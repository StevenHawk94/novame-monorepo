import { NextResponse } from 'next/server'
import { secureCode } from '@/lib/secure-random'
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

// Apple product ID → internal tier (both seats grant the same 'plus' tier)
const PRODUCT_TO_TIER = {
  'novame.plus.monthly':    'plus',
  'novame.plus.yearly':     'plus',
  'novame.plusduo.monthly': 'plus',
  'novame.plusduo.yearly':  'plus',
}
// Apple product ID → billing cycle
const PRODUCT_TO_CYCLE = {
  'novame.plus.monthly':    'monthly',
  'novame.plus.yearly':     'yearly',
  'novame.plusduo.monthly': 'monthly',
  'novame.plusduo.yearly':  'yearly',
}
// Apple product ID → seat model (duo grants one extra seat to invite a member)
const PRODUCT_TO_PLAN_TYPE = {
  'novame.plus.monthly':    'solo',
  'novame.plus.yearly':     'solo',
  'novame.plusduo.monthly': 'duo',
  'novame.plusduo.yearly':  'duo',
}

function normalizeStoreEnvironment(value) {
  if (value === 'Sandbox') return 'sandbox'
  if (value === 'Production') return 'production'
  return 'unknown'
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
    const storeEnvironment = normalizeStoreEnvironment(verifiedTxn.environment)
    const EXPECTED_BUNDLE_ID = 'com.novame.app'
    if (verifiedTxn.bundleId && verifiedTxn.bundleId !== EXPECTED_BUNDLE_ID) {
      console.warn('[apple-iap] rejected: bundleId mismatch', verifiedTxn.bundleId)
      return NextResponse.json(
        { success: false, error: 'Bundle ID mismatch' },
        { status: 401 }
      )
    }
    // New purchases attach the authenticated NovaMe UUID as StoreKit's
    // appAccountToken. Restores of historical purchases may not contain it,
    // but when Apple supplies it a different account must never claim it.
    if (verifiedTxn.appAccountToken && String(verifiedTxn.appAccountToken).toLowerCase() !== String(userId).toLowerCase()) {
      console.warn('[apple-iap] rejected: appAccountToken belongs to another user')
      return NextResponse.json(
        {
          success: false,
          error: 'Purchase belongs to another account',
          code: 'PURCHASE_ACCOUNT_CONFLICT',
          storeEnvironment,
        },
        { status: 409 }
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

    const planType = PRODUCT_TO_PLAN_TYPE[productId] || 'solo'
    const { data: applied, error: applyErr } = await supabase.rpc('apply_store_subscription', {
      p_user_id: userId,
      p_store: 'apple',
      p_plan: tier,
      p_plan_type: planType,
      p_billing_cycle: billingCycle,
      p_period_end: periodEnd,
      p_apple_transaction_id: String(transactionId),
      p_apple_original_transaction_id: String(originalTransactionId || transactionId),
      p_apple_product_id: productId,
    })
    if (applyErr) {
      console.error('[apple-iap] atomic subscription apply failed:', applyErr.message)
      return NextResponse.json(
        { success: false, error: 'Failed to activate subscription' },
        { status: 500 }
      )
    }
    if (!applied?.success) {
      const conflict = applied?.error === 'credential_owned_by_another_user'
      console.warn('[apple-iap] subscription rejected:', applied?.error)
      return NextResponse.json(
        {
          success: false,
          error: conflict ? 'Purchase belongs to another account' : 'Failed to activate subscription',
          ...(conflict ? { code: 'PURCHASE_ACCOUNT_CONFLICT', storeEnvironment } : {}),
        },
        { status: conflict ? 409 : 500 }
      )
    }

    // Environment is diagnostic metadata, not an entitlement input. Keep the
    // atomic subscription RPC backward-compatible, then persist the verified
    // JWS environment separately. This remains non-fatal during a rolling
    // deploy if the migration has not reached Supabase yet.
    const { error: environmentErr } = await supabase
      .from('subscriptions')
      .update({ store_environment: storeEnvironment })
      .eq('user_id', userId)
    if (environmentErr) {
      console.warn('[apple-iap] store environment persistence failed (non-fatal):', environmentErr.message)
    }

    // Duo: ensure the owner has a duo_membership row with a one-time invite
    // code. Idempotent on owner_id -- a repeat purchase or renewal keeps the
    // same code (and any claimed member). Only created for duo plans; solo
    // owners never get a membership row.
    if (planType === 'duo') {
      const { data: existingDuo } = await supabase
        .from('duo_memberships')
        .select('id')
        .eq('owner_id', userId)
        .maybeSingle()
      if (!existingDuo) {
        // 8-char code, unambiguous alphabet.
        const code = secureCode(8)
        const { error: duoErr } = await supabase
          .from('duo_memberships')
          .insert({ owner_id: userId, invite_code: code, status: 'pending' })
        if (duoErr) {
          // Non-fatal: the subscription is already active. The owner can
          // retry surfacing the code from /api/duo/status, which lazily
          // creates the row if missing.
          console.warn('[apple-iap] duo membership create failed (non-fatal):', duoErr.message)
        }
      }
    }

    console.log(`[apple-iap] Activated ${tier} (${billingCycle}, ${storeEnvironment}) for user ${userId} — txn=${transactionId}`)

    return NextResponse.json({
      success: true,
      tier,
      billingCycle,
      periodEnd,
      storeEnvironment,
    })
  } catch (error) {
    console.error('[apple-iap] Error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
