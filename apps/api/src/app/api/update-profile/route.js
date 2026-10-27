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
 * Sensitive authentication changes are rejected; clients use user-scoped Auth.
 */
export async function POST(request) {
  try {
    const {
      userId,
      displayName,
      defaultAvatarId,
      birthday,
      gender,
      newEmail,
      newPassword,
      onboardingWho,
      onboardingBlocker,
      partnerName,
      partnerPronouns,
      partnerNickname,
      relationshipSince,
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
      // Onboarding's name field allows 20 characters; never silently cut it to 15.
      updateData.display_name = displayName ? displayName.slice(0, 20) : displayName
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
      if(birthday!==null&&birthday!==''&&(typeof birthday!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||!Number.isFinite(Date.parse(birthday))
        ||new Date(birthday).toISOString().slice(0,10)!==birthday||Date.parse(birthday)>Date.now()+86400000)
      )
        return Response.json({error:'Invalid date of birth'},{status:400})
      updateData.birthday = birthday || null
    }
    if(gender!==undefined){
      if(!['woman','man','non_binary','prefer_not_to_say'].includes(gender))return Response.json({error:'Invalid gender'},{status:400})
      updateData.gender=gender
    }

    if (partnerName !== undefined) {
      updateData.onboarding_partner_name = String(partnerName || '').trim().slice(0, 30) || null
    }
    if (partnerPronouns !== undefined || partnerNickname !== undefined) {
      // Keep writing to the existing legacy column so this copy change does not
      // require another database migration.
      const normalizedPronouns = partnerPronouns ?? partnerNickname
      updateData.onboarding_partner_nickname = String(normalizedPronouns || '').trim().slice(0, 30) || null
    }
    if (relationshipSince !== undefined) {
      updateData.onboarding_relationship_since = typeof relationshipSince === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(relationshipSince)
        ? relationshipSince
        : null
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
            display_name: displayName ? displayName.slice(0, 20) : '',
            avatar_url: defaultAvatarId || null,
            is_default_avatar: true,
            birthday: birthday || null,
            ...(gender!==undefined?{gender}:{}),
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

export async function GET(request){
 try {
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  const user=token?await verifyToken(token):null
  if(!user)return Response.json({error:'Unauthorized'},{status:401})
  const result=await getSupabaseAdmin().rpc('read_account_profile_v1',{p_user:user.id})
  if(result.error||!result.data)return Response.json({error:'Profile unavailable'},{status:503})
  return Response.json({success:true,profile:result.data},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Profile unavailable'},{status:503})}
}
