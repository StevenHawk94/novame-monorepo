import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const GEMINI_MODEL = 'gemini-2.5-flash-lite'

// Random delay between 100-200 minutes (in ms)
function getCommentDelay(index) {
  const minMs = 100 * 60 * 1000 // 100 min
  const maxMs = 200 * 60 * 1000 // 200 min
  // Each subsequent comment gets a slightly later time
  const baseDelay = Math.floor(Math.random() * (maxMs - minMs)) + minMs
  return baseDelay + (index * 15 * 60 * 1000) // +15min offset per comment
}

/**
 * GET: Fetch comments for a wisdom (only visible ones based on visible_at)
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const wisdomId = searchParams.get('wisdomId')
  const checkOnly = searchParams.get('checkOnly') === 'true'
  
  if (!wisdomId) return Response.json({ error: 'Missing wisdomId' }, { status: 400 })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: allComments } = await supabase
    .from('wisdom_comments')
    .select('*')
    .eq('wisdom_id', wisdomId)
    .order('created_at', { ascending: true })

  if (!allComments) return Response.json({ success: true, comments: [], hasVisibleComments: false, commentCount: 0 })

  const now = new Date()
  const visibleComments = allComments.filter(c => {
    if (c.comment_type === 'user') return true
    if (!c.visible_at) return true
    return new Date(c.visible_at) <= now
  })

  if (checkOnly) {
    return Response.json({ success: true, hasVisibleComments: visibleComments.length > 0, commentCount: visibleComments.length })
  }

  return Response.json({ success: true, comments: visibleComments, hasVisibleComments: visibleComments.length > 0 })
}

/**
 * POST: Handle user comments AND AI comment generation
 */
export async function POST(request) {
  const body = await request.json()
  const { wisdomId, commentText, commenterId, commenterName, isAi } = body

  if (!wisdomId) return Response.json({ error: 'Missing wisdomId' }, { status: 400 })

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // ===== USER COMMENT (immediate) =====
  if (isAi === false && commentText) {
    let commenterAvatar = null
    if (commenterId) {
      const { data: profile } = await supabase.from('profiles').select('avatar_url').eq('id', commenterId).single()
      commenterAvatar = profile?.avatar_url || null
    }
    const { data: comment, error } = await supabase.from('wisdom_comments').insert({
      wisdom_id: wisdomId, commenter_id: commenterId || null, commenter_name: commenterName || 'Anonymous',
      commenter_avatar: commenterAvatar, comment_text: commentText, comment_type: 'user',
      sentiment: 'positive', is_visible: true, is_read: false, visible_at: new Date().toISOString(),
    }).select().single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ success: true, comment })
  }

  // ===== AI COMMENT GENERATION (1-3 comments, delayed visibility) =====
  const wisdomText = body.wisdomText
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return Response.json({ error: 'API key not configured' }, { status: 500 })

  // Check if AI comments already exist for this wisdom
  const { data: existing } = await supabase.from('wisdom_comments').select('id').eq('wisdom_id', wisdomId).eq('comment_type', 'ai').limit(1)
  if (existing && existing.length > 0) return Response.json({ success: true, message: 'AI comments already exist', skipped: true })

  // Get wisdom text if not provided
  let textToComment = wisdomText
  if (!textToComment) {
    const { data: wisdom } = await supabase.from('wisdoms').select('text, description').eq('id', wisdomId).single()
    textToComment = wisdom?.text || wisdom?.description || ''
  }
  if (!textToComment) return Response.json({ success: false, message: 'No text to comment on' })

  // Get random default users (need multiple for multiple comments)
  const { data: defaultUsers } = await supabase.from('leaderboard_seeds').select('name, avatar_url').limit(59)
  if (!defaultUsers || defaultUsers.length === 0) return Response.json({ success: false, message: 'No default users' })

  // Decide how many comments (1-3)
  const commentCount = Math.floor(Math.random() * 3) + 1 // 1, 2, or 3

  // Generate all comments in one API call
  const prompt = `You are generating ${commentCount} distinct community comments responding to someone's shared wisdom. Each comment should come from a different persona.

Persona Pool (randomly assign one per comment):
- The Professional: Clinical, precise, appreciative of the science.
- The Struggler: Vulnerable, raw, speaks from the "trenches" of their own recovery.
- The Hype-Person: High energy, uses emojis, short and punchy.
- The Philosophical Elder: Reflective, uses analogies, calm and grounded.
- The Skeptic-Turned-Believer: Admits they were doubtful but found this worked.

Rules:
- Mix lengths: some "one-liners" (under 10 words), others "micro-stories" (3-4 sentences).
- Vary tone: formal, casual/slang, deeply emotional, purely practical.
- Use natural "internet speak"—some lowercase, ellipses (...), exclamation points.
- NEVER use "Thank you for sharing this insightful post" or similar robotic phrases.
- Instead use: "I needed this today," "Oof, that hits home," "this literally saved my morning."
- Do NOT repeat keywords across comments.

Their wisdom: "${textToComment.substring(0, 5000)}"

Return ONLY a JSON array of ${commentCount} comment strings, no markdown:
["comment1", "comment2"${commentCount > 2 ? ', "comment3"' : ''}]`

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 1000 },
        }),
      }
    )

    const data = await response.json()
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    let comments = []
    try {
      const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      comments = JSON.parse(cleaned)
      if (!Array.isArray(comments)) comments = [String(comments)]
    } catch (e) {
      // If JSON parse fails, use raw text as single comment
      if (rawText) comments = [rawText.replace(/^["']|["']$/g, '')]
    }

    if (comments.length === 0) return Response.json({ success: false, message: 'No comments generated' })

    // Insert each comment with different random user and different delay
    const insertedComments = []
    for (let i = 0; i < comments.length; i++) {
      const text = comments[i]
      if (!text || text.length < 3) continue

      // Pick a unique random user for each comment
      const userIdx = Math.floor(Math.random() * defaultUsers.length)
      const user = defaultUsers[userIdx]

      const delayMs = getCommentDelay(i)
      const visibleAt = new Date(Date.now() + delayMs).toISOString()

      const { data: saved, error } = await supabase.from('wisdom_comments').insert({
        wisdom_id: wisdomId, commenter_id: null,
        commenter_name: user.name, commenter_avatar: user.avatar_url,
        comment_text: text, comment_type: 'ai', sentiment: 'positive',
        is_visible: true, is_read: false, visible_at: visibleAt,
      }).select().single()

      if (!error && saved) insertedComments.push({ id: saved.id, visibleAt, user: user.name })
    }

    return Response.json({ success: true, count: insertedComments.length, comments: insertedComments })
  } catch (error) {
    console.error('AI comment generation error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
