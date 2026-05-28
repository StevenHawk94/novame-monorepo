import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-2.5-flash-lite'

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
      return NextResponse.json({ success: true, report: cached.report_data, cached: true })
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

    const aspireWords = profile?.aspire_words || []
    const aspireScores = profile?.aspire_scores || {}
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

    const prompt = `Weekly Evolution Report for ${name}.

REAL DATA (already computed by the system — do not invent numbers):
- Active sharing days: ${wisdoms.length}
- Better Self Match Score: ${betterSelfStart}% → ${betterSelfEnd}%
- Personal growth traits this week: ${traitContext}
- Cumulative souls reached: ${totalResonance}
- Suggested focus trait (lowest score): ${suggestedFocusTrait}

Compressed daily indices (core emotion → event → insight):
${wisdomsSummary}

Generate ONLY these three pieces of prose (numbers above are authoritative — never restate or change them):
- section2_narrative.journey (150 words, second person, weave in specific anchors from the daily indices)
- section2_narrative.corelesson (2-3 sentences, single most powerful insight)
- section4_path.focusReason (one sentence, why nurturing "${suggestedFocusTrait}" matters next week)
- section4_path.motto (under 15 words, battle cry energy)

Return ONLY valid JSON in this exact shape, no markdown fences:
{
  "section2_narrative": { "journey": "...", "corelesson": "..." },
  "section4_path": { "focusReason": "...", "motto": "..." }
}`

    const systemInstruction = `You are the "Personal Growth Master," creating Weekly Evolution Reports for the user.
TONE: Warm, insightful, grounded. Second person ("you"). No markdown bold markers or asterisks. Flowing prose where specified.
DETAIL ANCHORING: Reference specific moments/anchors from the daily indices the user provides. No vague generalities like "you grew this week" — show evidence.
NO AI-isms ("In conclusion", "Furthermore", "I believe").
NO empty empathy ("I hear your pain", "this must be hard").
OUTPUT: A small partial JSON with prose fields only. Numeric data (questsFinished / betterSelfStart / betterSelfEnd / traitChanges / weeklyResonance / focusTrait) is already computed by the system — do NOT include those fields, and do NOT invent or alter the numbers in your prose.`

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1000 },
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
        journey: aiPartial?.section2_narrative?.journey || fallbackJourney,
        corelesson: aiPartial?.section2_narrative?.corelesson || fallbackCoreLesson,
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
        focusReason: aiPartial?.section4_path?.focusReason || fallbackFocusReason,
        motto: aiPartial?.section4_path?.motto || fallbackMotto,
      },
    }

    // ---- Cache + bump last_report_generated_at ----
    await supabase.from('weekly_reports').upsert({
      user_id: userId,
      week_start: weekStart,
      report_data: reportData,
    }, { onConflict: 'user_id,week_start' })

    await supabase.from('profiles').update({ last_report_generated_at: now.toISOString() }).eq('id', userId)

    return NextResponse.json({ success: true, report: reportData, cached: false })
  } catch (error) {
    console.error('Wisdom center POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
