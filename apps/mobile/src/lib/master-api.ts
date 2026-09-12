/**
 * Visit Master (Kit 5). Paid-only consultation with a 72h cooldown. Produces no
 * skill / xp / items -- it's a sage's counsel, isolated from the Skills system.
 */
import { ApiError } from '@novame/api-client';

import { kMasterState } from '../shared/storage/keys';
import { apiClient } from './api';
import { confirmCloverAward } from './cosmetics-api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface MasterResponse {
  /** New contract (2026-08-09): four Master sections with original headers. */
  sections?: { header: string; text: string }[];
  /** Legacy visits (pre-sections) keep the old five fields. */
  quote_short?: string;
  insight_full?: string;
  flipped_lens?: string;
  micro_task?: string;
  reflective_question?: string;
}

export interface MasterVisit {
  id: string;
  question: string;
  createdAt: string;
}

export interface MasterStatus {
  isPaid: boolean;
  available: boolean;
  nextAvailableAt: string | null;
  history: MasterVisit[];
}

interface MasterStatusCache {
  version: 2;
  status: MasterStatus;
  fetchedAtMs: number;
}

const EMPTY_STATUS: MasterStatus = {
  isPaid: false,
  available: false,
  nextAvailableAt: null,
  history: [],
};
const MASTER_STATUS_TTL_MS = 15 * 60 * 1000;
const MASTER_COOLDOWN_MS = 72 * 60 * 60 * 1000;
let statusFetchInFlight: Promise<MasterStatus> | null = null;

async function uid(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.user?.id ?? null;
}

function normalizeStatus(status: MasterStatus, now = Date.now()): MasterStatus {
  const nextAvailableAtMs = status.nextAvailableAt
    ? Date.parse(status.nextAvailableAt)
    : Number.NaN;
  if (Number.isFinite(nextAvailableAtMs) && nextAvailableAtMs <= now) {
    return {
      ...status,
      available: status.isPaid,
      nextAvailableAt: null,
    };
  }
  return {
    ...status,
    available: status.isPaid && status.available,
    history: Array.isArray(status.history) ? status.history : [],
  };
}

function readMasterCache(): MasterStatusCache | null {
  const raw = storage.getString(kMasterState.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MasterStatusCache | MasterStatus;
    if ('status' in parsed && parsed.status) {
      return {
        version: 2,
        status: normalizeStatus(parsed.status),
        fetchedAtMs: Number.isFinite(parsed.fetchedAtMs) ? parsed.fetchedAtMs : 0,
      };
    }
    // Backwards-compatible migration from the previous raw MasterStatus.
    return { version: 2, status: normalizeStatus(parsed as MasterStatus), fetchedAtMs: 0 };
  } catch {
    return null;
  }
}

export function getCachedMasterStatus(): MasterStatus {
  return readMasterCache()?.status ?? EMPTY_STATUS;
}

function setCachedMasterStatus(status: MasterStatus, fetchedAtMs = Date.now()): MasterStatus {
  const normalized = normalizeStatus(status);
  storage.set(kMasterState.name, JSON.stringify({
    version: 2,
    status: normalized,
    fetchedAtMs,
  } satisfies MasterStatusCache));
  return normalized;
}

function cacheMasterCooldown(nextAvailableAt: string): MasterStatus {
  const cached = getCachedMasterStatus();
  return setCachedMasterStatus({
    ...cached,
    isPaid: true,
    available: false,
    nextAvailableAt,
  });
}

export function refreshCachedMasterClock(now = Date.now()): MasterStatus {
  const cached = readMasterCache();
  if (!cached) return EMPTY_STATUS;
  const normalized = normalizeStatus(cached.status, now);
  if (
    normalized.available !== cached.status.available
    || normalized.nextAvailableAt !== cached.status.nextAvailableAt
  ) {
    return setCachedMasterStatus(normalized, cached.fetchedAtMs);
  }
  return normalized;
}

