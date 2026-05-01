import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware-context Supabase client + session refresh.
 *
 * Wraps every /admin/* request to:
 *   1. Read the session from incoming cookies
 *   2. Refresh the access token if it's about to expire
 *   3. Write any new cookies to the outgoing response
 *
 * Returns { supabase, response }:
 *   - supabase: client for the caller to query (e.g. supabase.auth.getUser())
 *   - response: NextResponse with potentially-updated cookies, must be
 *     either returned as-is or have its cookies copied to your final response
 *
 * Pattern from Supabase official SSR docs (Next.js App Router).
 */
export function createMiddlewareSupabaseClient(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  return { supabase, response };
}
