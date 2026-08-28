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

import {
  kQuietWinsFeedbackSequence,
  kQuietWinsState,
} from '../shared/storage/keys';
import { storage } from './storage';
import { supabase } from './supabase';
import { beginKitCompletion, isKitCompletionPending } from './kit-completion-state';
import { sessionEpoch } from './session-lifecycle';
import { withDeadline } from './async-lifecycle';

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
  if (isKitCompletionPending('quiet_wins', localDateStr())) return true;
  const raw = storage.getString(kQuietWinsState.name);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw) as CachedState;
    return s.date === localDateStr() && s.done === true;
  } catch {
    return false;
  }
}

function markDoneToday(date: string): void {
  storage.set(kQuietWinsState.name, JSON.stringify({ date, done: true }));
}

function feedbackBankKey(checkedIds: string[]): string {
  const count = checkedIds.length;
  if (count === 0) return 'zero';
  if (count === 1) return `single:${checkedIds[0]}`;
  if (count <= 6) return 'two-to-six';
  if (count <= 10) return 'seven-to-ten';
  return 'eleven-to-sixteen';
}

/** Return the next version index for this feedback bank and advance its cursor. */
export function consumeQuietWinsFeedbackSequence(checkedIds: string[]): number {
  const raw = storage.getString(kQuietWinsFeedbackSequence.name);
  let sequences: Record<string, number> = {};
  if (raw) {
    try {
      sequences = JSON.parse(raw) as Record<string, number>;
    } catch {
      sequences = {};
    }
  }
  const key = feedbackBankKey(checkedIds);
  const stored = sequences[key];
  const current = Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0;
  sequences[key] = current + 1;
  storage.set(kQuietWinsFeedbackSequence.name, JSON.stringify(sequences));
  return current;
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
  const today = localDateStr();
  const epoch = sessionEpoch();
  const release = beginKitCompletion('quiet_wins', today);
  try {
    const { data: sess } = await withDeadline(supabase.auth.getSession());
    const userId = sess.session?.user?.id;
    if (!userId || epoch !== sessionEpoch()) return { ok: false, error: 'network' };
    const data = await withDeadline(apiClient.post<WireSnapshot>('/api/kit/quiet-wins', {
      userId,
      checkedIds,
      localDate: today,
    }), 20_000);
    if (epoch !== sessionEpoch()) return { ok: false, error: 'network' };

    if (data.error === 'already_done_this_period') {
      markDoneToday(today);
      return { ok: false, error: 'already_done' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    markDoneToday(today);
    return {
      ok: true,
      snapshot: {
        completionId: data.completion_id ?? '',
        xpAwarded: data.xp_awarded ?? 0,
        companionXp: data.companion_xp ?? 0,
      },
    };
  } catch (e) {
    if (epoch === sessionEpoch() && e instanceof ApiError && e.status === 409) {
      markDoneToday(today);
      return { ok: false, error: 'already_done' };
    }
    return { ok: false, error: 'network' };
  } finally {
    release();
  }
}
