import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  decodeNotificationPayload,
  decodeTransaction,
  decodeRenewalInfo,
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
 * Apple sends signed JWS payloads. Both the outer notification and inner
 * transaction payload are certificate-chain/signature verified before use.
 *
 * Apple docs: https://developer.apple.com/documentation/appstoreservernotifications
 *
 * Setup: paste this URL in App Store Connect → App Information →
 *   App Store Server Notifications → Production Server URL
 *
 */

const EXPECTED_BUNDLE_ID = 'com.novame.app'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Apple product ID → internal tier
const PRODUCT_TO_TIER = {
  'novame.plus.monthly':    'plus',
  'novame.plus.yearly':     'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly':  'plus',
}

// Apple product ID → seat model
const PRODUCT_TO_PLAN_TYPE = {
  'novame.plus.monthly':    'solo',
  'novame.plus.yearly':     'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly':  'duo',
}

const PRODUCT_TO_CYCLE = {
  'novame.plus.monthly':    'monthly', 'novame.plus.yearly':     'yearly',
  'novame.plusduo.monthly': 'monthly', 'novame.plusduo.yearly':  'yearly',
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
    // SECURITY (2026-08-07 audit): this bypass turns the payment webhook into
    // an unauthenticated "grant me Plus" endpoint. Honor it ONLY outside a
    // production deploy, so a stray prod env var can never disable verification.
    const verifyDisabled =
      process.env.WEBHOOK_VERIFY_DISABLED === 'true' && process.env.VERCEL_ENV !== 'production'

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
        return NextResponse.json({ received: false, error: 'Decode failed' }, { status: 400 })
      }
    } else {
      // Normal path: verify signature, cert chain, and Apple Root CA.
      try {
        notification = await decodeNotificationPayload(signedPayload)
      } catch (verifyErr) {
        console.error('[Apple webhook] SIGNATURE VERIFICATION FAILED:', verifyErr.message, '— rejecting payload. If this is a legitimate Apple notification, check whether Apple has rotated certificates (see Oct 2025 incident) and consider setting WEBHOOK_VERIFY_DISABLED=true as an emergency measure.')
        return NextResponse.json(
          { received: false, error: 'Signature verification failed' },
          { status: 401 }
        )
      }
    }

    // Check bundle ID — defense against cross-app notification spoofing.
    // Notification structure differs between data-bearing and summary
    // notifications; both have bundleId in their data/summary subfield.
    const actualBundleId = notification.data?.bundleId || notification.summary?.bundleId
    if (actualBundleId && actualBundleId !== EXPECTED_BUNDLE_ID) {
      console.warn('[Apple webhook] Bundle ID mismatch — expected', EXPECTED_BUNDLE_ID, 'got', actualBundleId, '— ignoring notification')
      return NextResponse.json({ received: false, error: 'Bundle ID mismatch' }, { status: 400 })
    }

    const notificationType = notification.notificationType   // e.g. "DID_RENEW"
    const subtype          = notification.subtype             // e.g. "INITIAL_BUY"
    const data             = notification.data

    console.log(`[Apple webhook] ${notificationType}${subtype ? ':'+subtype : ''} verified=${!verifyDisabled}`)

    // Stage 6.WebhookJWS bugfix: app-store-server-api's
    // decodeNotificationPayload verifies and decodes ONLY the outer
    // envelope. signedTransactionInfo and signedRenewalInfo remain
    // JWS strings inside the data field -- per the library's type
    // declarations (Models.d.ts) they're typed as JWSTransaction /
    // JWSRenewalInfo, which are string aliases not decoded objects.
    //
    // To get productId / originalTransactionId / expiresDate etc. we
    // must call decodeTransaction / decodeRenewalInfo on the inner
    // strings, which themselves do cert-chain + signature verification.
    //
    // The fallback path (verifyDisabled) decodes the inner JWS strings
    // without verification, mirroring the unsafe pre-Stage-6.WebhookJWS
    // behavior.
    let transactionInfo = null
    let renewalInfo     = null

    if (verifyDisabled) {
      if (typeof data?.signedTransactionInfo === 'string') {
        try {
          const parts = data.signedTransactionInfo.split('.')
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
          const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
          transactionInfo = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
        } catch { transactionInfo = null }
      }
      if (typeof data?.signedRenewalInfo === 'string') {
        try {
          const parts = data.signedRenewalInfo.split('.')
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
          const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
          renewalInfo = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
        } catch { renewalInfo = null }
      }
    } else {
      // Verified path: use library decoders which do full cert chain
      // verification on the inner JWS strings.
      if (data?.signedTransactionInfo) {
        try {
          transactionInfo = await decodeTransaction(data.signedTransactionInfo)
        } catch (txnErr) {
          console.error('[Apple webhook] inner transactionInfo verification failed:', txnErr.message)
        }
      }
      if (data?.signedRenewalInfo) {
        try {
          renewalInfo = await decodeRenewalInfo(data.signedRenewalInfo)
        } catch (renewErr) {
          console.error('[Apple webhook] inner renewalInfo verification failed:', renewErr.message)
        }
      }
    }

    const supabase = getSupabase()

    // Route by notification type
    switch (notificationType) {

      // ── New purchase or re-subscribe ──────────────────────────────────────
      case 'SUBSCRIBED':
      case 'DID_RENEW': {
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleActive(supabase, transactionInfo)
        break
      }

      // ── Renewal recovered after billing retry ─────────────────────────────
      case 'DID_RECOVER': {
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleActive(supabase, transactionInfo)
        break
      }

      // ── Apple reversed a previously granted refund ────────────────────────
      case 'REFUND_REVERSED': {
        if (!transactionInfo) throw new Error('Missing verified transaction info')
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
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleExpired(supabase, transactionInfo)
        break
      }

      // ── Refund granted ────────────────────────────────────────────────────
      case 'REFUND': {
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleExpired(supabase, transactionInfo, 'revoked')
        break
      }

      case 'REVOKE': {
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleExpired(supabase, transactionInfo, 'revoked')
        break
      }

      // ── Grace period started (billing failed, Apple is retrying) ──────────
      case 'GRACE_PERIOD_EXPIRED': {
        // Billing failed and grace period ended — downgrade
        if (!transactionInfo) throw new Error('Missing verified transaction info')
        await handleExpired(supabase, transactionInfo)
        break
      }

      // ── Offer redeemed, price increase consent, etc. — log only ──────────
      default:
        console.log('[Apple webhook] Unhandled type:', notificationType)
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('[Apple webhook] Error:', error)
    // A non-2xx response is intentional: App Store Server Notifications V2
    // retries transient processing failures instead of silently losing a
    // renewal/refund/expiry entitlement update.
    return NextResponse.json({ received: false, error: 'Processing failed' }, { status: 500 })
  }
}

