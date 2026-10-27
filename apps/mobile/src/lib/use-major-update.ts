/**
 * This client ships only Burrow. Keep these compatibility exports for shared
 * callers, but never fetch or honor the retired legacy-UI rollout switch.
 * Server-side feature permissions and old-client APIs remain independent.
 */
import { setHomeEntryExperience } from './home-entry-readiness';

setHomeEntryExperience('burrow');

export function refreshMajorUpdateFlag(_options?: { force?: boolean }): Promise<void> {
  return Promise.resolve();
}

export function useMajorUpdateEnabled(): boolean { return true; }
export function useMajorUpdateReady(): boolean { return true; }
