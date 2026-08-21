import { useSyncExternalStore } from 'react';

import {
  getR2AssetRevision,
  subscribeR2AssetChanges,
} from './download-queue';

/** Re-render remote-image consumers when a background R2 task finishes. */
export function useR2AssetRevision(): number {
  return useSyncExternalStore(
    subscribeR2AssetChanges,
    getR2AssetRevision,
    getR2AssetRevision,
  );
}
