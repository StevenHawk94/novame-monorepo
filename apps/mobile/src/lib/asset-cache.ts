import { Directory, File, Paths } from 'expo-file-system';

import { storage } from './storage';
import type {
  AssetDownloadResult,
  AssetManifest,
  CardManifestEntry,
  VideoManifestEntry,
} from './asset-types';

/**
 * Asset cache for video and card image files served from R2 CDN.
 *
 * Strategy (D-3.3-B-3 = B):
 *   - On startup: read cached manifest from MMKV, do NOT block UI on network.
 *   - In background: fetch fresh manifest, diff, download missing assets.
 *   - Each cached asset persists in {documentDir}/cache/{filename}.
 *
 * Storage layout:
 *   apps/mobile/sandbox/Documents/cache/
 *     char1-outfit1-chill.mp4       (~3 MB, foreground download in onboarding)
 *     char1-outfit1-hungry.mp4
 *     ...
 *     mind-clarity-front.webp        (~50 KB, background download)
 *     ...
 *
 * MMKV keys:
 *   asset-manifest:cached         JSON-serialized AssetManifest (last fetch result)
 *
 * R2 URL: https://media.novameapp.com/video-manifest.json
 */

// ---- constants ----

/**
 * R2 manifest URL. Hardcoded per Q-3.3-B-1 = A (no env var needed,
 * URL is fixed across dev/prod, single source of truth).
 */
const MANIFEST_URL = 'https://media.novameapp.com/video-manifest.json';

/** Subdirectory under document directory where cached assets live. */
const CACHE_SUBDIR = 'cache';

/** MMKV key for cached manifest. */
const STORAGE_KEY_MANIFEST = 'asset-manifest:cached';

// ---- internal helpers ----

/**
 * Returns the Directory instance for the cache subdir, creating it if needed.
 */
