import { kLastGlobalRefreshMs } from '../shared/storage/keys';
import { storage } from './storage';

const DAY_MS = 24 * 60 * 60 * 1000;
let captured = false;
let openedAt = Date.now();
let inactivityMs = 0;

/** Capture the previous-use gap before cold-start prewarm overwrites its stamp. */
export function captureAnalysisLaunchInactivity(): void {
  if (captured) return;
  captured = true;
  openedAt = Date.now();
  const raw = storage.getString(kLastGlobalRefreshMs.name);
  const previous = raw ? Number(raw) : 0;
  inactivityMs = Number.isFinite(previous) && previous > 0 ? Math.max(0, openedAt - previous) : 0;
}

/** Force once after a long absence; a successful post-launch fetch consumes it. */
export function shouldResumeAfterAbsence(days: number, lastFetchedAt = 0): boolean {
  return inactivityMs >= days * DAY_MS && lastFetchedAt < openedAt;
}

export const ANALYSIS_WEEK_MS = 7 * DAY_MS;
