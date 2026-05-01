import { redirect } from 'next/navigation';

/**
 * Root path is not a real page in admin app. Middleware should already
 * redirect / → /admin. This server-side redirect is a defensive fallback
 * in case middleware is misconfigured or matcher misses this path.
 */
export default function RootPage() {
  redirect('/admin');
}
