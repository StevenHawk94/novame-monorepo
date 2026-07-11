/**
 * Quiet Wins submission + daily completion state.
 *
 * submitQuietWins posts the checked ids and adopts the server snapshot. The
 * layered feedback the screen shows is computed separately, client-side, from
 * the shared domain function (quietWinsFeedback) -- the server only records the
 * run and credits the flat xp.
 *
 * A small local flag (kQuietWinsState) tracks whether today's run is done, so
 * Home can hide the entry once completed and show it again next day. It's a
 * read-only shadow of the server's once-per-day gate: if the cache is stale and
 * lets the user in again, submit_kit rejects the second run.
 */
import { ApiError } from '@novame/api-client';

import { apiClient } from './api';

import { kQuietWinsState } from '../shared/storage/keys';
import { storage } from './storage';
import { supabase } from './supabase';

export interface QuietWinsSnapshot {
  completionId: string;
  xpAwarded: number;
  companionXp: number;
}

export type QuietWinsError = 'already_done' | 'companion_not_ready' | 'network';

export type QuietWinsResult =
  | { ok: true; snapshot: QuietWinsSnapshot }
  | { ok: false; error: QuietWinsError };

interface CachedState {
  date: string; // YYYY-MM-DD this "done" belongs to
  done: boolean;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whether Quiet Wins is done for today (resets across a day boundary). */
export function isQuietWinsDoneToday(): boolean {
  const raw = storage.getString(kQuietWinsState.name);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as CachedState;
    return s.date === localDateStr() && s.done === true;
  } catch {
    return false;
  }
}

function markDoneToday(): void {
  storage.set(kQuietWinsState.name, JSON.stringify({ date: localDateStr(), done: true }));
}

/** __DEV__ helper: clear the local completion flag so the Home entry reappears. */
export function clearQuietWinsLocal(): void {
  storage.remove(kQuietWinsState.name);
}

interface WireSnapshot {
  success?: boolean;
  error?: string;
  completion_id?: string;
  xp_awarded?: number;
  companion_xp?: number;
}

/**
 * Submit today's Quiet Wins. checkedIds may be empty -- a zero-check run still
 * counts and still pays, matching the "no pressure" framing. Marks today done
 * on success (and on already_done, since either way the day is spent).
 */
export async function submitQuietWins(checkedIds: string[]): Promise<QuietWinsResult> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };

  try {
    const data = await apiClient.post<WireSnapshot>('/api/kit/quiet-wins', {
      userId,
      checkedIds,
      localDate: localDateStr(),
    });

    if (data.error === 'already_done_this_period') {
      markDoneToday();
      return { ok: false, error: 'already_done' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    markDoneToday();
    return {
      ok: true,
      snapshot: {
        completionId: data.completion_id ?? '',
        xpAwarded: data.xp_awarded ?? 0,
        companionXp: data.companion_xp ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      markDoneToday();
      return { ok: false, error: 'already_done' };
    }
    return { ok: false, error: 'network' };
  }
}
