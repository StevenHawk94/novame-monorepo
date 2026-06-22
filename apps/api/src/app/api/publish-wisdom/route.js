import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'
import { generateWisdomCard } from '@/lib/generate-card'
import { restoreWpOnPublish } from '@/lib/character'
import { createWisdomQuests } from '@/lib/daily-tasks'

// Server-side self-harm / suicide pre-check (deterministic, runs BEFORE
// the AI call). The AI prompt's Stage 1 is a second-layer fallback, but
// LLMs (esp. flash-lite) have been observed to ignore the instruction and
// generate a normal card even for explicit suicidal text — a real safety
// failure. This regex catches explicit FIRST-PERSON intent ("I want to
// kill myself", "I don't want to live", self-harm) while deliberately NOT
// firing on idioms ("dying to see it"), third-person ("my friend wants to
// die"), or ordinary negative venting ("I'm so done with everything") —
// those are exactly what the app exists to help with. Violence-toward-
// others / illegal content is intentionally left to the AI prompt's Stage
// 1 (a regex can't separate a genuine threat from angry venting).
// English-only by product decision.
function detectSelfHarmCrisis(text) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const patterns = [
    /\bi (?:want|wanna|need) to die\b/,
    /\bi (?:don'?t|do not) (?:want|wanna) to (?:live|be alive)\b/,
    /\bi (?:want to |wanna |am going to |going to |will )?kill my ?self\b/,
    /\bi'?ll kill my ?self\b/,
    /\bi'?m going to kill my ?self\b/,
    /\bi (?:want to|wanna) end my life\b/,
    /\bi (?:want to|wanna) take my own life\b/,
    /\bi(?:'?m| am|'?d be| would be) better off dead\b/,
    /\bi(?:'?m| am) suicidal\b/,
    /\bi have no reason to live\b/,
    /\bi (?:want to|wanna) (?:hurt|harm) my ?self\b/,
    /\bi (?:cut|cutting) my ?self\b/,
    /\bi (?:want to|wanna) cut my ?self\b/,
    /\bi(?:'?ve| have)? ?(?:been )?self[- ]?harm(?:ing|ed)?\b/,
    /\bi self[- ]?harm\b/,
  ]
  return patterns.some((re) => re.test(t))
}

const CRISIS_MESSAGE =
  "What you're sharing sounds really heavy, and it deserves more than an analysis right now.\n\n" +
  "If you're going through something that feels too big to carry alone, please reach out to someone who can actually be there with you:\n\n" +
  "\u00b7 International Association for Suicide Prevention (directory of crisis centres by country): https://www.iasp.info/resources/Crisis_Centres/\n" +
  "\u00b7 Crisis Text Line (US/UK/IE/CA): Text HOME to 741741\n" +
  "\u00b7 Or speak to someone you trust \u2014 a friend, a family member, anyone who knows you.\n\n" +
  "You don't have to have it figured out before you reach out."
import { getQuotaPeriodStart, TIER_LIMITS } from '@/lib/quota'

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

    // Create the service-role Supabase client here so we can use it
    // both for the token verification block below and for the rest
    // of the publish flow that follows.
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ============================================================
    // SECURITY: verify the caller's Supabase JWT matches body.userId.
    //
    // publish-wisdom is the highest-frequency Gemini-burning endpoint
    // (every wisdom publish calls generate-card -> callAI). It already
    // has a per-user monthly tier quota (TIER_LIMITS) gating wisdom
    // creation, but that quota only kicks in when a wisdom INSERT
    // SUCCEEDS -- if an attacker POSTs with a fake userId that fails
    // the wisdoms-table foreign key to auth.users, the INSERT errors
    // out AFTER generate-card has already called Gemini. The failed
    // request does not increment the user's quota counter (no row
    // written), so the attacker can spam fake userIds and burn Gemini
    // indefinitely. Module 6 pentest #1 confirmed this -- 500 errors
    // returned, but Gemini was called first.
    //
    // Fix: same pattern as wisdom-center (commit 099973f). Read
    // Authorization Bearer token, resolve to a Supabase auth user via
    // service-role client's auth.getUser(jwt), and require user.id ===
    // body.userId. Mobile already attaches the token automatically via
    // apiClient (record.tsx lines 1566 / 1593), and grep confirms no
    // apps/api server-to-server caller fetches /api/publish-wisdom, so
    // adding 401 enforcement is backend-only and does NOT require an
    // app release.
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[publish-wisdom] POST rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !authUser) {
      console.warn('[publish-wisdom] POST rejected: token verify failed', authErr && authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (authUser.id !== userId) {
      console.warn('[publish-wisdom] POST rejected: token user', authUser.id, '!= body userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // ============================================================

    // ---- Stage 5.IAP.4: monthly insight quota gate ----
    // Mirror the algorithm used in /api/daily-limit (count
    // wisdom_cards rows for this user since the start of the calendar
    // month). If at-or-over the tier limit, return 402 Payment
    // Required with a machine-readable code so mobile clients can
    // route the user to the paywall instead of showing a generic
    // error.
    //
    // C4: DB subscription_tier is authoritative for quota. The old
    // "optimistic clientTier" path here was dead code -- clientTier was
    // assigned null on every branch, so the if below never fired and
    // effectiveTier always equalled dbTier. We deliberately do NOT trust a
    // client-supplied tier: that would be a quota-bypass hole (a caller
    // could claim 'ultra' to lift their limit). The post-purchase race the
    // old comment worried about is covered server-side -- apple-iap sets
    // profiles.subscription_tier before returning, so the client refreshes
    // to the correct tier before its next publish.
    const { data: tierProfile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .single()
    const effectiveTier = tierProfile?.subscription_tier || 'free'
    const monthlyLimit = TIER_LIMITS[effectiveTier] ?? TIER_LIMITS.free

    // Stage 6.QuotaFix: counter window from @/lib/quota helper.
    // Free tier: profile.created_at (lifetime).
    // Paid tier: subscription.current_period_start (per billing cycle).
    const quotaStart = await getQuotaPeriodStart(supabase, userId)
    const { count: usedCount } = await supabase
      .from('wisdom_cards')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      // Stage 5.WR.2 (Bug C): exclude starter / default cards
      // (wisdom_id IS NULL, gifted by user-sync).
      .not('wisdom_id', 'is', null)
      .gte('created_at', quotaStart)
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

    // Phase A.3 (Module 6 #4 followup): audio is now ephemeral.
    // We upload to storage to feed it into transcribe, then delete
    // the file regardless of whether the publish succeeds, fails
    // transcription, or fails card generation. Mobile no longer
    // plays audio (the response's audioUrl is a dead field kept for
    // type compatibility), so retaining the file gives an attack
    // surface for zero user value.
    //
    // audioFilename is declared at function scope so the success
    // return, the TRANSCRIPTION_FAILED short-circuit, and the
    // CARD_GENERATION_FAILED rollback can all reach the cleanup.
    // For typed mode it stays null and cleanupAudioFile() is a no-op.
    let audioFilename = null
    const cleanupAudioFile = async () => {
      if (!audioFilename) return
      try {
        const { error: delErr } = await supabase.storage.from('audio').remove([audioFilename])
        if (delErr) {
          console.warn('[publish-wisdom] audio cleanup failed (non-fatal):', delErr.message)
        } else {
          console.log('[publish-wisdom] audio cleaned up:', audioFilename)
        }
      } catch (e) {
        console.warn('[publish-wisdom] audio cleanup exception (non-fatal):', e && e.message)
      }
    }

    if (isTyped) {
      transcribedText = typedText
    } else {
      const timestamp = Date.now()
      audioFilename = `${userId}/${timestamp}.webm`
      const arrayBuffer = await audioFile.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('audio').upload(audioFilename, buffer, { contentType: 'audio/webm', upsert: false })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        return NextResponse.json({ error: 'Failed to upload audio' }, { status: 500 })
      }

      const { data: { publicUrl: audioPublicUrl } } = supabase.storage.from('audio').getPublicUrl(audioFilename)
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
          headers: {
            'Content-Type': 'application/json',
            // Internal server-to-server auth: transcribe rejects any
            // request without this shared secret (set in Vercel env).
            // This is what distinguishes our legitimate internal call
            // from an external attacker POSTing audio directly to the
            // transcribe endpoint to burn Gemini spend.
            'x-internal-secret': process.env.INTERNAL_API_SECRET || '',
          },
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
    // Raised 5 -> 10: silence/near-silence transcribes to junk like
    // "00:01" (len 5) which slipped through < 5 AND through the card-gen
    // > 5 gate, landing in the skip branch and leaving an empty wisdom
    // row. A real spoken sentence is well over 10 chars; 10 cleanly
    // rejects the time-stamp-shaped silence artifacts.
    // Three-state transcription validation (audio mode only; typed text
    // skips the refusal check). Order matters: UNCLEAR first, then TOO_SHORT.
    const tt = (transcribedText || '').trim()
    const ttLower = tt.toLowerCase()
    const refusalSignals = [
      'i cannot fulfill this request',
      "i can't fulfill this request",
      'too short to transcribe',
      'unable to transcribe',
      'cannot transcribe',
      "can't transcribe",
      'no discernible speech',
      'no audible speech',
      'no speech detected',
      'the audio provided is too',
    ]
    const looksLikeRefusal = !isTyped && refusalSignals.some((sig) => ttLower.includes(sig))

    // (1) UNCLEAR: empty, junk-short (<10 = silence artifacts), or a refusal
    //     sentence => the mic likely didn't capture clear speech.
    if (!tt || tt.length < 10 || looksLikeRefusal) {
      console.warn('[publish-wisdom] TRANSCRIPTION_UNCLEAR:', tt.substring(0, 80) || '(empty)')
      await cleanupAudioFile()
      return NextResponse.json(
        {
          error: "We can't hear you, please speak closer to the microphone.",
          code: 'TRANSCRIPTION_UNCLEAR',
        },
        { status: 422 }
      )
    }

    // (2) TOO_SHORT: clear speech but under the minimum length for a
    //     meaningful insight (200 chars).
    const MIN_TRANSCRIPT_CHARS = 200
    if (tt.length < MIN_TRANSCRIPT_CHARS) {
      console.warn('[publish-wisdom] TRANSCRIPTION_TOO_SHORT: len', tt.length)
      await cleanupAudioFile()
      return NextResponse.json(
        {
          error: 'Your audio is too short, please try again.',
          code: 'TRANSCRIPTION_TOO_SHORT',
        },
        { status: 422 }
      )
    }
    // ---- end hardening ----

    // Self-harm / suicide pre-check (deterministic, before AI + before
    // inserting the wisdom row). On hit: clean the audio, do NOT insert a
    // wisdom row, do NOT call the AI, do NOT burn quota. Return 403
    // CRISIS_DETECTED with the safe message so the client shows it in a
    // plain dialog and exits the flow.
    if (detectSelfHarmCrisis(transcribedText)) {
      console.warn('[publish-wisdom] CRISIS_DETECTED by server pre-check — no row inserted')
      await cleanupAudioFile()
      return NextResponse.json(
        {
          error: 'crisis',
          code: 'CRISIS_DETECTED',
          message: CRISIS_MESSAGE,
        },
        { status: 403 }
      )
    }

    // Save to database
    const insertData = {
      user_id: userId,
      // Phase A.3: audio is ephemeral (deleted at success/fail path
      // ends). Mobile does not consume this field, so persist '' to
      // keep the DB consistent with the storage-side cleanup.
      audio_url: '',
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

    // C1: removed dead auto-comment call. It POSTed to /api/wisdom-comments,
    // a route that does not exist in this project, so every public publish
    // fired a fire-and-forget request that always 404'd silently (no
    // auto-comments were ever created). Dropped to stop the wasted request.

    // Generate wisdom insight card — direct call (no HTTP self-fetch)
    let generatedCard = null
    let generatedAspireScores = null
    let cardGenerationFailed = false
    let lowQualityInput = false
    let crisisDetected = false
    let quotaExceededAtInsert = false
    let crisisMessage = ''
    if (wisdom.id && tt.length >= 10) {
      console.log('[publish-wisdom] Generating card for wisdom:', wisdom.id, 'text length:', transcribedText.length)
      try {
        const cardResult = await generateWisdomCard(supabase, wisdom.id, transcribedText, userId, forceKeyword, creatorName, creatorAvatar, quotaStart, monthlyLimit, seekQuestionId ? 'Opinion/Perspective' : null)
        console.log('[publish-wisdom] Card generation result:', cardResult.success ? 'success' : 'failed', 'keyword:', cardResult.keyword || 'n/a')
        if (cardResult.success && cardResult.card) {
          generatedCard = cardResult.card
          // Stage 6: forward the post-update aspire_scores snapshot
          // returned by generateWisdomCard so the mobile insight page
          // can size its Aspire progress bar without a follow-up
          // /api/profile fetch. Null when no aspire_impacts applied.
          generatedAspireScores = cardResult.aspireScores ?? null
          // Transform succeeded (a card was created). Restore WP to 100 +
          // bump last_recording_at and increment the card/recording
          // counters, atomically bound to publish success on the server.
          // This is the AUTHORITATIVE WP-restore: it no longer depends on
          // the client firing a separate /api/character-state
          // record_complete request, which could be skipped when the
          // client times out / hits a network error even though the server
          // succeeded (Home would then stay stuck on the hungry video).
          // Best-effort: never throws (card is already saved).
          await restoreWpOnPublish(supabase, userId, {
            durationSeconds: isTyped ? 0 : duration,
            countCard: true,
          })
          // Create the wisdom quests (task_1 / task_2) here, server-side,
          // bound atomically to the just-created card. Previously the
          // client fired a separate POST /api/daily-tasks after publish,
          // which could be skipped on a client network error even though
          // the publish itself succeeded -- so the user's card existed but
          // their Growth quests silently never appeared. This is the same
          // failure mode the WP restore moved server-side; quests now
          // follow the card. await'd so they exist before the response
          // returns and the client's post-publish refreshDailyTasks picks
          // them up. createWisdomQuests is best-effort (never throws), so a
          // quest insert failure can't break the publish.
          if (generatedCard.task_1 || generatedCard.task_2) {
            const quests = []
            if (generatedCard.task_1) {
              quests.push({
                text: generatedCard.task_1,
                keyword: generatedCard.task_1_keyword || '',
              })
            }
            if (generatedCard.task_2) {
              quests.push({
                text: generatedCard.task_2,
                keyword: generatedCard.task_2_keyword || '',
              })
            }
            await createWisdomQuests(supabase, userId, quests)
          }
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
          // A2: distinguish "input was junk" (user must change content,
          // surfaced as 422) from a genuine generation failure (retryable,
          // 500). generateWisdomCard's prefilter returns this code.
          if (cardResult && cardResult.code === 'LOW_QUALITY_INPUT') {
            lowQualityInput = true
          }
          // Atomic quota RPC rejected at insert (lost a concurrent race /
          // truly over quota). Surfaced as 402 below, same as the early gate.
          if (cardResult && cardResult.code === 'QUOTA_EXCEEDED') {
            quotaExceededAtInsert = true
          }
          // Crisis: the entry tripped the safety detector. Roll back like
          // any non-card result (shared cleanup below) but surface the safe
          // message instead of a failure/low-quality response.
          if (cardResult && cardResult.crisis === true) {
            crisisDetected = true
            crisisMessage = cardResult.crisisMessage || ''
          }
        }
      } catch (e) {
        console.error('[publish-wisdom] Card generation exception:', e.message)
        cardGenerationFailed = true
      }
    } else {
      // Defensive: if we ever reach here the text was unusable but the
      // 422 gate above didn't catch it. Never leave an orphan wisdom row
      // with no card — roll it back via the cardGenerationFailed path.
      console.warn('[publish-wisdom] Skipped card generation — rolling back orphan wisdom row:', (transcribedText || '').length, 'chars')
      cardGenerationFailed = true
      lowQualityInput = true
    }

    // Stage 5.IAP.4: if card generation failed, undo the wisdom write
    // so the user is not consuming a quota slot for a broken result.
    if (cardGenerationFailed) {
      console.warn('[publish-wisdom]', crisisDetected ? 'CRISIS_DETECTED (AI second-layer) -- rolling back wisdom row' : 'CARD_GENERATION_FAILED -- rolling back wisdom row', wisdom.id)
      try {
        await supabase.from('wisdoms').delete().eq('id', wisdom.id)
      } catch (delErr) {
        console.error('[publish-wisdom] rollback delete failed:', delErr)
      }
      // Phase A.3: also clean the audio file. The wisdom row was just
      // rolled back so no row references this audio anymore -- it would
      // be an orphan + attack surface if left in storage.
      await cleanupAudioFile()
      if (crisisDetected) {
        // Safe-response path. Wisdom row already rolled back + no quota
        // burned. 403 + CRISIS_DETECTED so the client shows the crisis
        // message in a plain dialog and does NOT enter the insight view
        // or write a My Logs row.
        return NextResponse.json(
          {
            error: 'crisis',
            code: 'CRISIS_DETECTED',
            message: crisisMessage,
          },
          { status: 403 }
        )
      }
      if (lowQualityInput) {
        // Input could not yield a meaningful insight. Wisdom row already
        // rolled back above + no quota burned. 422 so mobile shows the
        // gentle "I didn't quite catch that" prompt and returns to choose.
        return NextResponse.json(
          {
            error: 'That didn\'t give me enough to work with. Try again.',
            code: 'LOW_QUALITY_INPUT',
          },
          { status: 422 }
        )
      }
      if (quotaExceededAtInsert) {
        return NextResponse.json(
          {
            error: 'Monthly insight quota exceeded',
            code: 'QUOTA_EXCEEDED',
            tier: effectiveTier,
            monthlyLimit,
          },
          { status: 402 }
        )
      }
      return NextResponse.json(
        {
          error: 'Could not generate your wisdom card. Please try again.',
          code: 'CARD_GENERATION_FAILED',
        },
        { status: 500 }
      )
    }

    // Stage 6 Bug 3 fix: server-side roll the per-wisdom "people
    // resonated" count, persist it on the wisdom_card so My Logs
    // re-opens show the SAME number the user saw on the first view,
    // and accumulate it into profile.people_impacted_display so the
    // Me page "People Resonated" stat grows with every publish.
    //
    // Range 30-999 chosen for healthy growth curve: a typical user
    // doing ~3 publishes/week accumulates ~80k/year — large enough
    // to feel meaningful, small enough that the number remains
    // human-readable for years.
    //
    // Defensive: every DB side-effect here is in its own try/catch.
    // A failure to write community_count, accumulate impacted, or
    // anything else MUST NOT fail the publish — the wisdom + card
    // are already saved, the user has already paid quota, and the
    // celebratory Insight screen must render. We log + continue.
    let communityCount = null
    if (generatedCard && generatedCard.id) {
      communityCount = 30 + Math.floor(Math.random() * 970)
      // Persist on the wisdom_card so My Logs re-view is stable.
      try {
        const { error: ccErr } = await supabase
          .from('wisdom_cards')
          .update({ community_count: communityCount })
          .eq('id', generatedCard.id)
        if (ccErr) {
          console.warn('[publish-wisdom] community_count UPDATE failed:', ccErr.message)
        } else {
          // Mirror the value onto the in-memory card object so the
          // response carries it back to mobile without a second fetch.
          generatedCard.community_count = communityCount
        }
      } catch (e) {
        console.warn('[publish-wisdom] community_count UPDATE exception:', e.message)
      }
      // Accumulate to people_impacted_display. Two-step (select-then-
      // update) rather than RPC: supabase-js doesn't expose atomic
      // increment without a Postgres function; single-user race window
      // is negligible (one mobile client per session).
      try {
        const { data: prof, error: selErr } = await supabase
          .from('profiles')
          .select('people_impacted_display')
          .eq('id', userId)
          .single()
        if (selErr) throw selErr
        const current = prof?.people_impacted_display || 0
        const next = current + communityCount
        const { error: updErr } = await supabase
          .from('profiles')
          .update({
            people_impacted_display: next,
            people_impacted_updated_at: new Date().toISOString(),
          })
          .eq('id', userId)
        if (updErr) {
          console.warn('[publish-wisdom] people_impacted_display UPDATE failed:', updErr.message)
        }
      } catch (e) {
        console.warn('[publish-wisdom] people_impacted_display accumulate failed:', e.message)
      }
    }

    // Stage 5.WR.2 (Bug 1 fix): echo quotaExhausted synchronously so
    // mobile record.tsx can set the paywall-trigger state without a
    // race-prone follow-up fetchDailyLimit call. After this publish
    // succeeds, usedThisMonth + 1 is the new count.
    const quotaExhausted = (usedThisMonth + 1) >= monthlyLimit
    // Phase A.3: success path also deletes the audio. Mobile does not
    // play audio (only displays transcribed text), so the file has no
    // user-facing purpose past this point. Returning audioUrl as ''
    // because the field is a dead type-compat field; the URL would
    // 404 in a few seconds anyway once cleanup completes.
    await cleanupAudioFile()
    return NextResponse.json({
      success: true,
      wisdom: { id: wisdom.id, audioUrl: '', text: transcribedText, categories, duration: isTyped ? 0 : duration, isPublic },
      card: generatedCard,
      // Stage 6: aspire_scores snapshot after this wisdom's nudge has
      // been applied. Consumed by mobile InsightView's Aspire bar.
      aspireScores: generatedAspireScores,
      // Stage 6 Bug 3: server-rolled "people resonated" for this wisdom.
      // null when card generation succeeded but card.id was somehow
      // missing (extremely defensive — generateWisdomCard always returns
      // a saved row). Mobile InsightView treats null as "hide the row."
      communityCount,
      characterBMessage,
      quotaExhausted,
    })
  } catch (error) {
    console.error('[publish-wisdom] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
