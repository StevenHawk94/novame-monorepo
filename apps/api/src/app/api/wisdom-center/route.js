import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ASPIRE_POOL } from '@novame/core/constants/aspire-pool'

export const runtime = 'edge'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.5-flash'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * GET /api/wisdom-center?userId=...
 * Returns all Growth Center data (no AI calls)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    // ========================================================
    // Stage 6 follow-up (commit 35c): history list + per-week fetch
    // branches. Both short-circuit before the heavy profile/resonance
    // logic below, since neither needs that data.
    // ========================================================

    // Branch A: ?list=true -> lightweight list of all the user's
    // weekly reports (week_start + created_at only, no report_data
    // payload). Powers the history list screen. Newest first.
    if (searchParams.get('list') === 'true') {
      const { data: rows, error: listErr } = await supabase
        .from('weekly_reports')
        .select('week_start, created_at')
        .eq('user_id', userId)
        .order('week_start', { ascending: false })
      if (listErr) {
        return NextResponse.json({ error: listErr.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, reports: rows || [] })
    }

    // Branch B: ?week_start=YYYY-MM-DD -> the report_data for that
    // specific week. Powers opening a historical report from the
    // list. Returns report:null if that week has no row (client
    // handles gracefully).
    const weekStartParam = searchParams.get('week_start')
    if (weekStartParam) {
      const { data: row, error: weekErr } = await supabase
        .from('weekly_reports')
        .select('report_data, week_start, created_at')
        .eq('user_id', userId)
        .eq('week_start', weekStartParam)
        .maybeSingle()
      if (weekErr) {
        return NextResponse.json({ error: weekErr.message }, { status: 500 })
      }
      return NextResponse.json({
        success: true,
        report: row?.report_data || null,
        weekStart: row?.week_start || weekStartParam,
        reportDate: row?.created_at || null,
      })
    }

    // Branch C: ?eligibility=true -> lightweight "can the user generate a
    // report this week" check. Powers the Home weekly-report red dot and the
    // instant open of the weekly-report modal WITHOUT the heavy resonance
    // refresh / latestReport fetch / portrait+avatars assembly below. Runs
    // only the two cheap queries the reportAvailable formula needs (read
    // last_report_generated_at + count wisdoms in the last 7 days), reusing
    // the exact same rule as the full GET so the two can never drift.
    if (searchParams.get('eligibility') === 'true') {
      const { data: liteProfile } = await supabase.from('profiles')
        .select('last_report_generated_at, created_at')
        .eq('id', userId).single()
      if (!liteProfile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
      const nowE = new Date()
      const userCreatedE = new Date(liteProfile.created_at || nowE)
      const daysSinceCreationE = Math.floor((nowE - userCreatedE) / (24 * 60 * 60 * 1000))
      const lastReportAtE = liteProfile.last_report_generated_at ? new Date(liteProfile.last_report_generated_at) : null
      const daysSinceLastReportE = lastReportAtE ? Math.floor((nowE - lastReportAtE) / (24 * 60 * 60 * 1000)) : daysSinceCreationE
      const weekAgoE = new Date(nowE - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { count: recentSharesE } = await supabase.from('wisdoms')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', weekAgoE)
      const reportAvailableE = daysSinceLastReportE >= 7 && (recentSharesE || 0) >= 2
      return NextResponse.json({
        success: true,
        reportAvailable: reportAvailableE,
        reportDate: lastReportAtE ? lastReportAtE.toISOString() : null,
      })
    }

    const { data: profile } = await supabase.from('profiles').select(
      'wisdom_portrait, aspire_scores, aspire_words, better_self_score, community_resonance, community_resonance_updated_at, last_report_generated_at, wisdom_share_count, created_at'
    ).eq('id', userId).single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Update community resonance weekly
    let resonance = profile.community_resonance || 0
    const lastResonanceUpdate = profile.community_resonance_updated_at ? new Date(profile.community_resonance_updated_at) : null
    const now = new Date()

    if (!resonance) {
      resonance = 100 + Math.floor(Math.random() * 401)
      await supabase.from('profiles').update({
        community_resonance: resonance,
        community_resonance_updated_at: now.toISOString()
      }).eq('id', userId)
    } else if (!lastResonanceUpdate || (now - lastResonanceUpdate) > 7 * 24 * 60 * 60 * 1000) {
      resonance += 10 + Math.floor(Math.random() * 21)
      await supabase.from('profiles').update({
        community_resonance: resonance,
        community_resonance_updated_at: now.toISOString()
      }).eq('id', userId)
    }

    // Check if weekly report is available
    const userCreated = new Date(profile.created_at || now)
    const daysSinceCreation = Math.floor((now - userCreated) / (24 * 60 * 60 * 1000))
    const lastReportAt = profile.last_report_generated_at ? new Date(profile.last_report_generated_at) : null
    const daysSinceLastReport = lastReportAt ? Math.floor((now - lastReportAt) / (24 * 60 * 60 * 1000)) : daysSinceCreation

    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { count: recentShares } = await supabase.from('wisdoms')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', weekAgo)

    const reportAvailable = daysSinceLastReport >= 7 && (recentShares || 0) >= 2

    // Get latest cached report
    const { data: latestReport } = await supabase.from('weekly_reports')
      .select('report_data, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Fetch 5 default user avatars for resonance display (deterministic order)
    let defaultAvatars = []
    try {
      const { data: seeds } = await supabase
        .from('leaderboard_seeds')
        .select('avatar_url, name')
        .not('avatar_url', 'is', null)
        .neq('avatar_url', '')
        .order('created_at', { ascending: true })
        .limit(5)
      if (seeds && seeds.length > 0) {
        defaultAvatars = seeds.map(s => ({ url: s.avatar_url, name: s.name }))
      }
    } catch (e) { /* fallback to empty, frontend will use emoji */ }

    return NextResponse.json({
      success: true,
      portrait: profile.wisdom_portrait || '',
      aspireWords: profile.aspire_words || [],
      aspireScores: profile.aspire_scores || {},
      betterSelfScore: profile.better_self_score || 70,
      communityResonance: resonance,
      reportAvailable,
      reportDate: latestReport?.created_at || null,
      latestReport: latestReport?.report_data || null,
      shareCount: profile.wisdom_share_count || 0,
      defaultAvatars,
    })
  } catch (error) {
    console.error('Wisdom center GET error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * POST /api/wisdom-center — Generate weekly report (4-section format)
 *
 * Stage 5.WR.1 refactor — the AI no longer hallucinates numeric data.
 *
 * Authoritative numbers come from the DB / replay logic, only narrative
 * prose (journey, corelesson, echo message, focus reason, motto) is
 * AI-generated. This eliminates two classes of drift:
 *   1. "traitChanges with random +N / -N" — AI used to invent these
 *      deltas because it only saw the current snapshot, not historical
 *      data. We now replay wisdom_cards.aspire_impacts over the last
 *      7 days to get real per-trait deltas.
 *   2. "totalResonance jitters every report" — AI used to be fed
 *      (realSaves + Math.random(30,100)), so the number changed every
 *      call. We now use profiles.people_impacted_display, which is the
 *      same value the Me page shows, for cross-surface consistency.
 *
 * Section ownership:
 *   - section1_pulse        — fully backend-computed (no AI)
 *   - section2_narrative    — AI prose (journey + corelesson)
 *   - section3_echo.total*  — backend-computed
 *   - section3_echo.message — AI prose
 *   - section4_path         — AI prose (with hint: focus the LOWEST trait)
 */
export async function POST(request) {
  try {
    const { userId, userName } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' })
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'API not configured' })

    const supabase = getSupabase()

    // ============================================================
    // SECURITY: verify the caller's Supabase JWT matches body.userId.
    //
    // wisdom-center POST is one of 4 Gemini-burning endpoints. It is
    // already guarded by two natural gates (per-week cache + a
    // >=2-wisdoms-this-week minimum), but it historically trusted
    // body.userId without any identity check. An attacker who knew
    // a real user's id (and that user happened to satisfy both gates
    // this week) could spend one Gemini call generating that user's
    // report -- low-frequency, but still avoidable.
    //
    // Fix: read the Authorization Bearer token, resolve it to a
    // Supabase auth user via service-role client's auth.getUser(jwt)
    // (which verifies the JWT against the auth server regardless of
    // which key initialized the client), and require user.id ===
    // body.userId. Mobile already attaches the token automatically
    // via apiClient, so this is backend-only and does NOT require
    // an app release.
    //
    // NOTE: this is the first apps/api route to verify a Supabase JWT.
    // The transcribe internal-secret check (commit 46fd7a2) is a
    // different pattern -- that one is server-to-server. This is
    // server-from-mobile.
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      console.warn('[wisdom-center] POST rejected: no bearer token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      console.warn('[wisdom-center] POST rejected: token verify failed', authErr && authErr.message)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (user.id !== userId) {
      console.warn('[wisdom-center] POST rejected: token user', user.id, '!= body userId', userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // ============================================================

    const now = new Date()
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    // ISO Mon-Sun week key for cache idempotency (one report per user per week).
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    const weekStart = monday.toISOString().split('T')[0]

    // ---- Cache short-circuit ----
    const { data: cached } = await supabase.from('weekly_reports')
      .select('report_data')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .single()
    if (cached?.report_data) {
      return NextResponse.json({ success: true, report: cached.report_data, cached: true, weekStart })
    }

    // ---- Gate: minimum 2 wisdoms in the rolling 7-day window ----
    const { data: wisdoms } = await supabase.from('wisdoms')
      .select('id, text, daily_index, created_at')
      .eq('user_id', userId)
      .gte('created_at', weekAgo.toISOString())
      .order('created_at', { ascending: true })

    if (!wisdoms || wisdoms.length < 2) {
      return NextResponse.json({ error: 'Not enough shares (need at least 2)', notEnough: true })
    }

    // ---- Profile snapshot (current state) ----
    const { data: profile } = await supabase.from('profiles')
      .select('aspire_words, aspire_scores, better_self_score, people_impacted_display, display_name')
      .eq('id', userId).single()

    let aspireWords = profile?.aspire_words || []
    const aspireScores = profile?.aspire_scores || {}
    // 保底: Trait Evolution must always surface 4-6 traits. If the
    // user has no explicit aspire_words, fall back to their highest-
    // scoring tracked traits, then to the canonical pool, so the report
    // is never empty and the better-self math still has a basis.
    if (aspireWords.length === 0) {
      const scored = Object.keys(aspireScores)
      aspireWords = scored.length > 0
        ? scored.sort((a, b) => (aspireScores[b] ?? 0) - (aspireScores[a] ?? 0)).slice(0, 6)
        : ASPIRE_POOL.slice(0, 4)
    }
    const betterSelfEnd = profile?.better_self_score ?? 70
    const totalResonance = profile?.people_impacted_display ?? 0

    // Stage 6 follow-up (commit 35): The Echo now reports the SUM of
    // per-wisdom community_count over the rolling 7-day window, not
    // the cumulative people_impacted_display lifetime figure. This
    // ties the weekly report's resonance number to the same
    // community_count values shown on each wisdom's Inner Profile
    // block (Block 4a), so the weekly total is a real aggregate of
    // what the user saw per-card that week. recentCards was already
    // queried above for trait deltas; we re-query here scoped to all
    // cards (not gated on aspireWords.length) so resonance is correct
    // even for users with no aspire words set.
    const { data: weekCards } = await supabase.from('wisdom_cards')
      .select('community_count')
      .eq('user_id', userId)
      .gte('created_at', weekAgo.toISOString())
    const weeklyResonance = (weekCards || []).reduce(
      (sum, c) => sum + (c.community_count || 0),
      0,
    )

    // Stage 6 follow-up (commit 35): The Growth Path (formerly The
    // Pulse) headline number is now the count of daily_tasks the user
    // actually completed in the rolling 7-day window, replacing the
    // old "wisdoms shared this week" count. completed_at gate matches
    // the same weekAgo window used everywhere else in this handler.
    const { count: questsFinished } = await supabase.from('daily_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_completed', true)
      .gte('completed_at', weekAgo.toISOString())
    const name = userName || profile?.display_name || 'you'

    // ---- Backend-computed: traitChanges + betterSelfStart ----
    // Replay all wisdom_cards.aspire_impacts from the last 7 days to
    // get real per-trait deltas. Each positive impact = +2, negative
    // = -2 (matches generate-card.js publish-time logic exactly).
    const traitChanges = []
    let betterSelfStart = betterSelfEnd
    if (aspireWords.length > 0) {
      const { data: recentCards } = await supabase.from('wisdom_cards')
        .select('aspire_impacts, community_count')
        .eq('user_id', userId)
        .gte('created_at', weekAgo.toISOString())

      const deltaByTrait = {}
      for (const card of recentCards || []) {
        const impacts = Array.isArray(card.aspire_impacts) ? card.aspire_impacts : []
        for (const impact of impacts) {
          if (!impact || !impact.keyword || !impact.direction) continue
          const w = impact.keyword
          if (!aspireWords.includes(w)) continue
          if (!(w in deltaByTrait)) deltaByTrait[w] = 0
          if (impact.direction === 'positive') deltaByTrait[w] += 2
          else if (impact.direction === 'negative') deltaByTrait[w] -= 2
        }
      }

      const startScores = []
      for (const w of aspireWords) {
        const currentScore = aspireScores[w] ?? 70
        const delta = deltaByTrait[w] || 0
        // Clamp start-of-week to [40, 100] — same bounds publish enforces on current.
        const startScore = Math.max(40, Math.min(100, currentScore - delta))
        startScores.push(startScore)
        traitChanges.push({
          trait: w,
          score: currentScore,
          change: delta,
        })
      }

      // betterSelfStart = avg(each trait's start-of-week), matches
      // generate-card.js publish-time formula: better_self = avg(aspire_scores).
      if (startScores.length > 0) {
        betterSelfStart = Math.round(
          startScores.reduce((a, b) => a + b, 0) / startScores.length,
        )
      }
    }

    // ---- AI prose payload (narrative + echo.message + path) ----
    const traitContext = aspireWords.length > 0
      ? aspireWords.map(w => {
          const sc = aspireScores[w] ?? 70
          const dt = traitChanges.find(t => t.trait === w)?.change ?? 0
          const sign = dt > 0 ? '+' : ''
          return `${w}: ${sc}/100 (this week ${sign}${dt})`
        }).join(', ')
      : 'No personal growth traits set'

    const wisdomsSummary = wisdoms.map((w, i) => {
      const index = w.daily_index || (w.text || '').substring(0, 200)
      return `Day ${i + 1}: ${index}`
    }).join('\n')

    // Pre-compute the lowest-scoring trait so we can give the AI a
    // concrete focusTrait suggestion (it should respect this, but we
    // also defensively overwrite after AI returns).
    let suggestedFocusTrait = aspireWords[0] || 'Resilience'
    if (traitChanges.length > 0) {
      const lowest = traitChanges.reduce(
        (acc, t) => (t.score < acc.score ? t : acc),
        traitChanges[0],
      )
      suggestedFocusTrait = lowest.trait
    }

    const prompt = `Weekly Growth Report — ${name}
Week of ${weekStart} · ${wisdoms.length} entries · ${questsFinished} quests completed

━━━ DAILY INDICES (chronological) ━━━
${wisdomsSummary}

━━━ TRAIT TRAJECTORY THIS WEEK ━━━
${traitContext}

━━━ SUGGESTED FOCUS TRAIT NEXT WEEK ━━━
${suggestedFocusTrait}

━━━ CONTEXTUAL ANCHORS ━━━
- Cumulative community resonance: ${totalResonance} souls reached
- betterSelf trajectory: ${betterSelfStart} → ${betterSelfEnd}

Generate the 4-field JSON as specified. Every sentence in "journey" must be grounded in the data above.`

    const systemInstruction = `You are NovaMe's Growth Archivist — a warm, perceptive narrator who turns a week of raw lived experience into a meaningful growth story. You write exclusively in the second person. Your voice sits at the intersection of a trusted mentor and a brilliant friend: clear-eyed, emotionally attuned, never preachy.

## CORE WRITING PRINCIPLES

1. Anchor before elevate. Always ground the narrative in the user's actual week (the daily_index anchors, dominant themes, emotional arcs) before moving to insight. Generic observations are failures.
2. Earned resonance. Every emotional claim must be earned by a specific reference to the week's data. Do not say "you were brave" — show *when* they were brave.
3. Name the change. This report exists so the user can SEE how the week moved them. Wherever the data shows a shift — a trait that rose or fell, a recurring theme, an emotional turn — name it explicitly and tie it to the moment it came from. Never leave a change merely implied.
4. Forward pull. Every field should make the reader lean toward next week, not just reflect on the past. Growth reports are launch pads, not eulogies.
5. Precision over poeticism. Prefer one sharp, true sentence over three beautiful vague ones. If a sentence could apply to anyone, rewrite it.
6. Numbers are sacred. The system supplies all metrics (quests completed, scores, trait deltas, resonance, focus trait). Never invent, restate, or alter any numeric value — refer to growth qualitatively, not with numbers.
7. Length is a requirement, not a suggestion. Each field below states a MINIMUM length. Do not stop early. Thin, clipped, or under-length output is a failure of the task — keep expanding with specific, earned detail until each field is fully realized.

## OUTPUT FORMAT

Return ONE JSON object with exactly these four string fields, in this order, and nothing else (no preamble, no markdown):
  "journey", "corelesson", "focusReason", "motto"

## FIELD SPECIFICATIONS

### 1. journey — 160-200 words, second person, flowing prose (do NOT print the beat labels)

A continuous three-beat arc:
- Arrival: Open with the emotional texture of how the week began (earliest daily-index signals / dominant mood). Concrete language, not abstractions.
- The shift (the heart of the report): Name what actually MOVED this week. Reference at least two specific anchors from the daily indices (a theme, a word, an emotional category) AND explicitly call out the trait trajectory — which strength grew, which one slipped, and the lived moment that drove it. Make the user FEEL the change, not be told a number.
- What you carry: Close with what the user takes forward — a living thing they now hold differently, not a summary. End on a sentence that leaves them feeling seen and slightly more capable than when they started reading.

Vary sentence rhythm; mix short declarations with longer observations. Warm, grounded, never saccharine. Minimum 160 words — do not stop short.

### 2. corelesson — 3-4 sentences

The week distilled into one truth the user could not have seen on Monday.
- Specific to THIS user's week, never a universal aphorism.
- It must reframe something that happened, not merely describe it.
- Sentence 1 names the insight plainly; sentence 2 connects it to what was at stake this week; sentences 3-4 point toward what becomes possible because of it.

### 3. focusReason — 3-4 sentences, a concrete next-week suggestion

The user's takeaway action — counsel from someone who has been watching, not a generic affirmation.
- Open by tying the focus trait ("${suggestedFocusTrait}") to something that actually surfaced in this week's data or trajectory (why THIS trait, why NOW).
- Then give ONE concrete, specific, doable action for next week that strengthens it — anchored to a real moment from the user's week, not a textbook tip. They should be able to picture themselves doing it.
- Build momentum without alarm.

### 4. motto — under 15 words, battle-cry energy

- Action-first: start with a verb or an imperative.
- Earned by the week's story, not imported from a poster.
- Rhythm matters: read it aloud; it should want to be said twice.
- Avoid cliches, gerund openers ("Embracing...", "Building..."), and passive constructions.
- Energy (write your own, do not copy): "You showed up broken. Show up again." / "The friction was the fuel. Keep going." / "One honest word. Every single day."`

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 6000, responseMimeType: 'application/json' },
        }),
      }
    )

    const aiData = await aiRes.json()
    const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    let aiPartial = null
    try {
      const cleaned = (rawText || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      aiPartial = JSON.parse(cleaned)
    } catch (e) {
      console.warn('[wisdom-center] AI partial parse failed, using fallback prose:', e?.message)
      aiPartial = null
    }

    // Fallback prose (used when AI parse fails). Numbers come from the
    // backend-computed values above so the report is still coherent.
    const fallbackJourney =
      'This week you showed up for yourself with consistency, turning lived experience into transferable wisdom. Each sharing was a quiet act of courage — choosing reflection over silence.'
    const fallbackCoreLesson =
      'The simple act of articulating your experience transforms it. You are not just recording your life; you are distilling it into wisdom that guides your future self.'
    const fallbackFocusReason =
      'This quality, when strengthened, will amplify everything else you are building.'
    const fallbackMotto = 'Show up. Reflect. Grow. Repeat.'

    // Stitch the authoritative backend data with the AI prose. The
    // backend always wins on numbers; AI only contributes prose strings.
    const reportData = {
      section1_pulse: {
        // Stage 6 follow-up (commit 35): questsFinished replaces the
        // old activeDays (wisdom publish count) as the headline number.
        questsFinished: questsFinished || 0,
        betterSelfStart,
        betterSelfEnd,
        traitChanges,
      },
      section2_narrative: {
        journey: aiPartial?.journey || fallbackJourney,
        corelesson: aiPartial?.corelesson || fallbackCoreLesson,
      },
      section3_echo: {
        // Stage 6 follow-up (commit 35): weeklyResonance (7-day SUM of
        // community_count) replaces the cumulative totalResonance. The
        // AI echo message is removed -- mobile now renders a fixed
        // copy string ("People resonated with you in the past week...")
        // so there's no per-report AI prose for this section anymore.
        weeklyResonance,
      },
      section4_path: {
        focusTrait: suggestedFocusTrait,
        focusReason: aiPartial?.focusReason || fallbackFocusReason,
        motto: aiPartial?.motto || fallbackMotto,
      },
    }

    // ---- Cache + bump last_report_generated_at ----
    await supabase.from('weekly_reports').upsert({
      user_id: userId,
      week_start: weekStart,
      report_data: reportData,
    }, { onConflict: 'user_id,week_start' })

    await supabase.from('profiles').update({ last_report_generated_at: now.toISOString() }).eq('id', userId)

    return NextResponse.json({ success: true, report: reportData, cached: false, weekStart })
  } catch (error) {
    console.error('Wisdom center POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
