import { fetchManifestFromR2 } from './asset-cache';
import { stageLatestManifest, stageRemoteItemImages } from './download-queue';
import { fetchRemoteItemManifest } from './item-manifest-cache';
import { getCachedRemoteItemManifest } from './item-manifest-cache';
import { storage } from './storage';
import { kContentVersions } from '../shared/storage/keys';

const CONTENT_VERSION_URL = 'https://media.novameapp.com/content-version.json';

type ContentVersions = {
  itemsVersion: string;
  assetsVersion: string;
};

let checkInFlight: Promise<void> | null = null;

function readVersions(): ContentVersions {
  try {
    const raw = storage.getString(kContentVersions.name);
    const parsed = raw ? JSON.parse(raw) as Partial<ContentVersions> : null;
    return {
      itemsVersion: String(parsed?.itemsVersion ?? '0'),
      assetsVersion: String(parsed?.assetsVersion ?? '0'),
    };
  } catch {
    return { itemsVersion: '0', assetsVersion: '0' };
  }
}

function writeVersions(versions: ContentVersions): void {
  storage.set(kContentVersions.name, JSON.stringify(versions));
}

/**
 * A tiny, fail-silent launch probe. Callers deliberately do not await it:
 * changed catalogs are staged in the background while cached/bundled content
 * renders immediately. The existing six-hour lazy TTL remains the fallback.
 */
export function checkContentVersionInBackground(): Promise<void> {
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    try {
      const response = await fetch(`${CONTENT_VERSION_URL}?v=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const remote = await response.json() as Partial<ContentVersions>;
      const remoteItems = String(remote.itemsVersion ?? '0');
      const remoteAssets = String(remote.assetsVersion ?? '0');
      const saved = readVersions();
      const next = { ...saved };

      if (remoteItems !== '0' && (
        remoteItems !== saved.itemsVersion
        || getCachedRemoteItemManifest()?.version !== remoteItems
      )) {
        const manifest = await fetchRemoteItemManifest(remoteItems);
        if (manifest?.version === remoteItems) {
          stageRemoteItemImages(manifest);
          next.itemsVersion = remoteItems;
        }
      }

      if (remoteAssets !== '0' && remoteAssets !== saved.assetsVersion) {
        try {
          await fetchManifestFromR2({ force: true, requireFresh: true });
          stageLatestManifest();
          next.assetsVersion = remoteAssets;
        } catch {
          // Keep the old pointer so the next launch retries.
        }
      }

      if (
        next.itemsVersion !== saved.itemsVersion
        || next.assetsVersion !== saved.assetsVersion
      ) {
        writeVersions(next);
      }
    } catch {
      // Offline, malformed pointer, or R2 outage: lazy TTL paths still work.
    }
  })().finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}
