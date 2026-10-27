import {SYSTEM_NOTIFICATION_TYPES,systemNotificationCopy} from './system-notification-copy.mjs'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

const retryAt = (attempts) => new Date(
  Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000,
).toISOString()

export async function drainPushNotificationOutbox(supabase, limit = 50) {
  const now = new Date().toISOString()
  // A serverless invocation can be interrupted after claiming a row. Recover
  // stale claims so no partner update remains permanently stuck in `sending`.
  const staleLock = new Date(Date.now() - 10 * 60_000).toISOString()
  const recovery = supabase.from('notification_outbox').update({
    status: 'retry', next_attempt_at: now, locked_at: null,
    last_error: 'stale_delivery_claim_recovered',
  }).eq('status', 'sending').lt('locked_at', staleLock).in('event_type',SYSTEM_NOTIFICATION_TYPES)
  await recovery
  const pending = supabase.from('notification_outbox')
    .select('*').in('status', ['pending', 'retry']).lte('next_attempt_at', now).in('event_type',SYSTEM_NOTIFICATION_TYPES)
  const { data: rows, error } = await pending.order('created_at', { ascending: true }).limit(limit)
  if (error) throw error
  let sent = 0
  for (const row of rows || []) {
    if(!SYSTEM_NOTIFICATION_TYPES.includes(row.event_type))continue
    const attempts = Number(row.attempts || 0) + 1
    const { data: claimed } = await supabase.from('notification_outbox')
      .update({ status: 'sending', attempts, locked_at: now }).eq('id', row.id)
      .in('status', ['pending', 'retry']).select('id').maybeSingle()
    if (!claimed) continue
    try {
      const context=await supabase.rpc('system_notification_context_v1',{p_user:row.recipient_user_id,p_type:row.event_type,p_payload:row.payload??{}})
      if(context.error)throw context.error
      if(row.event_type==='game_invite'&&row.payload?.nudge===true){
        const eligible=await supabase.rpc('burrow_game_nudge_eligible_v1',{p_user:row.recipient_user_id,p_session:row.payload.sessionId})
        if(eligible.error)throw eligible.error
        if(!eligible.data)context.data={...context.data,allowed:false}
      }
      if(!context.data?.allowed||(row.expires_at&&Date.parse(row.expires_at)<=Date.now())){
        await supabase.from('notification_outbox').update({status:'failed',last_error:'notification_no_longer_eligible',locked_at:null}).eq('id',row.id)
        continue
      }
      let tokenQuery=supabase.from('device_push_tokens')
        .select('id,expo_push_token,platform').eq('user_id', row.recipient_user_id).eq('enabled', true)
      if(!['game_ready','game_invite'].includes(row.event_type))tokenQuery=tokenQuery.gte('notification_version',2)
      if(row.event_type==='adventure_reminder')tokenQuery=tokenQuery.eq('adventure_reminder_enabled',true)
      if(row.event_type==='adventure_invite')tokenQuery=tokenQuery.gte('adventure_version',5)
      if(row.event_type==='plushie_touch')tokenQuery=tokenQuery.gte('plushie_touch_version',context.data?.touchVersion===2?2:1)
      const {data:tokens,error:tokenError}=await tokenQuery
      if (tokenError) throw tokenError
      if (!tokens?.length) {
        await supabase.from('notification_outbox').update({
          status: attempts >= 6 ? 'failed' : 'retry',
          next_attempt_at: retryAt(attempts),
          locked_at: null,
          last_error: 'no_registered_device',
        }).eq('id', row.id)
        continue
      }
      const copy=systemNotificationCopy(row.event_type,row.payload,context.data.partnerName)
      const visibleMessages = tokens.map((token) => ({
        to: token.expo_push_token,
        title:copy.title,body:copy.body,
        sound: 'default',
        channelId: row.event_type==='adventure_reminder'?'daily-reminders-v2':'partner-updates',
        data:copy.data,
        ...(row.expires_at?{ttl:Math.max(1,Math.floor((Date.parse(row.expires_at)-Date.now())/1000))}:{}),
      }))
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(visibleMessages),
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
