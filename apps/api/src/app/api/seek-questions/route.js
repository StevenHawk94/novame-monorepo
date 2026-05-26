import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(request) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const questionId = searchParams.get('questionId')

    if (questionId) {
      // Optional userId so we can filter out cards this user has
      // blocked. The block list is a per-user "hide forever" set.
      // If userId is absent (e.g. legacy mobile build, or the caller
      // is a curious anonymous browser), we skip the filter and
      // return everything.
      const userId = searchParams.get('userId')

      const { data: question } = await supabase
        .from('seek_questions')
        .select('*')
        .eq('id', questionId)
        .single()

      if (!question) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      // Step 1: get card_ids linked to this question.
      const { data: cardLinks } = await supabase
        .from('seek_question_cards')
        .select('card_id, created_at')
        .eq('question_id', questionId)
        .order('created_at', { ascending: false })

      let cardIds = (cardLinks || []).map(l => l.card_id).filter(Boolean)

      // Step 1b: filter out cards this user has blocked. We do this
      // BEFORE the wisdom_cards fetch so we don't waste bandwidth
      // pulling card content that will be discarded.
      if (userId && cardIds.length > 0) {
        const { data: blocks, error: blocksErr } = await supabase
          .from('wisdom_card_blocks')
          .select('card_id')
          .eq('user_id', userId)
          .in('card_id', cardIds)
        if (blocksErr) {
          // Non-fatal: log and proceed without filtering. Better to
          // show a blocked card occasionally than to fail the whole
          // request because of a block-list query hiccup.
          console.warn('[seek-questions] block filter query failed:', blocksErr.message)
        } else if (blocks && blocks.length > 0) {
          const blockedSet = new Set(blocks.map(b => b.card_id))
          cardIds = cardIds.filter(id => !blockedSet.has(id))
        }
      }

      if (cardIds.length === 0) {
        return NextResponse.json({ success: true, question, cards: [] })
      }

      // Step 2: fetch wisdom_cards by id (no foreign key join — avoids PostgREST relation errors)
      const { data: cards } = await supabase
        .from('wisdom_cards')
        .select('id, keyword_id, quote_short, insight_full, card_number, creator_name, creator_avatar, saves_count')
        .in('id', cardIds)

      // Step 3: fetch keyword labels separately
      const keywordMap = {}
      try {
        const kwIds = [...new Set((cards || []).map(c => c.keyword_id).filter(Boolean))]
        if (kwIds.length > 0) {
          const { data: kws } = await supabase
            .from('card_keywords')
            .select('id, keyword')
            .in('id', kwIds)
          ;(kws || []).forEach(k => { keywordMap[k.id] = k.keyword })
        }
      } catch (e) { /* proceed without keyword names */ }

      // Merge + preserve order
      const cardMap = {}
      ;(cards || []).forEach(c => {
        cardMap[c.id] = {
          ...c,
          card_keywords: { keyword: keywordMap[c.keyword_id] || '' },
        }
      })
      const orderedCards = cardIds.map(id => cardMap[id]).filter(Boolean)

      return NextResponse.json({ success: true, question, cards: orderedCards })
    }

    // List all published questions, optionally filtered by question_tag.
    // Mobile passes ?keywords=Clarity,Resilience,Joy when the user
    // applies a filter from the Discover filter sheet. We accept a
    // comma-separated list and use Postgres IN to filter.
    const keywordsParam = searchParams.get('keywords')
    const keywordList = keywordsParam
      ? keywordsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    // Stage 6 follow-up: infinite-scroll pagination. Mobile sends
    // limit + offset on every fetch; default 20 with hard cap 100
    // (mirrors /api/wisdoms route pattern). The partial index
    // idx_seek_questions_published_created (migration 20260526000000)
    // makes the ORDER BY ... LIMIT ... OFFSET path cheap as the
    // table grows.
    //
    // Client uses questions.length === limit as the hasMore signal
    // (Q-18.2 = B decision: no separate total count round-trip).
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    let listQuery = supabase
      .from('seek_questions')
      .select('*, seek_question_cards(count)')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (keywordList.length > 0) {
      listQuery = listQuery.in('question_tag', keywordList)
    }

    const { data: questions } = await listQuery

    return NextResponse.json({
      success: true,
      questions: (questions || []).map(q => ({
        ...q,
        card_count: q.seek_question_cards?.[0]?.count || 0,
      })),
    })
  } catch (error) {
    console.error('Seek questions error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const { userId, action, questionId, cardId } = await request.json()
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()

    if (action === 'contribute') {
      if (!questionId || !cardId) return NextResponse.json({ error: 'Missing questionId or cardId' }, { status: 400 })

      const { data: existing } = await supabase
        .from('seek_question_cards')
        .select('id')
        .eq('question_id', questionId)
        .eq('card_id', cardId)
        .limit(1)

      if (existing && existing.length > 0) {
        return NextResponse.json({ error: 'Card already shared to this question', duplicate: true })
      }

      await supabase.from('seek_question_cards').insert({
        question_id: questionId,
        card_id: cardId,
        contributed_by: userId,
      })

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
