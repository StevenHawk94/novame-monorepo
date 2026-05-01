import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/auth/admin-emails';
import LogoutButton from './_components/LogoutButton';

export const metadata = {
  title: 'NovaMe Admin',
  description: 'Internal management dashboard',
};

/**
 * Admin layout — wraps every page under /admin/*.
 *
 * Defense-in-depth: middleware.ts already gates these routes, but
 * we re-check here at render time as a second line of protection
 * (in case middleware matcher misconfiguration or a regression).
 *
 * Note: /admin/login does NOT use this layout — it lives under the same
 * URL prefix but is rendered by app/admin/login/page.tsx with its own
 * minimal shell. Next.js still applies layouts to /admin/login though,
 * so this layout's auth check would block the login page itself. To
 * avoid that, we explicitly skip the redirect for users who are simply
 * not logged in (let middleware decide), and only redirect logged-in
 * users whose email isn't in the whitelist.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If logged in but email not in whitelist, force them out.
  // (Not-logged-in case is handled by middleware redirecting to /login.)
  if (user && !isAdminEmail(user.email)) {
    redirect('/admin/login?error=unauthorized');
  }

  // If we somehow got here without a user (shouldn't happen if middleware
  // is configured correctly), let middleware handle it on next request.
  // We render anyway — middleware is the source of truth.

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-lg font-bold text-black">NovaMe Admin</h1>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 hidden sm:inline">
                {user.email}
              </span>
              <LogoutButton />
            </div>
          )}
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 py-6">{children}</div>
    </div>
  );
}
