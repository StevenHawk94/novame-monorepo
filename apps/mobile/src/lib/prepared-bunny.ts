import { Image as NativeImage } from 'react-native';
import { Skia, type SkImage } from '@shopify/react-native-skia';
import { OUTFIT_LAYERS, type OutfitKey } from './burrow-outfit-assets';
import {bunnyLayers,type BunnyVariant} from './bunny-variant-assets';
import { normalizeMetroAssetUri } from './metro-asset-uri';
import type { BunnyLayer } from './bunny-idle-motion';

export type BunnySuite = Record<BunnyLayer, SkImage>;
const ready = new Map<string, BunnySuite>();
const pending = new Map<string, Promise<BunnySuite>>();
let queue = Promise.resolve();
/** At most two decoded outfits, not all full-size outfit textures. */
export function prepareBunny(key: OutfitKey,variant:BunnyVariant='biscuit'): Promise<BunnySuite> {
  const cacheKey=`${key}:${variant}:ef9ba3-v2`,layers=bunnyLayers(key,variant);
  const cached = ready.get(cacheKey);
  if (cached) { ready.delete(cacheKey); ready.set(cacheKey, cached); return Promise.resolve(cached); }
  const active = pending.get(cacheKey); if (active) return active;
  const task = queue.then(async () => {
    const images: Partial<BunnySuite> = {};
    try {
      for (const layer of ['tail', 'earLeft', 'earRight', 'body', 'head'] as BunnyLayer[]) {
        const uri = NativeImage.resolveAssetSource(layers[layer])?.uri;
        if (!uri) throw Error(`Missing bundled bunny layer: ${key}/${layer}`);
        const data = await Skia.Data.fromURI(normalizeMetroAssetUri(uri));
        let image: SkImage | null;
        try { image = Skia.Image.MakeImageFromEncoded(data); } finally { data.dispose(); }
        if (!image || image.width() !== 1189 || image.height() !== 1323) {
          image?.dispose(); throw Error(`Invalid full-canvas bunny layer: ${key}/${layer}`);
        }
        images[layer] = image;
      }
      const suite = images as BunnySuite;
      ready.set(cacheKey, suite);
      while (ready.size > 2) ready.delete(ready.keys().next().value!);
      return suite;
    } catch (error) { Object.values(images).forEach(image => image?.dispose()); throw error; }
  }).finally(() => { pending.delete(cacheKey); });
  queue = task.then(() => {}, () => {}); pending.set(cacheKey, task);
  return task;
}
