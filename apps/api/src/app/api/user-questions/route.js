import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// GET /api/user-questions?userId=xxx  — fetch user's own submitted questions
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()
    const { data: questions } = await supabase
      .from('seek_questions')
      .select('id, question_text, status, is_published, card_count, created_at')
      .eq('submitted_by_user_id', userId)
      .order('created_at', { ascending: false })

    return NextResponse.json({ success: true, questions: questions || [] })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/user-questions  { userId, questionText }
export async function POST(req) {
  try {
    const { userId, questionText } = await req.json()
    if (!userId || !questionText?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (questionText.trim().length > 200) {
      return NextResponse.json({ error: 'Question must be 200 characters or less' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Get user profile for display name + avatar
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', userId).single()

    const { data, error } = await supabase
      .from('seek_questions')
      .insert({
        question_text: questionText.trim(),
        question_tag: '',
        creator_name: profile?.display_name || 'Community Member',
        creator_avatar: profile?.avatar_url || '',
        submitted_by_user_id: userId,
        status: 'pending',      // pending | approved | rejected
        is_published: false,
        card_count: 0,
      })
      .select().single()

    if (error) throw error
    return NextResponse.json({ success: true, question: data })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
