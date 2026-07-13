/**
 * Duo seat (IAP Step 2). The Plus Duo owner shares Plus with one member via a
 * one-time code. status() reports both sides (owner's code + claim state,
 * member's owner); join() claims a seat (member must be free; irreversible).
 */
import { apiClient } from './api';
import { supabase } from './supabase';

export interface DuoStatus {
  asOwner: { inviteCode: string; claimed: boolean; memberName: string | null } | null;
  asMember: { ownerName: string } | null;
}

async function uid(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.user?.id ?? null;
}

export async function fetchDuoStatus(): Promise<DuoStatus> {
  const userId = await uid();
  if (!userId) return { asOwner: null, asMember: null };
  try {
    const data = await apiClient.get<{ success?: boolean; asOwner?: DuoStatus['asOwner']; asMember?: DuoStatus['asMember'] }>(
      `/api/duo/status?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) return { asOwner: null, asMember: null };
    return { asOwner: data.asOwner ?? null, asMember: data.asMember ?? null };
  } catch {
    return { asOwner: null, asMember: null };
  }
}

export async function joinDuo(code: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await uid();
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string }>(
      '/api/duo/join', { userId, code },
    );
    if (data.error) return { ok: false, error: data.error };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}
