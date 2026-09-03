const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const retryAt = (attempts) => new Date(
  Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000,
).toISOString()

export async function enqueuePartnerReflectNotification(supabase, userId, reflectId) {
  const [{ data: visible }, { data: pairing }] = await Promise.all([
    supabase.from('reflect_items').select('item_id').eq('user_id', userId)
      .eq('reflect_id', reflectId).eq('visible_to_paired', true).limit(1),
    supabase.from('pairings').select('partner_user_id').eq('user_id', userId).maybeSingle(),
  ])
  if (!visible?.length || !pairing?.partner_user_id) return false
  const { error } = await supabase.from('notification_outbox').upsert({
    recipient_user_id: pairing.partner_user_id,
    event_key: `partner-reflect:${reflectId}`,
  }, { onConflict: 'recipient_user_id,event_key', ignoreDuplicates: true })
  if (error) throw error
  return true
}

export async function drainPushNotificationOutbox(supabase, limit = 50) {
  const now = new Date().toISOString()
  // A serverless invocation can be interrupted after claiming a row. Recover
  // stale claims so no partner update remains permanently stuck in `sending`.
  const staleLock = new Date(Date.now() - 10 * 60_000).toISOString()
  await supabase.from('notification_outbox').update({
    status: 'retry', next_attempt_at: now, locked_at: null,
    last_error: 'stale_delivery_claim_recovered',
  }).eq('status', 'sending').lt('locked_at', staleLock)
  const { data: rows, error } = await supabase.from('notification_outbox')
    .select('*').in('status', ['pending', 'retry']).lte('next_attempt_at', now)
    .order('created_at', { ascending: true }).limit(limit)
  if (error) throw error
  let sent = 0
  for (const row of rows || []) {
    const attempts = Number(row.attempts || 0) + 1
    const { data: claimed } = await supabase.from('notification_outbox')
      .update({ status: 'sending', attempts, locked_at: now }).eq('id', row.id)
      .in('status', ['pending', 'retry']).select('id').maybeSingle()
    if (!claimed) continue
    try {
      const { data: tokens, error: tokenError } = await supabase.from('device_push_tokens')
        .select('id,expo_push_token').eq('user_id', row.recipient_user_id).eq('enabled', true)
      if (tokenError) throw tokenError
      if (!tokens?.length) {
        await supabase.from('notification_outbox').update({
          status: 'sent', sent_at: now, locked_at: null, last_error: 'no_registered_device',
        }).eq('id', row.id)
        continue
      }
      // Deliberately generic: no display name, account id or reflect id leaves
      // the backend. The authenticated app resolves the fresh Paired feed.
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(tokens.map((token) => ({
          to: token.expo_push_token,
          title: 'Burrow',
          body: 'A little more of your person’s day is here for you.',
          sound: 'default',
          channelId: 'partner-updates',
        }))),
      })
      if (!response.ok) throw new Error(`expo_push_http_${response.status}`)
      const payload = await response.json()
      const tickets = Array.isArray(payload?.data) ? payload.data : [payload?.data]
      let delivered = false
      for (let index = 0; index < tokens.length; index++) {
        const ticket = tickets[index]
        if (ticket?.status === 'ok') delivered = true
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          await supabase.from('device_push_tokens').update({ enabled: false }).eq('id', tokens[index].id)
        }
      }
      if (!delivered) throw new Error('expo_push_rejected')
      await supabase.from('notification_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), locked_at: null, last_error: null,
      }).eq('id', row.id)
      sent++
    } catch (pushError) {
      await supabase.from('notification_outbox').update({
        status: attempts >= 6 ? 'failed' : 'retry',
        next_attempt_at: retryAt(attempts),
        locked_at: null,
        last_error: String(pushError?.message || pushError).slice(0, 500),
      }).eq('id', row.id)
    }
  }
  return { processed: rows?.length || 0, sent }
}
