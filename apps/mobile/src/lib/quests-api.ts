/**
 * Weekly Quests -- active plan status (cache-first, like the other reads).
 * No active plan -> the picker renders a theme list; an active plan -> the
 * 7-day checklist. Plan creation / check-off / custom AI generation land in
 * later steps.
 */
import { kQuestCustomGeneration, kQuestStatus } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface QuestTask {
  text: string;
  reward: number;
  done: boolean;
  done_date: string | null;
}

export interface ActiveQuestPlan {
  id: string;
  themeKey: string;
  title: string;
  scope: 'self' | 'friend';
  tasks: QuestTask[];
  day: number;
  checkedCount: number;
  checkedToday: boolean;
  bonusPaid: boolean;
}

export interface QuestStatus {
  active: boolean;
  plan?: ActiveQuestPlan;
}

interface QuestStatusCache {
  state: QuestStatus;
  fetchedAtMs: number;
  localDate: string;
}

const QUEST_STATUS_TTL_MS = 15 * 60 * 1000;
let statusInflight: Promise<QuestStatus> | null = null;

function todayLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function readStatusCache(): QuestStatusCache | null {
  const raw = storage.getString(kQuestStatus.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as QuestStatusCache | QuestStatus;
    if ('state' in parsed && parsed.state) return parsed as QuestStatusCache;
    // Backward-compatible migration from the previous raw QuestStatus cache.
    return { state: parsed as QuestStatus, fetchedAtMs: 0, localDate: '' };
  } catch {
    return null;
  }
}

export function getCachedStatus(): QuestStatus {
  return readStatusCache()?.state ?? { active: false };
}

export function fetchQuestStatus(options?: { force?: boolean }): Promise<QuestStatus> {
  const cached = readStatusCache();
  const localDate = todayLocal();
  if (
    !options?.force &&
    cached &&
    cached.localDate === localDate &&
    Date.now() - cached.fetchedAtMs < QUEST_STATUS_TTL_MS
  ) {
    return Promise.resolve(cached.state);
  }
  if (statusInflight) return statusInflight;

  statusInflight = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return getCachedStatus();
    try {
      const data = await apiClient.get<{ success?: boolean; active?: boolean; plan?: ActiveQuestPlan }>(
        `/api/quests/status?userId=${encodeURIComponent(userId)}&localDate=${localDate}`,
      );
      if (!data.success) return getCachedStatus();
      const state: QuestStatus = { active: !!data.active, plan: data.plan };
      const next: QuestStatusCache = { state, fetchedAtMs: Date.now(), localDate };
      storage.set(kQuestStatus.name, JSON.stringify(next));
      return state;
    } catch {
      return getCachedStatus();
    } finally {
      statusInflight = null;
    }
  })();
  return statusInflight;
}


export type StartResult =
  | { ok: true; planId: string }
  | { ok: false; error: 'already_active' | 'no_tasks' | 'network' };

/** Commit a 7-day plan from the chosen tasks. Server enforces one active plan. */
export async function startPlan(themeKey: string, title: string, tasks: string[]): Promise<StartResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string; planId?: string }>(
      '/api/quests/start',
      { userId, themeKey, title, tasks, localDate: todayLocal() },
    );
    if (data.success && data.planId) return { ok: true, planId: data.planId };
    if (data.error === 'already_active' || data.error === 'no_tasks') return { ok: false, error: data.error };
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}


export type CheckResult =
  | { ok: true; reward: number; bonus: number; allDone: boolean; cloversEarned: number; checkedCount: number }
  | { ok: false; error: 'already_checked_today' | 'already_done' | 'no_active_plan' | 'network' };

/** Check off one task (one per calendar day). Server pays clovers + any bonus. */
export async function checkTask(taskIndex: number): Promise<CheckResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const data = await apiClient.post<{
      success?: boolean; error?: string; reward?: number; bonus?: number;
      allDone?: boolean; cloversEarned?: number; checkedCount?: number;
    }>('/api/quests/check', { userId, taskIndex, localDate: todayLocal() });
    if (data.success) {
      return {
        ok: true, reward: data.reward ?? 0, bonus: data.bonus ?? 0,
        allDone: !!data.allDone, cloversEarned: data.cloversEarned ?? 0, checkedCount: data.checkedCount ?? 0,
      };
    }
    const e = data.error;
    if (e === 'already_checked_today' || e === 'already_done' || e === 'no_active_plan') return { ok: false, error: e };
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}


