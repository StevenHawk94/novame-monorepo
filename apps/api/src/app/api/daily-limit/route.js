import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

const TIER_LIMITS = {
  free: 1,
  basic: 15,
  pro: 30,
  ultra: 60,
}

const TIER_RANK = { free: 0, basic: 1, pro: 2, ultra: 3 }

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const clientTier = searchParams.get('clientTier') || null
    
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
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
    
    // Count wisdom_cards created this calendar month by this user
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    
    const { count, error } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', monthStart)

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
