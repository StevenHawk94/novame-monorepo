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
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const FAILURE_RETRY_DELAY_MS = 5_000;

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
function runContentVersionCheck(allowAutomaticRetry: boolean): Promise<void> {
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    const response = await fetch(`${CONTENT_VERSION_URL}?v=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Content version request failed: ${response.status}`);
    const remote = await response.json() as Partial<ContentVersions>;
    const remoteItems = String(remote.itemsVersion ?? '0');
    const remoteAssets = String(remote.assetsVersion ?? '0');
    const saved = readVersions();
    const next = { ...saved };
    let refreshIncomplete = false;

    if (remoteItems !== '0' && (
      remoteItems !== saved.itemsVersion
      || getCachedRemoteItemManifest()?.version !== remoteItems
    )) {
      const manifest = await fetchRemoteItemManifest(remoteItems);
      if (manifest?.version === remoteItems) {
        stageRemoteItemImages(manifest);
        next.itemsVersion = remoteItems;
      } else {
        refreshIncomplete = true;
      }
    }

    if (remoteAssets !== '0' && remoteAssets !== saved.assetsVersion) {
      try {
        await fetchManifestFromR2({ force: true, requireFresh: true });
        stageLatestManifest();
        next.assetsVersion = remoteAssets;
      } catch {
        // Keep the old pointer and use the same bounded retry policy below.
        refreshIncomplete = true;
      }
    }

    if (
      next.itemsVersion !== saved.itemsVersion
      || next.assetsVersion !== saved.assetsVersion
    ) {
      writeVersions(next);
    }
    if (refreshIncomplete) {
      throw new Error('Content version dependencies did not finish refreshing');
    }
  })().catch(() => {
    // One bounded retry covers a transient launch/offline race. If that also
    // fails, the next real foreground transition starts a fresh retry cycle.
    if (allowAutomaticRetry && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void runContentVersionCheck(false);
      }, FAILURE_RETRY_DELAY_MS);
    }
  }).finally(() => {
    checkInFlight = null;
  });
  return checkInFlight;
}

export function checkContentVersionInBackground(): Promise<void> {
  // A real launch/foreground request supersedes any delayed retry and is
  // itself allowed one retry. Concurrent callers still share one request.
  if (!checkInFlight && retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  return runContentVersionCheck(true);
}
