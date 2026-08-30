import {
  ITEM_CATALOG_VERSION,
  isRemoteItemManifest,
  type RemoteItemManifest,
} from '@novame/engine';

import { kRemoteItemManifest } from '../shared/storage/keys';
import { storage } from './storage';

const R2_BASE = 'https://media.novameapp.com';
const listeners = new Set<() => void>();
let fetchInFlight: Promise<RemoteItemManifest | null> | null = null;

function readCached(): RemoteItemManifest | null {
  try {
    const raw = storage.getString(kRemoteItemManifest.name);
    const value = raw ? JSON.parse(raw) : null;
    return isRemoteItemManifest(value) ? value : null;
  } catch {
    return null;
  }
}

let current = readCached();

export function getCachedRemoteItemManifest(): RemoteItemManifest | null {
  return current;
}

export function subscribeRemoteItemManifest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function install(manifest: RemoteItemManifest): void {
  current = manifest;
  storage.set(kRemoteItemManifest.name, JSON.stringify(manifest));
  for (const listener of listeners) listener();
}

export function remoteItemAssetUrl(imageKey: string, assetVersion?: string): string {
  const path = imageKey.split('/').map(encodeURIComponent).join('/');
  const url = `${R2_BASE}/${path}`;
  return assetVersion ? `${url}?v=${encodeURIComponent(assetVersion)}` : url;
}

/** Fetch the immutable manifest selected by content-version.json. */
export function fetchRemoteItemManifest(version: string): Promise<RemoteItemManifest | null> {
  if (!version || version === '0') return Promise.resolve(null);
  if (current?.version === version) return Promise.resolve(current);
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = (async () => {
    try {
      const response = await fetch(`${R2_BASE}/Items/manifests/${encodeURIComponent(version)}.json`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Item manifest HTTP ${response.status}`);
      const value = await response.json() as unknown;
      if (!isRemoteItemManifest(value) || value.version !== version) {
        throw new Error('Invalid item manifest');
      }
      // The overlay can add new IDs across app releases. Replacements are
      // validated by Admin against this base version before publishing.
      if (!value.baseCatalogVersion) value.baseCatalogVersion = ITEM_CATALOG_VERSION;
      install(value);
      return value;
    } catch {
      return current;
    } finally {
      fetchInFlight = null;
    }
  })();
  return fetchInFlight;
}
