/**
 * Tame Enemy data + submission.
 *
 * The battle resolves client-side. A successful server completion updates the
 * existing local status immediately, including each monster's tame count.
 */
import { MONSTERS, TAME_POINTS_PER_COMPLETION } from '@novame/engine';
import { ApiError } from '@novame/api-client';

import { kTameEnemyState, kTameStatus } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';
import { sessionEpoch } from './session-lifecycle';

let statusRevision = 0;
let statusRequest = 0;
const pendingTames = new Set<{ epoch: number }>();

export function subscribeTameStatus(listener: () => void): () => void {
  const subscription = storage.addOnValueChangedListener(key => {
    if (key === kTameStatus.name) listener();
  });
  return () => subscription.remove();
}

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
  /** This monster's independent Tame History score. */
  battlePoints: number;
  /** One monster can only be tamed once per local day. */
  tamedToday: boolean;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Global Tame Enemy limit for every account. */
export const TAME_DAILY_LIMIT = 2;

function localTameCount(date: string): number {
  const raw = storage.getString(kTameEnemyState.name);
  if (!raw) return 0;
  try {
    const state = JSON.parse(raw) as { date?: string; count?: number; done?: boolean };
    if (state.date !== date) return 0;
    return Math.max(0, state.count ?? (state.done ? 1 : 0));
  } catch {
    return 0;
  }
}

/** Count one completed tame toward today's local tally. */
function markTameEnemyDoneToday(today: string): void {
  const count = localTameCount(today);
  storage.set(kTameEnemyState.name, JSON.stringify({ date: today, count: count + 1 }));
}

/** Whether all daily tames are spent (local view; server is truth). */
export function isTameEnemyDoneToday(): boolean {
  const statusRaw = storage.getString(kTameStatus.name);
  if (statusRaw) {
    try {
      const status = JSON.parse(statusRaw) as TameStatusPayload;
      if (status.statusDate === localDateStr()) return status.doneToday;
    } catch { /* Fall back to the local completion tally. */ }
  }
  return localTameCount(localDateStr()) >= TAME_DAILY_LIMIT;
}

/** __DEV__ reset. */
export function clearTameEnemyLocal(): void {
  storage.remove(kTameEnemyState.name);
}

export interface TameStatusPayload {
  monsters: MonsterStatus[];
  doneToday: boolean;
  perEnemyDaily: boolean;
  tamesToday?: number;
  dailyLimit?: number;
  /** Daily flags expire locally; lifetime counts and points stay cached. */
  statusDate?: string;
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
        const staleDay = !!parsed.statusDate && parsed.statusDate !== localDateStr();
        const monsters = parsed.monsters.map((m) => {
          const def = byId.get(m.id);
          const tamedCount = Math.max(0, Number(m.tamedCount ?? (m.tamedBefore ? 1 : 0)) || 0);
          const current = {
            ...m,
            ...(def ? { name: def.name, prep: def.prep, tamed: def.tamed } : {}),
            tamedCount,
            // Old cached payloads only had one shared top-level battlePoints
            // value. Never copy that value onto every enemy: reconstruct the
            // independent score until the authoritative status refresh lands.
            battlePoints: Number.isFinite(Number(m.battlePoints))
              ? Math.max(0, Number(m.battlePoints))
              : tamedCount * TAME_POINTS_PER_COMPLETION,
          };
          return staleDay ? { ...current, tamedToday: false } : current;
        });
        return {
          ...parsed, monsters,
          doneToday: !staleDay && (parsed.doneToday || isTameEnemyDoneToday()),
          tamesToday: staleDay ? 0 : parsed.tamesToday ?? localTameCount(localDateStr()),
          dailyLimit: TAME_DAILY_LIMIT,
        };
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
      battlePoints: 0,
      tamedToday: false,
    })),
    doneToday: isTameEnemyDoneToday(),
    perEnemyDaily: true,
    tamesToday: 0,
    dailyLimit: TAME_DAILY_LIMIT,
  };
}

