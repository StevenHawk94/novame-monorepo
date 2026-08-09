/**
 * Friends data + actions (C11a). A "keep your distance" model: a friend's card
 * shows the emoji of the items they collected today (resolved from the shared
 * dictionary by id), never their reflections. Invite by a stable code; add
 * creates a pending request the other side accepts.
 */
import { ITEM_DICTIONARY } from '@novame/engine';
import { syncWidgetLatestFriend } from './widget-sync';

import { apiClient } from './api';
import { supabase } from './supabase';
import { storage } from './storage';
import { kCommonItems, kConnInsights, kFriendsFeed, kFriendsStatus, kPairingStatus } from '../shared/storage/keys';

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
  /** The relationship proposed on the invitation (2026-07-24 pairing flow). */
  relationship?: string | null;
}

export interface SentRequest {
  friendshipId: string;
  userId: string;
  displayName: string;
  createdAt: string;
}

export interface FriendsStatus {
  inviteCode: string | null;
  friends: FriendCard[];
  pending: PendingRequest[];
  /** Requests I sent, still unanswered (Add Friends page's Pending rows). */
  sent: SentRequest[];
}

const EMPTY_STATUS: FriendsStatus = { inviteCode: null, friends: [], pending: [], sent: [] };

/** Last good status — the tab paints this instantly, then revalidates. */
export function getCachedFriends(): FriendsStatus {
  try {
    const raw = storage.getString(kFriendsStatus.name);
    if (raw) return JSON.parse(raw) as FriendsStatus;
  } catch { /* fall through */ }
  return EMPTY_STATUS;
}

/** Last good Messages feed. */
export function getCachedFriendFeed(): FeedEntry[] {
  try {
    const raw = storage.getString(kFriendsFeed.name);
    if (raw) return JSON.parse(raw) as FeedEntry[];
  } catch { /* fall through */ }
  return [];
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
  if (!userId) return EMPTY_STATUS;

  try {
    const data = await apiClient.get<{
      success?: boolean;
      inviteCode?: string | null;
      friends?: { userId: string; displayName: string; todayItemIds: string[] }[];
      pending?: PendingRequest[];
      sent?: SentRequest[];
    }>(`/api/friends/status?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`);
    // A failed refresh must never clobber a good cache — return the stale
    // copy instead (the screen already painted it anyway).
    if (!data.success) return getCachedFriends();
    const status: FriendsStatus = {
      inviteCode: data.inviteCode ?? null,
      friends: (data.friends || []).map((f) => ({
        ...f,
        todayEmoji: f.todayItemIds.map(emojiFor),
      })),
      pending: data.pending || [],
      sent: data.sent || [],
    };
    storage.set(kFriendsStatus.name, JSON.stringify(status));
    return status;
  } catch {
    return getCachedFriends();
  }
}

export async function addFriend(
  code: string,
  opts?: { relationship?: string; relationshipSince?: string },
): Promise<{ ok: boolean; error?: string; requestedTo?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string; requestedTo?: string }>(
      '/api/friends/add',
      { userId, code, relationship: opts?.relationship, relationshipSince: opts?.relationshipSince },
    );
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, requestedTo: data.requestedTo };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    return { ok: false, error: e || 'network' };
  }
}

/** Resolve a Pair ID to a name WITHOUT sending anything (search-result card). */
export async function previewFriend(
  code: string,
): Promise<{ ok: boolean; targetName?: string; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string; targetName?: string }>(
      '/api/friends/add',
      { userId, code, preview: true },
    );
    if (data.error) return { ok: false, error: data.error };
    return { ok: true, targetName: data.targetName };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    return { ok: false, error: e || 'network' };
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

// ---- v2: Messages feed, privacy, shared memory boxes (PRD §6) -------------

export interface FeedDetail {
  itemId: string;
  text: string;
}

export interface FeedEntry {
  friendUserId: string;
  friendName: string;
  reflectId: string;
  createdAt: string;
  itemIds: string[];
  emoji: string[]; // decorated from the shared dictionary
  /** Present ONLY when that friend opted into sharing details (server-enforced). */
  details: FeedDetail[] | null;
  sharesDetails: boolean;
  unread: boolean;
}

