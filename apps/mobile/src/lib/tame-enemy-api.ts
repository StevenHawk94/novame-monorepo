/**
 * Tame Enemy data + submission.
 *
 * The eight monsters and battle numbers live in the shared engine (MONSTERS,
 * damageFor, applyHit, monsterTier, MONSTER_HP), so the battle resolves
 * client-side and the server only records the completion. status() decorates
 * the monsters with each user's per-dimension skill count and tamed-before
 * flag; the skill pool for a battle is fetched from the skills cache, filtered
 * by the monster's dimension.
 */
import { kTameEnemyState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

export interface MonsterStatus {
  id: string;
  name: string;
  dimension: string;
  prep: string;
  tamed: string;
  skillCount: number;
  tamedBefore: boolean;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Mark today's single tame as done, so the sheet drops the Kit until tomorrow. */
export function markTameEnemyDoneToday(): void {
  storage.set(kTameEnemyState.name, JSON.stringify({ date: localDateStr(), done: true }));
}

/** Whether the one daily tame is already spent (local view; server is truth). */
export function isTameEnemyDoneToday(): boolean {
  const raw = storage.getString(kTameEnemyState.name);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as { date?: string; done?: boolean };
    return s.date === localDateStr() && s.done === true;
  } catch {
    return false;
  }
}

/** __DEV__ reset. */
export function clearTameEnemyLocal(): void {
  storage.remove(kTameEnemyState.name);
}

export async function fetchTameStatus(): Promise<{ monsters: MonsterStatus[]; doneToday: boolean }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { monsters: [], doneToday: false };

  try {
    const data = await apiClient.get<{ success?: boolean; monsters?: MonsterStatus[]; doneToday?: boolean }>(
      `/api/tame-enemy/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`,
    );
    if (!data.success || !data.monsters) return { monsters: [], doneToday: false };
    return { monsters: data.monsters, doneToday: !!data.doneToday };
  } catch {
    return { monsters: [], doneToday: false };
  }
}

export async function submitTame(params: {
  monsterId: string;
  skillsUsed: string[];
  hits: number;
}): Promise<{ ok: boolean; error?: string; xpAwarded?: number; companionXp?: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };

  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      xp_awarded?: number;
      companion_xp?: number;
    }>('/api/tame-enemy', {
      userId,
      monsterId: params.monsterId,
      skillsUsed: params.skillsUsed,
      hits: params.hits,
      localDate: localDateStr(),
    });
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, xpAwarded: data.xp_awarded, companionXp: data.companion_xp };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** Monster emoji placeholders until sprite art. Keyed by monster id. */
export const MONSTER_EMOJI: Record<string, string> = {
  the_swallower: '\u{1F910}',
  overthinking: '\u{1F300}',
  procrastination: '\u{1F9A5}',
  the_fog: '\u{1F32B}',
  the_spiral: '\u{1F32A}',
  the_hollow: '\u{1F573}',
  the_comparer: '\u{2696}',
  the_wall: '\u{1F9F1}',
};

/** Tamed (gentle) form emoji, shown on Screen 4. */
export const MONSTER_TAMED_EMOJI: Record<string, string> = {
  the_swallower: '\u{1F5E3}',
  overthinking: '\u{1F4AD}',
  procrastination: '\u{1F680}',
  the_fog: '\u{1F324}',
  the_spiral: '\u{1F33F}',
  the_hollow: '\u{1F4AB}',
  the_comparer: '\u{1F91D}',
  the_wall: '\u{1F6AA}',
};
