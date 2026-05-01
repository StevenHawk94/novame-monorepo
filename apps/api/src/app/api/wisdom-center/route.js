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
 */
export async function POST(request) {
  try {
    const { userId, userName } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' })
    if (!GEMINI_API_KEY) return NextResponse.json({ error: 'API not configured' })

    const supabase = getSupabase()
    const now = new Date()
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    // Week key for caching
    const dayOfWeek = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    const weekStart = monday.toISOString().split('T')[0]

    // Check cache
    const { data: cached } = await supabase.from('weekly_reports')
      .select('report_data')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .single()
    if (cached?.report_data) {
      return NextResponse.json({ success: true, report: cached.report_data, cached: true })
    }

    // Fetch wisdoms from last 7 days (include daily_index for efficient synthesis)
    const { data: wisdoms } = await supabase.from('wisdoms')
      .select('id, text, daily_index, created_at')
      .eq('user_id', userId)
      .gte('created_at', weekAgo.toISOString())
      .order('created_at', { ascending: true })

    if (!wisdoms || wisdoms.length < 2) {
      return NextResponse.json({ error: 'Not enough shares (need at least 2)', notEnough: true })
    }

    // Profile for trait data
    const { data: profile } = await supabase.from('profiles')
      .select('aspire_words, aspire_scores, better_self_score, community_resonance, display_name')
      .eq('id', userId).single()

    const aspireWords = profile?.aspire_words || []
    const aspireScores = profile?.aspire_scores || {}
    const currentBetterSelf = profile?.better_self_score || 70
    const name = userName || profile?.display_name || 'you'

    // Community resonance
    let resonance = profile?.community_resonance || 0
    const { count: realSaves } = await supabase.from('card_saves')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    const resonanceSeed = Math.floor(Math.random() * 71) + 30
    const totalResonance = (realSaves || 0) + resonanceSeed

    // Build prompt data using daily_index (compressed) or fallback to text excerpt
    const traitSummary = aspireWords.length > 0
      ? aspireWords.map(w => `${w}: ${aspireScores[w] ?? 70}/100`).join(', ')
      : 'No personal growth traits set'

    const wisdomsSummary = wisdoms.map((w, i) => {
      // Use daily_index if available (compressed ~200 chars), otherwise fallback to text excerpt
      const index = w.daily_index || (w.text || '').substring(0, 200)
      return `Day ${i + 1}: ${index}`
    }).join('\n')

    const prompt = `Weekly Evolution Report for ${name}.

DATA:
- Active sharing days: ${wisdoms.length}
- Better Self Match Score (current): ${currentBetterSelf}%
- Personal growth traits: ${traitSummary}
- Community resonance: ${totalResonance} souls reached

Compressed daily indices (core emotion → event → insight):
${wisdomsSummary}

Generate JSON. section1_pulse: activeDays=${wisdoms.length}, betterSelfEnd=${currentBetterSelf}. section3_echo: totalResonance=${totalResonance}.
${aspireWords.length === 0 ? 'No traits set — create 4 universal trait suggestions from their content.' : ''}
Return ONLY valid JSON, no markdown fences, no extra text.`

    // Use system_instruction separation for Gemini implicit caching
    const systemInstruction = `You are the "Wisdom Keeper," creating Weekly Evolution Reports.
TONE: Warm, insightful, grounded. Second person ("you"). No markdown bold markers or asterisks. Flowing prose where specified.
OUTPUT FORMAT: JSON with exactly 4 sections: section1_pulse, section2_narrative, section3_echo, section4_path.
section1_pulse: { activeDays, betterSelfStart (estimate start-of-week, 2-6pts lower than end), betterSelfEnd, traitChanges: [{trait, score, change(-5 to +5)}] }
section2_narrative: { journey (150-word synthesis of emotional/intellectual trajectory), corelesson (single most powerful insight, 2-3 sentences) }
section3_echo: { totalResonance, message (one-sentence poetic ripple effect statement) }
section4_path: { focusTrait (lowest score trait), focusReason (one sentence why), motto (under 15 words battle cry) }
Return ONLY valid JSON, no markdown fences.`

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1500 },
        }),
      }
    )

    const aiData = await aiRes.json()
    const rawText = aiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    let reportData
    try {
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      reportData = JSON.parse(cleaned)
    } catch (e) {
      reportData = {
        section1_pulse: {
          activeDays: wisdoms.length,
          betterSelfStart: Math.max(0, currentBetterSelf - 3),
          betterSelfEnd: currentBetterSelf,
          traitChanges: aspireWords.map(w => ({ trait: w, score: aspireScores[w] ?? 70, change: 0 })),
        },
        section2_narrative: {
          journey: 'This week you showed up for yourself consistently, turning lived experience into transferable wisdom. Each sharing was a quiet act of courage — choosing reflection over silence.',
          corelesson: 'The simple act of articulating your experience transforms it. You are not just recording your life; you are distilling it into wisdom that guides your future self.',
        },
        section3_echo: {
          totalResonance,
          message: 'Your words rippled outward this week, touching hearts you may never meet.',
        },
        section4_path: {
          focusTrait: aspireWords[0] || 'Resilience',
          focusReason: 'This quality, when strengthened, will amplify everything else you are building.',
          motto: 'Show up. Reflect. Grow. Repeat.',
        },
      }
    }

    // Ensure resonance is always correct
    if (reportData.section3_echo) reportData.section3_echo.totalResonance = totalResonance
    if (reportData.section1_pulse) {
      reportData.section1_pulse.activeDays = wisdoms.length
      reportData.section1_pulse.betterSelfEnd = currentBetterSelf
    }

    // Cache
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