/** The Messages list: friends' recent memories, unread first. */
export async function fetchFriendFeed(): Promise<FeedEntry[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return [];
  try {
    const data = await apiClient.get<{ success?: boolean; feed?: Omit<FeedEntry, 'emoji'>[] }>(
      `/api/friends/feed?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success || !data.feed) return getCachedFriendFeed();
    const feed = data.feed.map((e) => ({ ...e, emoji: e.itemIds.map(emojiFor) }));
    storage.set(kFriendsFeed.name, JSON.stringify(feed));
    void syncWidgetLatestFriend(feed);
    return feed;
  } catch {
    return getCachedFriendFeed();
  }
}

/** Move the unread cursor for one friend (fire-and-forget safe). */
export async function markFriendRead(friendUserId: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return;
  try {
    await apiClient.post('/api/friends/read', { userId, friendUserId });
  } catch {
    // cursor is cosmetic; next fetch just shows unread again
  }
}

/** My detail-sharing switch (default false — private). */
export async function fetchSharePrivacy(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.get<{ success?: boolean; share?: boolean }>(
      `/api/friends/privacy?userId=${encodeURIComponent(userId)}`,
    );
    return !!data.share;
  } catch {
    return false;
  }
}

export async function setSharePrivacy(share: boolean): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/friends/privacy', {
      userId,
      share,
    });
    return !!data.success;
  } catch {
    return false;
  }
}

export interface SharedBoxItem {
  id: string;
  authorUserId: string;
  itemId: string;
  emoji: string;
  description: string;
  source: 'manual' | 'reflect';
  createdAt: string;
}

/** The shared memory box with one friend. */
export async function fetchSharedBox(friendUserId: string): Promise<SharedBoxItem[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return [];
  try {
    const data = await apiClient.get<{
      success?: boolean;
      items?: { id: string; author_user_id: string; item_id: string; description: string; source: 'manual' | 'reflect'; created_at: string }[];
    }>(`/api/friends/box?userId=${encodeURIComponent(userId)}&friendUserId=${encodeURIComponent(friendUserId)}`);
    if (!data.success || !data.items) return [];
    return data.items.map((r) => ({
      id: r.id,
      authorUserId: r.author_user_id,
      itemId: r.item_id,
      emoji: emojiFor(r.item_id),
      description: r.description,
      source: r.source,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

/** Create-flow: free text → rule-matched items land in the pair's box. */
export async function createSharedMemories(
  friendUserId: string,
  text: string,
): Promise<{ ok: boolean; createdCount: number }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, createdCount: 0 };
  try {
    const data = await apiClient.post<{ success?: boolean; created?: unknown[] }>(
      '/api/friends/box',
      { userId, friendUserId, text },
    );
    return { ok: !!data.success, createdCount: data.created?.length ?? 0 };
  } catch {
    return { ok: false, createdCount: 0 };
  }
}

// ---- 1:1 pairing (2026-07-23 需求: 那个愿意共享生活点滴的人) ----------------

export interface PairingStatus {
  paired: boolean;
  partner: { userId: string; displayName: string } | null;
  relationship?: string | null;
  relationshipSince?: string | null;
  pairedDays?: number;
}

/** Cached pairing snapshot — tabs paint from this instantly on open. */
export function getCachedPairing(): PairingStatus | null {
  try {
    const raw = storage.getString(kPairingStatus.name);
    if (raw) return JSON.parse(raw) as PairingStatus;
  } catch { /* fall through */ }
  return null;
}

export async function fetchPairing(): Promise<PairingStatus> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { paired: false, partner: null };
  try {
    const data = await apiClient.get<{ success?: boolean } & PairingStatus>(
      `/api/friends/pair?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) return getCachedPairing() ?? { paired: false, partner: null };
    const status: PairingStatus = {
      paired: !!data.paired,
      partner: data.partner ?? null,
      relationship: data.relationship ?? null,
      relationshipSince: data.relationshipSince ?? null,
      pairedDays: data.pairedDays ?? 0,
    };
    storage.set(kPairingStatus.name, JSON.stringify(status));
    return status;
  } catch {
    return getCachedPairing() ?? { paired: false, partner: null };
  }
}

