// src/app/api/auth/apple-callback/route.js
//
// Apple Sign-In callback for Android
//
// Flow:
// 1. User authorizes on Apple's web page
// 2. Apple POSTs { code, id_token, state } to this endpoint
// 3. We verify the id_token with Apple's public keys
// 4. We use Supabase Admin to sign in/create the user
// 5. We redirect to com.novame.app://callback#access_token=xxx&refresh_token=yyy
//    (Android deep link catches this and completes login in the app)

import { createClient } from '@supabase/supabase-js'
import * as jose from 'jose'

// ⚡️ 声明此路由使用 Edge 运行时 (解决 Cloudflare 部署报错)
export const runtime = 'edge';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_DEEP_LINK = 'com.novame.app://callback'

export async function POST(request) {
  try {
    // Apple sends form-encoded POST data
    const formData = await request.formData()
    const code = formData.get('code')
    const idToken = formData.get('id_token')
    const state = formData.get('state')
    const userDataStr = formData.get('user') // Only sent on first authorization

    if (!idToken) {
      return redirectWithError('No id_token received from Apple')
    }

    // ── Step 1: Verify Apple's id_token ──
    // Fetch Apple's public keys
    const JWKS = jose.createRemoteJWKSet(
      new URL('https://appleid.apple.com/auth/keys')
    )

    let payload
    try {
      const { payload: verified } = await jose.jwtVerify(idToken, JWKS, {
        issuer: 'https://appleid.apple.com',
        audience: 'com.novame.app.auth', // Service ID
      })
      payload = verified
    } catch (verifyErr) {
      return redirectWithError('Apple token verification failed: ' + verifyErr.message)
    }

    const appleUserId = payload.sub
    const email = payload.email
    const emailVerified = payload.email_verified

    if (!appleUserId) {
      return redirectWithError('No user ID in Apple token')
    }

    // ── Step 2: Parse user name (only available on first auth) ──
    let firstName = ''
    let lastName = ''
    if (userDataStr) {
      try {
        const userData = JSON.parse(userDataStr)
        firstName = userData?.name?.firstName || ''
        lastName = userData?.name?.lastName || ''
      } catch {}
    }

    // ── Step 3: Sign in via Supabase using the Apple id_token ──
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    // Use signInWithIdToken — Supabase verifies the Apple token and creates/finds the user
    // We need a client-side Supabase instance for this
    const { createClient: createBrowserClient } = await import('@supabase/supabase-js')
    const anonClient = createBrowserClient(
      SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const { data, error } = await anonClient.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce: '', // Apple web flow doesn't use nonce
    })

    if (error) {
      return redirectWithError('Supabase auth failed: ' + error.message)
    }

    if (!data.session) {
      return redirectWithError('No session returned from Supabase')
    }

    // ── Step 4: Redirect to app with session tokens ──
    const accessToken = data.session.access_token
    const refreshToken = data.session.refresh_token

    const redirectUrl = `${APP_DEEP_LINK}#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&token_type=bearer`

    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Cache-Control': 'no-store',
      },
    })

  } catch (err) {
    console.error('[Apple Callback] Unexpected error:', err)
    return redirectWithError('Unexpected error: ' + err.message)
  }
}

// Also handle GET in case of redirect-based flows
export async function GET(request) {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  if (error) {
    return redirectWithError(error)
  }
  return new Response('Apple Sign-In callback. This endpoint expects a POST request from Apple.', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function redirectWithError(message) {
  const redirectUrl = `${APP_DEEP_LINK}?error=${encodeURIComponent(message)}`
  return new Response(null, {
    status: 302,
    headers: {
      'Location': redirectUrl,
      'Cache-Control': 'no-store',
    },
  })
}