/**
 * Admin's ApiClient singleton.
 *
 * Admin uses cookie-based session auth (Supabase SSR), so getToken
 * returns null — the browser sends cookies automatically with same-
 * origin fetch requests.
 *
 * baseUrl is empty (same-origin). Cross-app endpoints (/api/orders,
 * /api/force-update, /api/generate-abc-cards) are transparently
 * proxied to apps/api via next.config.js rewrites.
 */

import { ApiClient } from '@novame/api-client'
import { createClient } from '@/lib/supabase/client'

// Lazily-created, memoized browser Supabase client.
//
// Instantiate lazily (inside getToken), NOT at module scope: createBrowserClient
// touches document.cookie, so a module-scope call would crash if this module is
// ever evaluated during SSR. Memoizing also avoids the "Multiple GoTrueClient
// instances" warning from repeated createClient() calls.
let _supabase: ReturnType<typeof createClient> | null = null
function getBrowserSupabase() {
  if (!_supabase) _supabase = createClient()
  return _supabase
}

export const apiClient = new ApiClient({
  baseUrl: '',
  // Admin auth is cookie-based (Supabase SSR). But the cross-app endpoints
  // /api/orders, /api/force-update, /api/generate-abc-cards are reverse-proxied
  // to apps/api via next.config.js rewrites(), and apps/api verifies identity
  // from an Authorization: Bearer <jwt> header -- it cannot read admin cookies.
  // So read the signed-in admin's access_token from the browser session and
  // attach it as a Bearer. Next.js config rewrites forward request headers
  // transparently to the external destination, so the token reaches apps/api.
  // Local /api/admin/* routes ignore this header (they re-verify via
  // requireAdmin() against the cookie session), so it is harmless there.
  getToken: async () => {
    try {
      const { data } = await getBrowserSupabase().auth.getSession()
      return data.session?.access_token ?? null
    } catch {
      return null
    }
  },
})

// Re-export ApiError so admin code can `import { apiClient, ApiError }`
// from a single module.
export { ApiError } from '@novame/api-client'
