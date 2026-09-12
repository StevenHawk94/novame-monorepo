import { NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth-guard'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Profile bootstrap endpoint.
 *
 * The mobile app currently consumes display name, avatar and subscription
 * tier from this response. The numerical v1 growth fields remain as zeroed
 * compatibility values so installed clients do not depend on retired
 * Character, Wisdom or community tables.
 */
export async function GET(request) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const token = (request.headers.get('authorization') || '')
      .replace(/^Bearer\s+/i, '')
      .trim()
    const user = token ? await verifyToken(token) : null
    if (!user || user.id !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error } = await getSupabase()
      .from('profiles')
      .select('display_name, avatar_url, is_default_avatar, subscription_tier')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw error
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const planTier = profile.subscription_tier || 'free'
    return NextResponse.json({
      success: true,
      stats: {
        totalWords: 0,
        totalCards: 0,
        peopleImpacted: 0,
        totalExp: 0,
        betterSelfScore: 0,
        usedThisMonth: 0,
        monthlyAnalyses: planTier === 'plus' ? 90 : 0,
        planTier,
        planName: planTier === 'plus' ? 'Plus' : 'Free',
      },
      profile: {
        displayName: profile.display_name || '',
        avatarUrl: profile.avatar_url || '',
        isDefaultAvatar: profile.is_default_avatar !== false,
      },
    })
  } catch (error) {
    console.error('[me-stats]', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
