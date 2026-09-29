import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { fetchAppConfig, getCachedConfig } from './app-config-api';
import { setHomeEntryExperience } from './home-entry-readiness';
import { sessionEpoch, subscribeSessionIdentity } from './session-lifecycle';

let enabled = getCachedConfig().app_major_update_enabled;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let request: Promise<void> | null = null;
function publish(next: boolean) {
  enabled = next;
  setHomeEntryExperience(next ? 'burrow' : 'legacy');
  listeners.forEach(listener => listener());
}
subscribeSessionIdentity(() => publish(false));
setHomeEntryExperience(enabled ? 'burrow' : 'legacy');

export function refreshMajorUpdateFlag() {
  if (request) return request;
  const epoch = sessionEpoch();
  request = fetchAppConfig({ noCache: true }).then(result => {
    if (epoch === sessionEpoch() && result.kind === 'success') publish(result.config.app_major_update_enabled);
  }).finally(() => { request = null; });
  return request;
}

export function useMajorUpdateEnabled() {
  const value = useSyncExternalStore(subscribe, () => enabled, () => false);
  useEffect(() => {
    void refreshMajorUpdateFlag();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void refreshMajorUpdateFlag(); });
    return () => sub.remove();
  }, []);
  return value;
}
