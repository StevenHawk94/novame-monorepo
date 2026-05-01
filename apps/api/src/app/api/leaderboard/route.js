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
 * GET: 获取排行榜数据
 * 
 * 合并三个来源：
 * 1. leaderboard_seeds 表（默认用户）
 * 2. profiles.total_mins_created（真实用户预设值）
 * 3. wisdoms 表聚合（真实用户录制）
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'all'
    const limit = parseInt(searchParams.get('limit') || '100')
    
    const supabase = getSupabaseAdmin()
    
    // 来源1：从 leaderboard_seeds 获取默认用户数据
    let seedUsers = []
    try {
      const { data: seeds, error: seedError } = await supabase
        .from('leaderboard_seeds')
        .select('name, avatar_url, total_mins, wisdom_count')
        .order('total_mins', { ascending: false })
      
      if (!seedError && seeds) {
        seedUsers = seeds.map(s => ({
          userId: `seed-${s.name}`,
          name: s.name,
          avatar: s.avatar_url,
          totalMinutes: s.total_mins || 0,
          wisdomCount: s.wisdom_count || 1,
          isDefault: true,
        }))
      }
    } catch (e) {
      console.log('leaderboard_seeds table may not exist:', e.message)
    }
    
    // 来源2：从 wisdoms 聚合真实用户数据
    let dateFilter = null
    const now = new Date()
    if (period === 'week') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    } else if (period === 'month') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }
    
    let query = supabase
      .from('wisdoms')
      .select('user_id, duration_seconds')
      .eq('is_public', true)
      .not('user_id', 'is', null)
    
    if (dateFilter) {
      query = query.gte('created_at', dateFilter)
    }
    
    const { data: wisdoms } = await query
    
    // 按用户聚合
    const userStatsFromWisdoms = {}
    for (const w of wisdoms || []) {
      if (!w.user_id) continue
      if (!userStatsFromWisdoms[w.user_id]) {
        userStatsFromWisdoms[w.user_id] = { totalSeconds: 0, wisdomCount: 0 }
      }
      const seconds = parseInt(w.duration_seconds) || 0
      userStatsFromWisdoms[w.user_id].totalSeconds += seconds
      userStatsFromWisdoms[w.user_id].wisdomCount += 1
    }
    
    // 获取真实用户的 profile 信息
    const realUserIds = Object.keys(userStatsFromWisdoms)
    let realUsers = []
    
    if (realUserIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, total_mins_created')
        .in('id', realUserIds)
      
      if (profiles) {
        realUsers = profiles.map(p => {
          const stats = userStatsFromWisdoms[p.id] || { totalSeconds: 0, wisdomCount: 0 }
          const presetMins = p.total_mins_created || 0
          const calculatedMins = Math.round(stats.totalSeconds / 60)
          
          return {
            userId: p.id,
            name: p.display_name || 'Anonymous',
            avatar: p.avatar_url,
            totalMinutes: presetMins > 0 ? presetMins : calculatedMins,
            wisdomCount: stats.wisdomCount,
            isDefault: false,
          }
        })
      }
    }
    
    // 合并并排序
    const allUsers = [...seedUsers, ...realUsers]
      .filter(u => u.totalMinutes > 0)
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, limit)
      .map((entry, index) => ({ ...entry, rank: index + 1 }))
    
    return Response.json({
      success: true,
      period,
      leaderboard: allUsers,
      totalUsers: allUsers.length,
    })
    
  } catch (error) {
    console.error('Leaderboard error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