export async function fetchTameStatus(): Promise<TameStatusPayload> {
  const epoch = sessionEpoch();
  const revision = statusRevision;
  const request = ++statusRequest;
  const today = localDateStr();
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId || epoch !== sessionEpoch()) return getCachedTameStatus();
    const data = await apiClient.get<{ success?: boolean; monsters?: MonsterStatus[]; doneToday?: boolean; perEnemyDaily?: boolean; tamesToday?: number; dailyLimit?: number }>(
      `/api/tame-enemy/status?userId=${encodeURIComponent(userId)}&localDate=${today}`,
    );
    // An entry-time GET must not undo a completion that finished meanwhile.
    if (epoch !== sessionEpoch() || revision !== statusRevision || request !== statusRequest
      || [...pendingTames].some(pending => pending.epoch === epoch)) return getCachedTameStatus();
    if (!data.success || !data.monsters) return getCachedTameStatus();
    const payload: TameStatusPayload = {
      monsters: data.monsters,
      doneToday: !!data.doneToday,
      perEnemyDaily: !!data.perEnemyDaily,
      tamesToday: data.tamesToday ?? 0,
      dailyLimit: data.dailyLimit ?? TAME_DAILY_LIMIT,
      statusDate: today,
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
  const epoch = sessionEpoch();
  const today = localDateStr();
  const pending = { epoch };
  pendingTames.add(pending);
  statusRevision += 1;
  try {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId || epoch !== sessionEpoch()) return { ok: false, error: 'no_session' };
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      xp_awarded?: number;
      companion_xp?: number;
      battlePoints?: number;
      battleTotalPoints?: number;
      milestoneBonus?: number;
      tamesToday?: number;
      dailyLimit?: number;
    }>('/api/tame-enemy', {
      userId,
      monsterId: params.monsterId,
      skillsUsed: params.skillsUsed,
      hits: params.hits,
      localDate: today,
    });
    if (epoch !== sessionEpoch()) return { ok: false, error: 'session_changed' };
    if (data.error || !data.success) return { ok: false, error: data.error ?? 'network' };
    statusRevision += 1;
    markTameEnemyDoneToday(today);
    const cached = getCachedTameStatus();
    const completedToday = data.tamesToday ?? localTameCount(today);
    const monsters = cached.monsters.map(monster => {
      if (monster.id !== params.monsterId) return monster;
      const currentPoints = Math.max(0, Number(monster.battlePoints) || 0);
      return {
        ...monster,
        tamedCount: Math.max(0, Number(monster.tamedCount ?? (monster.tamedBefore ? 1 : 0)) || 0) + 1,
        battlePoints: typeof data.battleTotalPoints === 'number'
          ? data.battleTotalPoints
          : currentPoints + (data.battlePoints ?? TAME_POINTS_PER_COMPLETION),
        tamedBefore: true,
        tamedToday: today === localDateStr(),
      };
    });
    storage.set(kTameStatus.name, JSON.stringify({
      ...cached,
      monsters,
      statusDate: localDateStr(),
      tamesToday: completedToday,
      dailyLimit: data.dailyLimit ?? TAME_DAILY_LIMIT,
      doneToday: completedToday >= (data.dailyLimit ?? TAME_DAILY_LIMIT)
        || isTameEnemyDoneToday(),
    }));
    return {
      ok: true,
      xpAwarded: data.xp_awarded,
      companionXp: data.companion_xp,
      battlePoints: data.battlePoints,
      battleTotalPoints: data.battleTotalPoints,
      milestoneBonus: data.milestoneBonus ?? 0,
    };
  } catch (error) {
    if (epoch === sessionEpoch() && error instanceof ApiError && error.status === 409) {
      const body = error.body as { error?: string; tamesToday?: number; dailyLimit?: number } | undefined;
      const completedToday = Math.max(0, Number(body?.tamesToday) || 0);
      const dailyLimit = Math.max(1, Number(body?.dailyLimit) || TAME_DAILY_LIMIT);
      storage.set(kTameEnemyState.name, JSON.stringify({ date: today, count: completedToday }));
      const cached = getCachedTameStatus();
      storage.set(kTameStatus.name, JSON.stringify({
        ...cached,
        statusDate: today,
        tamesToday: completedToday,
        dailyLimit,
        doneToday: completedToday >= dailyLimit,
      } satisfies TameStatusPayload));
      return { ok: false, error: body?.error ?? 'already_done' };
    }
    return { ok: false, error: 'network' };
  } finally {
    pendingTames.delete(pending);
    statusRevision += 1;
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
