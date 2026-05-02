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

// GET: 获取所有公告（管理后台用）
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    
    const { data, error } = await supabase
      .from('app_announcements')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, announcements: data || [] })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// POST: 创建新公告
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { title, content, type, target_users, end_at } = body

    if (!title?.trim() || !content?.trim()) {
      return Response.json({ error: '缺少标题或内容' }, { status: 400 })
    }

    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('app_announcements')
      .insert({
        title,
        content,
        type: type || 'info',
        target_users: target_users || 'all',
        is_active: true,
        priority: 0,
        start_at: new Date().toISOString(),
        end_at: end_at ? new Date(end_at).toISOString() : null,
      })
      .select()
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, announcement: data })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// PATCH: 更新公告（启用/暂停）
export async function PATCH(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return Response.json({ error: '缺少公告ID' }, { status: 400 })

    const supabase = getSupabase()

    const { error } = await supabase
      .from('app_announcements')
      .update(updates)
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

// DELETE: 删除公告
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) return Response.json({ error: '缺少公告ID' }, { status: 400 })

    const supabase = getSupabase()

    // 同时删除已读记录
    await supabase.from('user_read_announcements').delete().eq('announcement_id', id)

    const { error } = await supabase
      .from('app_announcements')
      .delete()
      .eq('id', id)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
