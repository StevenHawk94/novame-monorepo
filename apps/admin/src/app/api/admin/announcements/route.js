import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'
import { announcementFields } from '@/lib/announcement-fields'

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
    let fields;
    try { fields=announcementFields(body); } catch { return Response.json({error:'标题、图片、描述、按钮文字或链接无效（链接仅支持 HTTPS）'},{status:400}); }

    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('app_announcements')
      .insert({
        ...fields,
        is_active: true,
        priority: 0,
        start_at: new Date().toISOString(),
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
    const { id } = body
    let updates;
    try { updates=announcementFields(body,true); } catch { return Response.json({error:'公告字段无效'},{status:400}); }

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
