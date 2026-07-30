/**
 * Bunny Closet outfits — catalog, equip state, and video cache (2026-07-30).
 *
 * The catalog lives in R2's video-manifest.json under `outfits` and is the
 * single source of truth (name/price/plusOnly + the three asset paths), so
 * the admin can ship new outfits without an app release. Cache-first: the
 * last-fetched catalog renders instantly, a background refresh follows.
 *
 * Asset trio per outfit (R2 keys, spaces intact — URLs are encoded here):
 *   Outfits/<Name>.webp        closet grid thumb
 *   Outfits/<Name>-Bunny.webp  worn preview shown on the closet's top scene
 *   Character Videos/<Name>.mov transparent loop for Home (downloaded to the
 *                               local cache first so looping never stutters)
 *
 * Equip is local-first MMKV like skins (cosmetics-store.ts); ownership stays
 * server-authoritative via cosmetic_unlocks type 'outfit'.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';

import { kEquippedOutfit, kOutfitCatalog } from '../shared/storage/keys';
import { storage } from './storage';
import { fetchSceneCatalog, sceneAssetUrl } from './scenes';

const R2_BASE = 'https://media.novameapp.com';
const MANIFEST_URL = `${R2_BASE}/video-manifest.json`;

export interface OutfitDef {
  key: string;
  name: string;
  price: number;
  plusOnly: boolean;
  /** R2 object keys (may contain spaces — use outfitAssetUrl to load). */
  thumb: string;
  bunny: string;
  video: string;
}

/** Public CDN URL for an R2 object key, segment-encoding spaces etc. */
export function outfitAssetUrl(objectKey: string): string {
  return `${R2_BASE}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

// ---- catalog (cache-first) ----

export function getCachedOutfitCatalog(): OutfitDef[] {
  const raw = storage.getString(kOutfitCatalog.name);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OutfitDef[];
  } catch {
    return [];
  }
}

export async function fetchOutfitCatalog(): Promise<OutfitDef[]> {
  try {
    // Cache-bust: the CDN may hold the manifest for minutes; a fresh catalog
    // matters right after the admin publishes a new outfit.
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`);
    if (!res.ok) return getCachedOutfitCatalog();
    const manifest = (await res.json()) as { outfits?: OutfitDef[] };
    const outfits = Array.isArray(manifest.outfits) ? manifest.outfits : [];
    if (outfits.length > 0) storage.set(kOutfitCatalog.name, JSON.stringify(outfits));
    return outfits.length > 0 ? outfits : getCachedOutfitCatalog();
  } catch {
    return getCachedOutfitCatalog();
  }
}

// ---- equip state (local-first, like skins) ----

export function getEquippedOutfitKey(): string | null {
  return storage.getString(kEquippedOutfit.name) ?? null;
}

export function setEquippedOutfitKey(key: string | null): void {
  if (key) storage.set(kEquippedOutfit.name, key);
  else storage.remove(kEquippedOutfit.name);
}

// ---- home video cache ----
// The loop must never stutter, so Home only ever plays local files: the
// remote .mov is downloaded once into the app cache and referenced by key.

function videoCachePath(key: string): string {
  return `${FileSystem.cacheDirectory}outfit-video-${key}.mov`;
}

/** Local file URI if the outfit's video is already cached, else null. */
export async function getCachedOutfitVideoUri(key: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(videoCachePath(key));
    return info.exists && (info.size ?? 0) > 0 ? info.uri : null;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<string | null>>();

/**
 * Ensure the outfit's video is on disk; resolves to the file URI (or null on
 * failure). Concurrent callers share one download.
 */
export function ensureOutfitVideoCached(outfit: OutfitDef): Promise<string | null> {
  const existing = inflight.get(outfit.key);
  if (existing) return existing;
  const p = (async () => {
    const cached = await getCachedOutfitVideoUri(outfit.key);
    if (cached) return cached;
    try {
      const res = await FileSystem.downloadAsync(
        outfitAssetUrl(outfit.video),
        videoCachePath(outfit.key),
      );
      if (res.status === 200) return res.uri;
      await FileSystem.deleteAsync(videoCachePath(outfit.key), { idempotent: true });
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(outfit.key);
    }
  })();
  inflight.set(outfit.key, p);
  return p;
}

/**
 * Background prefetch, kicked off once per launch from the entry gate
 * (covers onboarding and normal starts alike). Order matches perceived
 * urgency (2026-07-30):
 *   1. all closet images in parallel (~200KB total — thumbs + worn shots)
 *   2. videos sequentially, free outfits before Plus ones
 * so by the time a user opens the closet and switches, the wait modal is
 * a blink instead of a download.
 */
let prefetchStarted = false;

export function prefetchOutfitAssets(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;
  void (async () => {
    try {
      const catalog = await fetchOutfitCatalog();
      // Scene art rides along: thumbs + full backgrounds are all small webp.
      const scenes = await fetchSceneCatalog();
      await Promise.all([
        ...catalog.flatMap((o) => [
          ExpoImage.prefetch(outfitAssetUrl(o.thumb)).catch(() => false),
          ExpoImage.prefetch(outfitAssetUrl(o.bunny)).catch(() => false),
        ]),
        ...scenes.flatMap((s) => [
          ExpoImage.prefetch(sceneAssetUrl(s.thumb)).catch(() => false),
          ExpoImage.prefetch(sceneAssetUrl(s.image)).catch(() => false),
        ]),
      ]);
      const ordered = [
        ...catalog.filter((o) => !o.plusOnly),
        ...catalog.filter((o) => o.plusOnly),
      ];
      for (const o of ordered) {
        await ensureOutfitVideoCached(o);
      }
    } catch {
      // Best-effort warmup; on-demand download covers whatever is missing.
    }
  })();
}

/**
 * Resolve the Home companion video for the currently equipped outfit:
 * local file URI when ready, null → caller stays on the bundled default.
 */
export async function resolveEquippedOutfitVideo(): Promise<{ key: string; uri: string } | null> {
  const key = getEquippedOutfitKey();
  if (!key) return null;
  const outfit =
    getCachedOutfitCatalog().find((o) => o.key === key) ??
    (await fetchOutfitCatalog()).find((o) => o.key === key);
  if (!outfit) return null;
  const uri = await ensureOutfitVideoCached(outfit);
  return uri ? { key, uri } : null;
}