function getCacheDir(): Directory {
  const dir = new Directory(Paths.document, CACHE_SUBDIR);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

// ---- manifest fetching ----

/**
 * Fetches the latest manifest from R2.
 *
 * Throws on network error or invalid JSON. Caller should handle errors
 * and fall back to cached manifest.
 */
export async function fetchManifestFromR2(): Promise<AssetManifest> {
  const response = await fetch(MANIFEST_URL, {
    // Bypass HTTP cache to always get fresh manifest from R2.
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Manifest fetch failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as AssetManifest;
  if (data.version !== 'v1') {
    throw new Error(`Manifest version mismatch: expected v1, got ${data.version}`);
  }
  return data;
}

/**
 * Reads cached manifest from MMKV. Returns null if no cache exists or
 * the cached value is corrupt.
 */
export function getCachedManifest(): AssetManifest | null {
  const raw = storage.getString(STORAGE_KEY_MANIFEST);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AssetManifest;
  } catch {
    return null;
  }
}

/**
 * Writes manifest to MMKV cache.
 */
export function setCachedManifest(manifest: AssetManifest): void {
  storage.set(STORAGE_KEY_MANIFEST, JSON.stringify(manifest));
}

// ---- per-asset cache ops ----

/**
 * Returns the local file:// URI for a cached asset, or null if not cached.
 *
 * Used by VideoCharacter and card render components: pass through to
 * <VideoView> / <Image source> when the asset is cached, otherwise show
 * a placeholder.
 */
export function getCachedAssetUri(filename: string): string | null {
  const file = new File(Paths.document, CACHE_SUBDIR, filename);
  return file.exists ? file.uri : null;
}

/**
 * Verifies a cached file matches the expected size from manifest.
 *
 * Used to detect partial / corrupt downloads. If size mismatch, the file
 * is deleted so the next download attempt starts fresh.
 */
export function verifyCachedAsset(filename: string, expectedSize: number): boolean {
  const file = new File(Paths.document, CACHE_SUBDIR, filename);
  if (!file.exists) return false;
  if (file.size !== expectedSize) {
    file.delete();
    return false;
  }
  return true;
}

/**
 * Downloads a single asset to the cache directory.
 *
 * Returns the local file:// URI on success. Throws on download failure.
 *
 * The destination File is constructed deterministically from the filename
 * — same filename always lands at the same path, allowing idempotent
 * re-downloads after failure.
 */
export async function downloadAsset(
  baseUrl: string,
  filename: string,
): Promise<string> {
  const url = `${baseUrl}/${filename}`;
  const destination = new File(Paths.document, CACHE_SUBDIR, filename);
  // Ensure parent directory exists before download.
  getCacheDir();
  // Delete partial file if any (avoid append/race issues).
  if (destination.exists) {
    destination.delete();
  }
  const result = await File.downloadFileAsync(url, destination);
  return result.uri;
}

// ---- batch downloads ----

/**
 * Builds the list of asset filenames to download, with verification of
 * existing cached files.
 *
 * Returns filenames that are missing or corrupt (size mismatch). Caller
 * passes this list to downloadAssets.
 */
export function diffCacheAgainstManifest(
  manifest: AssetManifest,
  filter?: { videos?: boolean; cards?: boolean },
): string[] {
  const includeVideos = filter?.videos ?? true;
  const includeCards = filter?.cards ?? true;
  const missing: string[] = [];
  const checkEntry = (entry: VideoManifestEntry | CardManifestEntry) => {
    if (!verifyCachedAsset(entry.filename, entry.size)) {
      missing.push(entry.filename);
    }
  };
  if (includeVideos) {
    manifest.videos.forEach(checkEntry);
  }
  if (includeCards) {
    manifest.cards.forEach(checkEntry);
  }
  return missing;
}

/**
 * Downloads a batch of assets sequentially, calling onProgress after each.
 *
 * Sequential (not parallel) by design:
 *   - Avoids overwhelming R2 / user network bandwidth.
 *   - Keeps memory pressure low (one fetch buffer at a time).
 *   - Progress reporting is straightforward (n/total).
 *
 * For onboarding foreground downloads (3 outfit-1 videos), sequential
 * total is ~3-5 seconds on Wi-Fi, which is fine.
 *
 * For background fill (15 remaining videos + 52 cards = 67 items), total
 * is 30-90 seconds depending on network — also acceptable since user
 * does not directly wait.
 */
export async function downloadAssets(
  baseUrl: string,
  filenames: string[],
  onProgress?: (done: number, total: number, lastResult: AssetDownloadResult) => void,
): Promise<AssetDownloadResult[]> {
  const results: AssetDownloadResult[] = [];
  for (let i = 0; i < filenames.length; i++) {
    const filename = filenames[i];
    let result: AssetDownloadResult;
    try {
      const uri = await downloadAsset(baseUrl, filename);
      result = { filename, status: 'cached', uri };
    } catch (error) {
      result = {
        filename,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    onProgress?.(i + 1, filenames.length, result);
  }
  return results;
}

// ---- high-level orchestration (used by onboarding flow / app launch) ----

/**
 * Returns the manifest to use for this session.
 *
 * Order of preference:
 *   1. Cached manifest (instant, no network) — used as baseline.
 *   2. Fresh manifest from R2 (async, in background) — replaces cache when arrives.
 *
 * The startup path (returns cached, kicks off network refresh in background)
 * gives near-zero startup latency while still keeping content fresh.
 *
 * If neither cached nor R2 manifest is available (first launch + offline),
 * throws — caller should show an offline error UI.
 */
export async function getActiveManifest(): Promise<AssetManifest> {
  const cached = getCachedManifest();
  if (cached) {
    // Kick off background refresh, don't await.
    fetchManifestFromR2()
      .then((fresh) => {
        setCachedManifest(fresh);
      })
      .catch(() => {
        // Network error during background refresh is expected (offline,
        // R2 hiccup) — keep using the cached manifest.
      });
    return cached;
  }
  // No cache — first launch path. Must wait for network.
  const fresh = await fetchManifestFromR2();
  setCachedManifest(fresh);
  return fresh;
}
