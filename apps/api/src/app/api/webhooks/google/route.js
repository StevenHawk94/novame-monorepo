import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/** Google Play RTDN push endpoint. The notification is only a wake-up signal;
 * every entitlement decision below is re-derived from subscriptionsv2.get. */

const PACKAGE_NAME = 'com.burrow.app'
const SUB_TO_TIER = {
  'novame.plus.monthly': 'plus',
  'novame.plus.yearly': 'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly': 'plus',
}
const SUB_TO_PLAN_TYPE = {
  'novame.plus.monthly': 'solo',
  'novame.plus.yearly': 'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly': 'duo',
}
const SUB_TO_CYCLE = {
  'novame.plus.monthly': 'monthly',
  'novame.plus.yearly': 'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly': 'yearly',
}
const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
])

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function getGoogleAccessToken() {
  const keyJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY
    || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
  if (!keyJson) throw new Error('Google Play service account is not configured')

  const key = JSON.parse(keyJson)
  const now = Math.floor(Date.now() / 1000)
  const encode = value => btoa(JSON.stringify(value))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const claim = encode({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })
  const signInput = `${header}.${claim}`
  const pemBody = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const keyData = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput),
  )
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signInput}.${sig}`,
    }),
  })
  if (!tokenRes.ok) throw new Error(`Google OAuth failed: ${tokenRes.status}`)
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Google OAuth response missing access_token')
  return tokenData.access_token
}

async function fetchSubscription(accessToken, purchaseToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`subscriptionsv2.get failed: ${res.status}`)
  return res.json()
}

async function acknowledgeSubscription(accessToken, productId, purchaseToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (!res.ok) throw new Error(`Google acknowledgement failed: ${res.status}`)
}

function selectCurrentLineItem(subscription) {
  const known = (Array.isArray(subscription?.lineItems) ? subscription.lineItems : [])
    .filter(line => SUB_TO_TIER[line?.productId])
  if (!known.length) return null
  return known.sort((a, b) => {
    const aExpiry = a?.expiryTime ? new Date(a.expiryTime).getTime() : 0
    const bExpiry = b?.expiryTime ? new Date(b.expiryTime).getTime() : 0
    return bExpiry - aExpiry
  })[0]
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function ownerForCredential(supabase, credential) {
  if (!credential) return null
  const { data, error } = await supabase
    .from('store_credential_bindings')
    .select('user_id')
    .eq('store', 'google')
    .eq('credential', credential)
    .maybeSingle()
  if (error) throw new Error(`credential lookup failed: ${error.message}`)
  return data?.user_id || null
}

async function resolveUserId(supabase, purchaseToken, linkedPurchaseToken, subscription) {
  const tokenOwner = await ownerForCredential(supabase, purchaseToken)
  const linkedOwner = await ownerForCredential(supabase, linkedPurchaseToken)
  if (tokenOwner && linkedOwner && tokenOwner !== linkedOwner) {
    throw new Error('new and linked Google tokens have different owners')
  }

  const profileId = subscription?.externalAccountIdentifiers?.obfuscatedExternalProfileId
  const externalUserId = isUuid(profileId) ? profileId : null
  const knownOwner = tokenOwner || linkedOwner
  if (knownOwner && externalUserId && knownOwner !== externalUserId) {
    throw new Error('Google external profile identifier does not match token owner')
  }
  if (knownOwner) return knownOwner

  // Out-of-app re-subscriptions can arrive before the client. New builds attach
  // the opaque NovaMe UUID as obfuscatedProfileId so RTDN can bind safely.
  if (externalUserId) {
    const { data, error } = await supabase
      .from('profiles').select('id').eq('id', externalUserId).maybeSingle()
    if (error) throw new Error(`profile lookup failed: ${error.message}`)
    if (data?.id) return data.id
  }
  return null
}

export async function POST(request) {
  try {
    const body = await request.json()
    const messageData = body?.message?.data
    if (!messageData) {
      return NextResponse.json({ received: false, error: 'Missing message data' }, { status: 400 })
    }

    let decoded
    try {
      decoded = JSON.parse(atob(messageData))
    } catch (error) {
      console.warn('[Google webhook] invalid Pub/Sub payload:', error.message)
      return NextResponse.json({ received: false, error: 'Invalid payload' }, { status: 400 })
    }

    if (decoded.testNotification) {
      return NextResponse.json({ received: true, test: true })
    }
    if (!decoded.subscriptionNotification) {
      return NextResponse.json({ received: true, ignored: true })
    }
    if (decoded.packageName !== PACKAGE_NAME) {
      return NextResponse.json({ received: false, error: 'Unexpected package' }, { status: 400 })
    }

    const { purchaseToken } = decoded.subscriptionNotification
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      return NextResponse.json({ received: false, error: 'Missing purchase token' }, { status: 400 })
    }

    const accessToken = await getGoogleAccessToken()
    const subscription = await fetchSubscription(accessToken, purchaseToken)
    const line = selectCurrentLineItem(subscription)
    if (!line) {
      console.warn('[Google webhook] no supported product in authoritative line items')
      return NextResponse.json({ received: true, ignored: true })
    }

    const productId = line.productId
    const tier = SUB_TO_TIER[productId]
    const billingCycle = SUB_TO_CYCLE[productId]
    const planType = SUB_TO_PLAN_TYPE[productId]
    const periodEnd = line.expiryTime ? new Date(line.expiryTime).toISOString() : null
    const supabase = getSupabase()
    const userId = await resolveUserId(
      supabase,
      purchaseToken,
      subscription.linkedPurchaseToken || null,
      subscription,
    )
    if (!userId) {
      // Retry: the in-app verification path may bind the token shortly after
      // this RTDN arrives. Returning 200 here would permanently lose the event.
      throw new Error('Google purchase token is not bound to a NovaMe user')
    }

    if (ACTIVE_STATES.has(subscription.subscriptionState)) {
      if (!periodEnd) throw new Error('Active Google subscription missing expiryTime')
      const { data: applied, error: applyErr } = await supabase.rpc('apply_store_subscription', {
        p_user_id: userId,
        p_store: 'google',
        p_plan: tier,
        p_plan_type: planType,
        p_billing_cycle: billingCycle,
        p_period_end: periodEnd,
        p_google_purchase_token: purchaseToken,
        p_google_product_id: productId,
        p_google_base_plan_id: line?.offerDetails?.basePlanId || null,
        p_google_auto_renewing: line?.autoRenewingPlan?.autoRenewEnabled ?? null,
      })
      if (applyErr) throw new Error(`atomic subscription apply failed: ${applyErr.message}`)
      if (!applied?.success) throw new Error(`subscription apply rejected: ${applied?.error || 'unknown'}`)

      if (subscription.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
        await acknowledgeSubscription(accessToken, productId, purchaseToken)
      }
    } else if (
      subscription.subscriptionState === 'SUBSCRIPTION_STATE_PENDING'
      || subscription.subscriptionState === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'
    ) {
      // A pending replacement can point at a still-valid linked subscription.
      // It grants nothing, but must not revoke that existing entitlement.
      console.log(`[Google webhook] ${subscription.subscriptionState} — no entitlement change for user ${userId}`)
    } else if (subscription.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' && periodEnd && new Date(periodEnd).getTime() > Date.now()) {
      const { error } = await supabase.from('subscriptions').update({
        status: 'cancelled',
        google_auto_renewing: false,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
      if (error) throw new Error(`cancellation update failed: ${error.message}`)
    } else if (
      subscription.subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD'
      || subscription.subscriptionState === 'SUBSCRIPTION_STATE_PAUSED'
      || subscription.subscriptionState === 'SUBSCRIPTION_STATE_EXPIRED'
      || subscription.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED'
    ) {
      const status = subscription.subscriptionState === 'SUBSCRIPTION_STATE_ON_HOLD'
        ? 'on_hold'
        : subscription.subscriptionState === 'SUBSCRIPTION_STATE_PAUSED'
          ? 'paused'
          : 'expired'
      const { data: expired, error: expireErr } = await supabase.rpc('expire_store_subscription', {
        p_user_id: userId,
        p_status: status,
        p_event_period_end: periodEnd,
      })
      if (expireErr) throw new Error(`entitlement revoke failed: ${expireErr.message}`)
      if (!expired?.success) throw new Error(`entitlement revoke rejected: ${expired?.error || 'unknown'}`)
    } else {
      throw new Error(`Unsupported Google subscription state: ${subscription.subscriptionState}`)
    }

    console.log(`[Google webhook] reconciled ${subscription.subscriptionState} for user ${userId}`)
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Google webhook] processing failed:', error)
    // Pub/Sub retries every non-2xx delivery. Processing is idempotent, so a
    // transient Google/Supabase outage cannot permanently drop an entitlement.
    return NextResponse.json({ received: false, error: 'Processing failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'novame-google-webhook' })
}
