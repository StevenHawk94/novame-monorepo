import { NextRequest, NextResponse } from 'next/server'

/**
 * CORS middleware — applied to all /api/* routes.
 *
 * Mobile app (RN) is a NATIVE client: its fetches carry no Origin header and
 * are not subject to CORS at all, so it needs no allowance here. CORS only
 * governs BROWSER contexts, and for those we run a strict allowlist:
 *   - Origin in allowlist → echo it back (grant)
 *   - Origin not in allowlist / unknown → no Access-Control-Allow-Origin
 *     header at all (browser blocks the read) — previously this fell back to
 *     `*`, which made the allowlist decorative; that hole is closed.
 *   - Credentials are never allowed; auth is Bearer-token only.
 *
 * Extra browser origins (e.g. the deployed Admin domain) can be added without
 * a code change via the CORS_ALLOWED_ORIGINS env var (comma-separated).
 */
const ALLOWED_ORIGINS = [
  'https://novame.app', // Future production web
  'https://api.soulsayit.com', // Self-reference
  'http://localhost:3000', // Admin in dev
  'http://localhost:3001', // API in dev
  'http://localhost:8081', // Expo dev server (Metro)
  'http://localhost:19006', // Expo web (legacy)
  ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
]

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
const MAX_AGE = '86400' // 24 hours — browsers cache the preflight response

function corsHeaders(origin: string | null): Record<string, string> {
  // Only grant CORS to allowlisted browser origins. Requests without an
  // Origin header (native mobile, server-to-server webhooks, curl) are not
  // subject to CORS, so they get no headers and are unaffected. Disallowed
  // origins get no Access-Control-Allow-Origin — the browser blocks the read.
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return {}
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Vary': 'Origin', // per-origin grant — keep caches from cross-serving it
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    // We do NOT set Allow-Credentials — auth is Bearer-token only, no cookies.
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
