import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'
import { generateWisdomCard } from '@/lib/generate-card'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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
    let forceKeyword = null, seekQuestionId = null

    if (contentType.includes('application/json')) {
      const body = await request.json()
      userId = body.userId
      typedText = body.text || ''
      description = body.description || typedText.substring(0, 200)
      isPublic = body.isPublic === true || body.isPublic === 'true'
      isTyped = true
      forceKeyword = body.forceKeyword || null
      seekQuestionId = body.seekQuestionId || null
    } else {
      const formData = await request.formData()
      audioFile = formData.get('audio')
      userId = formData.get('userId')
      duration = parseInt(formData.get('duration') || '0')
      description = formData.get('description') || ''
      isPublic = formData.get('isPublic') === 'true'
      forceKeyword = formData.get('forceKeyword') || null
      seekQuestionId = formData.get('seekQuestionId') || null
    }

    if (!userId || (!audioFile && !isTyped)) {
      return NextResponse.json({ error: 'Missing required data' }, { status: 400 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ---- Stage 5.IAP.4: monthly insight quota gate ----
    // Mirror the algorithm used in /api/daily-limit (count
    // wisdom_cards rows for this user since the start of the calendar
    // month). If at-or-over the tier limit, return 402 Payment
    // Required with a machine-readable code so mobile clients can
    // route the user to the paywall instead of showing a generic
    // error.
    //
    // We respect a clientTier hint passed from mobile (mirroring
    // daily-limit's race-condition handling). After a fresh purchase
    // the StoreKit dialog can return before the apple-iap upload +
    // DB write settle. The mobile MMKV cache is updated optimistically
    // by lib/iap.ts -- if the client thinks it has a higher tier than
    // the DB, we trust it for THIS request and reconcile on the next
    // webhook fire.
    const TIER_LIMITS = { free: 1, basic: 15, pro: 30, ultra: 60 }
    const TIER_RANK   = { free: 0, basic: 1, pro: 2, ultra: 3 }

    let clientTier = null
    try {
      // JSON requests: clientTier was destructured into typedText et al
      // above -- but we read it again here so this block is positionally
      // independent (easier to maintain). Falls through to null on
      // multipart since FormData lookup is one-shot above.
      clientTier = (contentType.includes('application/json'))
        ? null  // JSON path: re-parse not possible (body was consumed). Mobile sets clientTier on form fields below for the file path; for typed wisdoms we accept the DB tier as authoritative since typed mode is fast and webhook race is rare.
        : null
    } catch { /* swallow */ }

    const { data: tierProfile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single()
    const dbTier = tierProfile?.subscription_tier || 'free'
    let effectiveTier = dbTier
    if (clientTier && (TIER_RANK[clientTier] ?? -1) > (TIER_RANK[dbTier] ?? 0)) {
      effectiveTier = clientTier
    }
    const monthlyLimit = TIER_LIMITS[effectiveTier] ?? TIER_LIMITS.free

    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    ).toISOString()
    const { count: usedCount } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      // Stage 5.WR.2 (Bug C): exclude starter / default cards which
      // have wisdom_id=NULL. Those are gifted to new users by
      // user-sync and would otherwise consume the user's first
      // free-tier slot before they publish anything real.
      .not('wisdom_id', 'is', null)
      .gte('created_at', monthStart)
    const usedThisMonth = usedCount || 0

    if (usedThisMonth >= monthlyLimit) {
      console.log(
        `[publish-wisdom] QUOTA_EXCEEDED: user=${userId} tier=${effectiveTier} used=${usedThisMonth}/${monthlyLimit}`
      )
      return NextResponse.json(
        {
          error: 'Monthly insight quota exceeded',
          code: 'QUOTA_EXCEEDED',
          usedThisMonth,
          monthlyLimit,
          tier: effectiveTier,
        },
        { status: 402 }
      )
    }
    // ---- end quota gate ----

    let creatorName = null
    let creatorAvatar = null
    try {
      const { data: profile } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', userId).single()
      if (profile) {
        // Mirror /api/user-questions fallback: when display_name is
        // empty/null, surface 'Community Member' so downstream
        // wisdom_cards / wisdoms rows never carry an empty string
        // (which would force the mobile UI into its 'WisdomSeeker'
        // fallback even though we technically have a row).
        const dn = (profile.display_name || '').trim()
        creatorName = dn || 'Community Member'
        creatorAvatar = profile.avatar_url || null
      }
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

    // ---- Stage 5.IAP.4 hardening: reject before insert if text is unusable ----
    // The previous behavior was to write the wisdom row regardless and
    // let card generation silently fail later. That gave the user a
    // success response with card=null and ALSO consumed the monthly
    // quota (because some prior code paths could still write a
    // wisdom_card stub). The fix: bail out here before any DB write.
    const minTextLength = 5
    if (!transcribedText || transcribedText.trim().length < minTextLength) {
      console.warn('[publish-wisdom] TRANSCRIPTION_FAILED: text too short or empty')
      return NextResponse.json(
        {
          error: 'Could not transcribe your recording. Please try again.',
          code: 'TRANSCRIPTION_FAILED',
        },
        { status: 422 }
      )
    }
    // ---- end hardening ----

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
    let generatedAspireScores = null
    let cardGenerationFailed = false
    if (wisdom.id && transcribedText && transcribedText.length > 5) {
      console.log('[publish-wisdom] Generating card for wisdom:', wisdom.id, 'text length:', transcribedText.length)
      try {
        const cardResult = await generateWisdomCard(supabase, wisdom.id, transcribedText, userId, forceKeyword, creatorName, creatorAvatar)
        console.log('[publish-wisdom] Card generation result:', cardResult.success ? 'success' : 'failed', 'keyword:', cardResult.keyword || 'n/a')
        if (cardResult.success && cardResult.card) {
          generatedCard = cardResult.card
          // Stage 6: forward the post-update aspire_scores snapshot
          // returned by generateWisdomCard so the mobile insight page
          // can size its Aspire progress bar without a follow-up
          // /api/profile fetch. Null when no aspire_impacts applied.
          generatedAspireScores = cardResult.aspireScores ?? null
          // If this wisdom was offered for a Seek question, link the
          // newly-created card to the question. Best-effort: failure
          // here is logged but does not fail the publish call (the
          // wisdom + card are already saved). Mobile clients can
          // surface a retry path if needed.
          if (seekQuestionId && generatedCard.id) {
            try {
              const { error: linkErr } = await supabase
                .from('seek_question_cards')
                .insert({
                  question_id: seekQuestionId,
                  card_id: generatedCard.id,
                  contributed_by: userId,
                })
              if (linkErr) {
                console.error('[publish-wisdom] seek_question_cards insert failed:', linkErr.message)
              } else {
                console.log('[publish-wisdom] linked card', generatedCard.id, 'to question', seekQuestionId)
              }
            } catch (linkEx) {
              console.error('[publish-wisdom] seek_question_cards exception:', linkEx.message)
            }
          }
        } else {
          cardGenerationFailed = true
        }
      } catch (e) {
        console.error('[publish-wisdom] Card generation exception:', e.message)
        cardGenerationFailed = true
      }
    } else {
      console.log('[publish-wisdom] Skipped card generation — text too short or empty:', (transcribedText || '').length, 'chars')
    }

    // Stage 5.IAP.4: if card generation failed, undo the wisdom write
    // so the user is not consuming a quota slot for a broken result.
    if (cardGenerationFailed) {
      console.warn('[publish-wisdom] CARD_GENERATION_FAILED -- rolling back wisdom row', wisdom.id)
      try {
        await supabase.from('wisdoms').delete().eq('id', wisdom.id)
      } catch (delErr) {
        console.error('[publish-wisdom] rollback delete failed:', delErr)
      }
      return NextResponse.json(
        {
          error: 'Could not generate your wisdom card. Please try again.',
          code: 'CARD_GENERATION_FAILED',
        },
        { status: 500 }
      )
    }

    // Stage 5.WR.2 (Bug 1 fix): echo quotaExhausted synchronously so
    // mobile record.tsx can set the paywall-trigger state without a
    // race-prone follow-up fetchDailyLimit call. After this publish
    // succeeds, usedThisMonth + 1 is the new count.
    const quotaExhausted = (usedThisMonth + 1) >= monthlyLimit
    return NextResponse.json({
      success: true,
      wisdom: { id: wisdom.id, audioUrl: publicUrl, text: transcribedText, categories, duration: isTyped ? 0 : duration, isPublic },
      card: generatedCard,
      // Stage 6: aspire_scores snapshot after this wisdom's nudge has
      // been applied. Consumed by mobile InsightView's Aspire bar.
      aspireScores: generatedAspireScores,
      characterBMessage,
      quotaExhausted,
    })
  } catch (error) {
    console.error('[publish-wisdom] Error:', error)
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
