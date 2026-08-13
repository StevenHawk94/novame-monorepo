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
import { fetchFriendFeed, fetchFriends } from './friends-api';
import { fetchQuestStatus } from './quests-api';
import { refreshRemoteItems } from './remote-items';
import { getHomeSceneSource } from './scenes';
import { Image as ExpoImage } from 'expo-image';
import { fetchReflectFeed } from './reflect-feed-api';

const THROTTLE_MS = 60_000;
let lastRun = 0;

export function prefetchAppData(): void {
  const now = Date.now();
  if (now - lastRun < THROTTLE_MS) return;
  lastRun = now;
  void refreshRemoteItems();
  // Selected Home scene background (remote scenes only — bundled default is a number).
  const sceneSrc = getHomeSceneSource();
  if (typeof sceneSrc === 'object' && sceneSrc.uri) void ExpoImage.prefetch(sceneSrc.uri);
  void fetchBags();
  void fetchReflectFeed();
  void fetchFriends();
  void fetchFriendFeed();
  void fetchQuestStatus();
  void fetchCosmetics();
}
