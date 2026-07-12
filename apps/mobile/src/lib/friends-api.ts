/**
 * Friends data + actions (C11a). A "keep your distance" model: a friend's card
 * shows the emoji of the items they collected today (resolved from the shared
 * dictionary by id), never their reflections. Invite by a stable code; add
 * creates a pending request the other side accepts.
 */
import { ITEM_DICTIONARY } from '@novame/engine';

import { apiClient } from './api';
import { supabase } from './supabase';

export interface FriendCard {
  userId: string;
  displayName: string;
  todayItemIds: string[];
  todayEmoji: string[]; // decorated from dictionary
}

export interface PendingRequest {
  friendshipId: string;
  userId: string;
  displayName: string;
}

export interface FriendsStatus {
  inviteCode: string | null;
  friends: FriendCard[];
  pending: PendingRequest[];
}

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function emojiFor(itemId: string): string {
  return ITEM_DICTIONARY.items[itemId]?.emoji ?? '✨';
}

export async function fetchFriends(): Promise<FriendsStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { inviteCode: null, friends: [], pending: [] };

  try {
    const data = await apiClient.get<{
      success?: boolean;
      inviteCode?: string | null;
      friends?: { userId: string; displayName: string; todayItemIds: string[] }[];
      pending?: PendingRequest[];
    }>(`/api/friends/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`);
    if (!data.success) return { inviteCode: null, friends: [], pending: [] };
    return {
      inviteCode: data.inviteCode ?? null,
      friends: (data.friends || []).map((f) => ({
        ...f,
        todayEmoji: f.todayItemIds.map(emojiFor),
      })),
      pending: data.pending || [],
    };
  } catch {
    return { inviteCode: null, friends: [], pending: [] };
  }
}

export async function addFriend(code: string): Promise<{ ok: boolean; error?: string; requestedTo?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string; requestedTo?: string }>(
      '/api/friends/add', { userId, code },
    );
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, requestedTo: data.requestedTo };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export async function respondFriend(
  friendshipId: string,
  action: 'accept' | 'decline',
): Promise<{ ok: boolean; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string }>(
      '/api/friends/respond', { userId, friendshipId, action },
    );
    if (data.error) return { ok: false, error: data.error };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}
