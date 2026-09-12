import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export const runtime = 'edge'

const DEFAULT_AVATAR_IDS = new Set([
  'default-1', 'default-2', 'default-3', 'default-4', 'default-5',
  'default-6', 'default-7', 'default-8', 'default-9', 'default-10',
])

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
 * POST: 更新用户 profile（display_name, avatar_url, birthday）
 * Also handles: newEmail, newPassword (via Supabase admin auth API)
 */
export async function POST(request) {
  try {
    const {
      userId,
      displayName,
      defaultAvatarId,
      birthday,
      newEmail,
      newPassword,
      onboardingWho,
      onboardingBlocker,
    } = await request.json()
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()

    // ============================================================
    // SECURITY (Module 6 #6 Step 1): require Bearer token matching
    // body.userId. update-profile uses Supabase admin API to change
    // a user's email and password -- without this guard, any anon
    // caller knowing a user UUID could take over that account by
    // changing the registered email or password.
    //
    // Mobile attaches the token automatically via apiClient
    // (apps/mobile/src/lib/wisdom-center-api.ts line 184 +
    //  account-api.ts), so backend-only. Same pattern as
    // publish-wisdom (commit 84e8151).
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[update-profile] POST rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authUser = await verifyToken(token); const authErr = authUser ? null : new Error('invalid token')
    if (authErr || !authUser) {
      console.warn('[update-profile] POST rejected: token verify failed', authErr && authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[update-profile] POST rejected: token user', authUser.id, '!= body userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Sensitive auth fields must go through the user-scoped Supabase Auth
    // reauthentication flow. Never use service-role updateUserById here: a
    // stolen ordinary access token would otherwise become account takeover.
    if (newEmail || newPassword) {
      return Response.json(
        { error: 'Secure reauthentication is required' },
        { status: 410 }
      )
    }
    
    // 构建更新数据
    const updateData = {
      updated_at: new Date().toISOString(),
    }
    
    if (displayName !== undefined) {
      // Display names are capped consistently with both mobile entry points.
      updateData.display_name = displayName ? displayName.slice(0, 15) : displayName
    }
    
    if (defaultAvatarId !== undefined) {
      if (!DEFAULT_AVATAR_IDS.has(defaultAvatarId)) {
        return Response.json({ error: 'Invalid default avatar' }, { status: 400 })
      }
      updateData.avatar_url = defaultAvatarId
      updateData.is_default_avatar = true
    }
    
    // Onboarding funnel answers (2026-08-10 analytics) — whitelisted keys only.
    if (['partner', 'parent', 'child', 'bestie', 'special'].includes(onboardingWho)) {
      updateData.onboarding_who = onboardingWho
    }
    if (['A', 'B', 'C', 'D'].includes(onboardingBlocker)) {
      updateData.onboarding_blocker = onboardingBlocker
    }

    if (birthday !== undefined) {
      updateData.birthday = birthday
    }

    console.log('[update-profile] updating whitelisted fields for user:', userId, Object.keys(updateData))
    
    // 更新 profile
    const { data, error } = await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single()
    
    if (error) {
      console.error('Profile update error:', error)
      
      // 如果 profile 不存在，尝试创建
      if (error.code === 'PGRST116') {
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            display_name: displayName ? displayName.slice(0, 15) : '',
            avatar_url: defaultAvatarId || null,
            is_default_avatar: true,
            birthday: birthday || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single()
        
        if (insertError) {
          return Response.json({ error: 'Failed to create profile', details: insertError.message }, { status: 500 })
        }
        
        return Response.json({ success: true, profile: newProfile })
      }
      
      return Response.json({ error: 'Failed to update profile', details: error.message }, { status: 500 })
    }

    return Response.json({ success: true, profile: data })
    
  } catch (error) {
    console.error('Update profile error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
