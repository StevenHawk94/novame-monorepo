import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

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
    const {
      userId,
      transactionId,
      productId,
      originalTransactionId,
      expiresDate,
    } = await request.json()

    if (!userId || !transactionId || !productId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields (userId, transactionId, productId)' },
        { status: 400 }
      )
    }

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
    const subRow = {
      user_id: userId,
      plan: tier,
      status: 'active',
      billing_cycle: billingCycle,
      current_period_start: new Date().toISOString(),
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
