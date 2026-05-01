import { createClient } from '@supabase/supabase-js';

/**
 * Admin Supabase client (service-role, bypasses RLS).
 *
 * Used ONLY in server-side admin route handlers (e.g. /api/admin/*) for
 * operations that need to read/write across all users — listing every
 * user, updating any order, deleting default cards, etc.
 *
 * SECURITY: Never import this in a Client Component. The service-role
 * key would leak to the browser and grant database-wide write access.
 *
 * RLS is disabled for this client; rely on the route handler's auth
 * check (verifyAdminEmail) to gate access instead.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
