import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'
import { generateWisdomCard } from '@/lib/generate-card'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Generate embedding via Gemini
 */
async function generateEmbedding(text) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey || !text) return null

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      }
    )
    if (!response.ok) {
      console.error('Embedding API error:', await response.text())
      return null
    }
    const data = await response.json()
    const fullEmbedding = data.embedding.values
    return fullEmbedding.slice(0, 768)
  } catch (error) {
    console.error('Failed to generate embedding:', error)
    return null
  }
}

/**
 * Generate character B message using callAI (3-tier fallback)
 */
async function generateCharacterBMessage(userId, wisdomText, supabase) {
  let generatedMessage = "That was some powerful wisdom! Keep them coming!"

  if (wisdomText) {
    try {
      const { text } = await callAI({
        systemInstruction: `You are a playful, empathetic wisdom companion. Write short positive feedback with playful energy in 20 words based on what the user shared. Just return the message, no quotes or explanation.

Examples:
- "Whoa, look at you dropping major truth bombs! I'm taking notes over here before you start charging for this wisdom."
- "Are you secretly a wise old owl in a human suit? Because that was some next-level, mind-blowing insight."`,
        userText: wisdomText.substring(0, 500),
        generationConfig: { temperature: 0.9, maxOutputTokens: 50 },
      })
      if (text) generatedMessage = text
    } catch (aiError) {
      console.error('[publish-wisdom] AI generation error for B message:', aiError.message)
    }
  }

  try {
    await supabase
      .from('profiles')
      .update({
        character_b_message: generatedMessage,
        character_b_message_at: new Date().toISOString(),
        last_wisdom_created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
  } catch (error) {
    console.error('Failed to update character B message:', error)
  }

  return generatedMessage
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || ''
    let audioFile = null, userId, duration = 0, description = '', isPublic = false, isTyped = false, typedText = ''

    if (contentType.includes('application/json')) {
      const body = await request.json()
      userId = body.userId
      typedText = body.text || ''
      description = body.description || typedText.substring(0, 200)
      isPublic = body.isPublic === true || body.isPublic === 'true'
      isTyped = true
    } else {
      const formData = await request.formData()
      audioFile = formData.get('audio')
      userId = formData.get('userId')
      duration = parseInt(formData.get('duration') || '0')
      description = formData.get('description') || ''
      isPublic = formData.get('isPublic') === 'true'
    }

    if (!userId || (!audioFile && !isTyped)) {
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let creatorName = null
    let creatorAvatar = null
    try {
      const { data: profile } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', userId).single()
      if (profile) { creatorName = profile.display_name; creatorAvatar = profile.avatar_url }
    } catch (e) { console.log('Could not fetch user profile:', e.message) }

    let publicUrl = ''
    let transcribedText = ''
    let categories = ['Life']

    if (isTyped) {
      transcribedText = typedText
    } else {
      const timestamp = Date.now()
      const filename = `${userId}/${timestamp}.webm`
      const arrayBuffer = await audioFile.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('audio').upload(filename, buffer, { contentType: 'audio/webm', upsert: false })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        return NextResponse.json({ error: 'Failed to upload audio' }, { status: 500 })
      }

      const { data: { publicUrl: audioPublicUrl } } = supabase.storage.from('audio').getPublicUrl(filename)
      publicUrl = audioPublicUrl

      try {
        console.log('[publish-wisdom] Starting transcription, audio size:', buffer.length, 'bytes')
        let binaryString = ''
        const chunkSize = 8192
        for (let i = 0; i < buffer.length; i += chunkSize) {
          const chunk = buffer.slice(i, i + chunkSize)
          binaryString += String.fromCharCode.apply(null, chunk)
        }
        const base64Audio = btoa(binaryString)
        console.log('[publish-wisdom] Base64 encoded, length:', base64Audio.length)

        const transcribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://api.soulsayit.com'}/api/transcribe`
        const transcribeResponse = await fetch(transcribeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: base64Audio })
        })

        console.log('[publish-wisdom] Transcribe response status:', transcribeResponse.status)
        if (transcribeResponse.ok) {
          const transcribeData = await transcribeResponse.json()
          console.log('[publish-wisdom] Transcribe result:', JSON.stringify(transcribeData).substring(0, 200))
          transcribedText = transcribeData.text || ''
        } else {
          const errorText = await transcribeResponse.text()
          console.error('[publish-wisdom] Transcribe error:', errorText)
        }
      } catch (transcribeError) {
        console.error('[publish-wisdom] Transcription failed:', transcribeError)
      }
    }

    console.log('[publish-wisdom] Final text length:', (transcribedText || '').length, 'chars:', (transcribedText || '').substring(0, 100) || '(empty)')

    // Save to database
    const insertData = {
      user_id: userId,
      audio_url: publicUrl || '',
      text: transcribedText,
      description: description,
      duration_seconds: isTyped ? 0 : duration,
      categories: categories,
      is_public: isPublic,
      creator_name: creatorName,
      creator_avatar: creatorAvatar,
    }

    const { data: wisdom, error: dbError } = await supabase.from('wisdoms').insert(insertData).select().single()
    if (dbError) {
      console.error('[publish-wisdom] Database error:', dbError)
      return NextResponse.json({ error: 'Failed to save wisdom' }, { status: 500 })
    }

    // Engagement boost
    if (wisdom.id && isPublic) {
      try {
        const delayMs = (Math.floor(Math.random() * 71) + 30) * 60 * 1000
        const boostAt = new Date(Date.now() + delayMs).toISOString()
        const boostViews = Math.floor(Math.random() * 76) + 25
        const boostLikes = Math.floor(Math.random() * 14) + 2
        await supabase.from('wisdoms').update({ boost_at: boostAt, boost_views: boostViews, boost_likes: boostLikes, engagement_boosted: false }).eq('id', wisdom.id)
      } catch (e) { console.log('Engagement boost scheduling failed:', e.message) }
    }

    // Character B message
    let characterBMessage = null
    if (transcribedText) {
      characterBMessage = await generateCharacterBMessage(userId, transcribedText, supabase)
    } else {
      await supabase.from('profiles').update({ last_wisdom_created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', userId)
    }

    // Auto-comment for public wisdoms
    if (wisdom.id && transcribedText && isPublic) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://api.soulsayit.com'
        fetch(`${appUrl}/api/wisdom-comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wisdomId: wisdom.id, wisdomText: transcribedText }),
        }).catch(e => console.log('Auto-comment fetch failed:', e.message))
      } catch (e) { console.log('Comment scheduling skipped:', e.message) }
    }

    // Generate wisdom insight card — direct call (no HTTP self-fetch)
    let generatedCard = null
    if (wisdom.id && transcribedText && transcribedText.length > 5) {
      console.log('[publish-wisdom] Generating card for wisdom:', wisdom.id, 'text length:', transcribedText.length)
      try {
        const cardResult = await generateWisdomCard(supabase, wisdom.id, transcribedText, userId)
        console.log('[publish-wisdom] Card generation result:', cardResult.success ? 'success' : 'failed', 'keyword:', cardResult.keyword || 'n/a')
        if (cardResult.success && cardResult.card) {
          generatedCard = cardResult.card
        }
      } catch (e) {
        console.error('[publish-wisdom] Card generation exception:', e.message)
      }
    } else {
      console.log('[publish-wisdom] Skipped card generation — text too short or empty:', (transcribedText || '').length, 'chars')
    }

    return NextResponse.json({
      success: true,
      wisdom: { id: wisdom.id, audioUrl: publicUrl, text: transcribedText, categories, duration: isTyped ? 0 : duration, isPublic },
      card: generatedCard,
      characterBMessage,
    })
  } catch (error) {
    console.error('[publish-wisdom] Error:', error)
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
