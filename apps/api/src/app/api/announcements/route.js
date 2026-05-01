import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * GET: 获取当前用户未读的公告
 * 参数: userId, userTier (free/premium/pro/ultra)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const userTier = searchParams.get('userTier') || 'free'

    const supabase = getSupabase()
    const now = new Date().toISOString()

    // 获取所有活跃的公告
    let query = supabase
      .from('app_announcements')
      .select('*')
      .eq('is_active', true)
      .lte('start_at', now)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })

    const { data: announcements, error } = await query

    if (error) return Response.json({ error: error.message }, { status: 500 })

    if (!announcements?.length) {
      return Response.json({ success: true, announcement: null })
    }

    // 过滤有效期内的公告
    const validAnnouncements = announcements.filter(a => {
      if (a.end_at && new Date(a.end_at) < new Date()) return false
      return true
    })

    // 过滤目标用户
    const targetedAnnouncements = validAnnouncements.filter(a => {
      if (a.target_users === 'all') return true
      if (a.target_users === 'free' && userTier === 'free') return true
      if (a.target_users === 'paid' && userTier !== 'free') return true
      return false
    })

    if (!targetedAnnouncements.length) {
      return Response.json({ success: true, announcement: null })
    }

    // 如果有用户ID，过滤掉已读的
    if (userId) {
      const { data: readRecords } = await supabase
        .from('user_read_announcements')
        .select('announcement_id')
        .eq('user_id', userId)

      const readIds = new Set(readRecords?.map(r => r.announcement_id) || [])
      const unreadAnnouncements = targetedAnnouncements.filter(a => !readIds.has(a.id))

      if (!unreadAnnouncements.length) {
        return Response.json({ success: true, announcement: null })
      }

      // 返回优先级最高的未读公告
      return Response.json({ 
        success: true, 
        announcement: unreadAnnouncements[0] 
      })
    }

    // 未登录用户返回第一条
    return Response.json({ 
      success: true, 
      announcement: targetedAnnouncements[0] 
    })

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST: 标记公告为已读
 * Body: { userId, announcementId }
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const { userId, announcementId } = body

    if (!userId || !announcementId) {
      return Response.json({ error: '缺少参数' }, { status: 400 })
    }

    const supabase = getSupabase()

    // 使用 upsert 避免重复
    const { error } = await supabase
      .from('user_read_announcements')
      .upsert({
        user_id: userId,
        announcement_id: announcementId,
        read_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,announcement_id'
      })

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
