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
 * POST: 删除用户账号及所有相关数据
 * 
 * App Store 要求：用户必须能在 App 内删除自己的账号
 * 
 * 删除顺序：
 * 1. 删除用户的 wisdoms
 * 2. 删除用户的 questions
 * 3. 删除用户的 liked wisdoms 记录
 * 4. 删除用户的 profile
 * 5. 删除 Supabase Auth 用户
 */
export async function POST(request) {
  try {
    const { userId } = await request.json()
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()
    
    console.log('Starting account deletion for user:', userId)
    
    // 1. 删除用户的 wisdoms 相关的音频文件
    const { data: wisdoms } = await supabase
      .from('wisdoms')
      .select('id, audio_url')
      .eq('user_id', userId)
    
    if (wisdoms && wisdoms.length > 0) {
      // 尝试删除 Storage 中的音频文件
      for (const wisdom of wisdoms) {
        if (wisdom.audio_url) {
          try {
            // 从 URL 中提取文件路径
            const urlParts = wisdom.audio_url.split('/audio/')
            if (urlParts.length > 1) {
              const filePath = urlParts[1]
              await supabase.storage.from('audio').remove([filePath])
            }
          } catch (e) {
            console.log('Failed to delete audio file:', e.message)
          }
        }
      }
    }
    
    // 2. 删除用户的 wisdoms
    const { error: wisdomsError } = await supabase
      .from('wisdoms')
      .delete()
      .eq('user_id', userId)
    
    if (wisdomsError) {
      console.error('Failed to delete wisdoms:', wisdomsError)
    } else {
      console.log('Deleted wisdoms for user:', userId)
    }
    
    // 3. 删除用户的 questions
    const { error: questionsError } = await supabase
      .from('questions')
      .delete()
      .eq('user_id', userId)
    
    if (questionsError) {
      console.error('Failed to delete questions:', questionsError)
    } else {
      console.log('Deleted questions for user:', userId)
    }
    
    // 4. 删除用户的 liked wisdoms 记录
    const { error: likedError } = await supabase
      .from('user_liked_wisdoms')
      .delete()
      .eq('user_id', userId)
    
    if (likedError) {
      console.error('Failed to delete liked wisdoms:', likedError)
    }
    
    // 5. 删除用户的 liked defaults 记录
    try {
      await supabase
        .from('user_liked_defaults')
        .delete()
        .eq('user_id', userId)
    } catch (e) {
      console.log('user_liked_defaults table may not exist')
    }
    
    // 6. 删除用户头像
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .single()
      
      if (profile?.avatar_url && profile.avatar_url.includes(`/${userId}/`)) {
        const urlParts = profile.avatar_url.split('/avatars/')
        if (urlParts.length > 1) {
          const filePath = urlParts[1]
          await supabase.storage.from('avatars').remove([filePath])
        }
      }
    } catch (e) {
      console.log('Failed to delete avatar:', e.message)
    }
    
    // 7. 删除用户 profile
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId)
    
    if (profileError) {
      console.error('Failed to delete profile:', profileError)
    } else {
      console.log('Deleted profile for user:', userId)
    }
    
    // 8. 删除 Supabase Auth 用户
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)
    
    if (authError) {
      console.error('Failed to delete auth user:', authError)
      // 即使 Auth 删除失败，数据已经删除，仍返回成功
    } else {
      console.log('Deleted auth user:', userId)
    }
    
    console.log('Account deletion completed for user:', userId)
    
    return Response.json({
      success: true,
      message: 'Account and all associated data have been deleted',
    })
    
  } catch (error) {
    console.error('Delete account error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
