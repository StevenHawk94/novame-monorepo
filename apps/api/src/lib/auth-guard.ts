/**
 * Local JWT verification for authenticated API routes.
 *
 * Replaces `supabase.auth.getUser(token)` -- a network round-trip to Supabase
 * on every request -- with local signature verification against Supabase's
 * published JWKS. The keys are ES256 (asymmetric), fetched once and cached by
 * createRemoteJWKSet (~10 min), so steady-state verification touches no network
 * at all. This closes audit item P1-3 across the twelve surviving routes.
 *
 * The tradeoff, chosen deliberately (decision: option a, all routes local):
 * local verification cannot see revocation. A token that Supabase has since
 * invalidated -- user deleted, banned, signed out -- stays valid here until it
 * expires on its own, up to its natural TTL (~1h). getUser() would have caught
 * that immediately. For read routes this is a non-issue; for delete-account it
 * is an informed risk, not an oversight (see the note there).
 *
 * Availability: if the JWKS endpoint is unreachable, jwtVerify throws and every
 * verify returns null -> 401, exactly as a failed getUser() did. But the JWKS
 * cache means this path is HARDER to hit than the old per-request network call,
 * not easier.
 *
 * `algorithms: ['ES256']` is load-bearing, not decoration: without it, a token
 * signed HS256 with the public key as the HMAC secret would verify -- the
 * classic JWT algorithm-confusion attack. Pinning the algorithm blocks it.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!SUPABASE_URL) {
  // Fail at module load, not per-request: a missing URL is a deploy error.
  throw new Error('[auth-guard] NEXT_PUBLIC_SUPABASE_URL is not set')
}

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
)

/**
 * Verify a bearer token locally. Returns { id } on success -- shaped to match
 * the `.id` the routes already read off the Supabase user object, so callers
 * change one line, not their checks -- or null on any failure.
 */
export async function verifyToken(token: string | null | undefined): Promise<{ id: string } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, JWKS, { algorithms: ['ES256'] })
    return payload.sub ? { id: payload.sub } : null
  } catch {
    return null
  }
}
