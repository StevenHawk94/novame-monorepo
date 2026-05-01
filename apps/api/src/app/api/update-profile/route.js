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
    const { userId, displayName, avatarUrl, birthday, newEmail, newPassword } = await request.json()
    
    if (!userId) {
      return Response.json({ error: 'Missing userId' }, { status: 400 })
    }
    
    const supabase = getSupabaseAdmin()

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
    return Response.json({ error: error.message }, { status: 500 })
  }
}
