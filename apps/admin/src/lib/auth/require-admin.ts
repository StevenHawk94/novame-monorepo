import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/auth/admin-emails';

/**
 * Admin authentication guard for API route handlers.
 *
 * Defense-in-depth — middleware.ts gates /admin/* page routes, but
 * /api/admin/* routes are also matched by middleware. This helper adds
 * an explicit per-handler check so each endpoint fails closed even if
 * middleware is bypassed or misconfigured.
 *
 * Usage in a route.js file:
 *
 *   import { requireAdmin } from '@/lib/auth/require-admin';
 *
 *   export async function GET() {
 *     const auth = await requireAdmin();
 *     if (auth.error) return auth.error;
 *     // ...your handler logic, auth.user is the verified admin
 *   }
 *
 * Returns:
 *   - { user, error: null } on success — proceed with the handler
 *   - { user: null, error: NextResponse } on failure — return error directly
 */
export async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      user: null,
      error: NextResponse.json(
        { error: 'Unauthorized', reason: 'no_session' },
        { status: 401 }
      ),
    };
  }

  if (!isAdminEmail(user.email)) {
    return {
      user: null,
      error: NextResponse.json(
        { error: 'Forbidden', reason: 'not_in_whitelist' },
        { status: 403 }
      ),
    };
  }

  return { user, error: null };
}
