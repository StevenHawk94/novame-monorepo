import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { GoogleAuth } from 'google-auth-library'
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

class GooglePlayApiError extends Error {
  constructor(operation, status, reason) {
    super(`${operation} failed (${status})`)
    this.name = 'GooglePlayApiError'
    this.operation = operation
    this.status = status
    this.reason = reason
  }
}

async function googleErrorReason(res) {
  try {
    const body = await res.json()
    return body?.error?.status || body?.error?.message || null
  } catch {
    return null
  }
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
  if (!res.ok) {
    throw new GooglePlayApiError(
      'subscriptions.acknowledge',
      res.status,
      await googleErrorReason(res),
    )
  }
}

/** Use Google's maintained auth client instead of hand-rolling JWT exchange. */
async function getAccessToken(credentials) {
  const auth = new GoogleAuth({
    credentials: {
      client_email: credentials.email,
      private_key: credentials.privateKey.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  })
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token?.token) throw new Error('Google OAuth response missing access token')
  return token.token
}

async function fetchSubscription(accessToken, purchaseToken) {
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    throw new GooglePlayApiError(
      'subscriptionsv2.get',
      res.status,
      await googleErrorReason(res),
    )
  }
  return res.json()
}

function googleFailureResponse(error) {
  const status = error instanceof GooglePlayApiError ? error.status : null
  const reason = error instanceof GooglePlayApiError ? error.reason : null
  console.error('[google-iap] Google Play API failure', {
    operation: error instanceof GooglePlayApiError ? error.operation : 'oauth',
    status,
    reason,
    packageName: PACKAGE_NAME,
  })

  if (status === 404) {
    return NextResponse.json(
      {
        success: false,
        code: 'PURCHASE_NOT_FOUND',
        error: 'Google Play could not find this purchase for the installed app.',
      },
      { status: 422 },
    )
  }
  if (status === 401 || status === 403 || status === null) {
    return NextResponse.json(
      {
        success: false,
        code: 'GOOGLE_PLAY_CONFIGURATION_ERROR',
        error: 'Google Play verification is temporarily unavailable.',
      },
      { status: 503 },
    )
  }
  return NextResponse.json(
    {
      success: false,
      code: 'GOOGLE_PLAY_TEMPORARY_UNAVAILABLE',
      error: 'Google Play verification is temporarily unavailable.',
    },
    { status: status === 429 || (status && status >= 500) ? 503 : 502 },
  )
}

function isEntitledState(sub, periodEnd) {
  if (ACTIVE_STATES.has(sub.subscriptionState)) return true
  // A cancelled auto-renewing subscription remains entitled until its paid
  // period expires. Cancellation stops renewal; it does not revoke access.
  return sub.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED'
    && Boolean(periodEnd)
    && new Date(periodEnd).getTime() > Date.now()
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
      console.warn('[google-iap] auth rejected', { hasBearerToken: Boolean(token) })
      return NextResponse.json(
        { success: false, code: 'AUTH_INVALID', error: 'Your session needs to be refreshed.' },
        { status: 401 },
      )
    }

    const { userId, purchaseToken } = await request.json()
    if (verified.id !== userId) {
      console.warn('[google-iap] auth account mismatch')
      return NextResponse.json(
        { success: false, code: 'AUTH_ACCOUNT_CHANGED', error: 'The purchase was started by another account.' },
        { status: 409 },
      )
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
      accessToken = await getAccessToken(credentials)
      sub = await fetchSubscription(accessToken, purchaseToken)
    } catch (e) {
      return googleFailureResponse(e)
    }

    if (sub.subscriptionState === 'SUBSCRIPTION_STATE_PENDING') {
      return NextResponse.json(
        {
          success: false,
          pending: true,
          code: 'PURCHASE_PENDING',
          state: sub.subscriptionState,
          error: 'Your payment is still pending in Google Play.',
        },
        { status: 202 },
      )
    }
    if (sub.subscriptionState === 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED') {
      return NextResponse.json(
        {
          success: false,
          code: 'PURCHASE_PENDING_CANCELED',
          state: sub.subscriptionState,
          error: 'The pending Google Play purchase was canceled.',
        },
        { status: 409 },
      )
    }

    const line = selectCurrentLineItem(sub)
    const periodEnd = line?.expiryTime
      ? new Date(line.expiryTime).toISOString()
      : null

    if (!isEntitledState(sub, periodEnd)) {
      console.warn('[google-iap] purchase is not entitled', { state: sub.subscriptionState })
      return NextResponse.json(
        {
          success: false,
          code: 'SUBSCRIPTION_NOT_ENTITLED',
          state: sub.subscriptionState,
          error: 'This Google Play subscription is not currently entitled.',
        },
        { status: 409 },
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
    if (!periodEnd) {
      console.error('[google-iap] entitled subscription missing authoritative expiryTime')
      return NextResponse.json(
        {
          success: false,
          code: 'GOOGLE_PLAY_INVALID_RESPONSE',
          error: 'Google Play returned an incomplete subscription record.',
        },
        { status: 502 },
      )
    }

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

    const { error: environmentErr } = await supabase
      .from('subscriptions')
      .update({ store_environment: 'production' })
      .eq('user_id', userId)
    if (environmentErr) {
      console.warn('[google-iap] store environment persistence failed (non-fatal):', environmentErr.message)
    }

    // The mobile finishTransaction path also acknowledges, but the backend is
    // authoritative and covers restores/out-of-app completion. Only PURCHASED
    // subscriptions are acknowledged; retries are safe and idempotent.
    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      try {
        await acknowledgeSubscription(accessToken, productId, purchaseToken)
      } catch (ackError) {
        // Entitlement is already durably recorded. Return success so the app
        // can finishTransaction (which also acknowledges on Android). RTDN is
        // idempotent and will retry the server acknowledgement independently.
        console.error('[google-iap] acknowledgement pending after entitlement grant', {
          status: ackError instanceof GooglePlayApiError ? ackError.status : null,
          reason: ackError instanceof GooglePlayApiError ? ackError.reason : null,
        })
        return NextResponse.json({
          success: true,
          tier,
          billingCycle,
          periodEnd,
          acknowledgementPending: true,
        })
      }
    }

    return NextResponse.json({
      success: true,
      tier,
      billingCycle,
      periodEnd,
      acknowledgementPending: false,
    })
  } catch (err) {
    console.error('[google-iap] unexpected:', err && err.message)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
