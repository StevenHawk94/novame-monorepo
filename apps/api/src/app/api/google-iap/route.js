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
 * Env (preferred):
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY  complete service-account JSON
 * Legacy split env is also accepted:
 *   GOOGLE_PLAY_SA_EMAIL / GOOGLE_PLAY_SA_PRIVATE_KEY
 */

const PACKAGE_NAME = 'com.burrow.app'

const SUBSCRIPTION_TO_TIER = {
  'novame.plus.monthly': 'plus',
  'novame.plus.yearly': 'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly': 'plus',
}
const SUBSCRIPTION_TO_CYCLE = {
  'novame.plus.monthly': 'monthly',
  'novame.plus.yearly': 'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly': 'yearly',
}
const SUBSCRIPTION_TO_PLAN_TYPE = {
  'novame.plus.monthly': 'solo',
  'novame.plus.yearly': 'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly': 'duo',
}

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
])

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function obfuscatedAccountId(userId) {
  return crypto.createHash('sha256').update(`novame:${userId}`).digest('hex')
}

function selectCurrentLineItem(sub) {
  const known = (Array.isArray(sub?.lineItems) ? sub.lineItems : [])
    .filter(line => SUBSCRIPTION_TO_TIER[line?.productId])
  if (!known.length) return null
  return known.sort((a, b) => {
    const aExpiry = a?.expiryTime ? new Date(a.expiryTime).getTime() : 0
    const bExpiry = b?.expiryTime ? new Date(b.expiryTime).getTime() : 0
    return bExpiry - aExpiry
  })[0]
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

function getServiceAccountCredentials() {
  const keyJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY
    || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT
  if (keyJson) {
    try {
      const key = JSON.parse(keyJson)
      if (key.client_email && key.private_key) {
        return { email: key.client_email, privateKey: key.private_key }
      }
    } catch (error) {
      console.error('[google-iap] invalid GOOGLE_PLAY_SERVICE_ACCOUNT_KEY JSON:', error.message)
    }
  }
  const email = process.env.GOOGLE_PLAY_SA_EMAIL
  const privateKey = process.env.GOOGLE_PLAY_SA_PRIVATE_KEY
  return email && privateKey ? { email, privateKey } : null
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

    const credentials = getServiceAccountCredentials()
    if (!credentials) {
      console.error('[google-iap] service account env not configured')
      return NextResponse.json(
        { success: false, error: 'Play verification not configured' },
        { status: 503 }
      )
    }

    // ── Verify with Google (authoritative product + expiry) ──
    let sub
    let accessToken
    try {
      accessToken = await getAccessToken(credentials.email, credentials.privateKey)
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

    const externalIds = sub.externalAccountIdentifiers || {}
    const expectedAccountId = obfuscatedAccountId(userId)
    if (
      (externalIds.obfuscatedExternalAccountId && externalIds.obfuscatedExternalAccountId !== expectedAccountId)
      || (externalIds.obfuscatedExternalProfileId && externalIds.obfuscatedExternalProfileId !== userId)
    ) {
      console.warn('[google-iap] rejected: Play account identifiers belong to another user')
      return NextResponse.json(
        { success: false, error: 'Purchase belongs to another account' },
        { status: 409 }
      )
    }

    const line = selectCurrentLineItem(sub)
    const productId = line?.productId
    const basePlanId = line?.offerDetails?.basePlanId
    const tier = SUBSCRIPTION_TO_TIER[productId]
    if (!tier) {
      return NextResponse.json(
        { success: false, error: `Unknown productId: ${productId}` },
        { status: 400 }
      )
    }
    const billingCycle = SUBSCRIPTION_TO_CYCLE[productId]
    const planType = SUBSCRIPTION_TO_PLAN_TYPE[productId]
    const periodEnd = line?.expiryTime
      ? new Date(line.expiryTime).toISOString()
      : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    if (sub.linkedPurchaseToken) {
      const { data: linkedBinding, error: linkedErr } = await supabase
        .from('store_credential_bindings')
        .select('user_id')
        .eq('store', 'google')
        .eq('credential', sub.linkedPurchaseToken)
        .maybeSingle()
      if (linkedErr) {
        console.error('[google-iap] linked token lookup failed:', linkedErr.message)
        return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 })
      }
      if (linkedBinding?.user_id && linkedBinding.user_id !== userId) {
        console.warn('[google-iap] rejected: linked token belongs to another user')
        return NextResponse.json(
          { success: false, error: 'Purchase belongs to another account' },
          { status: 409 }
        )
      }
    }

    const autoRenewEnabled = line?.autoRenewingPlan?.autoRenewEnabled ?? null
    const { data: applied, error: applyErr } = await supabase.rpc('apply_store_subscription', {
      p_user_id: userId,
      p_store: 'google',
      p_plan: tier,
      p_plan_type: planType,
      p_billing_cycle: billingCycle,
      p_period_end: periodEnd,
      p_google_purchase_token: purchaseToken,
      p_google_product_id: productId,
      p_google_base_plan_id: basePlanId,
      p_google_auto_renewing: autoRenewEnabled,
    })
    if (applyErr) {
      console.error('[google-iap] atomic subscription apply failed:', applyErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to activate subscription' },
        { status: 500 }
      )
    }
    if (!applied?.success) {
      const conflict = applied?.error === 'credential_owned_by_another_user'
      console.warn('[google-iap] subscription rejected:', applied?.error)
      return NextResponse.json(
        { success: false, error: conflict ? 'Purchase belongs to another account' : 'Failed to activate subscription' },
        { status: conflict ? 409 : 500 }
      )
    }

    // The mobile finishTransaction path also acknowledges, but the backend is
    // authoritative and covers restores/out-of-app completion. Only PURCHASED
    // subscriptions are acknowledged; retries are safe and idempotent.
    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      try {
        await acknowledgeSubscription(accessToken, productId, purchaseToken)
      } catch (ackError) {
        console.error('[google-iap] acknowledgement failed:', ackError.message)
        return NextResponse.json(
          { success: false, error: 'Purchase recorded but acknowledgement is pending' },
          { status: 502 }
        )
      }
    }

    return NextResponse.json({ success: true, tier, billingCycle, periodEnd })
  } catch (err) {
    console.error('[google-iap] unexpected:', err && err.message)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
