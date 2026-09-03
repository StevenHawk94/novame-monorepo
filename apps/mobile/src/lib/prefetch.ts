/**
 * App-wide cache warm-up (2026-07-24 全局缓存优先).
 *
 * Home calls this on focus for only the assets needed by Home itself. Every
 * feature resource owns an independent lazy TTL and singleflight guard; tabs
 * paint their existing cache first and revalidate only when actually opened.
 */
import { getHomeSceneSource } from './scenes';
import { Image as ExpoImage } from 'expo-image';
import { BACKGROUNDS } from './icons';

let lastPrefetchedSceneUri: string | null = null;
type LoadedImage = Awaited<ReturnType<typeof ExpoImage.loadAsync>>;
const warmedEntryBackgrounds: LoadedImage[] = [];
let entryBackgroundWarmRequest: Promise<void> | null = null;

/**
 * Decode the two high-frequency bundled entry backgrounds as soon as the JS
 * root starts. Keeping the ImageRefs alive prevents a cold first navigation
 * from waiting on WebP decode; this is deliberately limited to Focus/Reflect
 * rather than warming the full bundled catalog.
 */
export function warmEntryBackgrounds(): Promise<void> {
  if (entryBackgroundWarmRequest) return entryBackgroundWarmRequest;
  entryBackgroundWarmRequest = Promise.allSettled(
    [BACKGROUNDS.focus, BACKGROUNDS.reflect].map(async (source) => {
      const image = await ExpoImage.loadAsync(source);
      warmedEntryBackgrounds.push(image);
    }),
  ).then(() => undefined);
  return entryBackgroundWarmRequest;
}

export function prefetchAppData(): void {
  // Home-light prefetch only. Bags, logs, friends, quests and cosmetics are
  // intentionally omitted: their screens paint from cache and lazily ask
  // their own resource to revalidate when the user actually opens them.
  // Selected Home scene background (remote scenes only — bundled default is a number).
  const sceneSrc = getHomeSceneSource();
  if (typeof sceneSrc === 'object' && sceneSrc.uri && sceneSrc.uri !== lastPrefetchedSceneUri) {
    lastPrefetchedSceneUri = sceneSrc.uri;
    void ExpoImage.prefetch(sceneSrc.uri);
  }
}