export function fetchMasterStatus(options?: { force?: boolean }): Promise<MasterStatus> {
  const cached = readMasterCache();
  if (
    !options?.force
    && cached
    && Date.now() - cached.fetchedAtMs < MASTER_STATUS_TTL_MS
  ) {
    return Promise.resolve(cached.status);
  }
  if (statusFetchInFlight) return statusFetchInFlight;

  const request = (async () => {
    const userId = await uid();
    if (!userId) return getCachedMasterStatus();
    try {
      const data = await apiClient.get<{
        success?: boolean; isPaid?: boolean; available?: boolean;
        nextAvailableAt?: string | null; history?: MasterVisit[];
      }>(`/api/master/status?userId=${encodeURIComponent(userId)}`);
      if (!data.success) return getCachedMasterStatus();
      return setCachedMasterStatus({
        isPaid: !!data.isPaid,
        available: !!data.available,
        nextAvailableAt: data.nextAvailableAt ?? null,
        history: data.history || [],
      });
    } catch {
      // A transient transport failure must never turn a paid/cooldown cache into
      // the old empty Free state. The next TTL/focus pass retries silently.
      return getCachedMasterStatus();
    }
  })().finally(() => {
    if (statusFetchInFlight === request) statusFetchInFlight = null;
  });
  statusFetchInFlight = request;
  return request;
}

export async function askMaster(question: string): Promise<
  { ok: true; response: MasterResponse; xpAwarded: number; status: MasterStatus | null }
  | { ok: false; error: string; nextAvailableAt?: string }
> {
  const userId = await uid();
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{
      success?: boolean; error?: string; response?: MasterResponse; nextAvailableAt?: string;
      visitId?: string; createdAt?: string; xpAwarded?: number;
    }>('/api/master/ask', { userId, question });
    if (data.error) {
      if (data.error === 'on_cooldown' && data.nextAvailableAt) {
        cacheMasterCooldown(data.nextAvailableAt);
      }
      return { ok: false, error: data.error, nextAvailableAt: data.nextAvailableAt };
    }
    if (data.success && data.response) {
      const xpAwarded = data.xpAwarded ?? 0;
      confirmCloverAward(xpAwarded);
      let status: MasterStatus | null = null;
      if (data.visitId && data.createdAt) {
        const cached = getCachedMasterStatus();
        const visit: MasterVisit = { id: data.visitId, question, createdAt: data.createdAt };
        status = setCachedMasterStatus({
          ...cached,
          isPaid: true,
          available: false,
          nextAvailableAt: data.nextAvailableAt
            ?? new Date(Date.parse(data.createdAt) + MASTER_COOLDOWN_MS).toISOString(),
          history: [visit, ...cached.history.filter((entry) => entry.id !== visit.id)].slice(0, 30),
        });
      }
      return { ok: true, response: data.response, xpAwarded, status };
    }
    return { ok: false, error: 'unknown' };
  } catch (error) {
    // ApiClient throws on the endpoint's 4xx/5xx responses. Preserve the
    // server's meaningful cooldown/paywall errors instead of mislabelling every
    // non-2xx response as a network failure.
    const body = error instanceof ApiError && error.body && typeof error.body === 'object'
      ? error.body as { error?: string; nextAvailableAt?: string }
      : null;
    if (body?.error) {
      if (body.error === 'on_cooldown' && body.nextAvailableAt) {
        cacheMasterCooldown(body.nextAvailableAt);
      }
      return { ok: false, error: body.error, nextAvailableAt: body.nextAvailableAt };
    }
    return { ok: false, error: 'network' };
  }
}

export async function fetchMasterVisit(
  id: string,
): Promise<{ question: string; response: MasterResponse; createdAt: string } | null> {
  const userId = await uid();
  if (!userId) return null;
  try {
    const data = await apiClient.get<{
      success?: boolean;
      visit?: { question: string; response: MasterResponse; createdAt: string };
    }>(`/api/master/visit?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`);
    return data.success && data.visit ? data.visit : null;
  } catch {
    return null;
  }
}

/** A friendly "Master is away until ..." label from an ISO timestamp. */
export function cooldownLabel(nextAvailableAt: string | null): string {
  if (!nextAvailableAt) return '';
  const then = new Date(nextAvailableAt);
  const now = Date.now();
  const hrs = Math.max(0, Math.ceil((then.getTime() - now) / (60 * 60 * 1000)));
  if (hrs <= 1) return 'The Master returns within the hour.';
  if (hrs < 24) return `The Master returns in about ${hrs} hours.`;
  const days = Math.ceil(hrs / 24);
  return `The Master returns in about ${days} day${days > 1 ? 's' : ''}.`;
}
