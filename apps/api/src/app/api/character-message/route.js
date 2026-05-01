import { createClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Call AI to generate personalized feedback with 3-tier fallback
async function generateAIFeedback(wisdomText) {
  try {
    const { text } = await callAI({
      systemInstruction: `You are a playful, empathetic wisdom companion. Write a short feedback/encouragement with playful energy in 15-20 words based on what the user just shared. Write ONLY the feedback, no quotes, no explanation.

Examples:
- "I felt that shift! Your depth is my fuel—my energy is buzzing now that we've captured your truth"
- "Oof, that hit deep. You're becoming so much stronger. I'm surging with power from your honesty right now."
- "I see you. That was beautifully real. My spirit is sparkling—you're officially leveling up your best self today"`,
      userText: wisdomText,
      generationConfig: { temperature: 0.9, maxOutputTokens: 60 },
    })
    return text || null
  } catch (error) {
    console.error('AI feedback error:', error.message)
    return null
  }
}

/**
 * GET /api/character-message
 *
 * Modes:
 * 1. ?fresh=true&text=... → Generate AI feedback for just-published wisdom
 * 2. Otherwise → Return character state from DB
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const fresh = searchParams.get('fresh') === 'true'
    const text = searchParams.get('text')

    if (fresh && text) {
      const feedback = await generateAIFeedback(text)
      if (feedback) return Response.json({ message: feedback, source: 'ai' })
      return Response.json({ message: "You're doing amazing! Your wisdom is helping someone out there right now. Keep sharing your light! ✨", source: 'fallback' })
    }

    if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 })

    const supabase = getSupabase()
    const { data } = await supabase
      .from('character_state')
      .select('*')
      .eq('user_id', userId)
      .single()

    return Response.json({ success: true, data })
  } catch (error) {
    console.error('Character message error:', error)
    return Response.json({ error: error.message }, { status: 500 })
  }
}
