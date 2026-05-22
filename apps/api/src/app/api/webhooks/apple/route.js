import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  decodeNotificationPayload,
  isDecodedNotificationDataPayload,
  isDecodedNotificationSummaryPayload,
  APPLE_ROOT_CA_G3_FINGERPRINT,
} from 'app-store-server-api'

// Stage 6.WebhookJWS: runtime switched from 'edge' to 'nodejs'
// because app-store-server-api uses Node's crypto module for
// X.509 certificate chain validation (not available in Edge).
// Cold start goes from ~10ms to ~200-500ms — fine for a
// server-to-server webhook (Apple gives 30s timeout window).
// All other routes in this project remain on Edge runtime.
export const runtime = 'nodejs'

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
 * Stage 6.WebhookJWS: decodeJWSPayload helper removed. Previously
 * this function did base64url decode without ANY signature
 * verification, so any HTTP client that knew the webhook URL could
 * forge notifications. Replaced with decodeNotificationPayload from
 * app-store-server-api which:
 *   1. Parses the JWS x5c header (3-cert chain: leaf, intermediate,
 *      Apple Root CA G3)
 *   2. Verifies x5c[2]'s SHA-256 fingerprint matches the embedded
 *      APPLE_ROOT_CA_G3_FINGERPRINT constant
 *   3. Validates the certificate chain (each cert signed by next)
 *   4. Extracts the leaf cert's ES256 public key
 *   5. Verifies the JWS signature using that public key
 *   6. Returns the typed decoded payload
 *
 * Throws if any step fails. Feature flag WEBHOOK_VERIFY_DISABLED
 * exists as an emergency fallback if Apple's certificate rotation
 * causes false rejections in production (see Oct 2025 incident
 * where Apple's own certificate expiry briefly broke verification
 * for everyone).
 */

