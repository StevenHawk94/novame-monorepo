import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/require-admin'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const questionId = searchParams.get('questionId')
    const pending = searchParams.get('pending')

    // Return pending user-submitted questions
    if (pending === 'true') {
      const { data: pendingQs } = await supabase
        .from('seek_questions')
        .select('id, question_text, creator_name, creator_avatar, status, created_at, submitted_by_user_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      const { count: pendingCount } = await supabase
        .from('seek_questions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      return NextResponse.json({ success: true, questions: pendingQs || [], pendingCount: pendingCount || 0 })
    }

    if (questionId) {
      // Step 1: get card links
      const { data: cardLinks, error: linkError } = await supabase
        .from('seek_question_cards')
        .select('id, card_id, created_at')
        .eq('question_id', questionId)
        .order('created_at', { ascending: false })

      if (linkError) {
        return NextResponse.json({ success: false, error: 'link_error: ' + linkError.message, cards: [] })
      }

      const linkMap = {}
      const cardIds = (cardLinks || []).map(l => {
        if (l.card_id) linkMap[l.card_id] = l.id
        return l.card_id
      }).filter(Boolean)

      // Return debug info + empty if no links
      if (cardIds.length === 0) {
        return NextResponse.json({ success: true, cards: [], debug: { rawLinks: cardLinks } })
      }

      // Step 2: fetch wisdom_cards WITHOUT card_keywords join first (simpler)
      const { data: cards, error: cardError } = await supabase
        .from('wisdom_cards')
        .select('id, keyword_id, quote_short, card_number, creator_name')
        .in('id', cardIds)

      if (cardError) {
        return NextResponse.json({ success: false, error: 'card_error: ' + cardError.message, cards: [], debug: { cardIds } })
      }

      // Step 3: try to get card_keywords separately (table might not exist or join might fail)
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
      } catch (e) {
        // card_keywords join failed — not fatal, proceed without keyword names
      }

      const orderedCards = cardIds
        .map(id => {
          const card = (cards || []).find(c => c.id === id)
          if (!card) return null
          return {
            ...card,
            link_id: linkMap[id],
            card_keywords: { keyword: keywordMap[card.keyword_id] || card.keyword_id || '' },
          }
        })
        .filter(Boolean)

      return NextResponse.json({
        success: true,
        cards: orderedCards,
        debug: { cardIds, foundCards: cards?.length, linkCount: cardLinks?.length }
      })
    }

    const { data } = await supabase
      .from('seek_questions')
      .select('*, seek_question_cards(count)')
      .order('created_at', { ascending: false })

    return NextResponse.json({
      success: true,
      questions: (data || []).map(q => ({ ...q, card_count: q.seek_question_cards?.[0]?.count || 0 })),
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error: ' + error.message }, { status: 500 })
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { action } = body
    const supabase = getSupabase()

    if (action === 'create') {
      const { question, tag, creatorName, creatorAvatar } = body
      if (!question) return NextResponse.json({ error: 'Missing question' }, { status: 400 })
      const { data, error } = await supabase.from('seek_questions').insert({
        question_text: question,
        question_tag: tag || 'Clarity',
        creator_name: creatorName || 'WisdomSeeker',
        creator_avatar: creatorAvatar || '',
        is_published: true,
      }).select().single()
      return NextResponse.json({ success: !error, question: data })
    }

    if (action === 'update') {
      const { id, question, tag, isPublished } = body
      const updates = {}
      if (question !== undefined) updates.question_text = question
      if (tag !== undefined) updates.question_tag = tag
      if (isPublished !== undefined) updates.is_published = isPublished
      await supabase.from('seek_questions').update(updates).eq('id', id)
      return NextResponse.json({ success: true })
    }

    if (action === 'delete') {
      await supabase.from('seek_question_cards').delete().eq('question_id', body.id)
      await supabase.from('seek_questions').delete().eq('id', body.id)
      return NextResponse.json({ success: true })
    }

    if (action === 'add_card') {
      const { questionId, cardId } = body
      if (!questionId || !cardId) return NextResponse.json({ error: 'Missing questionId or cardId' }, { status: 400 })

      // Verify card exists
      const { data: cardExists, error: verifyError } = await supabase
        .from('wisdom_cards')
        .select('id')
        .eq('id', cardId)
        .single()

      if (verifyError || !cardExists) {
        return NextResponse.json({
          success: false,
          error: `Card not found (id: ${cardId}). Use the full UUID from the Cards tab copy button.`
        })
      }

      // Check duplicate
      const { data: existing } = await supabase.from('seek_question_cards')
        .select('id').eq('question_id', questionId).eq('card_id', cardId).limit(1)
      if (existing && existing.length > 0) {
        return NextResponse.json({ success: false, error: 'Card already added to this question' })
      }

      const { error } = await supabase.from('seek_question_cards').insert({
        question_id: questionId,
        card_id: cardId,
        contributed_by: 'admin',
      })
      return NextResponse.json({ success: !error, error: error?.message })
    }

    if (action === 'remove_card') {
      const { linkId } = body
      if (!linkId) return NextResponse.json({ error: 'Missing linkId' }, { status: 400 })
      await supabase.from('seek_question_cards').delete().eq('id', linkId)
      return NextResponse.json({ success: true })
    }

    if (action === 'approve_user_question') {
      const { id } = body
      await supabase.from('seek_questions').update({
        status: 'approved', is_published: true,
      }).eq('id', id)
      return NextResponse.json({ success: true })
    }

    if (action === 'reject_user_question') {
      const { id } = body
      await supabase.from('seek_questions').update({ status: 'rejected' }).eq('id', id)
      return NextResponse.json({ success: true })
    }

    if (action === 'bulk_csv_upload') {
      // rows: [{keyword_id, user_name, question, insight_full, quote_short}, ...]
      const { rows } = body
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'Missing or empty rows' }, { status: 400 })
      }

      // Step 1: Fetch default users (leaderboard_seeds) for name → avatar matching
      const { data: defaultUsers } = await supabase.from('leaderboard_seeds').select('name, avatar_url')
      const userAvatarMap = {}
      ;(defaultUsers || []).forEach(u => { userAvatarMap[u.name.toLowerCase().trim()] = u.avatar_url || '' })

      // Step 2: Group rows by unique question (keyword_id + user_name + question)
      const questionGroups = {}
      for (const row of rows) {
        const kw = (row.keyword_id || '').trim()
        const userName = (row.user_name || '').trim()
        const qText = (row.question || '').trim()
        if (!kw || !qText) continue
        const groupKey = `${kw}|||${userName}|||${qText}`
        if (!questionGroups[groupKey]) {
          questionGroups[groupKey] = { keyword_id: kw, user_name: userName, question: qText, cards: [] }
        }
        const insightFull = (row.insight_full || '').trim()
        const quoteShort = (row.quote_short || '').trim()
        if (insightFull || quoteShort) {
          questionGroups[groupKey].cards.push({ insight_full: insightFull, quote_short: quoteShort })
        }
      }

      const groups = Object.values(questionGroups)
      let totalQuestions = 0
      let totalCards = 0
      const errors = []

      for (const group of groups) {
        try {
          // Derive tag (keyword) from keyword_id: "mind-clarity" → "Clarity"
          const kwParts = group.keyword_id.split('-')
          const tag = kwParts.length > 1
            ? kwParts.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')
            : kwParts[0].charAt(0).toUpperCase() + kwParts[0].slice(1)
          const creatorAvatar = userAvatarMap[group.user_name.toLowerCase()] || ''

          // Step 3: Create seek_question
          const { data: qData, error: qErr } = await supabase.from('seek_questions').insert({
            question_text: group.question,
            question_tag: tag,
            creator_name: group.user_name || 'WisdomSeeker',
            creator_avatar: creatorAvatar,
            is_published: true,
          }).select('id').single()

          if (qErr || !qData) {
            errors.push(`Question "${group.question.substring(0, 40)}...": ${qErr?.message || 'insert failed'}`)
            continue
          }
          totalQuestions++

          // Step 4: Create wisdom_cards for this question (user_id: null → default/gallery)
          if (group.cards.length > 0) {
            const cardRows = group.cards.map(c => ({
              wisdom_id: null,
              user_id: null,
              keyword_id: group.keyword_id,
              quote_short: c.quote_short.substring(0, 60),
              insight_full: c.insight_full,
              card_a: c.quote_short.substring(0, 60),
              card_b: '',
              card_c: '',
              card_number: 1,
              likes: 0,
              saves_count: 0,
              creator_name: group.user_name || 'Default User',
              creator_avatar: creatorAvatar,
            }))

            const { data: cardsData, error: cardsErr } = await supabase
              .from('wisdom_cards')
              .insert(cardRows)
              .select('id')

            if (cardsErr) {
              errors.push(`Cards for "${group.question.substring(0, 40)}...": ${cardsErr.message}`)
              continue
            }

            // Step 5: Link cards to question via seek_question_cards
            const links = (cardsData || []).map(c => ({
              question_id: qData.id,
              card_id: c.id,
              contributed_by: 'admin',
            }))

            if (links.length > 0) {
              const { error: linkErr } = await supabase.from('seek_question_cards').insert(links)
              if (linkErr) {
                errors.push(`Links for "${group.question.substring(0, 40)}...": ${linkErr.message}`)
              }
            }

            totalCards += (cardsData || []).length
          }
        } catch (e) {
          errors.push(`Group error: ${e.message}`)
        }
      }

      return NextResponse.json({
        success: true,
        summary: { questions: totalQuestions, cards: totalCards, errors: errors.length },
        errors: errors.length > 0 ? errors : undefined,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error: ' + error.message }, { status: 500 })
  }
}

// NOTE: Additional actions handled in POST:
// action: 'approve_user_question' — approve a pending user question
// action: 'reject_user_question'  — reject a pending user question
// GET param: pending=true         — return pending user submissions
