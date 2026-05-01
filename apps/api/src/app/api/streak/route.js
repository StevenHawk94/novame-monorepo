import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

/**
 * Streak API
 * 
 * GET: Returns the last 7 days streak data for a user
 * Each day is marked as completed if user created at least one wisdom that day.
 * Uses user's local timezone offset to determine "today".
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')
    const tzOffset = parseInt(searchParams.get('tzOffset') || '0') // minutes offset from UTC

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Missing userId' })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Get wisdoms from last 7 days
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const { data: wisdoms, error } = await supabase
      .from('wisdoms')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Streak query error:', error)
      return NextResponse.json({ success: false, error: error.message })
    }

    // Build 7-day array (today = index 6, 6 days ago = index 0)
    const days = []
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000 - tzOffset * 60 * 1000)
      const dayStr = dayDate.toISOString().split('T')[0]
      
      const completed = (wisdoms || []).some(w => {
        const wDate = new Date(new Date(w.created_at).getTime() - tzOffset * 60 * 1000)
        return wDate.toISOString().split('T')[0] === dayStr
      })
      
      const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'short' })
      
      days.push({
        date: dayStr,
        dayName,
        completed,
      })
    }

    // Calculate current streak (consecutive days from today backwards)
    let currentStreak = 0
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].completed) {
        currentStreak++
      } else {
        break
      }
    }

    return NextResponse.json({
      success: true,
      days,
      currentStreak,
    })
  } catch (error) {
    console.error('Streak API error:', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
