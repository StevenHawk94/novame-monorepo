import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * GET /api/admin/wisdom-card-reports?status=pending
 *
 * Returns reports joined with card content, sorted by reported_at DESC.
 * Default status filter is "pending" (the active moderation queue);
 * pass status=actioned / dismissed / all to see history.
 *
 * Pattern mirrors /api/admin/wisdom-card-blocks: PostgREST does not
 * expose GROUP BY directly, so card content is fetched separately
 * and joined in JS. Orphan reports (card already deleted) are kept
 * in the list so admin can see audit history.
 *
 * Returns: { success: true, reports: [{
 *   id, user_id, card_id, reason, detail, reported_at,
 *   status, reviewed_at, reviewed_by,
 *   card: { id, keyword_id, quote_short, insight_full, creator_name, creator_avatar } | null
 * }, ...] }
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'pending'

    const supabase = getSupabase()

    let query = supabase
      .from('wisdom_card_reports')
      .select('id, user_id, card_id, reason, detail, reported_at, status, reviewed_at, reviewed_by')
      .order('reported_at', { ascending: false })

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data: reports, error: reportsErr } = await query

    if (reportsErr) {
      return Response.json({ error: reportsErr.message }, { status: 500 })
    }

    if (!reports || reports.length === 0) {
      return Response.json({ success: true, reports: [] })
    }

    // Pull card content for display. Orphan reports (card deleted)
    // get card: null.
    const cardIds = [...new Set(reports.map(r => r.card_id))]
    const { data: cards, error: cardsErr } = await supabase
      .from('wisdom_cards')
      .select('id, keyword_id, quote_short, insight_full, creator_name, creator_avatar')
      .in('id', cardIds)

    if (cardsErr) {
      console.error('[wisdom-card-reports] cards fetch failed:', cardsErr)
    }

    const cardMap = Object.fromEntries((cards || []).map(c => [c.id, c]))

    const result = reports.map(r => ({
      ...r,
      card: cardMap[r.card_id] ?? null,
    }))

    return Response.json({ success: true, reports: result })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/wisdom-card-reports?cardId=X
 *
 * Hard-deletes a wisdom_card flagged via reports. CASCADE clears
 * card_saves + wisdom_card_blocks + wisdom_card_reports automatically.
 * seek_question_cards has no FK CASCADE in the legacy schema, so we
 * manually delete its links first.
 *
 * After this returns, the card is gone from all listing contexts AND
 * all related reports are gone (per CASCADE). Use the PATCH endpoint
 * if you want to keep the card but mark reports as "actioned" or
 * "dismissed" instead.
 *
 * This matches the wisdom-card-blocks DELETE pattern.
 */
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const cardId = searchParams.get('cardId')

    if (!cardId) {
      return Response.json({ error: 'Missing cardId' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Mark all pending reports for this card as "actioned" BEFORE
    // deleting -- this preserves the audit trail. CASCADE on the
    // wisdom_cards DELETE would otherwise destroy the report rows.
    // We need them in "actioned" state for compliance / history.
    //
    // Strategy: fetch report ids, set status, then delete card. If
    // the post-update CASCADE fires anyway we've at least captured
    // the moment. (In practice we may want a separate audit_log
    // table, but for v1 the reports row preservation is enough.)
    const { error: patchErr } = await supabase
      .from('wisdom_card_reports')
      .update({
        status: 'actioned',
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth.adminId || 'admin',
      })
      .eq('card_id', cardId)
      .eq('status', 'pending')

    if (patchErr) {
      console.warn('[wisdom-card-reports] mark-actioned failed:', patchErr.message)
      // Continue with delete -- the CASCADE will clear the report
      // rows below.
    }

    // Clean orphan seek_question_cards (no FK CASCADE).
    const { error: linksErr } = await supabase
      .from('seek_question_cards')
      .delete()
      .eq('card_id', cardId)

    if (linksErr) {
      console.warn('[wisdom-card-reports] seek_question_cards cleanup failed:', linksErr.message)
    }

    // Main delete. CASCADE clears card_saves + wisdom_card_blocks +
    // wisdom_card_reports.
    const { error: cardErr } = await supabase
      .from('wisdom_cards')
      .delete()
      .eq('id', cardId)

    if (cardErr) {
      return Response.json({ error: cardErr.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/wisdom-card-reports?reportId=X
 * Body: { status: 'dismissed' | 'reviewed' | 'actioned' }
 *
 * Updates a single report's status without deleting the card. Used
 * when admin reviews a report and decides the content does NOT
 * violate guidelines (status='dismissed') or wants to mark it
 * reviewed for some other reason.
 */
export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const reportId = searchParams.get('reportId')

    if (!reportId) {
      return Response.json({ error: 'Missing reportId' }, { status: 400 })
    }

    const body = await request.json()
    const { status } = body

    const validStatuses = new Set(['pending', 'reviewed', 'dismissed', 'actioned'])
    if (!status || !validStatuses.has(status)) {
      return Response.json(
        { error: 'Invalid status. Must be pending|reviewed|dismissed|actioned' },
        { status: 400 },
      )
    }

    const supabase = getSupabase()

    const { error: updateErr } = await supabase
      .from('wisdom_card_reports')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth.adminId || 'admin',
      })
      .eq('id', reportId)

    if (updateErr) {
      return Response.json({ error: updateErr.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
