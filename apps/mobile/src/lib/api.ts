import { ApiClient } from '@novame/api-client';
import { supabase } from './supabase';

/**
 * ApiClient singleton for @novame/mobile.
 *
 * Wraps @novame/api-client with:
 *   - baseUrl from EXPO_PUBLIC_API_URL
 *   - getToken pulling from Supabase auth session
 *
 * Single instance shared across the app (D8 decision A — module-level
 * singleton, not React context). Token resolution happens fresh on
 * every request, so login/logout state is always reflected.
 */

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiBaseUrl) {
  throw new Error(
    'Missing EXPO_PUBLIC_API_URL. Set it in apps/mobile/.env or via ' +
    'your shell before running expo start. Production should point ' +
    'to the deployed apps/api Vercel URL.'
  );
}

export const apiClient = new ApiClient({
  baseUrl: apiBaseUrl,
  getToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
