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

    const supabase = getSupabase()

    // ============================================================
    // SECURITY (Module 6 #6 Step 2): require Bearer token matching
    // ?userId. announcements returns content potentially scoped by
    // user tier (free vs paid announcements); previously ?userTier
    // was trusted from the query string, letting any anon caller
    // see paid-tier marketing content.
    //
    // No live mobile caller right now (announcement display is
    // not yet wired up in app), so adding the guard is safe.
    // When the announcement UI is implemented, it will go through
    // apiClient which attaches the token automatically.
    //
    // We also no longer trust query userTier -- we look up the
    // user's tier from the profiles row using the verified user.id
    // so attackers cannot promote themselves to see paid-only
    // content.
    // ============================================================
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[announcements] GET rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authUser) {
      console.warn('[announcements] GET rejected: token verify failed', authErr && authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[announcements] GET rejected: token user', authUser.id, '!= query userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // DB-authoritative tier (do NOT trust query string)
    const { data: profileTier } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single()
    const userTier = profileTier?.subscription_tier || 'free'
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

    // SECURITY (audit follow-up): require a Bearer token matching body.userId,
    // same gate as the GET handler. Without this, an anonymous caller could
    // mark announcements read for an arbitrary user (mild griefing -- suppress
    // someone's announcements). The mobile caller (announcements-api.ts) sends
    // the token automatically via apiClient.
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[announcements] POST rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authUser) {
      console.warn('[announcements] POST rejected: token verify failed', authErr && authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[announcements] POST rejected: token user', authUser.id, '!= body userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
