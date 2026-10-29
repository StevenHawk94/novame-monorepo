import { ApiClient } from '@novame/api-client';
import { supabase } from './supabase';
import {BUNDLED_SHOP_RELEASE} from './generated/shop-catalog-version';
import {sessionEpoch,sessionUserId} from './session-lifecycle';

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
  headers: {'X-Burrow-Catalog':BUNDLED_SHOP_RELEASE,'X-Burrow-Rooms':'personal-v2','X-Burrow-Journal':'2','X-Burrow-Economy':'1','X-Burrow-Bunny':'1','X-Burrow-Adventure':'5','X-Burrow-Care':'2'},
  getRequestContext:()=>({key:`${sessionEpoch()}:${sessionUserId()??''}`,actorId:sessionUserId()??undefined}),
  getToken: async () => {
    const owner=sessionUserId(),epoch=sessionEpoch();
    // getSession already refreshes expiring credentials. A failed refresh is
    // not a signed-out session: stop here instead of sending a tokenless request.
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error('auth_refresh_failed');
    if(epoch!==sessionEpoch()||(owner&&data.session?.user.id!==owner))throw Error('session_changed');
    return data.session?.access_token ?? null;
  },
});
