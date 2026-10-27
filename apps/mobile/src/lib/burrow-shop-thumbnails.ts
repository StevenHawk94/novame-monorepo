import type { MajorUpdateCatalogItem } from './app-major-update-api';
import { burrowArtForItem } from './burrow-art-assets';
import { prepareBurrowImage, preparedBurrowImage } from './prepared-burrow-images';

type Owner = { cancelled: boolean };
export type ArtWarmup = {source: Parameters<typeof prepareBurrowImage>[0];size:number};
type Job = ArtWarmup & { owner: Owner };
let queue: Job[] = [], active = 0;
function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    if (job.owner.cancelled || preparedBurrowImage(job.source)) continue;
    active++;
    void prepareBurrowImage(job.source, job.size).catch(() => {
      // A failed speculative decode must never block scrolling or selection.
    }).finally(() => { active--; drain(); });
  }
}

/** Warm only the current viewport and its neighbours, at original resolution.
 * Shares the bounded image cache with Home; never substitutes a low-res image
 * for the same source later used by the room preview. New flings replace the
 * waiting queue rather than decoding a backlog of categories. */
export function createShopArtWarmer() {
  const owner: Owner = { cancelled: false };
  return {
    warm(images:readonly ArtWarmup[]) {
      owner.cancelled = false;
      queue = [...images.map(image=>({...image,owner})), ...queue.filter(job => job.owner !== owner)];
      drain();
    },
    cancel() { owner.cancelled = true; queue = queue.filter(job => job.owner !== owner); },
  };
}
export function createShopThumbnailWarmer() {
  const worker=createShopArtWarmer();
  return {
    warm(items:readonly MajorUpdateCatalogItem[]) {
      worker.warm(items.flatMap(item => {
        const art = burrowArtForItem(item);
        return art ? [{ source: item.category === 'wallpapers' ? art.thumbnail ?? art.source : art.source,
          size: Math.max(art.width, art.height) }] : [];
      }));
    },
    cancel:worker.cancel,
  };
}
