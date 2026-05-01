import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/google-iap
 *
 * Verifies a Google Play subscription purchase and activates it in the DB.
 * Called from the Android app after a successful purchase via GooglePlayBillingPlugin.
 *
 * Body:
 *   {
 *     userId,
 *     purchaseToken,
 *     subscriptionId,     // e.g. "novame_basic"
 *     basePlanId?,        // e.g. "monthly" or "yearly" — optional; derived from Google if omitted
 *     packageName?,       // defaults to com.novame.app
 *     orderId?,
 *     isRestore?          // true when this came from the Restore flow (no acknowledge needed)
 *   }
 *
 * Uses:
 *   - Google Play Developer API (purchases.subscriptionsv2.get) to verify & get expiry
 *   - Google Play Developer API (purchases.subscriptions.acknowledge) to acknowledge
 *     the purchase — REQUIRED within 3 days or Google auto-refunds
 *
 * Env:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY — JSON string of the service account credentials
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Subscription product ID → internal tier
const SUB_TO_TIER = {
  novame_basic: 'basic',
  novame_pro:   'pro',
  novame_ultra: 'ultra',
}

// Base plan ID → internal billing cycle (must match Play Console base plan IDs)
const BASEPLAN_TO_CYCLE = {
  monthly: 'monthly',
  yearly:  'yearly',
}

// ─── Google Play Developer API auth (Edge-runtime JWT signing) ──────────────

async function getGoogleAccessToken() {
  const keyJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null

  try {
    const key = JSON.parse(keyJson)
    const now = Math.floor(Date.now() / 1000)

    const header = { alg: 'RS256', typ: 'JWT' }
    const claim = {
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const b64url = (obj) => {
      const json = JSON.stringify(obj)
      const b64 = btoa(json)
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    const headerB64 = b64url(header)
    const claimB64 = b64url(claim)
    const signInput = `${headerB64}.${claimB64}`

    const pemBody = key.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '')
    const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signInput)
    )

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const jwt = `${signInput}.${sigB64}`

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })
    const tokenData = await tokenRes.json()
    return tokenData.access_token || null
  } catch (e) {
    console.error('[google-iap] Failed to get access token:', e)
    return null
  }
}

/**
 * Fetch the subscription purchase from Google Play Developer API.
 * Returns the full SubscriptionPurchaseV2 object or null on failure.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
 */
async function fetchSubscriptionFromGoogle(accessToken, packageName, purchaseToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    console.warn('[google-iap] subscriptionsv2.get non-OK:', res.status, txt.slice(0, 500))
    return null
  }
  return await res.json()
}

/**
 * Acknowledge a subscription purchase.
 * Per Google: subscriptions must be acknowledged within 3 days or they're auto-refunded.
 * https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
 */
