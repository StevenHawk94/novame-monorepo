import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { fetchAppConfig, getCachedConfig, hasCachedConfig } from './app-config-api';
import { setHomeEntryExperience } from './home-entry-readiness';
import { sessionEpoch } from './session-lifecycle';

let enabled = getCachedConfig().app_major_update_enabled;
// A cached `false` may be a stale pre-rollout value. Confirm it before ever
// rendering the legacy app; a cached `true` can paint Burrow immediately.
let resolved = enabled && hasCachedConfig();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let request: Promise<void> | null = null;
function publish(next: boolean) {
  enabled = next;
  resolved = true;
  setHomeEntryExperience(next ? 'burrow' : 'legacy');
  listeners.forEach(listener => listener());
}
// Rollout is app-wide, not user-scoped. Auth hydration must not reset the flag
// to false and briefly paint the old Home before the config request finishes.
setHomeEntryExperience(enabled ? 'burrow' : 'legacy');

export function refreshMajorUpdateFlag({ force = false }: { force?: boolean } = {}) {
  if (request) return request;
  const epoch = sessionEpoch();
  request = fetchAppConfig({ noCache: force }).then(result => {
    if (epoch === sessionEpoch() && result.kind === 'success') publish(result.config.app_major_update_enabled);
    else if (epoch === sessionEpoch() && !resolved) publish(getCachedConfig().app_major_update_enabled);
  }).finally(() => {
    request = null;
    // Auth may hydrate while the first request is in flight. Its response is
    // deliberately discarded above; retry for the now-current session.
    if (epoch !== sessionEpoch()) void refreshMajorUpdateFlag();
  });
  return request;
}

export function useMajorUpdateEnabled() {
  const value = useSyncExternalStore(subscribe, () => enabled, () => false);
  useEffect(() => {
    void refreshMajorUpdateFlag();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void refreshMajorUpdateFlag({ force: true }); });
    return () => sub.remove();
  }, []);
  return value;
}

/** Keep legacy UI hidden on a first load until the rollout decision settles. */
export function useMajorUpdateReady() {
  const value = useSyncExternalStore(subscribe, () => resolved, () => false);
  useEffect(() => { if (!value) void refreshMajorUpdateFlag(); }, [value]);
  return value;
}
