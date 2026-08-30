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

    // ============================================================
    // SECURITY (Module 6 #6 Step 1): require Bearer token matching
    // body.userId. delete-account is the highest-impact endpoint --
    // it cascade-deletes ALL of a user's data + their Supabase Auth
    // entry. Before this guard, any anon caller knowing a user UUID
    // could permanently destroy that account.
    //
    // Mobile attaches the token automatically via apiClient
    // (apps/mobile/src/lib/account-api.ts line 130), so backend-only.
    // Same pattern as publish-wisdom (commit 84e8151) and
    // wisdom-center (commit 099973f).
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[delete-account] POST rejected: no bearer token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authUser = await verifyToken(token); const authErr = authUser ? null : new Error('invalid token')
    if (authErr || !authUser) {
      console.warn('[delete-account] POST rejected: token verify failed', authErr && authErr.message)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[delete-account] POST rejected: token user', authUser.id, '!= body userId', userId)
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    console.log('Starting account deletion for user:', userId)
    
    // 1. 删除用户的 wisdoms 相关的音频文件
    const { data: wisdoms, error: wisdomListError } = await supabase
      .from('wisdoms')
      .select('id, audio_url')
      .eq('user_id', userId)
    if (wisdomListError) throw wisdomListError
    
    if (wisdoms && wisdoms.length > 0) {
      // 尝试删除 Storage 中的音频文件
      for (const wisdom of wisdoms) {
        if (wisdom.audio_url) {
          try {
            // 从 URL 中提取文件路径
            const urlParts = wisdom.audio_url.split('/audio/')
            if (urlParts.length > 1) {
              const filePath = urlParts[1]
              const { error: storageError } = await supabase.storage.from('audio').remove([filePath])
              if (storageError) throw storageError
            }
          } catch (e) { throw new Error(`audio_cleanup_failed: ${e.message}`) }
        }
      }
    }
    
    // 2. 删除用户的 wisdoms
    const { error: wisdomsError } = await supabase
      .from('wisdoms')
      .delete()
      .eq('user_id', userId)
    
    if (wisdomsError) throw wisdomsError
    
    // 3. 删除用户提交的 seek_questions
    //
    // Stage 6.UserSyncCleanup: this delete previously targeted
    // public.questions (table never existed) with .eq('user_id', ...).
    // The real table is public.seek_questions and the user reference
    // column is submitted_by_user_id. Pre-fix every account deletion
    // left the user's submitted questions orphaned in DB -- silent
    // GDPR violation hidden by the silent error swallow.
    const { error: questionsError } = await supabase
      .from('seek_questions')
      .delete()
      .eq('submitted_by_user_id', userId)
    
    if (questionsError) throw questionsError
    
    // 4. 删除用户的 liked wisdoms 记录
    const { error: likedError } = await supabase
      .from('user_liked_wisdoms')
      .delete()
      .eq('user_id', userId)
    
    if (likedError) throw likedError
    
    // 5. 删除用户的 liked defaults 记录
    const { error: likedDefaultsError } = await supabase
      .from('user_liked_defaults')
      .delete()
      .eq('user_id', userId)
    if (likedDefaultsError) throw likedDefaultsError
    
    // 6. 删除用户头像
    {
      const { data: profile, error: avatarProfileError } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle()
      if (avatarProfileError) throw avatarProfileError
      
      if (profile?.avatar_url && profile.avatar_url.includes(`/${userId}/`)) {
        const urlParts = profile.avatar_url.split('/avatars/')
        if (urlParts.length > 1) {
          const filePath = urlParts[1]
          const { error: avatarStorageError } = await supabase.storage.from('avatars').remove([filePath])
          if (avatarStorageError) throw avatarStorageError
        }
      }
    }
    
    // 7. 删除用户 profile
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId)
    
    // This single statement atomically applies every ON DELETE cascade. Do not
    // continue to auth deletion unless the relational delete is confirmed.
    if (profileError) throw profileError
    
    // 8. 删除 Supabase Auth 用户
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)
    
    if (authError) throw authError
    
    console.log('Account deletion completed for user:', userId)
    
    return Response.json({
      success: true,
      message: 'Account and all associated data have been deleted',
    })
    
  } catch (error) {
    console.error('Delete account error:', error)
    // Never report success for partial deletion. The client can retry safely;
    // deletes and storage removals are idempotent.
    return Response.json({ error: 'Account deletion is incomplete. Please try again.' }, { status: 500 })
  }
}