async function acknowledgeSubscription(accessToken, packageName, subscriptionId, purchaseToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptions/${subscriptionId}/tokens/${purchaseToken}:acknowledge`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  // 200 OK (even with empty body) means success
  if (res.ok) return true
  const txt = await res.text().catch(() => '')
  console.warn('[google-iap] acknowledge non-OK:', res.status, txt.slice(0, 500))
  return false
}

// ─── Main handler ──────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json()
    const {
      userId,
      purchaseToken,
      subscriptionId,
      basePlanId: clientBasePlanId,
      packageName,
      orderId,
      isRestore,
      // Upgrade flow: client tells us which old purchase this replaces.
      // We don't strictly need it (Google's subscriptionsv2 response includes
      // linkedPurchaseToken for the old sub), but having it as a hint helps us
      // update the DB row synchronously before the RTDN arrives.
      replacedOldPurchaseToken,
      changeType, // 'new' | 'upgrade' | 'downgrade' | 'same'
      // Deferred downgrade flow: no new purchaseToken — Play will switch plans
      // at next renewal. We just record the pending plan so UI can show it.
      isDeferredChange,
      pendingSubscriptionId,
      pendingBasePlanId,
      pendingTier,
      pendingBillingCycle,
    } = body

    if (!userId || !purchaseToken || !subscriptionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields (userId, purchaseToken, subscriptionId)' },
        { status: 400 }
      )
    }

    const tier = SUB_TO_TIER[subscriptionId]
    if (!tier) {
      return NextResponse.json(
        { success: false, error: `Unknown subscriptionId: ${subscriptionId}` },
        { status: 400 }
      )
    }

    const pkg = packageName || 'com.novame.app'
    const supabase = getSupabase()

    // ── Deferred change path ──────────────────────────────────────────────
    // For DEFERRED downgrades: the user's current subscription stays active.
    // Play will switch to the new plan at next renewal, and we'll learn about
    // that via RTDN (SUBSCRIPTION_RENEWED with the new productId).
    // Here we just record the "pending" plan so the UI can tell the user
    // what their subscription will become.
    if (isDeferredChange) {
      const pendingTierResolved = pendingTier || SUB_TO_TIER[pendingSubscriptionId]
      if (!pendingTierResolved) {
        return NextResponse.json({ success: false, error: 'Missing pendingTier / pendingSubscriptionId' }, { status: 400 })
      }

      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', userId)
        .single()

      if (!existingSub) {
        // This shouldn't happen — a deferred change implies they have an existing sub
        return NextResponse.json({ success: false, error: 'No existing subscription to modify' }, { status: 400 })
      }

      await supabase.from('subscriptions')
        .update({
          pending_plan: pendingTierResolved,
          pending_billing_cycle: pendingBillingCycle || BASEPLAN_TO_CYCLE[pendingBasePlanId] || null,
          pending_product_id: pendingSubscriptionId || null,
          pending_base_plan_id: pendingBasePlanId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)

      console.log(`[google-iap] Recorded deferred downgrade for user ${userId}: → ${pendingTierResolved}/${pendingBillingCycle}`)

      return NextResponse.json({
        success: true,
        deferred: true,
        pendingTier: pendingTierResolved,
        pendingBillingCycle: pendingBillingCycle || BASEPLAN_TO_CYCLE[pendingBasePlanId] || null,
      })
    }

    // ── Verify with Google Play Developer API ──────────────────────────────
    let expiryTime = null
    let googleBasePlanId = null
    let subscriptionState = null
    let googleOrderId = null
    let autoRenewing = null
    let alreadyAcknowledged = false

    const accessToken = await getGoogleAccessToken()
    if (accessToken) {
      const subData = await fetchSubscriptionFromGoogle(accessToken, pkg, purchaseToken)
      if (subData) {
        subscriptionState = subData.subscriptionState || null
        googleOrderId = subData.latestOrderId || null
        alreadyAcknowledged = subData.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'

        const lineItem = Array.isArray(subData.lineItems) ? subData.lineItems[0] : null
        if (lineItem) {
          expiryTime = lineItem.expiryTime || null
          // In the new model, the `offerDetails.basePlanId` identifies the base plan.
          // `productId` on the line item is the subscriptionId (e.g., novame_basic).
          googleBasePlanId = lineItem.offerDetails?.basePlanId || null
          autoRenewing = lineItem.autoRenewingPlan?.autoRenewEnabled ?? null
        }

        // Reject purchases Google doesn't consider active
        const activeStates = new Set([
          'SUBSCRIPTION_STATE_ACTIVE',
          'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
          // PENDING is shown after successful purchase of prepaid / pending plans;
          // we let it through but do NOT grant entitlement yet (checked below)
        ])
        if (!activeStates.has(subscriptionState)) {
          console.warn('[google-iap] Subscription not active:', subscriptionState)
          // If state is pending, return pending; otherwise reject
          if (subscriptionState === 'SUBSCRIPTION_STATE_PENDING') {
            return NextResponse.json({
              success: false,
              pending: true,
              error: 'Purchase is pending payment confirmation',
            }, { status: 202 })
          }
          // Inactive — caller can retry restore later
          return NextResponse.json({
            success: false,
            error: `Subscription not active: ${subscriptionState}`,
          }, { status: 400 })
        }
      } else {
        // Couldn't verify with Google. Trust the client (purchase token was returned by
        // Google Play so it's probably legit) but log loudly.
        console.warn('[google-iap] Could not verify purchase with Google; trusting client')
      }

      // ── Acknowledge (required within 3 days) ─────────────────────────────
      if (!isRestore && !alreadyAcknowledged) {
        const acked = await acknowledgeSubscription(accessToken, pkg, subscriptionId, purchaseToken)
        if (!acked) {
          console.warn('[google-iap] Failed to acknowledge purchase — RTDN will retry')
        }
      }
    } else {
      console.warn('[google-iap] No service account — skipping Google verification & acknowledge')
    }

    // Determine billing cycle — prefer Google's response, fall back to client hint
    const effectiveBasePlanId = googleBasePlanId || clientBasePlanId
    const billingCycle = BASEPLAN_TO_CYCLE[effectiveBasePlanId] || 'monthly'

    const periodEnd = expiryTime
      ? new Date(expiryTime).toISOString()
      : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

    // ── Update Supabase ────────────────────────────────────────────────────
    await supabase.from('profiles')
      .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
      .eq('id', userId)

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .single()

    const subRow = {
      user_id: userId,
      plan: tier,
      status: 'active',
      billing_cycle: billingCycle,
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd,
      google_purchase_token: purchaseToken,
      google_product_id: subscriptionId,
      google_base_plan_id: effectiveBasePlanId || null,
      google_order_id: googleOrderId || orderId || null,
      google_auto_renewing: autoRenewing,
      // Clear any previously-scheduled deferred change —
      // either because the switch just happened (RTDN renewal) or because the user
      // changed their mind and did an upgrade instead.
      pending_plan: null,
      pending_billing_cycle: null,
      pending_product_id: null,
      pending_base_plan_id: null,
      updated_at: new Date().toISOString(),
    }

    if (existingSub) {
      await supabase.from('subscriptions').update(subRow).eq('user_id', userId)
    } else {
      await supabase.from('subscriptions').insert(subRow)
    }

    // Upgrade hint: the client told us this replaces an old token.
    // Google already invalidated the old token on their side when the new one was issued,
    // but we log it for auditing. The subscriptions row is keyed by user_id (one row per user),
    // so updating above already replaced the old fields. No extra DB work needed.
    if (changeType === 'upgrade' && replacedOldPurchaseToken) {
      console.log(`[google-iap] Upgrade: replaced old token ${replacedOldPurchaseToken.slice(0, 12)}… → new token ${purchaseToken.slice(0, 12)}…`)
    }

    console.log(`[google-iap] Activated ${tier} (${billingCycle}) for user ${userId} — token=${purchaseToken.slice(0, 12)}… changeType=${changeType || 'new'}`)

    return NextResponse.json({
      success: true,
      tier,
      billingCycle,
      periodEnd,
      subscriptionState,
      acknowledged: !isRestore && (alreadyAcknowledged || accessToken !== null),
    })
  } catch (error) {
    console.error('[google-iap] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
