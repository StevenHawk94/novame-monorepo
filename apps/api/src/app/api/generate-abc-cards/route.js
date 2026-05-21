import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const KEYWORD_TO_ID = {
  'Clarity':'mind-clarity','Grounding':'mind-grounding','Focus':'mind-focus','Curiosity':'mind-curiosity',
  'Stillness':'mind-stillness','Objectivity':'mind-objectivity','Adaptability':'mind-adaptability','Unlearning':'mind-unlearning',
  'Vision':'mind-vision','Acceptance':'mind-acceptance','Humor':'mind-humor','Intuition':'mind-intuition',
  'Resilience':'heart-resilience','Boundaries':'heart-boundaries','Self-Compassion':'heart-self-compassion','Courage':'heart-courage',
  'Vulnerability':'heart-vulnerability','Empathy':'heart-empathy','Gratitude':'heart-gratitude','Patience':'heart-patience',
  'Forgiveness':'heart-forgiveness','Release':'heart-release','Balance':'heart-balance','Joy':'heart-joy',
  'Initiative':'action-initiative','Consistency':'action-consistency','Discipline':'action-discipline','Decisiveness':'action-decisiveness',
  'Purpose':'action-purpose','Rest':'action-rest','Resourcefulness':'action-resourcefulness','Accountability':'action-accountability',
  'Boldness':'action-boldness','Endurance':'action-endurance','Communication':'action-communication','Momentum':'action-momentum',
  'Sovereignty':'connection-sovereignty','Authenticity':'connection-authenticity','Inspiration':'connection-inspiration','Generosity':'connection-generosity',
  'Trust':'connection-trust','Reciprocity':'connection-reciprocity','Collaboration':'connection-collaboration','Leadership':'connection-leadership',
  'Harmony':'connection-harmony','Legacy':'connection-legacy','Respect':'connection-respect','Loyalty':'connection-loyalty',
}

const ID_TO_KEYWORD = Object.fromEntries(Object.entries(KEYWORD_TO_ID).map(([k, v]) => [v, k]))

// Stage 6 cleanup: the POST handler used to live here. It was a duplicate
// of generateWisdomCard() in /lib/generate-card.js and was no longer called
// by anything (publish-wisdom now imports the lib directly). The duplicate
// prompt was a maintenance liability — every prompt revision had to be made
// in two places. Deleted to keep a single source of truth in /lib.
//
// The GET handler below is still used by keyword-detail.tsx to fetch the
// user's "orphan" starter cards (wisdom_id IS NULL) that don't appear in
// /api/wisdoms (which joins through the wisdoms table).

// ─── GET handler (unchanged) ─────────────────────────────────────────────────

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const isPublic = searchParams.get('public') === 'true'
    const keywordId = searchParams.get('keywordId')
    const keywords = searchParams.get('keywords')
    const wisdomId = searchParams.get('wisdomId')
    const offset = parseInt(searchParams.get('offset') || '0', 10)
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)
    const keywordIds = keywords ? keywords.split(',').map(k => KEYWORD_TO_ID[k.trim()]).filter(Boolean) : []
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (wisdomId) {
      const { data } = await supabase.from('wisdom_cards').select('*').eq('wisdom_id', wisdomId).limit(1)
      if (data && data.length > 0) return NextResponse.json({ success: true, card: enrichCard(data[0]) })
      return NextResponse.json({ success: true, card: null })
    }
    if (isPublic) {
      // Unified query: default cards + user cards, paginated
      let query = supabase.from('wisdom_cards').select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      if (keywordIds.length > 0) query = query.in('keyword_id', keywordIds)
      else if (keywordId) query = query.eq('keyword_id', keywordId)
      const { data, count, error } = await query
      if (error) {
        return NextResponse.json({ success: true, cards: [], total: 0, hasMore: false })
      }
      const cards = (data || []).map(c => enrichCard(c))
      return NextResponse.json({ success: true, cards, total: count || 0, hasMore: offset + limit < (count || 0) })
    }
    let query = supabase.from('wisdom_cards').select('*').order('created_at', { ascending: false }).limit(100)
    if (keywordId) query = query.eq('keyword_id', keywordId)
    if (userId) query = query.eq('user_id', userId)
    else query = query.is('user_id', null)
    const { data, error } = await query
    if (error) {
      const { data: fallback } = await supabase.from('wisdom_cards').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100)
      return NextResponse.json({ success: true, cards: (fallback || []).map(c => enrichCard(c)) })
    }
    return NextResponse.json({ success: true, cards: (data || []).map(c => enrichCard(c)) })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function enrichCard(card) {
  const kwId = card.keyword_id || 'mind-clarity'
  const category = kwId.split('-')[0] || 'mind'
  const keyword = ID_TO_KEYWORD[kwId] || kwId.split('-').slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return { ...card, card_keywords: { keyword, category, front_image: `/images/cards/${kwId}-front.webp`, back_image: `/images/cards/${category}-back.webp` } }
}
