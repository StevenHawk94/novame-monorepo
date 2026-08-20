/**
 * App-wide cache warm-up (2026-07-24 全局缓存优先).
 *
 * Home calls this on focus for only the assets needed by Home itself. Every
 * feature resource owns an independent lazy TTL and singleflight guard; tabs
 * paint their existing cache first and revalidate only when actually opened.
 */
import { getHomeSceneSource } from './scenes';
import { Image as ExpoImage } from 'expo-image';

let lastPrefetchedSceneUri: string | null = null;

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
