import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/webhooks/google
 *
 * Receives Google Play Real-Time Developer Notifications (RTDN) via Pub/Sub.
 *
 * Setup (one-time, done in Google Cloud + Play Console):
 * 1. Enable Cloud Pub/Sub API in the GCP project
 * 2. Create a Pub/Sub topic; add google-play-developer-notifications@system.gserviceaccount.com
 *    as a Publisher on the topic
 * 3. Create a push subscription on the topic that POSTs to THIS URL
 *    (https://api.soulsayit.com/api/webhooks/google)
 * 4. Paste the topic full name in Play Console → Monetize → Monetization setup → RTDN
 *
 * Note: RTDN payloads only contain { subscriptionId, purchaseToken } in the new model.
 * To learn the basePlanId / expiry / state we must call purchases.subscriptionsv2.get.
 *
 * Docs: https://developer.android.com/google/play/billing/rtdn-reference
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

const SUB_TO_TIER = {
  novame_basic: 'basic',
  novame_pro:   'pro',
  novame_ultra: 'ultra',
}

const BASEPLAN_TO_CYCLE = {
  monthly: 'monthly',
  yearly:  'yearly',
}

// Notification types: https://developer.android.com/google/play/billing/rtdn-reference#sub
const NOTIFICATION_TYPES = {
  1:  'RECOVERED',
  2:  'RENEWED',
  3:  'CANCELED',              // voluntary cancel — access remains until expiryTime
  4:  'PURCHASED',
  5:  'ON_HOLD',
  6:  'IN_GRACE_PERIOD',
  7:  'RESTARTED',
  8:  'PRICE_CHANGE_CONFIRMED',
  9:  'DEFERRED',
  10: 'PAUSED',
  11: 'PAUSE_SCHEDULE_CHANGED',
  12: 'REVOKED',               // refund — revoke entitlement immediately
  13: 'EXPIRED',
  20: 'PENDING_PURCHASE_CANCELED',
}

// Which notification types grant / renew the entitlement
const ACTIVATE_TYPES = new Set([1, 2, 4, 7]) // RECOVERED, RENEWED, PURCHASED, RESTARTED

// Which notification types revoke the entitlement immediately
const REVOKE_TYPES = new Set([12, 13]) // REVOKED, EXPIRED

// ─── Google API auth (same logic as google-iap route) ──────────────────────

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
    const b64url = obj => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const signInput = `${b64url(header)}.${b64url(claim)}`
    const pemBody = key.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\s/g, '')
    const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
    const cryptoKey = await crypto.subtle.importKey('pkcs8', keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey,
      new TextEncoder().encode(signInput))
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
    console.error('[Google webhook] Failed to get access token:', e)
    return null
  }
}

