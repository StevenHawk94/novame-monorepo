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
        // Stage 6.LeaderboardExpUnify: seeds table stores total_mins
        // (curated minute counts assigned when the seed users were
        // first inserted). We treat that same number as the user-
        // facing "exp" score, since the values (200-600 range) align
        // with the magnitude of real users' total_exp (character_data
        // top-10 sits at ~400-6000). Renaming the DB column would
        // require a migration; we instead alias the field at the
        // API boundary so the mobile client sees a single field
        // (totalExp) regardless of which underlying table it came
        // from. wisdomCount removed -- ranking.tsx never displays it.
        seedUsers = seeds.map(s => ({
          userId: `seed-${s.name}`,
          name: s.name,
          avatar: s.avatar_url,
          totalExp: s.total_mins || 0,
          isDefault: true,
        }))
      }
    } catch (e) {
      console.log('leaderboard_seeds table may not exist:', e.message)
    }
    
    // Stage 6.LeaderboardExpUnify: real users now scored by
    // character_data.total_exp (same source as the me-stats page's
    // "totalExp" pill), so a user's leaderboard rank uses the
    // identical number they see in their own profile. Previously
    // leaderboard aggregated wisdoms.duration_seconds, which gave a
    // wisdom-creation-minutes score completely divorced from the
    // exp displayed elsewhere.
    //
    // The period filter ("week" / "month" / "all") is no longer
    // applied at the data layer because character_data has no
    // created_at-per-exp-event ledger -- total_exp is a running
    // total, not a time-bucketed metric. Period is still accepted
    // as a query param for forward compatibility but currently
    // returns all-time exp for any value.
    let realUsers = []
    const { data: charRows, error: charErr } = await supabase
      .from('character_data')
      .select('user_id, total_exp')
      .not('user_id', 'is', null)
      .gt('total_exp', 0)

    if (charErr) {
      console.error('[leaderboard] character_data fetch error:', charErr.message)
    } else if (charRows && charRows.length > 0) {
      // Fetch display info from profiles in a single round-trip.
      const userIds = charRows.map(r => r.user_id)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)

      const profilesMap = {}
      for (const p of profiles || []) {
        profilesMap[p.id] = p
      }

      realUsers = charRows
        .map(r => {
          const p = profilesMap[r.user_id]
          if (!p) return null  // Skip if profile row missing (defensive)
          return {
            userId: r.user_id,
            name: p.display_name || 'Anonymous',
            avatar: p.avatar_url,
            totalExp: r.total_exp || 0,
            isDefault: false,
          }
        })
        .filter(Boolean)
    }

    // Merge and rank. We filter out zero-exp entries (both seeds and
    // real users with no recorded activity) so the leaderboard never
    // surfaces empty rows.
    const allUsers = [...seedUsers, ...realUsers]
      .filter(u => u.totalExp > 0)
      .sort((a, b) => b.totalExp - a.totalExp)
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
