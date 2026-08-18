import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

const WHO_KEYS = ['partner', 'parent', 'child', 'bestie', 'special']
const BLOCKER_KEYS = ['A', 'B', 'C', 'D']

/**
 * GET /api/admin/onboarding-analysis
 *
 * Counts per answer for the two onboarding questions (Ob2 who / Ob3
 * blocker), read from profiles.onboarding_who / onboarding_blocker.
 * Head-count queries only — no rows transferred, scales with user count.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    const countEq = async (column, value) => {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq(column, value)
      return count || 0
    }

    const [who, blocker, { count: answered }] = await Promise.all([
      Promise.all(WHO_KEYS.map(async (k) => [k, await countEq('onboarding_who', k)])),
      Promise.all(BLOCKER_KEYS.map(async (k) => [k, await countEq('onboarding_blocker', k)])),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).not('onboarding_who', 'is', null),
    ])

    return NextResponse.json({
      success: true,
      who: Object.fromEntries(who),
      blocker: Object.fromEntries(blocker),
      answered: answered || 0,
    })
  } catch (err) {
    console.error('[admin/onboarding-analysis] unexpected:', err && err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
