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
