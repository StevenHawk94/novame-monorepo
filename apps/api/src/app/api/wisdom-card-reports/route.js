import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

// Valid report reasons -- must match the wisdom_card_reports CHECK
// constraint. Adding a new reason here means migrating the DB CHECK
// too.
const VALID_REASONS = new Set([
  'spam',
  'inappropriate',
  'harassment',
  'violence',
  'sexual',
  'self_harm',
  'misinformation',
  'other',
])

/**
 * POST /api/wisdom-card-reports
 * Body: { userId: string, cardId: string, reason: string, detail?: string }
 *
 * Records a user's report of a wisdom card for admin review per
 * Apple App Store Guideline 1.2 (UGC moderation, 24-hour response).
 *
 * Idempotent on (user_id, card_id) UNIQUE constraint: re-reporting
 * the same card returns success with alreadyReported=true, preserving
 * the original reported_at. This matches user expectation -- they
 * shouldn't get an error if they accidentally tap report twice.
 *
 * Side effect: ALSO writes wisdom_card_blocks for the same user, so
 * the reporter doesn't have to see the offending card again. This
 * is the industry standard (Instagram, TikTok) -- a user who reports
 * almost never wants the content in their feed. Auto-block failure
 * is non-fatal: the report write is the contractual obligation, the
 * block is a UX nicety.
 *
 * Returns: { success: true, reportedAt: ISO string, alreadyReported?: boolean }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { userId, cardId, reason, detail } = body

    if (!userId || !cardId || !reason) {
      return NextResponse.json(
        { error: 'Missing userId, cardId, or reason' },
        { status: 400 },
      )
    }

    if (!VALID_REASONS.has(reason)) {
      return NextResponse.json(
        { error: 'Invalid reason' },
        { status: 400 },
      )
    }

    // "other" reason requires a meaningful detail explanation so
    // admin moderation has something actionable to review.
    if (reason === 'other') {
      const trimmedDetail = (detail || '').trim()
      if (trimmedDetail.length < 3) {
        return NextResponse.json(
          { error: 'Detail required for "other" reason (min 3 chars)' },
          { status: 400 },
        )
      }
    }

    // Cap detail length defensively (mirror the 500-char client cap).
    const cleanDetail = detail
      ? String(detail).trim().slice(0, 500) || null
      : null

    const supabase = getSupabase()

    // Idempotency check: did this user already report this card?
    // Preserves original reported_at + status for any in-flight admin
    // review.
    const { data: existing, error: readErr } = await supabase
      .from('wisdom_card_reports')
      .select('reported_at, status')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .maybeSingle()

    if (readErr) {
      console.error('POST wisdom-card-reports read error:', readErr)
      return NextResponse.json({ error: readErr.message }, { status: 500 })
    }

    if (existing) {
      // Still attempt auto-block (idempotent on server side too) in
      // case the original block somehow failed.
      void autoBlock(supabase, userId, cardId)
      return NextResponse.json({
        success: true,
        reportedAt: existing.reported_at,
        alreadyReported: true,
      })
    }

    const now = new Date().toISOString()
    const { error: insertErr } = await supabase
      .from('wisdom_card_reports')
      .insert({
        user_id: userId,
        card_id: cardId,
        reason,
        detail: cleanDetail,
        reported_at: now,
        status: 'pending',
      })

    if (insertErr) {
      console.error('POST wisdom-card-reports insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    // Auto-block side effect. Errors logged but not propagated -- the
    // primary contract (report stored for admin review) succeeded.
    void autoBlock(supabase, userId, cardId)

    return NextResponse.json({ success: true, reportedAt: now })
  } catch (error) {
    console.error('POST wisdom-card-reports caught:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Best-effort auto-block on report. Mirrors the idempotent contract
 * of POST /api/wisdom-card-blocks -- silent no-op if the user has
 * already blocked the card.
 */
async function autoBlock(supabase, userId, cardId) {
  try {
    const { data: existing } = await supabase
      .from('wisdom_card_blocks')
      .select('blocked_at')
      .eq('user_id', userId)
      .eq('card_id', cardId)
      .maybeSingle()

    if (existing) return // already blocked

    const { error: insertErr } = await supabase
      .from('wisdom_card_blocks')
      .insert({
        user_id: userId,
        card_id: cardId,
        blocked_at: new Date().toISOString(),
      })

    if (insertErr) {
      console.warn('[wisdom-card-reports] auto-block insert failed:', insertErr.message)
    }
  } catch (e) {
    console.warn('[wisdom-card-reports] auto-block exception:', e?.message || e)
  }
}
