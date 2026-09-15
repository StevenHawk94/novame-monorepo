import { ITEM_IMAGES } from './item-images.g';
import { TAP_PERSON_IMAGES } from './tap-person-images';
import { baseItemIconUrl } from './base-item-icons';
import { remoteImageUri } from './remote-items';
import { ensurePriorityR2Image } from './download-queue';

export type ItemIconPrewarmResult = {
  requested: number;
  ready: number;
  timedOut: boolean;
};

type PrewarmOptions = {
  /** Zero or omitted waits for the bounded queue to settle normally. */
  deadlineMs?: number;
  /** Used only by the launch cover, before Android exposes the first frame. */
  allowBeforeAndroidUi?: boolean;
  maxIcons?: number;
  priority?: number;
};

/** Mirrors ItemSprite's source precedence without mounting or decoding a tile. */
function remoteUrlForItem(itemId: string): string {
  const bundled = TAP_PERSON_IMAGES[itemId] ?? ITEM_IMAGES[itemId];
  return remoteImageUri(itemId) || (!bundled ? baseItemIconUrl(itemId) : '');
}

/**
 * Persist a small, user-visible set of item icons through the shared R2 queue.
 * A deadline releases the caller only; queued work keeps running so a later
 * Memories/Paired navigation can still hit disk cache.
 */
export async function prewarmItemIcons(
  itemIds: readonly string[],
  options?: PrewarmOptions,
): Promise<ItemIconPrewarmResult> {
  const maxIcons = Math.max(0, options?.maxIcons ?? itemIds.length);
  const urls = [...new Set(itemIds.map(remoteUrlForItem).filter(Boolean))].slice(0, maxIcons);
  if (urls.length === 0) return { requested: 0, ready: 0, timedOut: false };

  let ready = 0;
  const completion = Promise.all(urls.map(async (url) => {
    const localUri = await ensurePriorityR2Image(url, options?.priority, {
      allowBeforeAndroidUi: options?.allowBeforeAndroidUi,
    }).catch(() => null);
    if (localUri) ready += 1;
  }));

  const deadlineMs = options?.deadlineMs ?? 0;
  if (deadlineMs <= 0) {
    await completion;
    return { requested: urls.length, ready, timedOut: false };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = await Promise.race([
    completion.then(() => false),
    new Promise<true>((resolve) => {
      timer = setTimeout(() => resolve(true), deadlineMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return { requested: urls.length, ready, timedOut };
}
