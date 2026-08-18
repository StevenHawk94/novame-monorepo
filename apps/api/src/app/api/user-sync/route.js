import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'

export const runtime = 'edge'

// 从邮箱提取用户名（最多16字符）
function getDisplayNameFromEmail(email) {
  if (!email) return null
  const prefix = email.split('@')[0] || ''
  return prefix.slice(0, 16)
}

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

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    // ============================================================
    // SECURITY: require a Bearer token whose user matches ?userId.
    // user-sync GET returns the FULL profile row (email, birthday,
    // aspire data, subscription_tier) via the service-role client
    // (RLS bypassed) -- without this guard anyone could read any
    // user's profile by id. Mobile apiClient attaches the token.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[user-sync GET] rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabaseGet = getSupabaseAdmin()
    const _authUserGet = await verifyToken(token); const _authErrGet = _authUserGet ? null : new Error('invalid token')
    if (_authErrGet || !_authUserGet) {
      console.warn('[user-sync GET] rejected: token verify failed', _authErrGet && _authErrGet.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (_authUserGet.id !== userId) {
      console.warn('[user-sync GET] rejected: token user', _authUserGet.id, '!= query userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    
    // 1. 获取用户 profile
    let { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    
    // If the profile does not exist, create it with a default display name.
    // Default avatar art is bundled in the app and selected deterministically
    // from the user id; the database intentionally stores no default URL.
    if (profileError && profileError.code === 'PGRST116') {
      // 获取用户邮箱来生成默认用户名 + 直接写入 profiles.email
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const authEmail = authUser?.user?.email || null
      const defaultDisplayName = getDisplayNameFromEmail(authEmail)

      // Stage 6.IAPFix: persist email at profile creation.
      // Prior to this fix the email was read from auth.users only to
      // derive display_name and then discarded — leaving profiles.email
      // NULL for every user (verified across 119 production rows).
      // Auth flows + admin queries that pivot off profiles need this
      // column populated.
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          email: authEmail,
          display_name: defaultDisplayName,
          avatar_url: null,
          is_default_avatar: true,
          has_completed_onboarding: false,
        })
        .select()
        .single()
      
      if (createError) {
        console.error('Profile creation error:', createError)
      } else {
        profile = newProfile

        // Stage 5.WR.2 (Bug 4 fix): every new user gets the
        // action-initiative wisdom card in their Collection by default.
        // The card content mirrors INITIATIVE_CARD in the mobile
        // onboarding constants — same quote_short + insight_full text
        // shown on onboarding Step 8, so the card the user "earned" in
        // the simulated onboarding is the same one they actually own.
        //
        // Note: wisdom_id is NULL on purpose. This card has no source
        // wisdom (the user never recorded one to generate it); leaving
        // wisdom_id null keeps the card out of the My Logs feed (which
        // filters on user_id from wisdoms table), while still showing
        // it in Collection (which queries wisdom_cards directly).
        // card_a/card_b/card_c are NOT NULL columns in the schema, so
        // we fill with quote_short/empty/empty to satisfy the constraint.
        // task_1/task_2 stay null — this is a static "default" card
        // with no actionable tasks tied to it.
        //
        // Errors here are non-fatal. If the INSERT fails, the user
        // still gets through sync; we just log it. They lose the
        // default card (minor) rather than failing sign-in (major).
        const { error: starterCardError } = await supabase
          .from('wisdom_cards')
          .insert({
            user_id: userId,
            wisdom_id: null,
            keyword_id: 'action-initiative',
            card_number: 1,
            quote_short:
              'The simple act of showing up is the first step of every great awakening.',
            insight_full:
              "The sheer act of showing up is your first profound breakthrough. You are here because a quiet part of you is demanding growth. Many ignore that inner voice, but you chose to listen. This desire to evolve is never just a fleeting thought—it is a grounding strength and the true engine of your transformation. Actively seeking change proves the seeds of your highest self are already taking root. You don't need every answer mapped out today; you only need the courage to begin. Your willingness to change is the magic.",
            card_a:
              'The simple act of showing up is the first step of every great awakening.',
            card_b: '',
            card_c: '',
            task_1: null,
            task_2: null,
            creator_name: newProfile.display_name,
            creator_avatar: newProfile.avatar_url,
          })
        if (starterCardError) {
          console.warn('[user-sync] starter card insert error:', starterCardError)
        }

        // Stage 5.WR.2 (Bug 2 part B): every new user gets 3 starter
        // tasks. These are one-time, never re-created, never expire
        // (expires_at far in the future). Once completed they vanish
        // from the active list. Free-standing micro-actions designed to
        // ground the user in their body / environment before any
        // wisdom recording — therapeutic priming.
        //
        // task_type='starter' separates these from daily_love (daily,
        // auto-regenerated) and wisdom (per-publish, 24h expiry).
        const { error: starterTasksError } = await supabase
          .from('daily_tasks')
          .insert([
            {
              user_id: userId,
              task_type: 'starter',
              task_text:
                'Name five things you see, four you feel, and three you hear right now.',
              exp_reward: 10,
              is_completed: false,
              expires_at: '2099-12-31T23:59:59Z',
            },
            {
              user_id: userId,
              task_type: 'starter',
              task_text: 'Drink a full glass of cold water slowly.',
              exp_reward: 10,
              is_completed: false,
              expires_at: '2099-12-31T23:59:59Z',
            },
            {
              user_id: userId,
              task_type: 'starter',
              task_text:
                'Look out a window and focus on the furthest object you can see for one minute.',
              exp_reward: 10,
              is_completed: false,
              expires_at: '2099-12-31T23:59:59Z',
            },
          ])
        if (starterTasksError) {
          console.warn('[user-sync] starter tasks insert error:', starterTasksError)
        }
      }
    } else if (profileError) {
      console.error('Profile fetch error:', profileError)
    }
    
    // Stage 6.IAPFix: defensive email backfill. If profile exists
    // (didn't hit the create branch above) but email is NULL — e.g.
    // a legacy row from before email was written — fetch from
    // auth.users once and persist. Self-healing for the column.
    if (profile && (!profile.email || profile.email === '')) {
      try {
        const { data: au } = await supabase.auth.admin.getUserById(userId)
        const email = au?.user?.email
        if (email) {
          const { data: emailUpdated } = await supabase
            .from('profiles')
            .update({ email, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select()
            .single()
          if (emailUpdated) profile = emailUpdated
        }
      } catch (e) {
        console.warn('[user-sync] email backfill failed:', e.message)
      }
    }

    // 2. 获取用户创建的 wisdoms (with insight card data)
    const { data: rawWisdoms, error: wisdomsError } = await supabase
      .from('wisdoms')
      .select('*, wisdom_cards(id, keyword_id, card_number, quote_short, insight_full, card_a, card_b, card_c, wisdom_score, wisdom_emotion)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (wisdomsError) {
      console.error('Wisdoms fetch error:', wisdomsError)
    }
    
    // Attach first card as .card for each wisdom
    const wisdoms = (rawWisdoms || []).map(w => ({
      ...w,
      card: w.wisdom_cards?.[0] || null,
    }))

    // 2b. 获取独立卡片（wisdom_id=null，如 onboarding 默认卡）
    const { data: standaloneCards } = await supabase
      .from('wisdom_cards')
      .select('id, keyword_id, card_number, quote_short, insight_full, card_a, card_b, card_c, wisdom_score, wisdom_emotion, created_at')
      .eq('user_id', userId)
      .is('wisdom_id', null)
      .order('created_at', { ascending: true })
    
    // 3. 获取用户 liked 的 wisdoms
    const { data: likedWisdomIds, error: likedError } = await supabase
      .from('user_liked_wisdoms')
      .select('wisdom_id')
      .eq('user_id', userId)
    
    if (likedError) {
      console.error('Liked wisdoms fetch error:', likedError)
    }
    
    // 3b. 获取用户 liked 的默认 wisdoms
    let likedDefaultIds = []
    try {
      const { data: likedDefaults, error: defaultError } = await supabase
        .from('user_liked_defaults')
        .select('wisdom_id')
        .eq('user_id', userId)
      
      if (!defaultError && likedDefaults) {
        likedDefaultIds = likedDefaults.map(item => item.wisdom_id)
      }
    } catch (e) {
      console.log('user_liked_defaults table may not exist yet')
    }
    
    // 4. 获取 liked wisdoms 的详细信息
    let likedWisdoms = []
    if (likedWisdomIds && likedWisdomIds.length > 0) {
      const wisdomIds = likedWisdomIds.map(item => item.wisdom_id)
      const { data: likedWisdomsData } = await supabase
        .from('wisdoms')
        .select('*')
        .in('id', wisdomIds)
      
      if (likedWisdomsData && likedWisdomsData.length > 0) {
        const userIds = [...new Set(likedWisdomsData.map(w => w.user_id).filter(Boolean))]
        let usersMap = {}
        
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('profiles')
            .select('id, display_name, avatar_url')
            .in('id', userIds)
          
          if (users) {
            usersMap = users.reduce((acc, u) => {
              acc[u.id] = { name: u.display_name || 'Anonymous', avatar: u.avatar_url }
              return acc
            }, {})
          }
        }
        
        likedWisdoms = likedWisdomsData.map(w => ({
          ...w,
          user: usersMap[w.user_id] || { name: 'Anonymous', avatar: null },
        }))
      }
    }
    
    // Stage 6.UserSyncCleanup: removed legacy questions fetch block.
    // It referenced public.questions (table never existed -- real table
    // is public.seek_questions, accessed via the dedicated
    // /api/user-questions and /api/seek-questions routes). Every
    // user-sync GET was silently erroring with PGRST205 on this
    // SELECT and falling through to return data.questions = [],
    // which no mobile consumer read.

    return Response.json({
      success: true,
      data: {
        profile: profile || null,
        subscriptionTier: profile?.subscription_tier || 'free',
        wisdoms: wisdoms || [],
        standaloneCards: standaloneCards || [],
        likedWisdoms: likedWisdoms || [],
        likedDefaultIds: likedDefaultIds || [],
        hasCompletedOnboarding: profile?.has_completed_onboarding || false,
        selectedCharacter: profile?.selected_character || 'char-1',
        selectedInterests: profile?.selected_interests || [],
        drainWords: profile?.drain_words || [],
        aspireWords: profile?.aspire_words || [],
        customCategories: profile?.custom_categories || [],
      }
    })
    
  } catch (error) {
    console.error('User sync error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST: 保存用户 profile 设置
 */
export async function POST(request) {
  try {
    const { 
      userId, 
      hasCompletedOnboarding,
      selectedCharacter,
      selectedInterests,
      customCategories,
      displayName,
      birthday,
      avatarUrl,
      drainWords,
      aspireWords,
      aspireScores,
      betterSelfScore,
      wisdomPortrait,
    } = await request.json()

    // ============================================================
    // SECURITY: derive the user from the Bearer token; IGNORE any
    // userId in the request body. user-sync POST upserts a profile via
    // the service-role client (RLS bypassed) -- without this, anyone
    // could overwrite ANY user's profile by POSTing their id. We write
    // to _authUser.id only, so a spoofed body.userId can at most target
    // the caller's own row. Mobile apiClient attaches the token.
    // ============================================================
    const _authHeader = request.headers.get('authorization') || ''
    const _token = _authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!_token) {
      console.warn('[user-sync POST] rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const _authSupabasePost = getSupabaseAdmin()
    const _authUser = await verifyToken(_token); const _authErr = _authUser ? null : new Error('invalid token')
    if (_authErr || !_authUser) {
      console.warn('[user-sync POST] rejected: token verify failed', _authErr && _authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authedUserId = _authUser.id
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    
    // 构建更新对象
    const updates = { updated_at: new Date().toISOString() }
    
    if (hasCompletedOnboarding !== undefined) {
      updates.has_completed_onboarding = hasCompletedOnboarding
    }
    if (selectedCharacter !== undefined) {
      updates.selected_character = selectedCharacter
    }
    if (selectedInterests !== undefined) {
      updates.selected_interests = selectedInterests
    }
    if (customCategories !== undefined) {
      updates.custom_categories = customCategories
    }
    if (displayName !== undefined) {
      // 限制用户名最多16字符
      updates.display_name = displayName ? displayName.slice(0, 16) : displayName
    }
    if (birthday !== undefined) {
      updates.birthday = birthday
    }
    if (avatarUrl !== undefined) {
      updates.avatar_url = avatarUrl
      // 如果用户上传了自定义头像，标记为非默认
      updates.is_default_avatar = false
    }
    if (drainWords !== undefined) {
      updates.drain_words = drainWords
    }
    if (aspireWords !== undefined) {
      updates.aspire_words = aspireWords
    }
    if (aspireScores !== undefined) {
      updates.aspire_scores = aspireScores
    }
    if (betterSelfScore !== undefined) {
      updates.better_self_score = betterSelfScore
    }
    // Stage 6: wisdom_portrait deprecated. user-sync no longer writes
    // the field even when client sends it (forward-compat: drop silently).
    // DB column preserved for rollback safety.
    
    // Upsert profile
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: authedUserId,
        ...updates,
      })
      .select()
      .single()
    
    if (error) {
      console.error('Profile update error:', error)
      return Response.json({ error: 'Failed to update profile' }, { status: 500 })
    }
    
    return Response.json({
      success: true,
      profile: data,
    })
    
  } catch (error) {
    console.error('Profile save error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
