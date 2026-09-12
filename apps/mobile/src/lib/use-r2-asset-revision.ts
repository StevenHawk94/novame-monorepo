import { useCallback, useSyncExternalStore } from 'react';

import {
  getR2AssetRevision,
  getR2AssetKeyRevision,
  subscribeR2AssetChanges,
  subscribeR2AssetKeyChanges,
} from './download-queue';

/** Re-render remote-image consumers when a background R2 task finishes. */
export function useR2AssetRevision(assetUrl?: string | null): number {
  const key = assetUrl ? `image:${assetUrl}` : null;
  const subscribe = useCallback((listener: () => void) => {
    if (assetUrl === undefined) return subscribeR2AssetChanges(listener);
    if (!key) return () => {};
    return subscribeR2AssetKeyChanges(key, listener);
  }, [assetUrl, key]);
  const getSnapshot = useCallback(() => {
    if (assetUrl === undefined) return getR2AssetRevision();
    return key ? getR2AssetKeyRevision(key) : 0;
  }, [assetUrl, key]);
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}
