/** Economic endpoints fail closed on limiter outages; paid receipts stay retryable. */
export async function securityRateLimit(db, request, actor, lane, limit = 60, seconds = 60) {
  const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown'
  const hashed=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip.split(',')[0].trim()))
  const digest=Array.from(new Uint8Array(hashed)).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32)
  const buckets = [`secure:${lane}:user:${actor}`, `secure:${lane}:ip:${digest}`]
  for (const [index, bucket] of buckets.entries()) {
    const { data, error } = await db.rpc('check_rate_limit', {
      p_bucket: bucket, p_limit: index ? limit * 5 : limit, p_window_seconds: seconds,
    })
    if (error || typeof data?.allowed !== 'boolean') throw Object.assign(Error('security_check_unavailable'), { status: 503 })
    if (!data.allowed) throw Object.assign(Error('too_many_requests'), { status: 429, retryAfter: Math.max(1, Math.min(seconds, Number(data.reset_in) || seconds)) })
  }
}

export function securityFailure(error) {
  const status = [400,401,403,409,410,422,429,503].includes(error?.status) ? error.status : 503
  const conflict=status===409&&['purchase_account_conflict','sandbox_account_conflict','production_account_conflict'].includes(error.message)
  return Response.json({ success:false, error:status === 503 ? 'verification_temporarily_unavailable' : error.message,
    ...(conflict?{code:error.message==='purchase_account_conflict'?'PURCHASE_ACCOUNT_CONFLICT':'PURCHASE_ECONOMIC_DOMAIN_CONFLICT'}:{}) }, {
    status, headers:{'Cache-Control':'no-store', ...(status===429?{'Retry-After':String(error.retryAfter||60)}:{})},
  })
}
