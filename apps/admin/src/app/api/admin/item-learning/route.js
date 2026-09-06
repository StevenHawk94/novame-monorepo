import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'
import { loadReview, publishReview, reviewSnapshot } from '@/lib/item-review'

export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const query = new URL(request.url).searchParams
    if (query.get('export') === '1') return NextResponse.json(await reviewSnapshot(db()), {
      headers: { 'Content-Disposition': 'attachment; filename="reviewed-item-rules.json"', 'Cache-Control': 'no-store' },
    })
    const status = query.get('status') || 'pending'
    if (!['pending','approved','published','rejected','all'].includes(status)) throw new Error('Invalid status')
    return NextResponse.json({ success: true, ...await loadReview(db(), status) }, { headers: { 'Cache-Control':'no-store' } })
  } catch (error) { return NextResponse.json({ success: false, error: error.message }, { status: 500 }) }
}

export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const input = await request.json()
    const client = db()
    if (['publish','disable','undo'].includes(input.action)) {
      return NextResponse.json({ success: true, revision: await publishReview(client, input, auth.user.id) })
    }
    if (input.action === 'reject-removal') {
      const { error } = await client.from('item_match_removals').update({ status:'rejected' }).eq('id', input.id).eq('status','pending')
      if (error) throw error
    } else if (['reject','approve-icon'].includes(input.action)) {
      let query = client.from('item_learning_candidates').update({ status: input.action === 'reject' ? 'rejected' : 'approved', reviewed_at: new Date().toISOString() }).eq('id', input.id).in('status',['pending','approved'])
      if (input.action === 'approve-icon') query = query.eq('kind','missing_icon')
      const { data, error } = await query.select('id').maybeSingle()
      if (error) throw error
      if (!data) throw new Error(input.action === 'approve-icon' ? 'This icon suggestion is already reviewed. Refresh the backlog.' : 'This suggestion is already reviewed. Refresh the list.')
    } else throw new Error('Invalid review action')
    return NextResponse.json({ success: true })
  } catch (error) { return NextResponse.json({ success: false, error: error.message }, { status: 409 }) }
}
