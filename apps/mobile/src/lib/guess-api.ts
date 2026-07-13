/**
 * Guess Their Day (C11c). Guessing a friend's day from their item emoji, and
 * reacting to guesses about your own -- all through fixed reply templates, no
 * free-form chat. A guess is private to its recipient.
 */
import { apiClient } from './api';
import { supabase } from './supabase';

export interface InboxGuess {
  guessId: string;
  fromName: string;
  targetDate: string;
  body: string;
  replyTemplateId: number | null;
  createdAt: string;
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function uid(): Promise<string | null> {
  const { data: sess } = await supabase.auth.getSession();
  return sess.session?.user?.id ?? null;
}

export async function submitGuess(toUserId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const userId = await uid();
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string }>('/api/guess', {
      userId, action: 'submit', toUserId, body, targetDate: localDateStr(),
    });
    if (data.error) return { ok: false, error: data.error };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function fetchGuessInbox(): Promise<InboxGuess[]> {
  const userId = await uid();
  if (!userId) return [];
  try {
    const data = await apiClient.post<{ success?: boolean; inbox?: InboxGuess[] }>('/api/guess', {
      userId, action: 'inbox',
    });
    return data.success && data.inbox ? data.inbox : [];
  } catch {
    return [];
  }
}

export async function replyGuess(guessId: string, replyTemplateId: number): Promise<{ ok: boolean }> {
  const userId = await uid();
  if (!userId) return { ok: false };
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/guess', {
      userId, action: 'reply', guessId, replyTemplateId,
    });
    return { ok: !!data.success };
  } catch {
    return { ok: false };
  }
}
