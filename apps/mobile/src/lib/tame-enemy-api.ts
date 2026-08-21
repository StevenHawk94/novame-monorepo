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
import { MONSTERS } from '@novame/engine';

import { kTameEnemyState, kTameStatus } from '../shared/storage/keys';
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
  /** How many times this monster was tamed (history/badge metadata). */
  tamedCount: number;
  /** Paid users tame each enemy once a day; this flags today's use. */
  tamedToday: boolean;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Free tier tames per day (2026-07-31: was 1). */
export const FREE_DAILY_TAMES = 3;

/** Count one completed tame toward today's local tally. */
export function markTameEnemyDoneToday(): void {
  const today = localDateStr();
  let count = 0;
  const raw = storage.getString(kTameEnemyState.name);
  if (raw) {
    try {
      const s = JSON.parse(raw) as { date?: string; count?: number; done?: boolean };
      if (s.date === today) count = s.count ?? (s.done ? 1 : 0);
    } catch {
      // fresh start
    }
  }
  storage.set(kTameEnemyState.name, JSON.stringify({ date: today, count: count + 1 }));
}

/** Whether all daily tames are spent (local view; server is truth). */
export function isTameEnemyDoneToday(): boolean {
  const raw = storage.getString(kTameEnemyState.name);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as { date?: string; count?: number; done?: boolean };
    if (s.date !== localDateStr()) return false;
    return (s.count ?? (s.done ? 1 : 0)) >= FREE_DAILY_TAMES;
  } catch {
    return false;
  }
}

/** __DEV__ reset. */
export function clearTameEnemyLocal(): void {
  storage.remove(kTameEnemyState.name);
}

export interface TameStatusPayload {
  monsters: MonsterStatus[];
  doneToday: boolean;
  perEnemyDaily: boolean;
  battlePoints: number;
}

/**
 * Cache-first status so the select screen paints instantly. First run (no
 * cache yet) synthesizes the grid from the engine's static MONSTERS list —
 * names/prep lines are local, only skill counts and tame flags arrive with
 * the background refresh.
 */
export function getCachedTameStatus(): TameStatusPayload {
  const raw = storage.getString(kTameStatus.name);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as TameStatusPayload;
      if (Array.isArray(parsed.monsters) && parsed.monsters.length > 0) {
        // Identity fields (name/prep/tamed) always come from the engine so
        // copy renames apply instantly, stale cache or not.
        const byId = new Map(MONSTERS.map((m) => [m.id, m]));
        const monsters = parsed.monsters.map((m) => {
          const def = byId.get(m.id);
          return def ? { ...m, name: def.name, prep: def.prep, tamed: def.tamed } : m;
        });
        return { ...parsed, monsters, doneToday: parsed.doneToday || isTameEnemyDoneToday() };
      }
    } catch {
      // fall through to the synthesized default
    }
  }
  return {
    monsters: MONSTERS.map((m) => ({
      id: m.id,
      name: m.name,
      dimension: m.dimension,
      prep: m.prep,
      tamed: m.tamed,
      skillCount: 0,
      tamedBefore: false,
      tamedCount: 0,
      tamedToday: false,
    })),
    doneToday: isTameEnemyDoneToday(),
    perEnemyDaily: false,
    battlePoints: 0,
  };
}

export async function fetchTameStatus(): Promise<TameStatusPayload> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { monsters: [], doneToday: false, perEnemyDaily: false, battlePoints: 0 };

  try {
    const data = await apiClient.get<{ success?: boolean; monsters?: MonsterStatus[]; doneToday?: boolean; perEnemyDaily?: boolean; battlePoints?: number }>(
      `/api/tame-enemy/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`,
    );
    if (!data.success || !data.monsters) return getCachedTameStatus();
    const payload: TameStatusPayload = {
      monsters: data.monsters,
      doneToday: !!data.doneToday,
      perEnemyDaily: !!data.perEnemyDaily,
      battlePoints: data.battlePoints ?? 0,
    };
    storage.set(kTameStatus.name, JSON.stringify(payload));
    return payload;
  } catch {
    return getCachedTameStatus();
  }
}

export async function submitTame(params: {
  monsterId: string;
  skillsUsed: string[];
  hits: number;
}): Promise<{
  ok: boolean;
  error?: string;
  xpAwarded?: number;
  companionXp?: number;
  battlePoints?: number;
  battleTotalPoints?: number;
  milestoneBonus?: number;
}> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };

  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      xp_awarded?: number;
      companion_xp?: number;
      battlePoints?: number;
      battleTotalPoints?: number;
      milestoneBonus?: number;
    }>('/api/tame-enemy', {
      userId,
      monsterId: params.monsterId,
      skillsUsed: params.skillsUsed,
      hits: params.hits,
      localDate: localDateStr(),
    });
    if (data.error) return { ok: false, error: data.error };
    if (typeof data.battleTotalPoints === 'number') {
      const cached = getCachedTameStatus();
      storage.set(
        kTameStatus.name,
        JSON.stringify({ ...cached, battlePoints: data.battleTotalPoints }),
      );
    }
    return {
      ok: true,
      xpAwarded: data.xp_awarded,
      companionXp: data.companion_xp,
      battlePoints: data.battlePoints,
      battleTotalPoints: data.battleTotalPoints,
      milestoneBonus: data.milestoneBonus ?? 0,
    };
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
