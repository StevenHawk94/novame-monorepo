/**
 * apps/api/src/lib/rate-limit.js
 *
 * Postgres-backed fixed-window rate limiter (serverless instances are
 * stateless, so the counter lives in the DB via the check_rate_limit RPC,
 * migration 20260807000035). Fail-OPEN: if the RPC errors we allow the
 * request rather than lock users out on a DB hiccup — the limiter is an
 * abuse backstop, not an auth gate.
 *
 *   const rl = await rateLimit(supabase, `support:${ip}`, 3, 3600)
 *   if (!rl.allowed) return tooMany(rl.resetIn)
 */
export async function rateLimit(supabase, bucket, limit, windowSeconds) {
  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error || !data) return { allowed: true, count: 0, resetIn: 0 };
    return { allowed: !!data.allowed, count: data.count ?? 0, resetIn: data.reset_in ?? 0 };
  } catch {
    return { allowed: true, count: 0, resetIn: 0 };
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}
