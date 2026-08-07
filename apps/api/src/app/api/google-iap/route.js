import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

// nodejs runtime: RS256 service-account JWT signing uses node crypto.
export const runtime = 'nodejs'

/**
 * POST /api/google-iap
 *
 * Android counterpart of /api/apple-iap. Called after a successful Play
 * Billing purchase/restore with { userId, productId, purchaseToken }.
 *
 * SECURITY (fail-closed, mirrors the apple route's JWS rule): the client's
 * productId/expiry are never trusted. The purchaseToken is verified against
 * the Google Play Developer API (subscriptionsv2.get) using a service
 * account, and the authoritative productId + expiry come from Google's
 * response. Missing env config -> 503 (route disabled), invalid token -> 401.
 *
 * Env:
 *   GOOGLE_PLAY_SA_EMAIL        service account email
 *   GOOGLE_PLAY_SA_PRIVATE_KEY  service account PEM key ("\n" escapes ok)
 */

const PACKAGE_NAME = 'com.novame.app'

const PRODUCT_TO_TIER = {
  'novame.plus.monthly':    'plus',
  'novame.plus.yearly':     'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly':  'plus',
}
const PRODUCT_TO_CYCLE = {
  'novame.plus.monthly':    'monthly',
  'novame.plus.yearly':     'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly':  'yearly',
}
const PRODUCT_TO_PLAN_TYPE = {
  'novame.plus.monthly':    'solo',
  'novame.plus.yearly':     'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly':  'duo',
}

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
])

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

/** Service-account OAuth token via a self-signed RS256 JWT grant. */
async function getAccessToken(email, privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(privateKey.replace(/\\n/g, '\n'), 'base64url')
  const assertion = `${header}.${claims}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) throw new Error(`oauth token exchange failed: ${res.status}`)
  const data = await res.json()
  if (!data.access_token) throw new Error('oauth response missing access_token')
  return data.access_token
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { userId, purchaseToken } = await request.json()
    if (verified.id !== userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (!purchaseToken || typeof purchaseToken !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing purchaseToken' },
        { status: 400 }
      )
    }

    const saEmail = process.env.GOOGLE_PLAY_SA_EMAIL
    const saKey = process.env.GOOGLE_PLAY_SA_PRIVATE_KEY
    if (!saEmail || !saKey) {
      console.error('[google-iap] service account env not configured')
      return NextResponse.json(
        { success: false, error: 'Play verification not configured' },
        { status: 503 }
      )
    }

    // ── Verify with Google (authoritative product + expiry) ──
    let sub
    try {
      const accessToken = await getAccessToken(saEmail, saKey)
      const res = await fetch(
        `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (!res.ok) {
        console.warn('[google-iap] rejected: verification failed', res.status)
        return NextResponse.json(
          { success: false, error: 'Invalid purchase token' },
          { status: 401 }
        )
      }
      sub = await res.json()
    } catch (e) {
      console.error('[google-iap] verification error:', e && e.message)
      return NextResponse.json(
        { success: false, error: 'Verification failed' },
        { status: 502 }
      )
    }

    if (!ACTIVE_STATES.has(sub.subscriptionState)) {
      console.warn('[google-iap] rejected: state', sub.subscriptionState)
      return NextResponse.json(
        { success: false, error: `Subscription not active (${sub.subscriptionState})` },
        { status: 401 }
      )
    }

    const line = Array.isArray(sub.lineItems) ? sub.lineItems[0] : null
    const productId = line?.productId
    const tier = PRODUCT_TO_TIER[productId]
    if (!tier) {
      return NextResponse.json(
        { success: false, error: `Unknown productId: ${productId}` },
        { status: 400 }
      )
    }
    const billingCycle = PRODUCT_TO_CYCLE[productId] || 'monthly'
    const planType = PRODUCT_TO_PLAN_TYPE[productId] || 'solo'
    const periodEnd = line?.expiryTime
      ? new Date(line.expiryTime).toISOString()
      : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (profileErr) {
      console.error('[google-iap] profile update error:', profileErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to update profile tier' },
        { status: 500 }
      )
    }

    // Preserve the billing-period anchor on re-reports of the same period
    // (same QuotaFix rule as apple-iap: resetting it would refill quotas).
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('current_period_start, current_period_end, status, plan')
      .eq('user_id', userId)
      .maybeSingle()
    const isSamePeriod =
      existingSub &&
      existingSub.status === 'active' &&
      existingSub.plan === tier &&
      existingSub.current_period_end &&
      new Date(periodEnd) <= new Date(existingSub.current_period_end)
    const periodStart = isSamePeriod
      ? existingSub.current_period_start
      : new Date().toISOString()

    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert({
        user_id: userId,
        plan: tier,
        plan_type: planType,
        status: 'active',
        billing_cycle: billingCycle,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        google_purchase_token: purchaseToken,
        google_product_id: productId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    if (subErr) {
      console.error('[google-iap] subscription upsert error:', subErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to record subscription' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, tier, billingCycle, periodEnd })
  } catch (err) {
    console.error('[google-iap] unexpected:', err && err.message)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