/**
 * Activate or renew a subscription in the DB.
 */
async function handleActive(supabase, txn) {
  if (txn.bundleId !== EXPECTED_BUNDLE_ID) {
    throw new Error('Apple transaction bundleId mismatch')
  }
  const productId   = txn.productId
  const tier        = PRODUCT_TO_TIER[productId]
  const billingCycle = PRODUCT_TO_CYCLE[productId] || 'monthly'

  if (!tier) {
    console.warn('[Apple webhook] Unknown productId:', productId)
    throw new Error(`unknown Apple productId: ${productId}`)
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
    .select('user_id, current_period_start, current_period_end, status')
    .eq('apple_original_transaction_id', originalId)
    .maybeSingle()

  if (subErr) {
    console.error('[Apple webhook] subscriptions lookup error for originalTxnId=' + originalId + ':', subErr.message)
    throw new Error(`subscriptions lookup failed: ${subErr.message}`)
  }

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] No user has originalTransactionId=' + originalId + ' on file. This is normal for renewals on subscriptions purchased before this server saved apple_* columns; the user will need to re-purchase or restore. After Stage 6.IAPFix all new purchases write apple_* via apple-iap, so this warning should not recur for purchases post-deploy.')
    throw new Error(`unbound originalTransactionId: ${originalId}`)
  }

  const expiresDate = txn.expiresDate
    ? new Date(txn.expiresDate).toISOString()
    : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

  // #2/#3 (out-of-order + quota-reset guard): Apple does NOT guarantee
  // notification ordering and retries deliveries. Compare this event's
  // expiry against the period we already have on file.
  const incomingExpiryMs = new Date(expiresDate).getTime()
  const storedEndMs = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0
  // Stale/duplicate activation: we already have a period ending LATER than
  // this event's expiry -> ignore entirely (don't roll the period backward
  // or reset the quota window). Primary upgrade path is the client apple-iap
  // call; the webhook is confirmatory, so skipping a stale event here is safe.
  if (storedEndMs && incomingExpiryMs && incomingExpiryMs < storedEndMs) {
    console.warn(`[Apple webhook] stale activation ignored for user ${userId} (incoming expiry ${expiresDate} < stored end ${sub.current_period_end})`)
    return
  }
  const { data: applied, error: applyErr } = await supabase.rpc('apply_store_subscription', {
    p_user_id: userId,
    p_store: 'apple',
    p_plan: tier,
    p_plan_type: PRODUCT_TO_PLAN_TYPE[productId] || 'solo',
    p_billing_cycle: billingCycle,
    p_period_end: expiresDate,
    p_apple_transaction_id: String(txn.transactionId),
    p_apple_original_transaction_id: originalId,
    p_apple_product_id: productId,
  })
  if (applyErr) throw new Error(`atomic subscription apply failed: ${applyErr.message}`)
  if (!applied?.success) throw new Error(`subscription apply rejected: ${applied?.error || 'unknown'}`)

  console.log(`[Apple webhook] Activated ${tier} for user ${userId} until ${expiresDate}`)
}

