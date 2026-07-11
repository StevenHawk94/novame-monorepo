import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'
import { decodeTransaction } from 'app-store-server-api'

// A2: nodejs runtime required -- app-store-server-api's decodeTransaction
// uses Node crypto for X.509 cert-chain validation (not available on Edge),
// same as webhooks/apple. Cold start ~200-500ms; fine for this endpoint.
export const runtime = 'nodejs'

/**
 * POST /api/apple-iap
 *
 * Called from the iOS app after a successful StoreKit 2 purchase or restore.
 * Receives transaction info from the client, validates it, and activates
 * the subscription in the database.
 *
 * Body:
 *   {
 *     userId,
 *     transactionId,              // StoreKit Transaction.id
 *     productId,                  // e.g. "novame.basic.monthly"
 *     originalTransactionId,      // StoreKit Transaction.originalID (links renewals)
 *     expiresDate,                // ISO string or null (null for lifetime)
 *   }
 *
 * Flow:
 *   1. Map productId → tier + billingCycle
 *   2. Upsert subscriptions table (keyed by user_id)
 *   3. Update profiles.subscription_tier
 *   4. Return { success, tier, billingCycle, periodEnd }
 *
 * Server-side receipt verification with Apple's App Store Server API
 * is handled via the Apple webhook (webhooks/apple/route.js) which
 * receives signed notifications for renewals, expirations, and refunds.
 * This endpoint trusts the client-provided transactionId because:
 *   - StoreKit 2 transactions are locally verified by the OS
 *   - The webhook provides ongoing server-to-server validation
 *   - If a transaction is fraudulent, Apple's webhook will send REFUND
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

// Apple product ID → billing cycle
const PRODUCT_TO_CYCLE = {
  'novame.basic.monthly': 'monthly',
  'novame.basic.yearly':  'yearly',
  'novame.pro.monthly':   'monthly',
  'novame.pro.yearly':    'yearly',
  'novame.ultra.monthly': 'monthly',
  'novame.ultra.yearly':  'yearly',
}

export async function POST(request) {
  try {
    // A2: let (not const) -- productId/transactionId/originalTransactionId/
    // expiresDate are re-derived from Apple's verified JWS below.
    let {
      userId,
      transactionId,
      productId,
      originalTransactionId,
      expiresDate,
      jws,
    } = await request.json()

    if (!userId || !transactionId || !productId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields (userId, transactionId, productId)' },
        { status: 400 }
      )
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2 batch 5): require Bearer token
    // matching body.userId. Without this guard, an anon caller could
    // POST any { userId, fake transactionId, productId: 'novame.ultra.
    // yearly' } and the route would activate an Ultra subscription
    // for that target user. The header comment about Apple's webhook
    // auto-refunding fake transactions is too optimistic -- the
    // webhook only acts on real Apple server-to-server notifications,
    // so a fake transactionId never triggers a REFUND event.
    //
    // Mobile attaches the token via apiClient (iap.ts:658), called
    // from uploadPurchaseToServer() which already requires an active
    // Supabase session (no purchase flow runs pre-signup), so the
    // gate has zero impact on legitimate paths.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[apple-iap] rejected: no bearer token')
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const _authUser = await verifyToken(token); const _authErr = _authUser ? null : new Error('invalid token')
    if (_authErr || !_authUser) {
      console.warn('[apple-iap] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[apple-iap] rejected: token user', _authUser.id, '!= body userId', userId)
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // ============================================================
    // SECURITY (A2): verify the StoreKit 2 signed transaction (JWS) with
    // Apple before granting anything. This route previously trusted the
    // client-supplied productId/expiresDate/transactionId, so a signed-in
    // user could POST productId:'novame.ultra.yearly' + a far-future expiry
    // and self-grant Ultra for free (the webhook only fires for REAL Apple
    // transactions, so a fabricated id is never caught/refunded). We now
    // REQUIRE the JWS (purchase.purchaseToken on the client) and re-derive
    // the authoritative fields from Apple's signed payload. decodeTransaction
    // verifies the cert chain + signature (same lib + pattern as the Apple
    // webhook). Fail-closed: no jws / invalid / wrong bundle -> 401.
    // ============================================================
    if (!jws || typeof jws !== 'string') {
      console.warn('[apple-iap] rejected: missing jws')
      return NextResponse.json(
        { success: false, error: 'Missing signed transaction', code: 'JWS_REQUIRED' },
        { status: 401 }
      )
    }
    let verifiedTxn
    try {
      verifiedTxn = await decodeTransaction(jws)
    } catch (e) {
      console.warn('[apple-iap] rejected: JWS verification failed:', e && e.message)
      return NextResponse.json(
        { success: false, error: 'Invalid signed transaction' },
        { status: 401 }
      )
    }
    const EXPECTED_BUNDLE_ID = 'com.novame.app'
    if (verifiedTxn.bundleId && verifiedTxn.bundleId !== EXPECTED_BUNDLE_ID) {
      console.warn('[apple-iap] rejected: bundleId mismatch', verifiedTxn.bundleId)
      return NextResponse.json(
        { success: false, error: 'Bundle ID mismatch' },
        { status: 401 }
      )
    }
    // Re-derive authoritative fields from Apple's signed data; the
    // client-supplied values are now ignored (overwritten).
    productId = verifiedTxn.productId
    transactionId = String(verifiedTxn.transactionId)
    originalTransactionId = verifiedTxn.originalTransactionId
      ? String(verifiedTxn.originalTransactionId)
      : transactionId
    expiresDate = verifiedTxn.expiresDate
      ? new Date(verifiedTxn.expiresDate).toISOString()
      : null

    const tier = PRODUCT_TO_TIER[productId]
    if (!tier) {
      return NextResponse.json(
        { success: false, error: `Unknown productId: ${productId}` },
        { status: 400 }
      )
    }

    const billingCycle = PRODUCT_TO_CYCLE[productId] || 'monthly'
    const supabase = getSupabase()

    // Calculate period end
    const periodEnd = expiresDate
      ? new Date(expiresDate).toISOString()
      : new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 86400000).toISOString()

    // ── Update profiles.subscription_tier ──
    //
    // Stage 6.IAPFix: destructure { error } and surface failures.
    // The pre-fix code awaited the update without checking error,
    // so RLS rejections / row-not-found / type mismatches all
    // silently succeeded -- mobile saw tier upgrade but DB never
    // changed. Same silent-fail family as Stage 6.WisdomFix-S1
    // (the wisdom_card DB save).
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (profileErr) {
      console.error('[apple-iap] profile update error:', profileErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to update profile tier: ' + profileErr.message },
        { status: 500 }
      )
    }

    // ── Upsert subscriptions table (atomic) ──
    //
    // Stage 6.IAPFix: switched from select-then-update/insert
    // two-step to supabase upsert() with onConflict='user_id'.
    // The two-step had two flaws:
    //   1. Race window: concurrent purchase callbacks could both
    //      see "no existing row" and both try to insert.
    //   2. Silent error fall-through: neither branch destructured
    //      error, so DB schema mismatch or RLS rejection passed.
    //
    // Stage 6.IAPFix also requires the subscriptions table to
    // have apple_transaction_id / apple_original_transaction_id /
    // apple_product_id columns -- added in the corresponding
    // schema migration (see commit message for the ALTER TABLE).
    // QuotaFix: current_period_start is a STABLE billing-period anchor, NOT the
    // upload time. A cold-start restore / unfinished-transaction re-report of an
    // already-active subscription must NOT reset it -- resetting it zeroes the
    // per-period quota counter on every relaunch (= unlimited usage). Advance it
    // only for a brand-new subscription or a genuine renewal (incoming expiry
    // moves past the stored period end). Matches Apple's per-transaction
    // purchaseDate model + Stripe's billing_cycle_anchor (preserve, don't reset).
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('current_period_start, current_period_end, status, plan')
      .eq('user_id', userId)
      .maybeSingle()
    const isSamePeriod =
      existingSub &&
      existingSub.status === 'active' &&
      // QuotaFix-2: only preserve the period anchor within the SAME tier.
      // A genuine tier change (e.g. basic -> pro upgrade) must reset the
      // quota window to now, otherwise the prior tier's usage keeps
      // counting against the new, higher limit (e.g. 11/15 -> 11/30
      // instead of 0/30). Same-tier reactivation/restore still preserves.
      existingSub.plan === tier &&
      existingSub.current_period_start &&
      existingSub.current_period_end &&
      new Date(periodEnd).getTime() <= new Date(existingSub.current_period_end).getTime()
    const periodStart = isSamePeriod
      ? existingSub.current_period_start
      : new Date().toISOString()

    const subRow = {
      user_id: userId,
      plan: tier,
      status: 'active',
      billing_cycle: billingCycle,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      apple_transaction_id: String(transactionId),
      apple_original_transaction_id: String(originalTransactionId || transactionId),
      apple_product_id: productId,
      // Clear any pending changes from a previously-scheduled
      // downgrade/crossgrade that this purchase supersedes.
      pending_plan: null,
      pending_billing_cycle: null,
      updated_at: new Date().toISOString(),
    }

    const { error: subErr } = await supabase
      .from('subscriptions')
      .upsert(subRow, { onConflict: 'user_id' })

    if (subErr) {
      console.error('[apple-iap] subscription upsert error:', subErr.message)
      // We already updated profiles.subscription_tier above; the
      // user is now in a half-state (profile says paid, no
      // subscription row). Surfacing the error lets the mobile
      // client retry — the next retry's upsert is idempotent.
      return NextResponse.json(
        { success: false, error: 'Failed to save subscription: ' + subErr.message },
        { status: 500 }
      )
    }

    console.log(`[apple-iap] Activated ${tier} (${billingCycle}) for user ${userId} — txn=${transactionId}`)

    return NextResponse.json({
      success: true,
      tier,
      billingCycle,
      periodEnd,
    })
  } catch (error) {
    console.error('[apple-iap] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
