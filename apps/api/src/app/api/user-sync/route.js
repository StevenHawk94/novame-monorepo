import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export const runtime = 'edge'

const DEFAULT_AVATAR_IDS = new Set([
  'default-1', 'default-2', 'default-3', 'default-4', 'default-5',
  'default-6', 'default-7', 'default-8', 'default-9', 'default-10',
])

function getDisplayNameFromEmail(email) {
  if (!email) return null
  return (email.split('@')[0] || '').slice(0, 15)
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function requireOwnUser(request, claimedUserId) {
  const token = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '')
    .trim()
  if (!token) return null
  const user = await verifyToken(token)
  return user?.id === claimedUserId ? user : null
}

/**
 * Lightweight compatibility endpoint used by the mobile subscription cache.
 *
 * The v1 endpoint also returned Wisdom, community, character and growth data.
 * Those systems are retired. Keeping their response keys as empty values lets
 * an installed older client finish sign-in while no request reaches a retired
 * table during the schema transition.
 */
export async function GET(request) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')
    if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 })
    if (!(await requireOwnUser(request, userId))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    let { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw error

    if (!profile) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const email = authUser?.user?.email || null
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email,
          display_name: getDisplayNameFromEmail(email),
          avatar_url: null,
          is_default_avatar: true,
          subscription_tier: 'free',
        })
        .select()
        .single()
      if (createError) throw createError
      profile = created
    } else if (!profile.email) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const email = authUser?.user?.email || null
      if (email) {
        const { data: updated, error: updateError } = await supabase
          .from('profiles')
          .update({ email, updated_at: new Date().toISOString() })
          .eq('id', userId)
          .select()
          .single()
        if (updateError) throw updateError
        profile = updated
      }
    }

    return Response.json({
      success: true,
      data: {
        profile,
        subscriptionTier: profile?.subscription_tier || 'free',
        wisdoms: [],
        standaloneCards: [],
        likedWisdoms: [],
        likedDefaultIds: [],
        hasCompletedOnboarding: Boolean(profile?.onboarding_completed_at),
        selectedCharacter: 'char-1',
        selectedInterests: [],
        drainWords: [],
        aspireWords: [],
        customCategories: [],
      },
    })
  } catch (error) {
    console.error('[user-sync GET]', error?.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Compatibility writer for profile fields that still exist. Legacy request
 * fields are accepted and ignored so installed older clients do not fail.
 */
export async function POST(request) {
  try {
    const body = await request.json()
    const userId = body?.userId
    if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 })
    if (!(await requireOwnUser(request, userId))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const updates = { updated_at: new Date().toISOString() }
    if (body.displayName !== undefined) {
      updates.display_name = body.displayName ? String(body.displayName).slice(0, 15) : body.displayName
    }
    if (body.birthday !== undefined) updates.birthday = body.birthday
    if (body.defaultAvatarId !== undefined) {
      if (!DEFAULT_AVATAR_IDS.has(body.defaultAvatarId)) {
        return Response.json({ error: 'Invalid default avatar' }, { status: 400 })
      }
      updates.avatar_url = body.defaultAvatarId
      updates.is_default_avatar = true
    }
    if (body.hasCompletedOnboarding === true) {
      updates.onboarding_completed_at = new Date().toISOString()
    }
    if (['partner', 'parent', 'child', 'bestie', 'special'].includes(body.onboardingWho)) {
      updates.onboarding_who = body.onboardingWho
    }
    if (['A', 'B', 'C', 'D'].includes(body.onboardingBlocker)) {
      updates.onboarding_blocker = body.onboardingBlocker
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...updates })
      .select()
      .single()
    if (error) throw error

    return Response.json({ success: true, profile: data })
  } catch (error) {
    console.error('[user-sync POST]', error?.message)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
