import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const MAX_TEXT = 500

/**
 * POST /api/reflect/edit-memories
 *
 * Body: { userId, reflectId, edits: [{ itemId, text }] }
 *
 * The free tier's "Add Memories Manually" (claim screen; PRD: 免费用户可自行
 * 添加描述): overwrite the rule-matched excerpt of THIS reflect's item
 * memories with the user's own words. Scoped strictly to
 * (user_id, reflect_id, item_id) rows — you can only describe your own
 * memories, and only ones this reflect actually created. Paid users may use
 * it too (editing is a PRD 4.4 right); it never touches refined_desc, which
 * stays the AI channel.
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const verified = await verifyToken(token)
    if (!verified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { userId, reflectId, edits } = await request.json()
    if (verified.id !== userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!reflectId || !Array.isArray(edits) || edits.length === 0) {
      return NextResponse.json({ error: 'Missing reflectId or edits' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    let updated = 0
    for (const e of edits.slice(0, 10)) {
      const text = typeof e?.text === 'string' ? e.text.trim().slice(0, MAX_TEXT) : ''
      if (!e?.itemId || !text) continue
      const { error, count } = await supabase
        .from('item_memories')
        .update({ raw_excerpt: text }, { count: 'exact' })
        .eq('user_id', userId)
        .eq('reflect_id', reflectId)
        .eq('item_id', e.itemId)
      if (!error) updated += count ?? 0
    }

    return NextResponse.json({ success: true, updated })
  } catch (err) {
    console.error('[reflect/edit-memories] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
