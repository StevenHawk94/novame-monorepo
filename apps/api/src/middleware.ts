import { NextRequest, NextResponse } from 'next/server'

/**
 * CORS middleware — applied to all /api/* routes.
 *
 * Mobile app (RN) calls this API from a different origin (capacitor://localhost,
 * file://, or whatever WebView runs as), so we must explicitly allow:
 *   - All origins (`*`) since mobile native has no stable origin
 *   - Credentials NOT allowed (incompatible with `*`); mobile uses Bearer tokens, not cookies
 *   - Common methods + headers used by the app
 *
 * Note: When admin app is added (stage 1.3), we'll either deploy admin separately
 * (different Vercel project, no CORS conflict) OR tighten this to whitelist origins.
 */

// Domains that are allowed to call the API.
// `*` covers mobile native (which has no fixed Origin header).
// Listed origins below are for defense-in-depth and future Admin domain restriction.
const ALLOWED_ORIGINS = [
  '*', // Native mobile (capacitor:// or RN networking)
  'https://novame.app', // Future production web
  'https://api.soulsayit.com', // Self-reference
  'http://localhost:3000', // Admin in dev
  'http://localhost:3001', // API in dev
  'http://localhost:8081', // Expo dev server (Metro)
  'http://localhost:19006', // Expo web (legacy)
]

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
const MAX_AGE = '86400' // 24 hours — browsers cache the preflight response

function corsHeaders(origin: string | null): Record<string, string> {
  // If the request has an Origin header and it's in our allowlist, echo it back.
  // Otherwise fall back to `*` (which means: anyone, but no cookies).
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : '*'

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    // We do NOT set Allow-Credentials because mobile uses Bearer tokens,
    // and `*` origin is incompatible with credentials anyway.
  }
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')

  // ── Handle CORS preflight ──
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204, // No Content
      headers: corsHeaders(origin),
    })
  }

  // ── Pass through, but attach CORS headers to the response ──
  const response = NextResponse.next()
  Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

// Apply only to /api/* paths — don't intercept the health-check page or static assets.
export const config = {
  matcher: '/api/:path*',
}
