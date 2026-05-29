import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getQuotaPeriodStart, TIER_LIMITS, TIER_RANK } from '@/lib/quota'

export const runtime = 'edge'

/**
 * Monthly Analysis Limit API
 * 
 * GET: Check remaining analyses this month for a user
 *   → Called when user taps + button, BEFORE entering record/type screen
 *   → Returns { allowed, usedThisMonth, remaining, monthlyLimit }
 * 
 * Counts wisdom_cards created this calendar month by the user.
 * Each wisdom insight generation = 1 analysis.
 */

// Stage 6.QuotaFix: TIER_LIMITS / TIER_RANK now centralized in
// @/lib/quota -- this route imports them.

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const clientTier = searchParams.get('clientTier') || null
    
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // ?userId. Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f). Mobile uses apiClient which
    // attaches the token automatically; backend-only change.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[daily-limit] rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { user: _authUser }, error: _authErr } = await _authSupabase.auth.getUser(token)
    if (_authErr || !_authUser) {
      console.warn('[daily-limit] rejected: token verify failed', _authErr && _authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUser.id !== userId) {
      console.warn('[daily-limit] rejected: token user', _authUser.id, '!= query userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    
    // Get user's subscription tier from DB
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single()
    
    const dbTier = profile?.subscription_tier || 'free'
    
    // Use the HIGHER of DB tier vs client tier (handles race condition after purchase)
    // Client sends its known tier; if it's higher than DB, the purchase succeeded
    // but the DB hasn't synced yet (webhook delay)
    let tier = dbTier
    if (clientTier && TIER_RANK[clientTier] > TIER_RANK[dbTier]) {
      tier = clientTier
      // Also update DB to sync it (best-effort, non-blocking)
      supabase.from('profiles')
        .update({ subscription_tier: clientTier, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .then(() => {})
        .catch(() => {})
    }
    
    const monthlyLimit = TIER_LIMITS[tier] || TIER_LIMITS.free

    // Stage 6.QuotaFix: counter window is no longer the calendar month.
    // For free tier -> lifetime (from profile.created_at).
    // For paid tier -> current billing period (from subscription
    //                  current_period_start, refreshed on renewal).
    // See apps/api/src/lib/quota.js for the full semantics.
    const quotaStart = await getQuotaPeriodStart(supabase, userId)

    const { count, error } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      // Stage 5.WR.2 (Bug 1 fix, second pass): exclude starter /
      // default cards (wisdom_id IS NULL). user-sync inserts a
      // starter card that we don't want to count against quota.
      .not('wisdom_id', 'is', null)
      .gte('created_at', quotaStart)

    if (error) console.error('Count error:', error)
    
    const usedThisMonth = count || 0
    const remaining = Math.max(0, monthlyLimit - usedThisMonth)
    
    return NextResponse.json({
      success: true,
      allowed: remaining > 0,
      usedThisMonth,
      remaining,
      monthlyLimit,
      tier,
    })
  } catch (error) {
    console.error('Monthly limit check error:', error)
    // On error, allow (don't block user)
    return NextResponse.json({ 
      success: true, 
      allowed: true, 
      usedThisMonth: 0, 
      remaining: 999, 
      monthlyLimit: 999,
      error: error.message 
    })
  }
}
