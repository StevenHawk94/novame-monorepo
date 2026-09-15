const DEFAULT_ALERT_EMAIL = 'support@soulsayit.com'

function acceptedSignalIds(updates) {
  const ids = new Set()
  for (const module of Object.values(updates || {})) {
    for (const card of Array.isArray(module?.cards) ? module.cards : []) {
      if (typeof card?.signalId === 'string' && card.signalId) ids.add(card.signalId)
    }
  }
  return ids
}

export async function recordConnectionOutputOutcomes(supabase, {
  reflectId, signalResults, updates,
}) {
  try {
    const accepted = acceptedSignalIds(updates)
    const outcomes = (signalResults || []).flatMap((row) => (
      accepted.has(row?.signalId) && ['matched', 'custom'].includes(row?.outcome)
        ? [{
          signal_id: row.signalId,
          outcome: row.outcome,
          section: row.moduleKey || null,
        }]
        : []
    ))
    if (!reflectId || outcomes.length === 0) return { recorded: 0 }
    const { error } = await supabase.rpc('record_connection_output_outcomes', {
      p_reflect_id: String(reflectId),
      p_outcomes: outcomes,
    })
    if (error) throw error
    return { recorded: outcomes.length }
  } catch (error) {
    // Metrics and alerts must never block a user's Connection update.
    console.warn('[connection-output-monitor] record failed:', error?.message || error)
    return { recorded: 0, error: String(error?.message || error) }
  }
}

function alertRecipient() {
  const configured = process.env.CONNECTION_ALERT_EMAIL?.trim()
  return configured && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured)
    ? configured : DEFAULT_ALERT_EMAIL
}

export async function sendPendingConnectionOutputAlert(supabase) {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) return { sent: false, reason: 'resend_not_configured' }

  let alert = null
  try {
    const { data, error } = await supabase.rpc('claim_connection_output_alert')
    if (error) throw error
    alert = Array.isArray(data) ? data[0] : data
    if (!alert) return { sent: false, reason: 'no_pending_alert' }

    const percentage = Math.round(Number(alert.original_ratio || 0) * 10000) / 100
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `connection-output-window-${Number(alert.window_number)}`,
      },
      body: JSON.stringify({
        from: 'Burrow Alerts <noreply@soulsayit.com>',
        to: [alertRecipient()],
        subject: `[Burrow] Connection original-card rate is ${percentage}%`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:620px;margin:auto">
          <h2>Connection template coverage alert</h2>
          <p>In completed output window #${Number(alert.window_number)}, ${Number(alert.original_outputs)} of ${Number(alert.total_outputs)} user-visible Connection cards required original AI fallback copy.</p>
          <p><strong>Original-card rate: ${percentage}%</strong> (alert threshold: greater than 30%).</p>
          <p>No journal text, user identity, or private evidence is included in this alert.</p>
        </div>`,
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Resend ${response.status}: ${body.slice(0, 180)}`)
    }
    const { error: completeError } = await supabase.rpc('complete_connection_output_alert', {
      p_alert_id: alert.id,
      p_success: true,
      p_error: null,
    })
    if (completeError) throw completeError
    return { sent: true, alertId: alert.id }
  } catch (error) {
    if (alert?.id) {
      try {
        await supabase.rpc('complete_connection_output_alert', {
          p_alert_id: alert.id,
          p_success: false,
          p_error: String(error?.message || error).slice(0, 500),
        })
      } catch {
        // A later cron can reclaim a stale sending row.
      }
    }
    console.warn('[connection-output-monitor] alert failed:', error?.message || error)
    return { sent: false, reason: 'delivery_failed' }
  }
}

export function connectionOutputMonitorInternals() {
  return { acceptedSignalIds, alertRecipient }
}
