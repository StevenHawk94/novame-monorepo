/**
 * Weekly Quests -- active plan status (cache-first, like the other reads).
 * No active plan -> the picker renders a theme list; an active plan -> the
 * 7-day checklist. Plan creation / check-off / custom AI generation land in
 * later steps.
 */
import { kQuestStatus } from '../shared/storage/keys';
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

function todayLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function getCachedStatus(): QuestStatus {
  const raw = storage.getString(kQuestStatus.name);
  if (!raw) return { active: false };
  try {
    return JSON.parse(raw) as QuestStatus;
  } catch {
    return { active: false };
  }
}

export async function fetchQuestStatus(): Promise<QuestStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedStatus();
  try {
    const data = await apiClient.get<{ success?: boolean; active?: boolean; plan?: ActiveQuestPlan }>(
      `/api/quests/status?userId=${encodeURIComponent(userId)}&localDate=${todayLocal()}`,
    );
    if (!data.success) return getCachedStatus();
    const state: QuestStatus = { active: !!data.active, plan: data.plan };
    storage.set(kQuestStatus.name, JSON.stringify(state));
    return state;
  } catch {
    return getCachedStatus();
  }
}
