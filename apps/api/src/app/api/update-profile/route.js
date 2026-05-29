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
 * POST: 更新用户 profile（display_name, avatar_url, birthday）
 * Also handles: newEmail, newPassword (via Supabase admin auth API)
 */
export async function POST(request) {
  try {
    const { userId, displayName, avatarUrl, birthday, newEmail, newPassword, aspireWords } = await request.json()
    
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
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authUser) {
      console.warn('[update-profile] POST rejected: token verify failed', authErr && authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[update-profile] POST rejected: token user', authUser.id, '!= body userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Handle email change via admin API
    if (newEmail) {
      try {
        const { error } = await supabase.auth.admin.updateUserById(userId, {
          email: newEmail,
        })
        if (error) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        return Response.json({ success: true, message: 'Verification email sent' })
      } catch (e) {
        return Response.json({ error: 'Failed to update email: ' + e.message }, { status: 500 })
      }
    }

    // Handle password change via admin API
    if (newPassword) {
      if (newPassword.length < 8) {
        return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
      }
      try {
        const { error } = await supabase.auth.admin.updateUserById(userId, {
          password: newPassword,
        })
        if (error) {
          return Response.json({ error: error.message }, { status: 400 })
        }
        return Response.json({ success: true, message: 'Password updated' })
      } catch (e) {
        return Response.json({ error: 'Failed to update password: ' + e.message }, { status: 500 })
      }
    }
    
    // 构建更新数据
    const updateData = {
      updated_at: new Date().toISOString(),
    }
    
    if (displayName !== undefined) {
      // 限制用户名最多16字符
      updateData.display_name = displayName ? displayName.slice(0, 16) : displayName
    }
    
    if (avatarUrl !== undefined) {
      updateData.avatar_url = avatarUrl
      updateData.is_default_avatar = false
    }
    
    if (birthday !== undefined) {
      updateData.birthday = birthday
    }

    // Stage 6: aspire_words update with B-strategy score handling.
    // Preserves historical aspire_scores untouched (user-produced data
    // is user-owned -- removed words keep their score in the dict, will
    // be revived if user re-adds the word later). Better-self-score is
    // recomputed as avg of CURRENT aspireWords, with unscored new words
    // defaulting to 70 (matches generate-card.js publish-time default).
    if (aspireWords !== undefined) {
      if (!Array.isArray(aspireWords)) {
        return Response.json({ error: 'aspireWords must be an array' }, { status: 400 })
      }
      updateData.aspire_words = aspireWords

      // Fetch current aspire_scores to recompute better_self_score
      // (we preserve scores untouched; we only recompute the average
      // for the new aspireWords set).
      const { data: existing } = await supabase
        .from('profiles')
        .select('aspire_scores')
        .eq('id', userId)
        .single()
      const existingScores = existing?.aspire_scores || {}
      if (aspireWords.length > 0) {
        const vals = aspireWords.map(w => existingScores[w] ?? 70)
        const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        updateData.better_self_score = avg
      }
    }
    
    console.log('Updating profile for user:', userId, updateData)
    
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
            display_name: displayName ? displayName.slice(0, 16) : '',
            avatar_url: avatarUrl || null,
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
