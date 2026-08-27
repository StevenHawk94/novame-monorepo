import { useSyncExternalStore } from 'react';

import { getHomeEntryState, subscribeHomeEntry } from './home-entry-readiness';

export function useHomeEntry() {
  return useSyncExternalStore(subscribeHomeEntry, getHomeEntryState, getHomeEntryState);
}
