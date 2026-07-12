/**
 * Focus submission. A completed Focus session credits +30 xp once a day via
 * submit_kit (kit='focus', period = local date). The play/complete logic lives
 * in the screen; this just records the completion. Best-effort -- a failed
 * credit doesn't undo the user's sit.
 */
import { apiClient } from './api';
import { supabase } from './supabase';

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function submitFocus(params: {
  sceneId: string;
  trackIndex: number;
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
    }>('/api/focus', {
      userId,
      sceneId: params.sceneId,
      trackIndex: params.trackIndex,
      localDate: localDateStr(),
    });
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, xpAwarded: data.xp_awarded, companionXp: data.companion_xp };
  } catch {
    return { ok: false, error: 'network' };
  }
}
