/**
 * Visit Master (Kit 5). Paid-only consultation with a 48h cooldown. Produces no
 * skill / xp / items -- it's a sage's counsel, isolated from the Skills system.
 */
import { apiClient } from './api';
import { supabase } from './supabase';

export interface MasterResponse {
  quote_short: string;
  insight_full: string;
  flipped_lens: string;
  micro_task: string;
  reflective_question: string;
}

export interface MasterVisit {
  id: string;
  question: string;
  createdAt: string;
}

export interface MasterStatus {
  isPaid: boolean;
  available: boolean;
  nextAvailableAt: string | null;
  history: MasterVisit[];
}

async function uid(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.user?.id ?? null;
}

export async function fetchMasterStatus(): Promise<MasterStatus> {
  const userId = await uid();
  if (!userId) return { isPaid: false, available: false, nextAvailableAt: null, history: [] };
  try {
    const data = await apiClient.get<{
      success?: boolean; isPaid?: boolean; available?: boolean;
      nextAvailableAt?: string | null; history?: MasterVisit[];
    }>(`/api/master/status?userId=${encodeURIComponent(userId)}`);
    if (!data.success) return { isPaid: false, available: false, nextAvailableAt: null, history: [] };
    return {
      isPaid: !!data.isPaid,
      available: !!data.available,
      nextAvailableAt: data.nextAvailableAt ?? null,
      history: data.history || [],
    };
  } catch {
    return { isPaid: false, available: false, nextAvailableAt: null, history: [] };
  }
}

export async function askMaster(question: string): Promise<
  { ok: true; response: MasterResponse } | { ok: false; error: string; nextAvailableAt?: string }
> {
  const userId = await uid();
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{
      success?: boolean; error?: string; response?: MasterResponse; nextAvailableAt?: string;
    }>('/api/master/ask', { userId, question });
    if (data.error) return { ok: false, error: data.error, nextAvailableAt: data.nextAvailableAt };
    if (data.success && data.response) return { ok: true, response: data.response };
    return { ok: false, error: 'unknown' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function fetchMasterVisit(
  id: string,
): Promise<{ question: string; response: MasterResponse; createdAt: string } | null> {
  const userId = await uid();
  if (!userId) return null;
  try {
    const data = await apiClient.get<{
      success?: boolean;
      visit?: { question: string; response: MasterResponse; createdAt: string };
    }>(`/api/master/visit?userId=${encodeURIComponent(userId)}&id=${encodeURIComponent(id)}`);
    return data.success && data.visit ? data.visit : null;
  } catch {
    return null;
  }
}

/** A friendly "Master is away until ..." label from an ISO timestamp. */
export function cooldownLabel(nextAvailableAt: string | null): string {
  if (!nextAvailableAt) return '';
  const then = new Date(nextAvailableAt);
  const now = Date.now();
  const hrs = Math.max(0, Math.ceil((then.getTime() - now) / (60 * 60 * 1000)));
  if (hrs <= 1) return 'The Master returns within the hour.';
  if (hrs < 24) return `The Master returns in about ${hrs} hours.`;
  const days = Math.ceil(hrs / 24);
  return `The Master returns in about ${days} day${days > 1 ? 's' : ''}.`;
}
