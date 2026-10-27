import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'
import { securityRateLimit,securityFailure } from '@/lib/security-boundary'
import { normalizeProfileAvatar } from '@/lib/profile-avatar-image.mjs'

export const runtime = 'nodejs'

const MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 5 * 1024 * 1024
const OPTIMIZED_MAX_BYTES = 1024 * 1024

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function decodeBase64(value) {
  const raw = value.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function matchesDeclaredImageType(bytes, mimeType) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  }
  return false
}

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    const authUser = await verifyToken(token)
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { action, userId, base64, mimeType, path: requestedPath, requestKey } = body
    if (authUser.id !== userId) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()

    if (action === 'prepare') {
      await securityRateLimit(supabase,request,userId,'avatar-upload',10,3600)
      if(requestKey!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey))return Response.json({error:'Invalid request key'},{status:400})
      const ticket=await supabase.rpc('prepare_profile_avatar_v1',{p_user:userId,p_key:requestKey??crypto.randomUUID()})
      if(ticket.error||ticket.data?.error||!ticket.data?.path)return Response.json({error:'Avatar upload is temporarily unavailable'},{status:503})
      const path=ticket.data.path
      const { data, error } = await supabase.storage.from('avatars').createSignedUploadUrl(path)
      if (error || !data?.token) {
        console.error('[upload-avatar] signed upload ticket failed', error)
        return Response.json({ error: 'Could not prepare photo upload' }, { status: 500 })
      }
      return Response.json({ success: true, path, token: data.token })
    }

    if (action === 'complete') {
      await securityRateLimit(supabase,request,userId,'avatar-complete',30,60)
      const path = typeof requestedPath === 'string' ? requestedPath : ''
      if (!path.startsWith(`${userId}/`) || !/^[0-9a-f-]+\.jpg$/i.test(path.slice(userId.length + 1))) {
        return Response.json({ error: 'Invalid image path' }, { status: 400 })
      }
      const { data: info, error: infoError } = await supabase.storage.from('avatars').info(path)
      if (
        infoError
        || !info
        || typeof info.size !== 'number'
        || info.size <= 0
        || info.size > OPTIMIZED_MAX_BYTES
        || info.contentType !== 'image/jpeg'
      ) {
        return Response.json({ error: 'Invalid uploaded image' }, { status: 400 })
      }

      const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path)
      const downloaded=await supabase.storage.from('avatars').download(path)
      if(downloaded.error||!downloaded.data)return Response.json({error:'Could not validate photo'},{status:503})
      let normalized
      try{normalized=await normalizeProfileAvatar(new Uint8Array(await downloaded.data.arrayBuffer()))}
      catch{return Response.json({error:'Invalid uploaded image'},{status:400})}
      const sanitized=await supabase.storage.from('avatars').upload(path,normalized,{contentType:'image/jpeg',upsert:true,cacheControl:'31536000'})
      if(sanitized.error)return Response.json({error:'Could not validate photo'},{status:503})
      const avatarUrl = publicData.publicUrl
      const committed=await supabase.rpc('complete_profile_avatar_v1',{p_user:userId,p_path:path,p_url:avatarUrl})
      if(committed.error||!committed.data||committed.data.error)return Response.json({error:'Could not save photo'},{status:503})
      return Response.json({success:true,...committed.data})
    }

    const extension = MIME_TYPES[mimeType]
    if (!extension || typeof base64 !== 'string' || !base64) {
      return Response.json({ error: 'Invalid image' }, { status: 400 })
    }
    // Base64 is roughly 4/3 of the decoded payload. Reject oversized input
    // before allocating a decoded buffer in the Edge runtime.
    if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 256) {
      return Response.json({ error: 'Image is too large' }, { status: 413 })
    }

    await securityRateLimit(supabase,request,userId,'avatar-upload',10,3600)

    let bytes
    try {
      bytes = decodeBase64(base64)
    } catch {
      return Response.json({ error: 'Invalid image' }, { status: 400 })
    }
    if (!bytes.length || bytes.length > MAX_BYTES) {
      return Response.json({ error: 'Image is too large' }, { status: 413 })
    }
    if (!matchesDeclaredImageType(bytes, mimeType)) {
      return Response.json({ error: 'Invalid image' }, { status: 400 })
    }

    try { bytes=await normalizeProfileAvatar(bytes) }
    catch { return Response.json({error:'Invalid image'},{status:400}) }
    const path = `${userId}/${crypto.randomUUID()}.jpg`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, {
        cacheControl: '31536000',
        contentType: 'image/jpeg',
        upsert: false,
      })
    if (uploadError) {
      console.error('[upload-avatar] storage upload failed', uploadError)
      return Response.json({ error: 'Could not upload photo' }, { status: 500 })
    }

    const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = publicData.publicUrl
    const committed=await supabase.rpc('complete_profile_avatar_v1',{p_user:userId,p_path:path,p_url:avatarUrl})
    if(committed.error||!committed.data||committed.data.error)return Response.json({error:'Could not save photo'},{status:503})
    return Response.json({success:true,...committed.data})
  } catch (error) {
    if(error.status)return securityFailure(error)
    console.error('[upload-avatar] unexpected error', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
