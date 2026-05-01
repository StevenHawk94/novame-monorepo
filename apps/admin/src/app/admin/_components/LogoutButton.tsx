'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Logout button — calls supabase.auth.signOut() to clear cookies,
 * then redirects to /admin/login.
 *
 * Replaces the old Visdom localStorage-based "logout" which only
 * cleared a fake auth flag and was trivially bypassable.
 */
export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/admin/login');
      router.refresh();
    } catch {
      // On error, still try to bounce to login. Cookie may be stale
      // but middleware will handle it.
      router.push('/admin/login');
      router.refresh();
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="text-sm text-gray-600 hover:text-black disabled:opacity-50"
    >
      {loading ? 'Signing out...' : 'Logout'}
    </button>
  );
}
