import { Directory, File, Paths } from 'expo-file-system';

import { storage } from './storage';
import type {
  AssetDownloadResult,
  AssetManifest,
  CardManifestEntry,
  ProductAssetManifestEntry,
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
 * Card filenames used on onboarding step 8.
 *
 * These two assets must be on the user's device before they reach
 * step 8, or the FlippableCard renders its placeholder (purple bg
 * with a star) instead of the real card art — which feels broken.
 *
 * Onboarding step 1 awaits the download of these (along with the
 * outfit-1 videos) before launching the background fill of the
 * remaining 50 cards + outfit-2..6 videos. See
 * apps/mobile/app/(onboarding)/index.tsx.
 */
export const STEP_8_CARDS = [
  'action-initiative-front.webp',
  'action-back.webp',
] as const;


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
    const parsed = JSON.parse(raw) as AssetManifest;
    // Staleness guard: a cached manifest from before the dir-aware
    // migration carries no `dir` on its entries. Treat such a
    // structurally-old cache as absent so callers fetch a fresh one
    // (which has dir) instead of resolving every folder asset to the
    // bucket root. Any future R2 re-org that repoints dirs rides the
    // same refresh path. Probe the first video entry: post-migration
    // dir is always present (even '' for root), so dir===undefined
    // means the whole cache predates the migration.
    const firstVideo = parsed.videos?.[0];
    if (firstVideo && firstVideo.dir === undefined) return null;
    return parsed;
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
/**
 * Builds a full asset URL from baseUrl + R2 directory prefix + bare filename.
 * `dir` is the folder the file physically lives in on R2 ('' = bucket root).
 * Every path segment is encodeURIComponent'd so folders with spaces
 * (e.g. 'cards art', 'product details') become %20-escaped.
 */
export function buildAssetUrl(
  baseUrl: string,
  dir: string | undefined,
  filename: string,
): string {
  const segs = (dir ? dir.split('/') : []).concat(filename);
  return `${baseUrl}/${segs.map(encodeURIComponent).join('/')}`;
}

/**
 * Resolves the R2 directory prefix for a bare filename by looking it up
 * in the cached manifest (videos / cards / productAssets). Returns '' if
 * not found (treated as bucket root) so callers degrade safely when the
 * cached manifest predates the dir field or the filename is unknown.
 */
export function dirForFilename(filename: string): string {
  const m = getCachedManifest();
  if (!m) return '';
  const hit =
    m.videos?.find((v) => v.filename === filename) ??
    m.cards?.find((c) => c.filename === filename) ??
    m.productAssets?.find((p) => p.filename === filename);
  return hit?.dir ?? '';
}

export async function downloadAsset(
  baseUrl: string,
  filename: string,
): Promise<string> {
  const url = buildAssetUrl(baseUrl, dirForFilename(filename), filename);
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

// ---- product asset cache: versioned filenames ----

/**
 * Computes the local cache filename for a productAsset, embedding
 * the manifest updatedAt timestamp.
 *
 * Stage B6 fix: pure size-based cache busting fails when the new
 * content happens to have the same byte size as the old (admin re-
 * uploads the same file, or two different webp encodings collide on
 * size). updatedAt-derived filenames guarantee that any manifest
 * change produces a new local filename, forcing a fresh download.
 *
 * R2 always serves at a stable key (book-cover.webp) -- only the
 * local cache filename is versioned. Cleanup of stale versions
 * happens at fill time in fillProductAssets.
 *
 * Example: filename='book-cover.webp' updatedAt='2026-05-24T16:04:32.057Z'
 *   -> 'book-cover-v20260524T160432057Z.webp'
 */
export function productCacheFilename(asset: ProductAssetManifestEntry): string {
  const lastDot = asset.filename.lastIndexOf('.');
  const base = lastDot >= 0 ? asset.filename.slice(0, lastDot) : asset.filename;
  const ext = lastDot >= 0 ? asset.filename.slice(lastDot) : '';
  // Strip all separators from ISO 8601 to make a filesystem-safe tag.
  const tag = asset.updatedAt.replace(/[-:.Z]/g, '');
  return `${base}-v${tag}${ext}`;
}

/**
 * Download a single productAsset to its versioned cache filename.
 *
 * R2 URL keeps the stable filename (admin doesn't write versioned
 * keys to R2); we just point the local download destination at the
 * versioned name.
 */
export async function downloadProductAsset(
  baseUrl: string,
  asset: ProductAssetManifestEntry,
): Promise<AssetDownloadResult> {
  // Stage B6 hardening: append ?v={updatedAt-tag} to the download URL.
  // R2 is fronted by Cloudflare with cache-control: max-age=14400
  // on objects, so the bare URL can return a 1-hour-stale edge copy
  // even after admin re-uploads. The version tag makes each upload's
  // download URL unique, forcing CDN MISS -> origin fetch.
  const versionTag = asset.updatedAt.replace(/[-:.Z]/g, '');
  const url = `${buildAssetUrl(baseUrl, asset.dir, asset.filename)}?v=${versionTag}`;
  const localName = productCacheFilename(asset);
  const destination = new File(Paths.document, CACHE_SUBDIR, localName);
  getCacheDir();
  if (destination.exists) {
    destination.delete();
  }
  try {
    const result = await File.downloadFileAsync(url, destination);
    return { filename: localName, status: 'cached', uri: result.uri };
  } catch (error) {
    return {
      filename: localName,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  filter?: { videos?: boolean; cards?: boolean; productAssets?: boolean },
): string[] {
  const includeVideos = filter?.videos ?? true;
  const includeCards = filter?.cards ?? true;
  const includeProductAssets = filter?.productAssets ?? true;
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
  // productAssets use versioned local filenames keyed by updatedAt
  // (Stage B6 size-collision fix). Defense in depth:
  //   - filename version mismatch (file missing): obvious cache miss.
  //   - filename matches but byte size differs: previous download
  //     received a stale CDN edge cache copy. Delete + redownload.
  if (includeProductAssets && manifest.productAssets) {
    manifest.productAssets.forEach((entry) => {
      const localName = productCacheFilename(entry);
      const file = new File(Paths.document, CACHE_SUBDIR, localName);
      if (!file.exists) {
        missing.push(localName);
        return;
      }
      if (file.size !== entry.size) {
        file.delete();
        missing.push(localName);
      }
    });
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

// ---- product-assets helpers (Stage B) ----

/**
 * Returns the URI for a product asset by its admin-side id.
 *
 * Behavior (Stage B policy β):
 *   - Cache hit:  file:// URI to the locally cached binary.
 *   - Cache miss: remote https://media.novameapp.com URL.
 *   - Unknown id (not in manifest): remote URL fallback using id as-is
 *     filename pattern -- this should not happen in production but
 *     keeps the function total to avoid undefined hazards in render code.
 *
 * The caller never needs to branch on cache state -- expo-image
 * handles both file:// and https:// transparently. After the
 * fillProductAssets() background download lands, subsequent calls
 * for the same id will return file:// URIs.
 */
export function getProductAssetUri(id: string): string {
  const manifest = getCachedManifest();
  const entry = manifest?.productAssets?.find((a) => a.id === id);
  if (!entry) {
    // Unknown id -- fallback assumes id pattern 'product-X-Y' maps to
    // filename 'X-Y.webp'. This is a defensive last-resort that should
    // not trip in production because the admin manifest is authoritative.
    const guessFilename = id.replace(/^product-/, '') + '.webp';
    const base = manifest?.baseUrl ?? 'https://media.novameapp.com';
    return `${base}/${guessFilename}`;
  }
  // Cache hit: look up the versioned local filename. The version tag
  // is derived from updatedAt, so any admin re-upload produces a new
  // expected filename and a new cache miss until fillProductAssets
  // downloads the new content (Stage B6 size-collision fix).
  const localName = productCacheFilename(entry);
  const cached = getCachedAssetUri(localName);
  if (cached) return cached;
  // Cache miss (first launch / cache cleared / fresh manifest entry):
  // return remote URL with ?v={updatedAt-tag} so any HTTP / expo-image
  // / browser cache layer treats each version as a distinct URL. The
  // updatedAt tag (not raw size) survives size collisions.
  const base = manifest?.baseUrl ?? 'https://media.novameapp.com';
  const versionTag = entry.updatedAt.replace(/[-:.Z]/g, '');
  return `${buildAssetUrl(base, entry.dir, entry.filename)}?v=${versionTag}`;
}

/**
 * Returns a complete expo-image source object for a product asset,
 * including both the uri (resolved by getProductAssetUri) and a
 * cacheKey that invalidates expo-image's internal cache on content
 * change.
 *
 * Stage B6 final fix: testing revealed that expo-image's internal
 * cache (Glide on Android, SDWebImage on iOS) does NOT invalidate
 * purely on uri string change for file:// URIs in some edge cases --
 * the previous file path was already present in cache and served
 * stale bytes even after our asset-cache layer wrote new content.
 *
 * The cacheKey prop is expo-image's official mechanism for forcing
 * cache invalidation (per github.com/expo/expo discussion #36940).
 * We embed the updatedAt tag, so any admin re-upload produces a new
 * cacheKey and forces expo-image to load from source.
 *
 * The 'v2-' prefix is a one-time invalidation token: existing users
 * upgrading from the previous code path may have stale entries cached
 * under bare versioned URI keys; with v2- prefixed cacheKeys those
 * old entries become unreachable and a fresh load happens.
 *
 * Consumers should ALSO set cachePolicy="none" on the <Image> to
 * skip expo-image's cache entirely (we already have our own
 * asset-cache layer, expo-image's cache is redundant + a known bug
 * source). This gives defense in depth: cacheKey handles the cache-
 * aware path, cachePolicy="none" handles any path that ignores
 * cacheKey.
 */
export function getProductAssetSource(id: string): {
  uri: string;
  cacheKey: string;
} {
  const manifest = getCachedManifest();
  const entry = manifest?.productAssets?.find((a) => a.id === id);
  const tag = entry ? entry.updatedAt.replace(/[-:.Z]/g, '') : 'unknown';
  const cacheKey = `v2-${id}-${tag}`;
  const uri = getProductAssetUri(id);
  return { uri, cacheKey };
}

/**
 * Fires off a background download of all product assets not yet cached.
 *
 * Returns immediately -- caller does not await. Errors are logged and
 * swallowed; the user-facing image flow tolerates download failure
 * (expo-image falls back to remote URL via getProductAssetUri).
 *
 * Designed to be called from _layout.tsx cold-start mount so every
 * user (not just new onboarding users) gets their product asset cache
 * populated. Cheap to call repeatedly -- diff against manifest skips
 * already-cached items.
 */
export function fillProductAssets(): void {
  void (async () => {
    try {
      let manifest: AssetManifest;
      try {
        manifest = await fetchManifestFromR2();
        setCachedManifest(manifest);
      } catch {
        const cached = getCachedManifest();
        if (!cached) return;
        manifest = cached;
      }

      // Stage B6: cleanup of stale versioned product asset files.
      // After admin uploads, the productCacheFilename of each asset
      // changes (updatedAt tag changes). The old file with the
      // previous tag stays on disk forever otherwise -- cache grows
      // unboundedly across many re-uploads. We list the cache dir,
      // find anything matching the versioned-product pattern that
      // is NOT in the current valid set, and delete it.
      try {
        const validNames = new Set(
          (manifest.productAssets || []).map(productCacheFilename),
        );
        // Build set of original (non-versioned) productAsset filenames
        // so we can also delete pre-B6 cache entries (book-cover.webp,
        // cards-cover.webp, etc.). These were created by the original
        // B5 download code path before filename versioning landed and
        // would otherwise stay on disk forever, wasting ~530KB.
        const productOriginalNames = new Set(
          (manifest.productAssets || []).map((a) => a.filename),
        );
        const productBaseNames = (manifest.productAssets || []).map((a) => {
          const lastDot = a.filename.lastIndexOf('.');
          return lastDot >= 0 ? a.filename.slice(0, lastDot) : a.filename;
        });
        const dir = getCacheDir();
        const entries = dir.list();
        for (const item of entries) {
          if (!(item instanceof File)) continue;
          const name = item.uri.split('/').pop();
          if (!name) continue;
          // Stale versioned file (matches '{base}-v...' but not current
          // valid tag)?
          const isStaleVersioned =
            productBaseNames.some((base) => name.startsWith(`${base}-v`)) &&
            !validNames.has(name);
          // Pre-B6 non-versioned file? (e.g. 'cards-cover.webp')
          const isLegacyNonVersioned = productOriginalNames.has(name);
          if (isStaleVersioned || isLegacyNonVersioned) {
            item.delete();
          }
        }
      } catch {
        // Cleanup is best-effort; failure does not block downloads.
      }

      const missingProductAssets = (manifest.productAssets || []).filter(
        (a) => {
          const localName = productCacheFilename(a);
          const file = new File(Paths.document, CACHE_SUBDIR, localName);
          if (!file.exists) return true;
          if (file.size !== a.size) {
            file.delete();
            return true;
          }
          return false;
        },
      );
      if (missingProductAssets.length === 0) return;

      for (const asset of missingProductAssets) {
        await downloadProductAsset(manifest.baseUrl, asset);
      }
    } catch (e) {
      console.warn('[asset-cache] fillProductAssets failed:', e);
    }
  })();
}