/** Pair with an accepted friend. Errors map to a short reason for the UI. */
export async function setPairing(
  friendUserId: string,
): Promise<{ ok: boolean; error?: 'not_friends' | 'already_paired' | 'partner_already_paired' | 'network' }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string }>(
      '/api/friends/pair',
      { userId, friendUserId },
    );
    if (data.success) return { ok: true };
    const e = data.error;
    if (e === 'not_friends' || e === 'already_paired' || e === 'partner_already_paired') {
      return { ok: false, error: e };
    }
    return { ok: false, error: 'network' };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    if (e === 'not_friends' || e === 'already_paired' || e === 'partner_already_paired') {
      return { ok: false, error: e };
    }
    return { ok: false, error: 'network' };
  }
}

export async function unsetPairing(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.delete<{ success?: boolean }>('/api/friends/pair', { userId });
    return !!data.success;
  } catch {
    return false;
  }
}

/** The partner's icon stream for one day (widget + paired view). */
export interface PairedFeed {
  paired: boolean;
  partner: { userId: string; displayName: string } | null;
  date: string;
  items: { itemId: string; reflectId: string; createdAt: string }[];
}

export async function fetchPairedFeed(date?: string): Promise<PairedFeed> {
  const empty: PairedFeed = { paired: false, partner: null, date: date ?? localDateStr(), items: [] };
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return empty;
  try {
    const d = date ?? localDateStr();
    const data = await apiClient.get<{ success?: boolean } & PairedFeed>(
      `/api/friends/paired-feed?userId=${encodeURIComponent(userId)}&date=${d}`,
    );
    if (!data.success) return empty;
    return { paired: !!data.paired, partner: data.partner ?? null, date: data.date ?? d, items: data.items ?? [] };
  } catch {
    return empty;
  }
}

// ---- Connection Dashboard (2026-07-24) --------------------------------------

export interface CommonItem {
  itemId: string;
  mine: { text: string; reflectId: string; createdAt: string };
  partner: { text: string | null; createdAt: string };
}

/** 板块3: up to 8 items both members reflected recently. */
export function getCachedCommonItems(): CommonItem[] {
  try {
    const raw = storage.getString(kCommonItems.name);
    if (raw) return JSON.parse(raw) as CommonItem[];
  } catch { /* fall through */ }
  return [];
}

export async function fetchCommonItems(): Promise<CommonItem[]> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return [];
  try {
    const data = await apiClient.get<{ success?: boolean; items?: CommonItem[] }>(
      `/api/friends/common-items?userId=${encodeURIComponent(userId)}`,
    );
    if (!data.success) return getCachedCommonItems();
    const items = data.items ?? [];
    storage.set(kCommonItems.name, JSON.stringify(items));
    return items;
  } catch {
    return getCachedCommonItems();
  }
}

export interface ConnectionInsights {
  emotion: string | null;
  topic: string | null;
  careTips: string | null;
  boundaries: string | null;
  hangoutIdeas: string | null;
}

export type InsightsResult =
  | { ok: true; insights: ConnectionInsights | null }
  | { ok: false; error: 'plus_required' | 'consent_required' | 'network' };

export function getCachedInsights(): InsightsResult | null {
  try {
    const raw = storage.getString(kConnInsights.name);
    if (raw) return JSON.parse(raw) as InsightsResult;
  } catch { /* fall through */ }
  return null;
}

/** 板块4 (Plus): daily AI guidance about the partner. */
export async function fetchInsights(): Promise<
  { ok: true; insights: ConnectionInsights | null } | { ok: false; error: 'plus_required' | 'consent_required' | 'network' }
> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const data = await apiClient.get<{ success?: boolean; error?: string; insights?: ConnectionInsights | null }>(
      `/api/friends/insights?userId=${encodeURIComponent(userId)}&date=${date}`,
    );
    if (data.success) {
      const res: InsightsResult = { ok: true, insights: data.insights ?? null };
      storage.set(kConnInsights.name, JSON.stringify(res));
      return res;
    }
    if (data.error === 'plus_required' || data.error === 'consent_required') {
      const res: InsightsResult = { ok: false, error: data.error };
      storage.set(kConnInsights.name, JSON.stringify(res));
      return res;
    }
    return getCachedInsights() ?? { ok: false, error: 'network' };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    if (e === 'plus_required' || e === 'consent_required') return { ok: false, error: e };
    return getCachedInsights() ?? { ok: false, error: 'network' };
  }
}
