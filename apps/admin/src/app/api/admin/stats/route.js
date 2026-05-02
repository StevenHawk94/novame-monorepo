import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || 'all' // today | 7days | 30days | 180days | all

    // Calculate date filter
    let since = null
    const now = new Date()
    if (period === 'today') since = now.toISOString().split('T')[0]
    else if (period === '7days') { const d = new Date(now); d.setDate(d.getDate() - 7); since = d.toISOString() }
    else if (period === '30days') { const d = new Date(now); d.setDate(d.getDate() - 30); since = d.toISOString() }
    else if (period === '180days') { const d = new Date(now); d.setDate(d.getDate() - 180); since = d.toISOString() }

    // Users
    let usersQuery = supabase.from('profiles').select('*', { count: 'exact', head: true })
    if (since) usersQuery = usersQuery.gte('created_at', since)
    const { count: users } = await usersQuery

    // Total users (always all-time for context)
    const { count: totalUsers } = await supabase.from('profiles').select('*', { count: 'exact', head: true })

    // Subscriptions
    const { count: activeSubs } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).neq('subscription_tier', 'free').not('subscription_tier', 'is', null)

    // Orders
    let ordersQuery = supabase.from('orders').select('id, amount, status, created_at')
    if (since) ordersQuery = ordersQuery.gte('created_at', since)
    const { data: orders } = await ordersQuery

    const totalOrders = orders?.length || 0
    const pendingOrders = orders?.filter(o => ['pending_selection', 'paid', 'processing'].includes(o.status)).length || 0
    const revenue = orders?.filter(o => !['cancelled', 'refunded'].includes(o.status)).reduce((s, o) => s + parseFloat(o.amount || 0), 0) || 0

    // Wisdoms & Cards
    let wisdomsQuery = supabase.from('wisdoms').select('*', { count: 'exact', head: true })
    if (since) wisdomsQuery = wisdomsQuery.gte('created_at', since)
    const { count: wisdoms } = await wisdomsQuery

    let cardsQuery = supabase.from('wisdom_cards').select('*', { count: 'exact', head: true }).not('user_id', 'is', null)
    if (since) cardsQuery = cardsQuery.gte('created_at', since)
    const { count: cards } = await cardsQuery

    // Today likes
    const today = now.toISOString().split('T')[0]
    const { data: todayData } = await supabase.from('wisdoms').select('likes').gte('updated_at', today)
    const todayLikes = todayData?.reduce((s, w) => s + (w.likes || 0), 0) || 0

    // Pending reports
    let pendingReports = 0
    try { const { count } = await supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'pending'); pendingReports = count || 0 } catch (e) {}

    // Force update status
    let forceUpdateActive = false
    try { const { data } = await supabase.from('force_updates').select('id').eq('is_active', true).limit(1); forceUpdateActive = data?.length > 0 } catch (e) {}

    return Response.json({
      success: true,
      period,
      dashboard: { users: users || 0, totalUsers: totalUsers || 0, activeSubs: activeSubs || 0, orders: totalOrders, pendingOrders, revenue: Math.round(revenue * 100) / 100, wisdoms: wisdoms || 0, cards: cards || 0, todayLikes },
      pendingReports,
      forceUpdateActive,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
