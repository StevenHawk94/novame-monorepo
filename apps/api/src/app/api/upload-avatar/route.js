import { createClient } from '@supabase/supabase-js'
import { verifyToken } from '@/lib/auth-guard'
import { rateLimit } from '@/lib/rate-limit'

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
 * 使用 Google Cloud Vision SafeSearch 检测敏感内容
 */
async function checkImageSafety(imageBase64) {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  
  if (!apiKey) {
    console.log('Google Cloud Vision API key not configured')
    return { safe: true, reason: 'Safety check skipped (no API key)', skipped: true }
  }
  
  try {
    console.log('Calling Vision API, image size:', imageBase64.length, 'chars')
    
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageBase64 },
            features: [{ type: 'SAFE_SEARCH_DETECTION' }]
          }]
        })
      }
    )
    
    const responseText = await response.text()
    console.log('Vision API response status:', response.status)
    console.log('Vision API response:', responseText.substring(0, 500))
    
    if (!response.ok) {
      console.error('Vision API error status:', response.status)
      return { 
        safe: true, 
        reason: `Vision API error (${response.status}), allowing by default`,
        error: responseText.substring(0, 200)
      }
    }
    
    const data = JSON.parse(responseText)
    const safeSearch = data.responses?.[0]?.safeSearchAnnotation
    
    if (!safeSearch) {
      console.log('No safeSearch data in response')
      return { safe: true, reason: 'No safety data returned', details: data }
    }
    
    console.log('SafeSearch results:', JSON.stringify(safeSearch))
    
    // 检查各项指标
    const unsafeRatings = ['LIKELY', 'VERY_LIKELY']
    const issues = []
    
    if (unsafeRatings.includes(safeSearch.adult)) {
      issues.push('adult content')
    }
    if (unsafeRatings.includes(safeSearch.violence)) {
      issues.push('violent content')
    }
    if (unsafeRatings.includes(safeSearch.racy)) {
      issues.push('racy content')
    }
    
    if (issues.length > 0) {
      return {
        safe: false,
        reason: `Image contains: ${issues.join(', ')}`,
        details: safeSearch
      }
    }
    
    return { safe: true, reason: 'Image passed safety check', details: safeSearch }
    
  } catch (error) {
    console.error('Safety check exception:', error.message)
    return { 
      safe: true, 
      reason: 'Safety check error: ' + error.message,
      error: error.message
    }
  }
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const imageFile = formData.get('image')
    const userId = formData.get('userId')
    
    if (!imageFile || !userId) {
      return Response.json(
        { error: 'Missing image or userId' },
        { status: 400 }
      )
    }

    // ============================================================
    // SECURITY (B4): require a Bearer token matching body userId.
    // Before this gate upload-avatar was fully unauthenticated -- anyone
    // could (a) burn Google Vision SafeSearch spend by POSTing images in
    // a loop, and (b) overwrite ANY user's avatar (userId is client-
    // supplied + upsert:true). Mobile sends the token via apiClient even
    // for multipart FormData (packages/api-client attaches Authorization
    // outside the FormData branch), so legit uploads are unaffected.
    // ============================================================
    const authHeader = request.headers.get('authorization') || ''
    const authToken = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!authToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authClient = getSupabaseAdmin()
    const authUser = await verifyToken(authToken); const authErr = authUser ? null : new Error('invalid token')
    if (authErr || !authUser || authUser.id !== userId) {
      console.warn('[upload-avatar] rejected: token/user mismatch')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SECURITY (2026-08-07 audit): each upload is a paid Google Vision call.
    // Cap at 20/hour/user so it can't be looped for unbounded Vision spend.
    const rl = await rateLimit(authClient, `upload-avatar:${userId}`, 20, 3600)
    if (!rl.allowed) {
      return Response.json({ error: 'Too many uploads. Try again later.' }, { status: 429 })
    }

    // Validate type + size BEFORE the Vision call so a bad/oversized file
    // can't burn Vision spend or balloon memory. Avatars are small images.
    const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    const MAX_AVATAR_BYTES = 8 * 1024 * 1024
    if (imageFile.type && !ALLOWED_AVATAR_TYPES.includes(String(imageFile.type).toLowerCase())) {
      return Response.json({ error: 'Unsupported image type', code: 'BAD_TYPE' }, { status: 400 })
    }
    if (typeof imageFile.size === 'number' && imageFile.size > MAX_AVATAR_BYTES) {
      return Response.json({ error: 'Image too large (max 8MB)', code: 'TOO_LARGE' }, { status: 400 })
    }
    
    console.log('Processing avatar upload for user:', userId)
    console.log('Image file type:', imageFile.type, 'size:', imageFile.size)
    
    // 转换为 base64
    const arrayBuffer = await imageFile.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    
    // Base64 编码
    let binaryString = ''
    const chunkSize = 8192
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, i + chunkSize)
      binaryString += String.fromCharCode.apply(null, chunk)
    }
    const base64Image = btoa(binaryString)
    
    console.log('Base64 encoded, length:', base64Image.length)
    
    // 检查图片安全性
    const safetyResult = await checkImageSafety(base64Image)
    
    console.log('Safety check result:', JSON.stringify(safetyResult))
    
    if (!safetyResult.safe) {
      return Response.json({
        success: false,
        error: 'Image rejected',
        reason: safetyResult.reason,
        code: 'UNSAFE_CONTENT',
        details: safetyResult.details
      }, { status: 400 })
    }
    
    // 上传到 Supabase Storage
    const supabase = getSupabaseAdmin()
    const timestamp = Date.now()
    const filename = `${userId}/${timestamp}.jpg`
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filename, buffer, {
        contentType: imageFile.type || 'image/jpeg',
        upsert: true
      })
    
    if (uploadError) {
      console.error('Upload error:', uploadError)
      return Response.json(
        { error: 'Failed to upload image', details: uploadError.message },
        { status: 500 }
      )
    }
    
    // 获取公开 URL
    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filename)
    
    // 更新用户 profile
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        avatar_url: publicUrl,
        is_default_avatar: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
    
    if (updateError) {
      console.error('Profile update error:', updateError)
    }
    
    return Response.json({
      success: true,
      avatarUrl: publicUrl,
      safetyCheck: safetyResult.reason,
      safetyDetails: safetyResult.details || null
    })
    
  } catch (error) {
    console.error('Avatar upload error:', error)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
