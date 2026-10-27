import { type ImageRef, type ImageProps } from 'expo-image';
import { Image as NativeImage } from 'react-native';
import { normalizeMetroAssetUri } from './metro-asset-uri';
import { decodeNativeImage } from './native-image-decoder';

type Source = ImageProps['source'];
type Entry = { image: ImageRef; size: number; pixels: number };
const ready = new Map<string, Entry>();
const pending = new Map<string, Promise<ImageRef>>();
let homeKeys = new Set<string>();
let pageKeys = new Set<string>();
let environmentKeys = new Set<string>();
let notificationKeys = new Set<string>();
let giftKeys = new Set<string>();
// A few first viewports + Home, not the full catalogue. A 48 MiB budget
// evicted the earlier warmups while Release's transparent art was decoding.
const MAX_PIXELS = 24 * 1024 * 1024;
export function preparedImageKey(source: Source): string | null {
  const value = typeof source === 'number' ? NativeImage.resolveAssetSource(source) : source;
  if (typeof value === 'string') return normalizeMetroAssetUri(value);
  return value && !Array.isArray(value) && 'uri' in value && typeof value.uri === 'string'
    ? normalizeMetroAssetUri(value.uri) : null;
}
export function preparedBurrowImage(source: Source): ImageRef | undefined {
  const key = preparedImageKey(source), entry = key ? ready.get(key) : null;
  if (!key || !entry) return undefined;
  ready.delete(key); ready.set(key, entry);
  return entry.image;
}
function trim() {
  let pixels = [...ready.values()].reduce((sum, value) => sum + value.pixels, 0);
  for (const [key, value] of ready) {
    if (pixels <= MAX_PIXELS && ready.size <= 64) break;
    if (homeKeys.has(key)||pageKeys.has(key)||environmentKeys.has(key)||notificationKeys.has(key)||giftKeys.has(key)) continue;
    ready.delete(key); pixels -= value.pixels;
    // Views may hold the native ref. Shared-object GC owns its lifetime.
  }
}
export function retainHomeImages(sources: readonly Source[]) {
  homeKeys = new Set(sources.map(preparedImageKey).filter((key): key is string => !!key));
  trim();
}
export function retainPageImages(sources: readonly Source[]) {
  pageKeys=new Set(sources.map(preparedImageKey).filter((key):key is string=>!!key));
  trim();
}
/** The shared Home/map pair must survive unrelated page thumbnail warmups. */
export function retainEnvironmentImages(sources: readonly Source[]) {
  environmentKeys=new Set(sources.map(preparedImageKey).filter((key):key is string=>!!key));
  trim();
}
/** At most one pending journey's first views, not the entire reward catalogue. */
export function retainNotificationImages(sources:readonly Source[]){
  notificationKeys=new Set(sources.map(preparedImageKey).filter((key):key is string=>!!key));trim();
}
export function retainGiftImages(sources:readonly Source[]){
  giftKeys=new Set(sources.map(preparedImageKey).filter((key):key is string=>!!key));trim();
}
/** Native refs are consumed by the real view, not decoded a second time. */
export async function prepareBurrowImage(source: Source, size = 1600): Promise<ImageRef> {
  const key = preparedImageKey(source);
  if (!key) throw new Error('image_source_missing');
  const cached = ready.get(key);
  if (cached && cached.size >= size) return cached.image;
  const active = pending.get(key);
  if (active) { await active; return prepareBurrowImage(source, size); }
  const task = decodeNativeImage({ uri: key }, { maxWidth: size, maxHeight: size }).then(image => {
    ready.set(key, { image, size, pixels: image.width * image.height * image.scale ** 2 });
    trim(); return image;
  }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
  pending.set(key, task);
  return task;
}
/** Bounded concurrency, never decode the entire catalogue at once. */
export async function prepareBurrowImages(sources: readonly Source[], size = 1600) {
  const unique = [...new Map(sources.map(source => [preparedImageKey(source), source])).values()];
  let cursor = 0;
  await Promise.all([0, 1].map(async () => {
    while (cursor < unique.length) await prepareBurrowImage(unique[cursor++], size);
  }));
}
