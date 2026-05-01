import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

// 从邮箱提取用户名（最多16字符）
function getDisplayNameFromEmail(email) {
  if (!email) return null
  const prefix = email.split('@')[0] || ''
  return prefix.slice(0, 16)
}

// 默认头像列表（备用，主要通过数据库触发器分配）
const DEFAULT_AVATARS = [
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_01.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_02.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_03.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_04.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_05.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_06.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_07.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_08.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_09.jpg',
  'https://qleeohkhbrdvznbwgqad.supabase.co/storage/v1/object/public/avatars/user-defaults/avatar_10.jpg',
]

function getRandomDefaultAvatar() {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)]
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
    
    // 如果用户 profile 不存在，创建一个（带默认头像和用户名）
    if (profileError && profileError.code === 'PGRST116') {
      const defaultAvatar = getRandomDefaultAvatar()
      
      // 获取用户邮箱来生成默认用户名
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const defaultDisplayName = getDisplayNameFromEmail(authUser?.user?.email)
      
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          display_name: defaultDisplayName,
          avatar_url: defaultAvatar,
          is_default_avatar: true,
          has_completed_onboarding: false,
        })
        .select()
        .single()
      
      if (createError) {
        console.error('Profile creation error:', createError)
      } else {
        profile = newProfile
      }
    } else if (profileError) {
      console.error('Profile fetch error:', profileError)
    }
    
    // 如果 profile 存在但没有头像，分配一个默认头像
    if (profile && (!profile.avatar_url || profile.avatar_url === '')) {
      const defaultAvatar = getRandomDefaultAvatar()
      
      const { data: updatedProfile } = await supabase
        .from('profiles')
        .update({ 
          avatar_url: defaultAvatar,
          is_default_avatar: true,
        })
        .eq('id', userId)
        .select()
        .single()
      
      if (updatedProfile) {
        profile = updatedProfile
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
    
    // 5. 获取用户的 questions
    const { data: questionsRaw, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    
    if (questionsError) {
      console.error('Questions fetch error:', questionsError)
    }
    
    // 6. 为每个 question 加载匹配的 wisdoms
    let questions = []
    if (questionsRaw && questionsRaw.length > 0) {
      questions = await Promise.all(questionsRaw.map(async (q) => {
        let matchedWisdoms = []
        
        if (q.collected_wisdom_ids && q.collected_wisdom_ids.length > 0) {
          const { data: matchedData } = await supabase
            .from('wisdoms')
            .select('*')
            .in('id', q.collected_wisdom_ids)
          
          if (matchedData && matchedData.length > 0) {
            const userIds = [...new Set(matchedData.map(w => w.user_id).filter(Boolean))]
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
            
            matchedWisdoms = matchedData.map(w => ({
              ...w,
              user: usersMap[w.user_id] || { name: 'Anonymous', avatar: null },
            }))
          }
        }
        
        return {
          ...q,
          text: q.question_text,
          matchedWisdoms: matchedWisdoms,
          matchedCount: matchedWisdoms.length,
          isPublic: q.is_public,
        }
      }))
    }
    
    return Response.json({
      success: true,
      data: {
        profile: profile || null,
        subscriptionTier: profile?.subscription_tier || 'free',
        wisdoms: wisdoms || [],
        standaloneCards: standaloneCards || [],
        likedWisdoms: likedWisdoms || [],
        likedDefaultIds: likedDefaultIds || [],
        questions: questions || [],
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
    if (wisdomPortrait !== undefined) {
      updates.wisdom_portrait = wisdomPortrait
    }
    
    // Upsert profile
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
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
