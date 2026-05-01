import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

/**
 * POST /api/support-ticket
 * 1. Saves ticket to support_tickets table
 * 2. Sends email notification to support@soulsayit.com via Resend
 */
export async function POST(req) {
  try {
    const { userId, email, category, subject, message } = await req.json()

    if (!email || !category || !subject?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = getSupabase()

    // 1. Save to DB
    let ticketId = null
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .insert({
          user_id: userId || null,
          email,
          category,
          subject: subject.trim(),
          message: message.trim(),
          status: 'open',
        })
        .select('id')
        .single()

      if (!error && data) ticketId = data.id
    } catch (e) {
      console.error('DB insert error:', e)
      // Continue — email is more important
    }

    // 2. Send email notification via Resend
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Novame Support <noreply@soulsayit.com>',
            to: ['support@soulsayit.com'],
            reply_to: email,
            subject: `[${category.toUpperCase()}] ${subject}`,
            html: `
              <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #7C3AED;">New Support Ticket</h2>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr><td style="padding: 8px 0; color: #666; width: 100px;">From</td><td style="padding: 8px 0;"><strong>${email}</strong></td></tr>
                  <tr><td style="padding: 8px 0; color: #666;">Category</td><td style="padding: 8px 0;">${category}</td></tr>
                  <tr><td style="padding: 8px 0; color: #666;">User ID</td><td style="padding: 8px 0; font-size: 12px; color: #999;">${userId || 'Guest'}</td></tr>
                  ${ticketId ? `<tr><td style="padding: 8px 0; color: #666;">Ticket ID</td><td style="padding: 8px 0; font-size: 12px; color: #999;">${ticketId}</td></tr>` : ''}
                </table>
                <div style="background: #F5F3FF; border-radius: 12px; padding: 20px; margin: 16px 0;">
                  <p style="margin: 0; white-space: pre-wrap; line-height: 1.6;">${message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                </div>
                <p style="color: #999; font-size: 12px; margin-top: 24px;">Reply directly to this email to respond to the user.</p>
              </div>
            `,
          }),
        })

        if (!emailRes.ok) {
          const errData = await emailRes.json().catch(() => ({}))
          console.error('Resend error:', errData)
        }
      } catch (e) {
        console.error('Email send error:', e)
      }
    } else {
      console.warn('RESEND_API_KEY not set — skipping email notification')
    }

    return NextResponse.json({ success: true, ticketId })
  } catch (e) {
    console.error('support-ticket error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * GET /api/support-ticket?status=open
 * Admin: list support tickets
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'open'

    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    return NextResponse.json({ success: true, tickets: data || [] })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * PATCH /api/support-ticket
 * Admin: update ticket status or add notes
 */
export async function PATCH(req) {
  try {
    const { id, status, adminNotes } = await req.json()
    if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 })

    const supabase = getSupabase()
    const updates = { updated_at: new Date().toISOString() }
    if (status) updates.status = status
    if (adminNotes !== undefined) updates.admin_notes = adminNotes

    const { error } = await supabase
      .from('support_tickets')
      .update(updates)
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
