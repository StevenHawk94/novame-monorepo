import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    const [{ count: users, error: usersError }, { count: activeSubs, error: subsError }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true })
        .neq('subscription_tier', 'free').not('subscription_tier', 'is', null),
    ])
    if (usersError) throw usersError
    if (subsError) throw subsError

    // Force update status
    let forceUpdateActive = false
    try { const { data } = await supabase.from('force_updates').select('id').eq('is_active', true).limit(1); forceUpdateActive = data?.length > 0 } catch (e) {}

    return Response.json({
      success: true,
      dashboard: { users: users || 0, activeSubs: activeSubs || 0 },
      forceUpdateActive,
    })
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}
