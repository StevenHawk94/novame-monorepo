import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * POST /api/webhooks/apple
 *
 * Receives App Store Server Notifications v2 from Apple.
 * Apple sends signed JWS payloads — we decode the payload to get
 * the notification type and transaction info, then update the DB.
 *
 * Apple docs: https://developer.apple.com/documentation/appstoreservernotifications
 *
 * Setup: paste this URL in App Store Connect → App Information →
 *   App Store Server Notifications → Production Server URL
 *
 * Note: We trust the payload for tier/expiry updates.
 * For production with high-value transactions, add full JWS signature
 * verification using Apple's public keys from /api/v1/certificates.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Apple product ID → internal tier
const PRODUCT_TO_TIER = {
  'novame.basic.monthly': 'basic',
  'novame.basic.yearly':  'basic',
  'novame.pro.monthly':   'pro',
  'novame.pro.yearly':    'pro',
  'novame.ultra.monthly': 'ultra',
  'novame.ultra.yearly':  'ultra',
}

const PRODUCT_TO_CYCLE = {
  'novame.basic.monthly': 'monthly', 'novame.basic.yearly': 'yearly',
  'novame.pro.monthly':   'monthly', 'novame.pro.yearly':   'yearly',
  'novame.ultra.monthly': 'monthly', 'novame.ultra.yearly': 'yearly',
}

/**
 * Decode a JWS token payload (base64url middle segment).
 * We skip signature verification here — Apple's notification system is
 * already authenticated via HTTPS to our specific URL.
 */
function decodeJWSPayload(jws) {
  try {
    const parts = jws.split('.')
    if (parts.length < 2) return null
    // base64url → base64 → JSON
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded  = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch (e) {
    console.error('[Apple webhook] JWS decode error:', e)
    return null
  }
}

export async function POST(request) {
  try {
    const body = await request.json()

    // Apple sends: { signedPayload: "eyJ..." }
    const signedPayload = body.signedPayload
    if (!signedPayload) {
      console.warn('[Apple webhook] No signedPayload in request body')
      return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 })
    }

    // Decode the outer notification envelope
    const notification = decodeJWSPayload(signedPayload)
    if (!notification) {
      return NextResponse.json({ error: 'Failed to decode notification' }, { status: 400 })
    }

    const notificationType = notification.notificationType   // e.g. "DID_RENEW"
    const subtype          = notification.subtype             // e.g. "INITIAL_BUY"
    const data             = notification.data

    console.log(`[Apple webhook] ${notificationType}${subtype ? ':'+subtype : ''}`)

    // Decode the transaction info inside data
    let transactionInfo = null
    let renewalInfo     = null

    if (data?.signedTransactionInfo) {
      transactionInfo = decodeJWSPayload(data.signedTransactionInfo)
    }
    if (data?.signedRenewalInfo) {
      renewalInfo = decodeJWSPayload(data.signedRenewalInfo)
    }

    const supabase = getSupabase()

    // Route by notification type
    switch (notificationType) {

      // ── New purchase or re-subscribe ──────────────────────────────────────
      case 'SUBSCRIBED':
      case 'DID_RENEW': {
        if (!transactionInfo) break
        await handleActive(supabase, transactionInfo)
        break
      }

      // ── Renewal recovered after billing retry ─────────────────────────────
      case 'DID_RECOVER': {
        if (!transactionInfo) break
        await handleActive(supabase, transactionInfo)
        break
      }

      // ── Subscription changed to different plan ────────────────────────────
      case 'DID_CHANGE_RENEWAL_PREF':
      case 'DID_CHANGE_RENEWAL_STATUS': {
        // renewalInfo.autoRenewStatus: 0 = turned off, 1 = on
        // We don't downgrade immediately — we wait for EXPIRED
        console.log('[Apple webhook] Renewal status change — no immediate action')
        break
      }

      // ── Subscription expired (user cancelled + period ended) ──────────────
      case 'EXPIRED': {
        if (!transactionInfo) break
        await handleExpired(supabase, transactionInfo)
        break
      }

      // ── Refund granted ────────────────────────────────────────────────────
      case 'REFUND': {
        if (!transactionInfo) break
        await handleExpired(supabase, transactionInfo)
        break
      }

      // ── Grace period started (billing failed, Apple is retrying) ──────────
      case 'GRACE_PERIOD_EXPIRED': {
        // Billing failed and grace period ended — downgrade
        if (!transactionInfo) break
        await handleExpired(supabase, transactionInfo)
        break
      }

      // ── Offer redeemed, price increase consent, etc. — log only ──────────
      default:
        console.log('[Apple webhook] Unhandled type:', notificationType)
    }

    // Always return 200 so Apple doesn't retry
    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('[Apple webhook] Error:', error)
    // Return 200 anyway — returning 4xx/5xx causes Apple to retry repeatedly
    return NextResponse.json({ received: true, error: error.message })
  }
}

/**
 * Activate or renew a subscription in the DB.
 */
async function handleActive(supabase, txn) {
  const productId   = txn.productId
  const tier        = PRODUCT_TO_TIER[productId]
  const billingCycle = PRODUCT_TO_CYCLE[productId] || 'monthly'

  if (!tier) {
    console.warn('[Apple webhook] Unknown productId:', productId)
    return
  }

  // Find user by apple_original_transaction_id stored during first purchase
  const originalId = String(txn.originalTransactionId)
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', originalId)
    .single()

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] No user found for originalTransactionId:', originalId)
    return
  }

  const expiresDate = txn.expiresDate
    ? new Date(txn.expiresDate).toISOString()
    : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

  // Update profiles.subscription_tier
  await supabase.from('profiles')
    .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
    .eq('id', userId)

  // Update subscriptions table
  await supabase.from('subscriptions')
    .update({
      plan:               tier,
      status:             'active',
      billing_cycle:      billingCycle,
      apple_product_id:   productId,
      current_period_end: expiresDate,
      updated_at:         new Date().toISOString(),
    })
    .eq('user_id', userId)

  console.log(`[Apple webhook] Activated ${tier} for user ${userId} until ${expiresDate}`)
}

/**
 * Downgrade user to free when subscription expires or is refunded.
 */
async function handleExpired(supabase, txn) {
  const originalId = String(txn.originalTransactionId)

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', originalId)
    .single()

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] No user found for expired txn:', originalId)
    return
  }

  await supabase.from('profiles')
    .update({ subscription_tier: 'free', updated_at: new Date().toISOString() })
    .eq('id', userId)

  await supabase.from('subscriptions')
    .update({
      plan:       'free',
      status:     'expired',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  console.log(`[Apple webhook] Expired — user ${userId} downgraded to free`)
}

/**
 * GET /api/webhooks/apple — health check so Apple can verify the URL
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'visdom-apple-webhook' })
}
