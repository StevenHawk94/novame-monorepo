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
 *   Character Videos/<Name>.mov         iOS transparent loop for Home
 *   Character Videos-Android/<Name>.webp Android animated-alpha loop for Home
 * Both video formats are downloaded to a platform-specific local cache first,
 * and a device never downloads the other platform's format.
 *
 * Equip is local-first MMKV like skins (cosmetics-store.ts); ownership stays
 * server-authoritative via cosmetic_unlocks type 'outfit'.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { kEquippedOutfit, kOutfitCatalog } from '../shared/storage/keys';
import { storage } from './storage';
import { fetchManifestFromR2 } from './asset-cache';

const R2_BASE = 'https://media.novameapp.com';

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

export async function fetchOutfitCatalog(options?: { force?: boolean }): Promise<OutfitDef[]> {
  try {
    const manifest = await fetchManifestFromR2(options);
    const outfits = Array.isArray(manifest?.outfits)
      ? manifest.outfits as OutfitDef[]
      : [];
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
// remote platform-specific video is downloaded once into the app cache.

const VIDEO_PLATFORM = Platform.OS === 'android' ? 'android' : 'ios';
const VIDEO_EXTENSION = Platform.OS === 'android' ? 'webp' : 'mov';

/**
 * The manifest's `video` field remains the canonical iOS object key so old and
 * newly published catalogs stay compatible. Android mirrors the same basename
 * in its own R2 folder with a .webp extension.
 */
function outfitVideoObjectKey(outfit: OutfitDef): string {
  if (Platform.OS !== 'android') return outfit.video;
  const filename = outfit.video.split('/').pop() || `${outfit.name}.mov`;
  const basename = filename.replace(/\.mov$/i, '');
  return `Character Videos-Android/${basename}.webp`;
}

function videoCachePath(key: string): string {
  return `${FileSystem.cacheDirectory}outfit-video-${VIDEO_PLATFORM}-${key}.${VIDEO_EXTENSION}`;
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
  const inflightKey = `${VIDEO_PLATFORM}:${outfit.key}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;
  const p = (async () => {
    const cached = await getCachedOutfitVideoUri(outfit.key);
    if (cached) return cached;
    try {
      const res = await FileSystem.downloadAsync(
        outfitAssetUrl(outfitVideoObjectKey(outfit)),
        videoCachePath(outfit.key),
      );
      if (res.status === 200) return res.uri;
      await FileSystem.deleteAsync(videoCachePath(outfit.key), { idempotent: true });
      return null;
    } catch {
      return null;
    } finally {
      inflight.delete(inflightKey);
    }
  })();
  inflight.set(inflightKey, p);
  return p;
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
