/**
 * App-wide cache warm-up (2026-07-24 全局缓存优先).
 *
 * Home calls this on focus for its own selected scene plus a bounded set of
 * item icons already named by the Memories/Paired caches. Feature data keeps
 * its independent lazy TTL and revalidates only when that tab is opened.
 */
import { getHomeSceneSource } from './scenes';
import { Image as ExpoImage } from 'expo-image';
import { Platform } from 'react-native';
import { BACKGROUNDS } from './icons';
import { getCachedBags } from './bags-api';
import { getCachedFriendFeedPage, type FeedEntry } from './friends-api';
import { prewarmItemIcons } from './item-icon-prewarm';

let lastPrefetchedSceneUri: string | null = null;
type LoadedImage = Awaited<ReturnType<typeof ExpoImage.loadAsync>>;
const warmedEntryBackgrounds: LoadedImage[] = [];
let entryBackgroundWarmRequest: Promise<void> | null = null;
const MEMORIES_FIRST_VIEW_ICON_LIMIT = 18;
const PAIRED_FIRST_VIEW_CARD_LIMIT = 2;
const PAIRED_FIRST_VIEW_ICON_LIMIT = 18;
const OFFSCREEN_ENTRY_ICON_PRIORITY = -200;

export function prewarmPairedFeedItemIcons(
  friendFeed: readonly FeedEntry[],
  options?: { allowBeforeAndroidUi?: boolean; deadlineMs?: number },
) {
  const itemIds = friendFeed
    .slice(0, PAIRED_FIRST_VIEW_CARD_LIMIT)
    .flatMap((entry) => entry.itemIds);
  return prewarmItemIcons(itemIds, {
    allowBeforeAndroidUi: options?.allowBeforeAndroidUi,
    deadlineMs: options?.deadlineMs,
    maxIcons: PAIRED_FIRST_VIEW_ICON_LIMIT,
    priority: options?.deadlineMs ? -500 : OFFSCREEN_ENTRY_ICON_PRIORITY,
  });
}

/**
 * Warm only the first useful viewport of offscreen collection tabs. This is
 * deliberately non-blocking: Home owns launch readiness, while Memories and
 * Paired use the time under/after the cover to make the next tap instantaneous.
 */
export function prewarmCachedTabItemIcons(
  friendFeed: readonly FeedEntry[] = getCachedFriendFeedPage().feed,
  options?: { allowBeforeAndroidUi?: boolean },
): void {
  const memories = getCachedBags()
    .slice(0, MEMORIES_FIRST_VIEW_ICON_LIMIT)
    .map((item) => item.itemId);
  void prewarmItemIcons(memories, {
    allowBeforeAndroidUi: options?.allowBeforeAndroidUi,
    maxIcons: MEMORIES_FIRST_VIEW_ICON_LIMIT,
    priority: OFFSCREEN_ENTRY_ICON_PRIORITY,
  });
  void prewarmPairedFeedItemIcons(friendFeed, options);
}

/**
 * Decode the two high-frequency bundled entry backgrounds as soon as the JS
 * root starts. Keeping the ImageRefs alive prevents a cold first navigation
 * from waiting on image decode; this is deliberately limited to Thump/Reflect
 * rather than warming the full bundled catalog.
 */
export function warmEntryBackgrounds(): Promise<void> {
  if (entryBackgroundWarmRequest) return entryBackgroundWarmRequest;
  // On Android, bundled Metro assets are already local resources and render
  // directly from the mounted view; no imperative pre-decode is required.
  // Calling Image.loadAsync with a numeric require() source is unsafe under
  // full-mode R8 (the native SourceMap converter can reject the bridged map),
  // so let the mounted Image perform the decode instead. Keep the iOS warm-up
  // unchanged because it is stable there and remains useful for navigation.
  if (Platform.OS === 'android') {
    entryBackgroundWarmRequest = Promise.resolve();
    return entryBackgroundWarmRequest;
  }
  entryBackgroundWarmRequest = Promise.allSettled(
    [BACKGROUNDS.court, BACKGROUNDS.reflect].map(async (source) => {
      const image = await ExpoImage.loadAsync(source);
      warmedEntryBackgrounds.push(image);
    }),
  ).then(() => undefined);
  return entryBackgroundWarmRequest;
}

export function prefetchAppData(): void {
  // Cache-only tab warm-up: this never fetches Bags/Friends data and never
  // walks their history. Each screen still owns its normal TTL reconciliation.
  prewarmCachedTabItemIcons();

  // Selected Home scene background (remote scenes only — bundled default is a number).
  // Android's selected R2 scene is already promoted by Home and written by
  // the file-only queue. Imperative prefetch here would decode it a second
  // time and reintroduce the memory spike this pipeline avoids.
  if (Platform.OS === 'android') return;
  const sceneSrc = getHomeSceneSource();
  if (typeof sceneSrc === 'object' && sceneSrc.uri && sceneSrc.uri !== lastPrefetchedSceneUri) {
    lastPrefetchedSceneUri = sceneSrc.uri;
    void ExpoImage.prefetch(sceneSrc.uri);
  }
}
