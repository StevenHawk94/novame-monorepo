import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const status = new URL(request.url).searchParams.get('status') || 'pending'
  let query = db().from('item_learning_candidates').select('*')
    .order('last_seen_at', { ascending: false }).limit(1000)
  if (status !== 'all') query = query.eq('status', status)
  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, candidates: data || [] })
}

export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { ids, status, suggestedItemId, suggestedIconName, safetyMode, exclusionRules } = await request.json()
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 || !['approved', 'rejected', 'pending'].includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid review action' }, { status: 400 })
  }
  const update = { status, reviewed_at: status === 'pending' ? null : new Date().toISOString() }
  if (ids.length === 1 && typeof suggestedItemId === 'string') update.suggested_item_id = suggestedItemId.trim() || null
  if (ids.length === 1 && typeof suggestedIconName === 'string') update.suggested_icon_name = suggestedIconName.trim().slice(0, 80)
  if (ids.length === 1 && ['AUTO', 'AUTO_UNLESS_EXCLUDED', 'NEVER_AUTO'].includes(safetyMode)) update.safety_mode = safetyMode
  if (ids.length === 1 && Array.isArray(exclusionRules)) update.exclusion_rules = exclusionRules.filter((x) => typeof x === 'string').slice(0, 20)
  const { error } = await db().from('item_learning_candidates').update(update).in('id', ids)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

