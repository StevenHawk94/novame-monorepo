/**
 * App-wide cache warm-up (2026-07-24 全局缓存优先).
 *
 * Home calls this on focus: every tab's data is fetched ONCE in the
 * background so switching tabs paints instantly from cache and the focus
 * revalidation becomes a silent refresh instead of a cold load. Throttled so
 * bouncing through Home doesn't hammer the API; every call is fire-and-forget
 * and each lib already falls back to its stale cache on failure.
 */
import { fetchBags } from './bags-api';
import { fetchCosmetics } from './cosmetics-api';
import { fetchFriendFeed, fetchFriends, fetchPairing } from './friends-api';
import { fetchQuestStatus } from './quests-api';
import { fetchReflectFeed } from './reflect-feed-api';

const THROTTLE_MS = 60_000;
let lastRun = 0;

export function prefetchAppData(): void {
  const now = Date.now();
  if (now - lastRun < THROTTLE_MS) return;
  lastRun = now;
  void fetchBags();
  void fetchReflectFeed();
  void fetchFriends();
  void fetchFriendFeed();
  void fetchPairing();
  void fetchQuestStatus();
  void fetchCosmetics();
}
