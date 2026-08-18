import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

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
    const { userId, displayName, avatarUrl, birthday, newEmail, newPassword, aspireWords, onboardingWho, onboardingBlocker } = await request.json()
    
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

    // When aspire_words changed, invalidate this week's cached weekly
    // report so it regenerates with the new trait set (otherwise the
    // user sees stale traits for the rest of the ISO week). Best-effort.
    if (aspireWords !== undefined) {
      const _now = new Date()
      const _dow = _now.getDay()
      const _mon = new Date(_now)
      _mon.setDate(_now.getDate() - (_dow === 0 ? 6 : _dow - 1))
      const _weekStart = _mon.toISOString().split('T')[0]
      await supabase
        .from('weekly_reports')
        .delete()
        .eq('user_id', userId)
        .eq('week_start', _weekStart)
    }

    // Cascade name/avatar changes to the redundant snapshots stamped on
    // the user's previously-published content, so a rename / new avatar
    // also shows up on their existing cards and seek questions (not just
    // the Me page / leaderboard, which read profiles live). Only runs when
    // display_name or avatar_url actually changed. Best-effort: a cascade
    // failure must NOT fail the profile update itself (that already
    // succeeded) — we log and move on. Clients see the new values on the
    // next SWR refresh of the seek / cards feeds.
    if (displayName !== undefined || avatarUrl !== undefined) {
      const cascade = {}
      if (displayName !== undefined) cascade.creator_name = updateData.display_name
      if (avatarUrl !== undefined) cascade.creator_avatar = updateData.avatar_url
      try {
        const { error: wcErr } = await supabase
          .from('wisdom_cards')
          .update(cascade)
          .eq('user_id', userId)
        if (wcErr) console.error('[update-profile] wisdom_cards cascade failed (non-blocking):', wcErr.message)
        const { error: sqErr } = await supabase
          .from('seek_questions')
          .update(cascade)
          .eq('submitted_by_user_id', userId)
        if (sqErr) console.error('[update-profile] seek_questions cascade failed (non-blocking):', sqErr.message)
      } catch (cascadeErr) {
        console.error('[update-profile] creator name/avatar cascade exception (non-blocking):', cascadeErr && cascadeErr.message)
      }
    }

    return Response.json({ success: true, profile: data })
    
  } catch (error) {
    console.error('Update profile error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
