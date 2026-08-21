/**
 * Cache-first fetcher for R2's small runtime catalog.
 *
 * Binary downloads are owned by download-queue.ts. This module deliberately
 * contains no retired Cards/Product Assets paths and never blocks a page on a
 * refresh: a valid MMKV catalog paints first, then the shared TTL decides
 * whether one background GET is needed.
 */
import type { AssetManifest } from './asset-types';
import { storage } from './storage';
import {
  kAssetManifest,
  kAssetManifestFetchedAt,
} from '../shared/storage/keys';

const MANIFEST_URL = 'https://media.novameapp.com/video-manifest.json';
const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;
const MANIFEST_RETRY_MS = 5 * 60 * 1000;

let manifestFetchInFlight: Promise<AssetManifest> | null = null;
let lastManifestAttemptAt = 0;

function isRuntimeManifest(value: unknown): value is AssetManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<AssetManifest>;
  return manifest.version === 'v1'
    && typeof manifest.baseUrl === 'string'
    && Array.isArray(manifest.outfits)
    && Array.isArray(manifest.scenes);
}

export function getCachedManifest(): AssetManifest | null {
  const raw = storage.getString(kAssetManifest.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRuntimeManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedManifest(manifest: AssetManifest): void {
  storage.set(kAssetManifest.name, JSON.stringify(manifest));
  storage.set(kAssetManifestFetchedAt.name, String(Date.now()));
}

export async function fetchManifestFromR2(options?: {
  force?: boolean;
  requireFresh?: boolean;
}): Promise<AssetManifest> {
  const cached = getCachedManifest();
  const fetchedAt = Number(storage.getString(kAssetManifestFetchedAt.name) ?? 0);
  const now = Date.now();

  if (
    !options?.force
    && cached
    && Number.isFinite(fetchedAt)
    && now - fetchedAt < MANIFEST_TTL_MS
  ) {
    return cached;
  }
  if (!options?.force && cached && now - lastManifestAttemptAt < MANIFEST_RETRY_MS) {
    return cached;
  }
  if (manifestFetchInFlight) return manifestFetchInFlight;

  lastManifestAttemptAt = now;
  manifestFetchInFlight = (async () => {
    try {
      const version = options?.force ? Date.now() : Math.floor(Date.now() / MANIFEST_TTL_MS);
      const response = await fetch(`${MANIFEST_URL}?v=${version}`, {
        cache: options?.force ? 'no-store' : 'default',
      });
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      const data = await response.json() as unknown;
      if (!isRuntimeManifest(data)) throw new Error('Invalid runtime R2 manifest');
      setCachedManifest(data);
      return data;
    } catch (error) {
      if (cached && !options?.requireFresh) return cached;
      throw error;
    } finally {
      manifestFetchInFlight = null;
    }
  })();
  return manifestFetchInFlight;
}

export async function getActiveManifest(): Promise<AssetManifest> {
  const cached = getCachedManifest();
  if (cached) {
    void fetchManifestFromR2().catch(() => {});
    return cached;
  }
  return fetchManifestFromR2();
}
