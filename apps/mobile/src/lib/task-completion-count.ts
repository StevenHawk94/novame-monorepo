/**
 * task-completion-count.ts -- Stage 6.RatingPrompt
 *
 * Lifetime MMKV counter for completed daily tasks. Used by the
 * rating prompt (rating-prompt.ts) as a secondary trigger path
 * alongside publish count.
 *
 * Why a separate counter from publish-count:
 *   Subscribed users may complete many daily tasks without ever
 *   hitting publish quota (e.g. Basic plan with 5 publishes/month
 *   but unlimited task completions). Task completion is a strong
 *   engagement signal independent of the publish flow -- the user
 *   actively engaged with their Growth tab to earn EXP.
 *
 * Semantics: counter increments exactly once per successful task
 * completion -- defined as completeDailyTask() server call succeeded
 * (refreshChar then fires to pull authoritative EXP). Failed task
 * completions (network error, server 4xx/5xx) do NOT increment.
 *
 * Stored in MMKV at key `novame_task_completion_count`, persisting
 * across cold launches but NOT synced cross-device. Worst case: a
 * user on a new device starts from 0 -- the rating prompt would
 * still gate on iOS SKStoreReviewController (365/3 limit) so the
 * worst-case behaviour is bounded.
 */
import { storage } from '@/lib/storage';

const TASK_COMPLETION_COUNT_KEY = 'novame_task_completion_count';

/**
 * Read the lifetime task completion counter. Returns 0 when MMKV is
 * empty (fresh install or counter cleared).
 */
export function getTaskCompletionCount(): number {
  try {
    const raw = storage.getString(TASK_COMPLETION_COUNT_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Increment the lifetime task completion counter and return the new
 * value. Call exactly once from growth.tsx after completeDailyTask
 * returns successfully (after the +EXP toast fires).
 */
export function incrementTaskCompletionCount(): number {
  const current = getTaskCompletionCount();
  const next = current + 1;
  try {
    storage.set(TASK_COMPLETION_COUNT_KEY, String(next));
  } catch (e) {
    // MMKV writes essentially never fail. If it does, the counter
    // stays at its prior value -- worst case the user doesn't get a
    // rating prompt this time. Not worth retrying.
    console.warn('[task-completion-count] MMKV write failed:', e);
  }
  return next;
}