async function fetchSubscription(accessToken, packageName, purchaseToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return null
  return await res.json()
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json()

    // Google Pub/Sub wraps payload: { message: { data: "base64..." } }
    const messageData = body?.message?.data
    if (!messageData) {
      console.warn('[Google webhook] No message data')
      return NextResponse.json({ received: true })
    }

    let decoded
    try {
      decoded = JSON.parse(atob(messageData))
    } catch (e) {
      console.error('[Google webhook] Failed to decode message:', e)
      return NextResponse.json({ received: true })
    }

    // Three notification types: subscriptionNotification, oneTimeProductNotification, testNotification
    if (decoded.testNotification) {
      console.log('[Google webhook] Test notification received — OK')
      return NextResponse.json({ received: true })
    }

    const subNotif = decoded.subscriptionNotification
    if (!subNotif) {
      console.log('[Google webhook] Non-subscription notification, ignoring')
      return NextResponse.json({ received: true })
    }

    const { notificationType, purchaseToken, subscriptionId } = subNotif
    const typeName = NOTIFICATION_TYPES[notificationType] || `UNKNOWN(${notificationType})`
    const pkg = decoded.packageName || 'com.novame.app'

    console.log(`[Google webhook] ${typeName} — subscriptionId=${subscriptionId}`)

    const tier = SUB_TO_TIER[subscriptionId]
    if (!tier) {
      console.warn('[Google webhook] Unknown subscriptionId:', subscriptionId)
      return NextResponse.json({ received: true })
    }

    const supabase = getSupabase()

    // Call subscriptionsv2.get for authoritative state FIRST — we need linkedPurchaseToken
    // to resolve upgrade scenarios (where the new purchaseToken is brand new and doesn't
    // yet exist in our DB, but the OLD token does).
    let lineItem = null
    let subscriptionState = null
    let autoRenewEnabled = null
    let linkedPurchaseToken = null
    const accessToken = await getGoogleAccessToken()
    if (accessToken) {
      const subData = await fetchSubscription(accessToken, pkg, purchaseToken)
      if (subData) {
        subscriptionState = subData.subscriptionState
        lineItem = Array.isArray(subData.lineItems) ? subData.lineItems[0] : null
        autoRenewEnabled = lineItem?.autoRenewingPlan?.autoRenewEnabled ?? null
        // linkedPurchaseToken points to the OLD subscription this one replaces
        // (upgrade/downgrade-apply/resubscribe scenarios)
        linkedPurchaseToken = subData.linkedPurchaseToken || null
      }
    }

    // Find the user by purchase token.
    // Preferred: the new token matches an existing row (client-side /api/google-iap
    //            already wrote it). This is the normal case for PURCHASED events.
    // Fallback:  the new token isn't in the DB yet, but linkedPurchaseToken is —
    //            happens when RTDN arrives before our client-side verification,
    //            or for upgrade events where Play issues the new token directly.
    let { data: sub } = await supabase
      .from('subscriptions')
      .select('user_id, plan, billing_cycle')
      .eq('google_purchase_token', purchaseToken)
      .single()

    if (!sub?.user_id && linkedPurchaseToken) {
      console.log(`[Google webhook] New token not yet in DB; trying linkedPurchaseToken=${linkedPurchaseToken.slice(0, 12)}…`)
      const { data: oldSub } = await supabase
        .from('subscriptions')
        .select('user_id, plan, billing_cycle')
        .eq('google_purchase_token', linkedPurchaseToken)
        .single()
      if (oldSub?.user_id) {
        sub = oldSub
        // Migrate the row to the new token — we now own this subscription under the new token
        await supabase.from('subscriptions')
          .update({ google_purchase_token: purchaseToken, updated_at: new Date().toISOString() })
          .eq('user_id', oldSub.user_id)
        console.log(`[Google webhook] Migrated user ${oldSub.user_id} to new token via linkedPurchaseToken`)
      }
    }

    if (!sub?.user_id) {
      console.warn('[Google webhook] No user found for purchaseToken or linkedPurchaseToken — dropping')
      return NextResponse.json({ received: true })
    }
    const userId = sub.user_id

    const googleBasePlanId = lineItem?.offerDetails?.basePlanId || null
    const billingCycle = BASEPLAN_TO_CYCLE[googleBasePlanId] || sub.billing_cycle || 'monthly'
    const expiryTime = lineItem?.expiryTime || null

    // ── Route by notification type ──────────────────────────────────────────

    if (ACTIVATE_TYPES.has(notificationType)) {
      const periodEnd = expiryTime
        ? new Date(expiryTime).toISOString()
        : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

      await supabase.from('profiles')
        .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
        .eq('id', userId)

      await supabase.from('subscriptions')
        .update({
          plan: tier,
          status: 'active',
          billing_cycle: billingCycle,
          current_period_end: periodEnd,
          google_product_id: subscriptionId,           // sync in case of upgrade
          google_base_plan_id: googleBasePlanId,
          google_auto_renewing: autoRenewEnabled,
          // The deferred change (if any) has now taken effect — clear pending fields
          pending_plan: null,
          pending_billing_cycle: null,
          pending_product_id: null,
          pending_base_plan_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)

      console.log(`[Google webhook] Activated ${tier}/${billingCycle} for user ${userId}${linkedPurchaseToken ? ' (replaced old sub)' : ''}`)
    } else if (notificationType === 3) {
      // CANCELED — user initiated cancel, access remains until expiryTime
      await supabase.from('subscriptions')
        .update({
          status: 'cancelled',
          google_auto_renewing: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
      console.log(`[Google webhook] Cancelled for user ${userId} — access continues until period end`)
    } else if (notificationType === 5 || notificationType === 6) {
      // ON_HOLD (5) or IN_GRACE_PERIOD (6)
      await supabase.from('subscriptions')
        .update({
          status: notificationType === 5 ? 'on_hold' : 'grace_period',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
      console.log(`[Google webhook] ${typeName} for user ${userId}`)
    } else if (REVOKE_TYPES.has(notificationType)) {
      // REVOKED (12) or EXPIRED (13) — downgrade to free immediately
      await supabase.from('profiles')
        .update({ subscription_tier: 'free', updated_at: new Date().toISOString() })
        .eq('id', userId)
      await supabase.from('subscriptions')
        .update({
          plan: 'free',
          status: notificationType === 12 ? 'revoked' : 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
      console.log(`[Google webhook] ${typeName} — user ${userId} downgraded to free`)
    } else {
      console.log(`[Google webhook] Unhandled type ${typeName} for user ${userId}`)
    }

    // Always return 200 so Google doesn't retry
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Google webhook] Error:', error)
    // Still return 200 — avoid retry storms; log and move on
    return NextResponse.json({ received: true })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'novame-google-webhook' })
}