/**
 * Downgrade user to free when subscription expires or is refunded.
 */
async function handleExpired(supabase, txn, terminalStatus = 'expired') {
  if (txn.bundleId !== EXPECTED_BUNDLE_ID) {
    throw new Error('Apple transaction bundleId mismatch')
  }
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
    .select('user_id, current_period_end')
    .eq('apple_original_transaction_id', originalId)
    .maybeSingle()

  if (subErr) {
    console.error('[Apple webhook] expired-lookup error for originalTxnId=' + originalId + ':', subErr.message)
    throw new Error(`expired subscription lookup failed: ${subErr.message}`)
  }

  const userId = sub?.user_id
  if (!userId) {
    console.warn('[Apple webhook] EXPIRED for unknown originalTxnId=' + originalId + ' — user not downgraded. Possible causes: (a) purchase pre-dates apple_* schema columns, (b) webhook signature spoofing (backlog: implement JWS verification).')
    throw new Error(`unbound expired originalTransactionId: ${originalId}`)
  }

  // #3 (out-of-order guard): a stale EXPIRED that arrives AFTER a newer
  // renewal must not downgrade an active subscriber. If we already have a
  // period ending LATER than this expiring transaction's expiry, a renewal
  // has superseded it -> ignore this event.
  const incomingExpiryMs = txn.expiresDate ? new Date(txn.expiresDate).getTime() : 0
  const storedEndMs = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : 0
  if (storedEndMs && incomingExpiryMs && storedEndMs > incomingExpiryMs) {
    console.warn(`[Apple webhook] stale EXPIRED ignored for user ${userId} (stored end ${sub.current_period_end} is later than expiring txn ${new Date(incomingExpiryMs).toISOString()} -> superseded by renewal)`)
    return
  }

  const eventEnd = incomingExpiryMs ? new Date(incomingExpiryMs).toISOString() : null
  const { data: expired, error: expireErr } = await supabase.rpc('expire_store_subscription', {
    p_user_id: userId,
    p_status: terminalStatus,
    p_event_period_end: eventEnd,
  })
  if (expireErr) throw new Error(`atomic expiration failed: ${expireErr.message}`)
  if (!expired?.success) throw new Error(`expiration rejected: ${expired?.error || 'unknown'}`)
  console.log(`[Apple webhook] Expired — user ${userId} entitlement reconciled`)
}

/**
 * GET /api/webhooks/apple — health check so Apple can verify the URL
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: 'visdom-apple-webhook' })
}
