/**
 * apps/api/src/lib/quota.js
 *
 * Single source of truth for "where does the user's quota counter
 * start?" — used by daily-limit, publish-wisdom, and me-stats so all
 * three see the SAME window and report consistent usedThisMonth /
 * remaining / monthlyLimit numbers.
 *
 * Quota semantics (Stage 6.QuotaFix):
 *
 *   Free tier — LIFETIME quota of 1 wisdom card per account.
 *     Counter starts at profiles.created_at and never resets. A user
 *     who exhausts their 1 free slot stays at 1/1 forever (unless
 *     they upgrade). This matches "free trial" semantics common in
 *     SaaS (one taste, then pay).
 *
 *   Paid tier — PER-BILLING-CYCLE quota.
 *     Counter starts at subscriptions.current_period_start (set at
 *     upgrade time by apple-iap, refreshed on every renewal by the
 *     Apple webhook handleActivated). Each renewal -> new period
 *     start -> counter resets to 0/N.
 *
 *   Downgrade to free — Apple StoreKit deferred-downgrade behavior:
 *     the user keeps paid quota until current_period_end, then the
 *     `subscription.expired` webhook fires handleExpired, which sets
 *     profile.subscription_tier='free' + subscriptions.status='expired'.
 *     At that point this helper sees tier='free' and routes to the
 *     profiles.created_at branch -- so a returning-to-free user gets
 *     their LIFETIME counter (which they already exhausted if they
 *     used their original free slot). Intentional: prevents tier
 *     downgrade-churn from being a way to farm free quota.
 *
 * Industry references:
 *   - Stripe Billing: subscription.current_period_start is the
 *     official boundary for usage-based metering.
 *   - Apple StoreKit 2: Transaction.purchaseDate is the new-period
 *     anchor at renewal time. (We approximate this with new Date()
 *     in the webhook -- accurate within seconds in normal operation,
 *     with a few minutes drift in retry scenarios.)
 *   - RevenueCat / Adapty: entitlement.purchaseDate is the boundary
 *     SDKs surface to client-side usage trackers.
 */

export async function getQuotaPeriodStart(supabase, userId) {
  // Fetch profile + subscription in parallel. Both queries are
  // independent and the helper has to wait for both anyway.
  const [profRes, subRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('created_at, subscription_tier')
      .eq('id', userId)
      .single(),
    supabase
      .from('subscriptions')
      .select('plan, status, current_period_start')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const tier = profRes.data?.subscription_tier || 'free'

  // Account creation timestamp -- universal fallback. Epoch 0 if
  // somehow missing (would only happen for ancient/corrupted rows;
  // counting from epoch is safer than counting from now since it
  // includes all historical cards rather than zero).
  const accountCreatedAt = profRes.data?.created_at
    ? new Date(profRes.data.created_at)
    : new Date(0)

  // Free tier: lifetime quota -- counter has been running since the
  // account was created and never resets.
  if (tier === 'free') {
    return accountCreatedAt.toISOString()
  }

  // Paid tier: use the current billing period start. If null (legacy
  // row or migration artifact -- shouldn't happen for active paid
  // subs after apple-iap line 114 sets it, but we guard anyway), fall
  // back to account creation. Worse than period start (over-counts)
  // but safer than fabricating a recent timestamp (under-counts and
  // hands the user free quota they didn't earn).
  const periodStart = subRes.data?.current_period_start
    ? new Date(subRes.data.current_period_start)
    : null

  return (periodStart || accountCreatedAt).toISOString()
}

/**
 * Also export the tier limits + ranks so all three routes import
 * from one place instead of defining them locally (which drifted
 * twice already -- §5.IAP.4 and §5.WR.2).
 */
export const TIER_LIMITS = { free: 1, basic: 15, pro: 30, ultra: 60 }
export const TIER_RANK   = { free: 0, basic: 1, pro: 2, ultra: 3 }
