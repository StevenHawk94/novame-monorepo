import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareSupabaseClient } from '@/lib/supabase/middleware';
import { isAdminEmail } from '@/lib/auth/admin-emails';

/**
 * Admin auth gate.
 *
 * Runs on every request matched by `config.matcher` below. Refreshes
 * Supabase session, then enforces:
 *   - /             → redirect to /admin
 *   - /admin/login  → if already logged in, redirect to /admin
 *                     else allow (let user log in)
 *   - /admin/*      → require logged-in + email in whitelist,
 *                     else redirect to /admin/login
 *
 * OTP flow: verifyOtp() runs client-side and writes session cookies
 * directly via @supabase/ssr — no callback route is needed.
 */
export async function middleware(request: NextRequest) {
  const { supabase, response } = createMiddlewareSupabaseClient(request);

  // Refresh session — must call getUser() (not getSession()) here so the
  // token is verified against Supabase, not just decoded from cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Root path → bounce to /admin.
  if (pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    return NextResponse.redirect(url);
  }

  // Login page: if already authorized, send to dashboard. Else allow.
  if (pathname === '/admin/login') {
    if (user && isAdminEmail(user.email)) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // /admin and /admin/* — require auth + whitelist.
  if (pathname.startsWith('/admin')) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    if (!isAdminEmail(user.email)) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('error', 'unauthorized');
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static  (Next.js static assets)
     *   - _next/image   (Next.js image optimization)
     *   - favicon.ico, public files (anything with a file extension)
     *
     * This still matches /, /admin, /admin/*.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