export async function POST(request) {
  try {
    const body = await request.json()

    // Apple sends: { signedPayload: "eyJ..." }
    const signedPayload = body.signedPayload
    if (!signedPayload) {
      console.warn('[Apple webhook] No signedPayload in request body')
      return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 })
    }

    // Stage 6.WebhookJWS: full JWS signature + cert-chain + Apple
    // Root CA fingerprint verification before trusting the payload.
    //
    // Emergency feature flag: if Apple has another certificate
    // rotation incident (Oct 2025 had one), setting
    // WEBHOOK_VERIFY_DISABLED=true in Vercel env vars will skip
    // verification temporarily. NEVER leave this on in normal
    // operation -- it disables the entire defense.
    let notification
    const verifyDisabled = process.env.WEBHOOK_VERIFY_DISABLED === 'true'

    if (verifyDisabled) {
      // Fallback path: base64url decode without verification.
      console.warn('[Apple webhook] WEBHOOK_VERIFY_DISABLED=true — signature verification skipped. This should only be used during Apple certificate incidents.')
      try {
        const parts = signedPayload.split('.')
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
        notification = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
      } catch (decodeErr) {
        console.error('[Apple webhook] Fallback decode failed:', decodeErr.message)
        return NextResponse.json({ received: true, error: 'Decode failed' })
      }
    } else {
      // Normal path: verify signature, cert chain, and Apple Root CA.
      try {
        notification = await decodeNotificationPayload(signedPayload)
      } catch (verifyErr) {
        console.error('[Apple webhook] SIGNATURE VERIFICATION FAILED:', verifyErr.message, '— rejecting payload. If this is a legitimate Apple notification, check whether Apple has rotated certificates (see Oct 2025 incident) and consider setting WEBHOOK_VERIFY_DISABLED=true as an emergency measure.')
        // Return 200 not 401: returning 4xx/5xx causes Apple to
        // retry up to 5 times over 3 days, amplifying load if our
        // verification is misconfigured. Return 200 + log so legit
        // notifications get dropped silently (worse than retry,
        // but bounded) while we investigate.
        return NextResponse.json({ received: true, error: 'Signature verification failed' })
      }
    }

    // Check bundle ID — defense against cross-app notification spoofing.
    // Notification structure differs between data-bearing and summary
    // notifications; both have bundleId in their data/summary subfield.
    const expectedBundleId = 'com.novame.app'
    const actualBundleId = notification.data?.bundleId || notification.summary?.bundleId
    if (actualBundleId && actualBundleId !== expectedBundleId) {
      console.warn('[Apple webhook] Bundle ID mismatch — expected', expectedBundleId, 'got', actualBundleId, '— ignoring notification')
      return NextResponse.json({ received: true })
    }

    const notificationType = notification.notificationType   // e.g. "DID_RENEW"
    const subtype          = notification.subtype             // e.g. "INITIAL_BUY"
    const data             = notification.data

    console.log(`[Apple webhook] ${notificationType}${subtype ? ':'+subtype : ''} verified=${!verifyDisabled}`)

    // The library already decoded signedTransactionInfo and
    // signedRenewalInfo for us (in the verified path) -- they come
    // back as plain objects, not still-encoded JWS strings. In the
    // fallback (verifyDisabled) path the data field still has the
    // raw signed JWS strings, so we must decode them unverified.
    let transactionInfo = data?.signedTransactionInfo || null
    let renewalInfo     = data?.signedRenewalInfo || null

    if (verifyDisabled && typeof transactionInfo === 'string') {
      try {
        const parts = transactionInfo.split('.')
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
        transactionInfo = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
      } catch { transactionInfo = null }
    }
    if (verifyDisabled && typeof renewalInfo === 'string') {
      try {
        const parts = renewalInfo.split('.')
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
        renewalInfo = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
      } catch { renewalInfo = null }
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

  // Find user by apple_original_transaction_id stored during first purchase.
  //
  // Stage 6.IAPFix: surface the underlying error (column missing,
  // RLS denied, etc) instead of swallowing it. The pre-fix code
  // destructured only `data` and discarded `error`, so when the
  // apple_* schema columns didn't yet exist this branch silently
  // returned no rows + the warn line below fired with a generic
  // "no user found" that hid the real problem (PostgreSQL error
  // "column apple_original_transaction_id does not exist"). The
  // schema migration in this commit adds the columns, but the
  // diagnostic is kept so future drift is caught faster.
  const originalId = String(txn.originalTransactionId)
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', originalId)
    .maybeSingle()

  if (subErr) {
    console.error('[Apple webhook] subscriptions lookup error for originalTxnId=' + originalId + ':', subErr.message)
    return
  }

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] No user has originalTransactionId=' + originalId + ' on file. This is normal for renewals on subscriptions purchased before this server saved apple_* columns; the user will need to re-purchase or restore. After Stage 6.IAPFix all new purchases write apple_* via apple-iap, so this warning should not recur for purchases post-deploy.')
    return
  }

  const expiresDate = txn.expiresDate
    ? new Date(txn.expiresDate).toISOString()
    : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

  // Update profiles.subscription_tier
  await supabase.from('profiles')
    .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
    .eq('id', userId)

  // Update subscriptions table.
  //
  // Stage 6.QuotaFix: current_period_start is now refreshed on every
  // renewal (previously this update block only touched
  // current_period_end, leaving period_start frozen at the original
  // upgrade timestamp -- which made the quota counter window grow
  // unbounded over time instead of resetting each billing cycle).
  //
  // We use new Date() (webhook arrival time) as a close-enough proxy
  // for the true Apple renewal time. In normal operation this is
  // accurate to within seconds; under webhook retry it could drift
  // by minutes. For a higher-fidelity timestamp we would parse
  // txn.purchaseDate from the JWS payload, but the seconds-to-minutes
  // approximation is fine for a monthly/yearly quota window.
  await supabase.from('subscriptions')
    .update({
      plan:                 tier,
      status:               'active',
      billing_cycle:        billingCycle,
      apple_product_id:     productId,
      current_period_start: new Date().toISOString(),
      current_period_end:   expiresDate,
      updated_at:           new Date().toISOString(),
    })
    .eq('user_id', userId)

  console.log(`[Apple webhook] Activated ${tier} for user ${userId} until ${expiresDate}`)
}

/**
 * Downgrade user to free when subscription expires or is refunded.
 */
async function handleExpired(supabase, txn) {
  // Stage 6.IAPFix: same diagnostic improvement as handleActive.
  // Note: an unfound expired notification is more concerning than
  // an unfound activation, because failing to process it leaves
  // the user permanently on a paid tier in profiles after Apple
  // has stopped billing them (Apple stops, our DB doesn't know,
  // user enjoys lifetime paid features). The warn is preserved
  // until JWS signature verification is added (backlog), at
  // which point we can also start parsing transactionId out of
  // the signed payload and match on that as a secondary lookup.
  const originalId = String(txn.originalTransactionId)

  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('apple_original_transaction_id', originalId)
    .maybeSingle()

  if (subErr) {
    console.error('[Apple webhook] expired-lookup error for originalTxnId=' + originalId + ':', subErr.message)
    return
  }

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] EXPIRED for unknown originalTxnId=' + originalId + ' — user not downgraded. Possible causes: (a) purchase pre-dates apple_* schema columns, (b) webhook signature spoofing (backlog: implement JWS verification).')
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
