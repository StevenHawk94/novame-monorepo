import { Platform } from 'react-native';
import * as Application from 'expo-application';

import { apiClient } from './api';

/**
 * Force-update (hard-update) gate -- client side.
 *
 * The server (/api/force-update GET, PUBLIC) returns at most one active row:
 *   { forceUpdate: { min_version, platform, message, ... } | null }
 *
 * This module decides whether the INSTALLED app version is below min_version
 * and the user must be blocked until they update.
 *
 * FAIL-OPEN is the iron rule here. A hard-update screen is full-screen and
 * unescapable; a false positive bricks every user. So EVERY uncertain path --
 * request error/timeout, no active row, missing/invalid min_version,
 * unreadable installed version, platform mismatch -- resolves to "do NOT
 * force update". We only force when we can positively prove current < min.
 */

const REQUEST_TIMEOUT_MS = 4000;

export type ForceUpdateResult = {
  required: boolean;
  message: string | null;
};

const NOT_REQUIRED: ForceUpdateResult = { required: false, message: null };

/**
 * Parse "major.minor.patch" (ignoring any -suffix / build metadata) into a
 * 3-tuple of non-negative integers. Returns null if the string is not a clean
 * numeric semver -- callers treat null as "cannot compare" => fail open.
 */
function parseSemver(v: string | null | undefined): [number, number, number] | null {
  if (!v || typeof v !== 'string') return null;
  // Take the part before any pre-release/build separator, then require exactly
  // three dot-separated integer segments.
  const core = v.trim().split(/[-+]/)[0];
  const m = core.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (![major, minor, patch].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  return [major, minor, patch];
}

/**
 * True iff `current` is strictly below `min` by semver. If EITHER value fails
 * to parse, returns false (fail open -- never force on an unparseable input).
 */
export function isVersionBelow(
  current: string | null | undefined,
  min: string | null | undefined,
): boolean {
  const c = parseSemver(current);
  const m = parseSemver(min);
  if (!c || !m) return false;
  for (let i = 0; i < 3; i++) {
    if (c[i] < m[i]) return true;
    if (c[i] > m[i]) return false;
  }
  return false; // equal => not below
}

type WireResponse = {
  success?: boolean;
  forceUpdate?: {
    min_version?: string | null;
    platform?: string | null;
    message?: string | null;
  } | null;
};

/**
 * Check whether a hard update is required for THIS install. Never throws;
 * always resolves to a ForceUpdateResult. Fails open on every error path.
 */
export async function checkForceUpdate(): Promise<ForceUpdateResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let data: WireResponse;
    try {
      data = await apiClient.get<WireResponse>('/api/force-update', {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const row = data?.forceUpdate;
    if (!row || !row.min_version) return NOT_REQUIRED;

    // Platform filter. 'all' or matching OS only. We only ship iOS today, but
    // honor the field so an 'android' row never blocks iOS and vice versa.
    const platform = (row.platform || 'all').toLowerCase();
    const os = Platform.OS; // 'ios' | 'android' | ...
    if (platform !== 'all' && platform !== os) return NOT_REQUIRED;

    const current = Application.nativeApplicationVersion; // string | null
    if (!isVersionBelow(current, row.min_version)) return NOT_REQUIRED;

    return { required: true, message: row.message ?? null };
  } catch {
    // Any failure (network, abort/timeout, parse) => fail open.
    return NOT_REQUIRED;
  }
}
