import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

/**
 * GET: 获取用户本周和上周的统计数据
 * 
 * 本周 = 过去7天
 * 上周 = 7-14天前
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    const now = new Date()
    
    // 计算时间范围
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const lastWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const lastWeekEnd = thisWeekStart
    
    // 获取本周 wisdoms
    const { data: thisWeekWisdoms } = await supabase
      .from('wisdoms')
      .select('id, duration_seconds, listens, likes')
      .eq('user_id', userId)
      .gte('created_at', thisWeekStart)
    
    // 获取上周 wisdoms
    const { data: lastWeekWisdoms } = await supabase
      .from('wisdoms')
      .select('id, duration_seconds, listens, likes')
      .eq('user_id', userId)
      .gte('created_at', lastWeekStart)
      .lt('created_at', lastWeekEnd)
    
    // 计算本周统计
    const thisWeekStats = {
      wisdoms: thisWeekWisdoms?.length || 0,
      minutes: 0,
      listens: 0,
      likes: 0,
    }
    
    for (const w of thisWeekWisdoms || []) {
      thisWeekStats.minutes += (w.duration_seconds || 0) / 60
      thisWeekStats.listens += w.listens || 0
      thisWeekStats.likes += w.likes || 0
    }
    
    // 计算上周统计
    const lastWeekStats = {
      wisdoms: lastWeekWisdoms?.length || 0,
      minutes: 0,
      listens: 0,
      likes: 0,
    }
    
    for (const w of lastWeekWisdoms || []) {
      lastWeekStats.minutes += (w.duration_seconds || 0) / 60
      lastWeekStats.listens += w.listens || 0
      lastWeekStats.likes += w.likes || 0
    }
    
    return Response.json({
      success: true,
      thisWeek: thisWeekStats,
      lastWeek: lastWeekStats,
      period: {
        thisWeekStart,
        lastWeekStart,
        lastWeekEnd,
      },
    })
    
  } catch (error) {
    console.error('Weekly stats error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
