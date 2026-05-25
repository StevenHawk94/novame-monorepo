/**
 * daily-tasks API client wrapper — Stage 3.9.A.2.3
 *
 * Wraps /api/daily-tasks for the Growth tab's My Tasks sub-tab.
 *
 * Server endpoints:
 *   GET  /api/daily-tasks?userId=X
 *     -> auto-creates today's daily_love task if missing,
 *        returns { tasks: DailyTask[] }
 *
 *   POST /api/daily-tasks { userId, action: 'complete', taskId }
 *     -> marks completed, awards exp_reward, recomputes level,
 *        updates aspire_scores if linked_keyword set
 *     -> returns { expGained, oldLevel, newLevel, leveledUp,
 *                  expCurrent, expNeeded }
 */
import { apiClient } from './api';
import { storage } from './storage';

export type DailyTaskType = 'daily_love' | 'wisdom';

export type DailyTask = {
  id: string;
  user_id: string;
  task_text: string;
  task_type: DailyTaskType;
  exp_reward: number;
  is_completed: boolean;
  expires_at: string;
  linked_keyword: string | null;
  created_at: string;
};

export type CompleteTaskResult = {
  success: boolean;
  expGained: number;
  oldLevel: number;
  oldExpCurrent: number;
  oldExpNeeded: number;
  newLevel: number;
  expCurrent: number;
  expNeeded: number;
  leveledUp: boolean;
};

export async function fetchDailyTasks(userId: string): Promise<DailyTask[]> {
  const data = await apiClient.get<{ success?: boolean; tasks?: DailyTask[] }>(
    `/api/daily-tasks?userId=${encodeURIComponent(userId)}`,
  );
  return data.tasks ?? [];
}

export async function completeDailyTask(
  userId: string,
  taskId: string,
): Promise<CompleteTaskResult> {
  return apiClient.request<CompleteTaskResult>(
    'POST',
    '/api/daily-tasks',
    { userId, action: 'complete', taskId },
  );
}

// ============================================================
// SWR Cache Layer — Stage 6 (cache-first reads, publish invalidation)
//
// Strategy: mirror me-stats.ts pattern.
//   - getCachedDailyTasks(): MMKV sync read; null on miss.
//   - fetchDailyTasksWithCache(userId): API fetch + write-through to
//     cache + return. Used for both initial cold-start fetch and
//     post-invalidate re-fetch.
//   - invalidateDailyTasks(): MMKV remove; signals "next read should
//     refetch."
//
// Page integration (growth.tsx My Tasks):
//   - On mount: useState initial value = getCachedDailyTasks(). User
//     immediately sees last-known list (or empty if first time).
//   - useFocusEffect: void fetchDailyTasksWithCache(userId).then(setRows)
//     for silent background refresh on every tab focus.
//
// Invalidation triggers:
//   - record.tsx PhasePublishing success: invalidateDailyTasks()
//     because publish creates new wisdom tasks (task_1 / task_2).
//
// MMKV key: novame_daily_tasks
// ============================================================

const DAILY_TASKS_STORAGE_KEY = 'novame_daily_tasks';

export type CachedDailyTasks = {
  tasks: DailyTask[];
  lastFetchedAtMs: number;
};

export function getCachedDailyTasks(): DailyTask[] | null {
  const raw = storage.getString(DAILY_TASKS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedDailyTasks;
    return parsed.tasks ?? null;
  } catch {
    return null;
  }
}

function setCachedDailyTasks(tasks: DailyTask[]): void {
  const payload: CachedDailyTasks = {
    tasks,
    lastFetchedAtMs: Date.now(),
  };
  storage.set(DAILY_TASKS_STORAGE_KEY, JSON.stringify(payload));
}

export function invalidateDailyTasks(): void {
  storage.remove(DAILY_TASKS_STORAGE_KEY);
}

/**
 * Cache-aware fetch. Always hits server; writes through to cache.
 * Use this from page components (growth.tsx) for both initial
 * load and post-invalidate refresh.
 */
export async function fetchDailyTasksWithCache(
  userId: string,
): Promise<DailyTask[]> {
  const tasks = await fetchDailyTasks(userId);
  setCachedDailyTasks(tasks);
  return tasks;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight 3-bug series Layer 1).
 *
 * Each publish creates new wisdom tasks (task_1 / task_2 from
 * generate-card.js). This helper clears the stale cache and immediately
 * fetches the post-publish task list so Growth tab's My Tasks sub-tab
 * shows new tasks the moment the user returns from the Insight screen.
 *
 * fire-and-forget safe: never throws.
 */
export async function refreshDailyTasks(userId: string): Promise<void> {
  storage.remove(DAILY_TASKS_STORAGE_KEY);
  try {
    await fetchDailyTasksWithCache(userId);
  } catch (e) {
    console.warn('[refreshDailyTasks]', e);
  }
}
