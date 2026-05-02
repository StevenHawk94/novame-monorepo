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

export const apiClient = new ApiClient({
  baseUrl: '',
  getToken: async () => null,
})

// Re-export ApiError so admin code can `import { apiClient, ApiError }`
// from a single module.
export { ApiError } from '@novame/api-client'