export type CustomTasksResult =
  | { ok: true; tasks: string[] }
  | { ok: false; error: 'plus_required' | 'ai_unavailable' | 'generation_in_progress' | 'network' };

interface CachedCustomGeneration {
  tasks: string[];
  expiresAt: string;
}

function readCachedCustomTasks(): string[] | null {
  const raw = storage.getString(kQuestCustomGeneration.name);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as CachedCustomGeneration;
    if (
      !Array.isArray(cached.tasks) ||
      cached.tasks.length === 0 ||
      !cached.tasks.every((task) => typeof task === 'string') ||
      !cached.expiresAt ||
      new Date(cached.expiresAt).getTime() <= Date.now()
    ) {
      storage.remove(kQuestCustomGeneration.name);
      return null;
    }
    return cached.tasks;
  } catch {
    storage.remove(kQuestCustomGeneration.name);
    return null;
  }
}

function cacheCustomTasks(tasks: string[], expiresAt?: string): void {
  const validExpiry = expiresAt && Number.isFinite(new Date(expiresAt).getTime())
    ? expiresAt
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  storage.set(
    kQuestCustomGeneration.name,
    JSON.stringify({ tasks, expiresAt: validExpiry } satisfies CachedCustomGeneration),
  );
}

/**
 * Restore an already-generated Custom Goal without invoking AI. Local MMKV is
 * checked first; the GET endpoint then recovers the same server result after a
 * reinstall or on another device. A cache miss intentionally returns null.
 */
export async function fetchCachedCustomTasks(): Promise<string[] | null> {
  const local = readCachedCustomTasks();
  if (local) return local;

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return null;
  try {
    const data = await apiClient.get<{
      success?: boolean;
      tasks?: string[] | null;
      expiresAt?: string;
    }>(`/api/quests/custom?userId=${encodeURIComponent(userId)}`);
    if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
      cacheCustomTasks(data.tasks, data.expiresAt);
      return data.tasks;
    }
  } catch {
    // A restore failure must not block the form. POST still enforces the
    // server-side generation lock/cache, so retrying cannot spend extra AI.
  }
  return null;
}

/**
 * AI custom plan (Plus): turn a free-text goal into ~20 candidate daily tasks.
 * The server gates on subscription_tier and answers 'not_paid' for free users;
 * that maps to 'plus_required' here so the screen can route to the paywall.
 */
export async function generateCustomTasks(goal: string): Promise<CustomTasksResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      tasks?: string[];
      expiresAt?: string;
    }>(
      '/api/quests/custom',
      { userId, goal },
    );
    if (data.success && Array.isArray(data.tasks) && data.tasks.length > 0) {
      cacheCustomTasks(data.tasks, data.expiresAt);
      return { ok: true, tasks: data.tasks };
    }
    if (data.error === 'not_paid') return { ok: false, error: 'plus_required' };
    if (data.error === 'ai_unavailable') return { ok: false, error: 'ai_unavailable' };
    if (data.error === 'generation_in_progress') return { ok: false, error: 'generation_in_progress' };
    return { ok: false, error: 'network' };
  } catch (e) {
    // ApiError carries the HTTP body for non-2xx; a 403 not_paid lands here.
    const msg = e instanceof Error ? e.message : '';
    const body = (e as { body?: unknown })?.body;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body ?? '');
    if (bodyStr.includes('not_paid') || msg.includes('403')) {
      return { ok: false, error: 'plus_required' };
    }
    if (bodyStr.includes('ai_unavailable')) return { ok: false, error: 'ai_unavailable' };
    if (bodyStr.includes('generation_in_progress')) return { ok: false, error: 'generation_in_progress' };
    return { ok: false, error: 'network' };
  }
}
