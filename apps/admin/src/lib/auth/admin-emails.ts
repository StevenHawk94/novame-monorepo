/**
 * Admin email whitelist verification.
 *
 * Reads ADMIN_EMAILS from env (comma-separated) and checks if a given
 * email is in the list. Used by:
 *   - middleware.ts (gate /admin routes)
 *   - app/admin/layout.tsx (server-side double check)
 *   - app/api/admin/* route handlers (per-request authorization)
 *
 * Returns false on any input edge case (empty email, missing env, etc.)
 * — fail closed.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return false;

  const whitelist = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (whitelist.length === 0) return false;

  return whitelist.includes(email.trim().toLowerCase());
}
