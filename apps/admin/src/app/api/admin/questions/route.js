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

// GET: 列表
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '0')
    const limit = parseInt(searchParams.get('limit') || '20')
    const filter = searchParams.get('filter') || 'all'

    const supabase = getSupabase()
    let query = supabase.from('questions').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(page * limit, (page + 1) * limit - 1)

    if (filter === 'awaiting') query = query.eq('status', 'awaiting')
    else if (filter === 'matched') query = query.eq('status', 'matched')

    const { data, count, error } = await query
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ success: true, questions: data || [], total: count || 0, hasMore: (page + 1) * limit < (count || 0) })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: 添加默认问题
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { text, categories, asker_name } = body

    if (!text?.trim()) return Response.json({ error: '缺少问题内容' }, { status: 400 })

    const supabase = getSupabase()

    const { data, error } = await supabase.from('questions').insert({
      user_id: null,
      text,
      question_text: text,
      categories: categories?.length ? categories : ['Life'],
      is_public: true,
      status: 'awaiting',
      asker_name: asker_name || 'Community',
      asker_avatar: '/avatars/default-1.png',
    }).select().single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, question: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: 删除
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: '缺少ID' }, { status: 400 })

    const supabase = getSupabase()
    const { error } = await supabase.from('questions').delete().eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
