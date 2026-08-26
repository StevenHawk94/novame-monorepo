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
import { kCommonItems, kConnInsights, kFriendsFeed, kFriendsStatus, kPairingStatus, kSharedBoxState } from '../shared/storage/keys';
import { localDateKey, patchAnalysisCache, readAnalysisCache } from './connection-analysis-cache';
import { shouldResumeAfterAbsence } from './analysis-refresh-policy';
import { fetchSubscriptionTier } from './subscription';
import { cacheTheirItemsFromFeed } from './bags-api';

export interface FriendCard {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** false only when they uploaded a real avatar; default art renders client-side. */
  isDefaultAvatar?: boolean;
  todayItemIds: string[];
  todayEmoji: string[]; // decorated from dictionary
}

export interface PendingRequest {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** false only when they uploaded a real avatar; default art renders client-side. */
  isDefaultAvatar?: boolean;
  /** The relationship proposed on the invitation (2026-07-24 pairing flow). */
  relationship?: string | null;
}

export interface SentRequest {
  friendshipId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** false only when they uploaded a real avatar; default art renders client-side. */
  isDefaultAvatar?: boolean;
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
const FRIENDS_CACHE_MAX_AGE_MS = 5 * 60_000;

interface FriendsStatusCache {
  status: FriendsStatus;
  fetchedAtMs: number;
  localDate: string;
}

interface FriendsFeedCache {
  feed: FeedEntry[];
  fetchedAtMs: number;
  localDate: string;
}

let friendsStatusRequest: Promise<FriendsStatus> | null = null;
let friendsStatusForcedFollowup: Promise<FriendsStatus> | null = null;
let friendsFeedRequest: Promise<FeedEntry[]> | null = null;

function readFriendsStatusCache(): FriendsStatusCache | null {
  try {
    const raw = storage.getString(kFriendsStatus.name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FriendsStatusCache | FriendsStatus;
    if ('status' in parsed && parsed.status) return parsed;
    return { status: parsed as FriendsStatus, fetchedAtMs: 0, localDate: '' };
  } catch { return null; }
}

function readFriendsFeedCache(): FriendsFeedCache | null {
  try {
    const raw = storage.getString(kFriendsFeed.name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FriendsFeedCache | FeedEntry[];
    if (Array.isArray(parsed)) return { feed: parsed, fetchedAtMs: 0, localDate: '' };
    if (Array.isArray(parsed.feed)) return parsed;
  } catch { /* fall through */ }
  return null;
}

/** Last good status — the tab paints this instantly, then revalidates. */
export function getCachedFriends(): FriendsStatus {
  return readFriendsStatusCache()?.status ?? EMPTY_STATUS;
}

/** Last good Messages feed. */
export function getCachedFriendFeed(): FeedEntry[] {
  return readFriendsFeedCache()?.feed ?? [];
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

export function fetchFriends(options?: { force?: boolean }): Promise<FriendsStatus> {
  const today = localDateStr();
  const cached = readFriendsStatusCache();
  if (!options?.force && cached && cached.localDate === today
    && Date.now() - cached.fetchedAtMs < FRIENDS_CACHE_MAX_AGE_MS) {
    return Promise.resolve(cached.status);
  }
  if (friendsStatusRequest) {
    if (!options?.force) return friendsStatusRequest;
    // A force refresh is an explicit invalidation signal. Reusing a request
    // that began before that signal can return the exact stale snapshot the
    // caller is trying to replace, so queue one (and only one) follow-up.
    if (!friendsStatusForcedFollowup) {
      friendsStatusForcedFollowup = friendsStatusRequest
        .then(() => fetchFriends({ force: true }))
        .finally(() => { friendsStatusForcedFollowup = null; });
    }
    return friendsStatusForcedFollowup;
  }
  const request = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return EMPTY_STATUS;

    try {
      const data = await apiClient.get<{
        success?: boolean;
        inviteCode?: string | null;
        friends?: { userId: string; displayName: string; avatarUrl?: string; isDefaultAvatar?: boolean; todayItemIds: string[] }[];
        pending?: PendingRequest[];
        sent?: SentRequest[];
      }>(`/api/friends/status?userId=${encodeURIComponent(userId)}&localDate=${today}`);
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
      storage.set(kFriendsStatus.name, JSON.stringify({
        status,
        fetchedAtMs: Date.now(),
        localDate: today,
      } satisfies FriendsStatusCache));
      return status;
    } catch {
      return getCachedFriends();
    }
  })().finally(() => { friendsStatusRequest = null; });
  friendsStatusRequest = request;
  return request;
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
    await fetchFriends({ force: true }).catch(() => null);
    return { ok: true, requestedTo: data.requestedTo };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    return { ok: false, error: e || 'network' };
  }
}

/** Resolve a Pair ID to a name WITHOUT sending anything (search-result card). */
export async function previewFriend(
  code: string,
): Promise<{ ok: boolean; targetName?: string; targetUserId?: string; targetAvatarUrl?: string; targetIsDefaultAvatar?: boolean; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{
      success?: boolean;
      error?: string;
      targetName?: string;
      targetUserId?: string;
      targetAvatarUrl?: string;
      targetIsDefaultAvatar?: boolean;
    }>(
      '/api/friends/add',
      { userId, code, preview: true },
    );
    if (data.error) return { ok: false, error: data.error };
    return {
      ok: true,
      targetName: data.targetName,
      targetUserId: data.targetUserId,
      targetAvatarUrl: data.targetAvatarUrl,
      targetIsDefaultAvatar: data.targetIsDefaultAvatar,
    };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    return { ok: false, error: e || 'network' };
  }
}

export async function respondFriend(
  friendshipId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'no_session' };
  try {
    const data = await apiClient.post<{ success?: boolean; error?: string }>(
      '/api/friends/respond', { userId, friendshipId, action: 'accept' },
    );
    if (data.error) return { ok: false, error: data.error };
    // Pair acceptance can grant this free account its partner's Duo seat.
    // Refresh the local entitlement before returning so every screen opened
    // immediately afterwards sees Plus without requiring an app restart.
    await Promise.all([
      fetchSubscriptionTier(userId, { force: true }).catch(() => null),
      fetchFriends({ force: true }).catch(() => null),
      fetchPairing({ force: true }).catch(() => null),
      fetchFriendFeed(undefined, { force: true }).catch(() => null),
    ]);
    return { ok: true };
  } catch (err) {
    const error = (err as { body?: { error?: string } })?.body?.error;
    return { ok: false, error: error || 'network' };
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
  friendAvatarUrl?: string;
  friendIsDefaultAvatar?: boolean;
  reflectId: string;
  createdAt: string;
  localDate?: string;
  itemIds: string[];
  emoji: string[]; // decorated from the shared dictionary
  /** Present ONLY when that friend opted into sharing details (server-enforced). */
  details: FeedDetail[] | null;
  sharesDetails: boolean;
  unread: boolean;
}

/** The Messages list: friends' recent memories, unread first. */
export function fetchFriendFeed(
  range?: { start: string; end: string },
  options?: { force?: boolean },
): Promise<FeedEntry[]> {
  const today = localDateStr();
  const cached = readFriendsFeedCache();
  if (!range && !options?.force && cached && cached.localDate === today
    && Date.now() - cached.fetchedAtMs < FRIENDS_CACHE_MAX_AGE_MS) {
    return Promise.resolve(cached.feed);
  }
  if (!range && friendsFeedRequest) return friendsFeedRequest;
  const request = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return [];
    try {
      const data = await apiClient.get<{ success?: boolean; feed?: Omit<FeedEntry, 'emoji'>[] }>(
        `/api/friends/feed?userId=${encodeURIComponent(userId)}${range ? `&start=${range.start}&end=${range.end}` : ''}`,
      );
      if (!data.success || !data.feed) return range ? [] : getCachedFriendFeed();
      const feed = data.feed.map((e) => ({ ...e, emoji: e.itemIds.map(emojiFor) }));
      if (!range) {
        storage.set(kFriendsFeed.name, JSON.stringify({
          feed,
          fetchedAtMs: Date.now(),
          localDate: today,
        } satisfies FriendsFeedCache));
        const byOwner = new Map<string, FeedEntry[]>();
        for (const entry of feed) {
          const current = byOwner.get(entry.friendUserId) ?? [];
          current.push(entry);
          byOwner.set(entry.friendUserId, current);
        }
        for (const [ownerUserId, entries] of byOwner) cacheTheirItemsFromFeed(ownerUserId, entries);
        void syncWidgetLatestFriend(feed);
      }
      return feed;
    } catch {
      return range ? [] : getCachedFriendFeed();
    }
  })().finally(() => {
    if (!range) friendsFeedRequest = null;
  });
  if (!range) friendsFeedRequest = request;
  return request;
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

/** My detail-sharing switch (2026-08-10 ruling: default ON — users hide
 * individual reflects from the post-reflect reward screen instead). */
export type MemoryDetailsMode = 'all' | 'none' | 'custom';

export async function fetchSharePrivacy(): Promise<MemoryDetailsMode> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return 'custom';
  try {
    const data = await apiClient.get<{ success?: boolean; share?: boolean; mode?: MemoryDetailsMode }>(
      `/api/friends/privacy?userId=${encodeURIComponent(userId)}`,
    );
    return data.mode ?? (data.share === false ? 'none' : 'custom');
  } catch {
    return 'custom';
  }
}

export async function setSharePrivacy(mode: MemoryDetailsMode): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/friends/privacy', {
      userId,
      mode,
    });
    if (data.success) void fetchFriendFeed(undefined, { force: true });
    return !!data.success;
  } catch {
    return false;
  }
}

export const GOOD_VIBE_MESSAGES = [
  'Love you to bits!',
  'So grateful for you.',
  'Always by your side.',
  'You mean the world.',
  'Rooting for you always!',
  'Good things are coming.',
  "You've got this!",
  'Keep shining your light.',
  'Ride or Die, No Cap',
  'Proud of you, always.',
  'Sending a big hug!',
  'Thinking of you today.',
  "Tomorrow's a fresh start.",
  'Delulu is the Solulu.',
  "Don't Let Idiots Ruin Your Day.",
  'Main Character Energy Only!',
  'More Espresso, Less Depresso.',
  'In My Rest & Healing Era.',
  'Slay the Day, Then Take a Nap.',
  'Kindness is Cool, Drama is Not.',
  'Overthinking, but Make it Cute.',
  'Every day counts, truly.',
  'Big wins ahead today!',
  'Forever on Your Team!',
  'My Favorite Notification Is You.',
] as const;

export interface GoodVibeInboxItem {
  id: string;
  senderUserId: string;
  senderName: string;
  senderAvatarUrl?: string;
  senderIsDefaultAvatar?: boolean;
  messageIndex: number;
  message: string;
  createdAt: string;
  messageType: 'initial' | 'reply';
  canReply: boolean;
}

export async function fetchUnreadGoodVibe(): Promise<GoodVibeInboxItem | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  try {
    const result = await apiClient.get<{ success?: boolean; vibe?: GoodVibeInboxItem | null }>(
      `/api/friends/good-vibes?userId=${encodeURIComponent(userId)}&localDate=${localDateStr()}`,
    );
    return result.vibe ?? null;
  } catch { return null; }
}

export async function sendGoodVibe(messageIndex: number, replyToId?: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    await apiClient.post('/api/friends/good-vibes', {
      userId, messageIndex, localDate: localDateStr(), replyToId,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as { body?: { error?: string } })?.body?.error || 'network' };
  }
}

export async function markGoodVibeRead(vibeId: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return;
  try { await apiClient.post('/api/friends/good-vibes', { userId, action: 'read', vibeId }); } catch { /* retry next foreground */ }
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

export interface SharedBoxResult {
  items: SharedBoxItem[];
  hasUnreadFromPartner: boolean;
  readThrough: string;
  /** False means another server page may exist below the cached rows. */
  historyComplete: boolean;
  /** Last successful refresh of the newest page, not a pagination request. */
  fetchedAt: number;
  nextBeforeCreatedAt?: string | null;
  nextBeforeId?: string | null;
}

interface SharedBoxCache {
  friendUserId: string;
  result: SharedBoxResult;
}

export function getCachedSharedBox(friendUserId?: string): SharedBoxResult {
  const empty: SharedBoxResult = {
    items: [],
    hasUnreadFromPartner: false,
    readThrough: new Date(0).toISOString(),
    historyComplete: false,
    fetchedAt: 0,
  };
  const raw = storage.getString(kSharedBoxState.name);
  if (!raw) return empty;
  try {
    const cached = JSON.parse(raw) as SharedBoxCache;
    if (friendUserId && cached.friendUserId !== friendUserId) return empty;
    if (!cached.result || !Array.isArray(cached.result.items)) return empty;
    return {
      ...cached.result,
      historyComplete: cached.result.historyComplete ?? false,
      fetchedAt: cached.result.fetchedAt ?? 0,
      nextBeforeCreatedAt: cached.result.nextBeforeCreatedAt ?? null,
      nextBeforeId: cached.result.nextBeforeId ?? null,
    };
  } catch { return empty; }
}

export interface SharedBoxChange {
  friendUserId: string;
  items: SharedBoxItem[];
  /** A remote database invalidation must bypass only the Ours TTL once. */
  forceRefresh?: boolean;
}

type SharedBoxChangeListener = (change: SharedBoxChange) => void;
const sharedBoxChangeListeners = new Set<SharedBoxChangeListener>();
const sharedBoxFetchGenerations = new Map<string, number>();
const sharedBoxAppliedGenerations = new Map<string, number>();
const sharedBoxFirstRequests = new Map<string, Promise<SharedBoxResult>>();
const sharedBoxMoreRequests = new Map<string, Promise<SharedBoxResult>>();
const SHARED_BOX_PAGE_SIZE = 100;
const SHARED_BOX_CACHE_MAX_AGE_MS = 5 * 60_000;

function mergeSharedBoxItems(current: SharedBoxItem[], incoming: SharedBoxItem[]): SharedBoxItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function cacheSharedBox(friendUserId: string, result: SharedBoxResult): void {
  storage.set(kSharedBoxState.name, JSON.stringify({ friendUserId, result } satisfies SharedBoxCache));
}

export function isSharedBoxCacheStale(friendUserId: string, maxAgeMs = SHARED_BOX_CACHE_MAX_AGE_MS): boolean {
  const cached = getCachedSharedBox(friendUserId);
  return cached.fetchedAt === 0 || Date.now() - cached.fetchedAt >= maxAgeMs;
}

interface SharedBoxWireResponse {
  success?: boolean;
  hasUnreadFromPartner?: boolean;
  readThrough?: string;
  hasMore?: boolean;
  nextBeforeCreatedAt?: string | null;
  nextBeforeId?: string | null;
  items?: { id: string; author_user_id: string; item_id: string; description: string; source: 'manual' | 'reflect'; created_at: string }[];
}

function mapSharedBoxRows(rows: NonNullable<SharedBoxWireResponse['items']>): SharedBoxItem[] {
  return rows.map((row) => ({
    id: row.id,
    authorUserId: row.author_user_id,
    itemId: row.item_id,
    emoji: emojiFor(row.item_id),
    description: row.description,
    source: row.source,
    createdAt: row.created_at,
  }));
}

/**
 * The creator screen is pushed above the Memories tab, so on some Expo Router
 * stacks the tab never actually loses focus. A small in-process signal makes
 * the mounted Ours collection refresh immediately after a successful create
 * instead of waiting for the user to switch tabs.
 */
export function subscribeSharedBoxChanges(listener: SharedBoxChangeListener): () => void {
  sharedBoxChangeListeners.add(listener);
  return () => sharedBoxChangeListeners.delete(listener);
}

export function notifySharedBoxChanged(friendUserId: string, items: SharedBoxItem[] = []): void {
  if (items.length > 0) {
    const cached = getCachedSharedBox(friendUserId);
    cacheSharedBox(friendUserId, {
      ...cached,
      items: mergeSharedBoxItems(cached.items, items),
    });
  }
  const change = { friendUserId, items } satisfies SharedBoxChange;
  for (const listener of sharedBoxChangeListeners) listener(change);
}

/**
 * Apply the partner's tiny realtime invalidation without polling. The existing
 * five-minute TTL remains the delivery fallback; setting fetchedAt to zero
 * only makes the next Ours read refresh immediately after this explicit event.
 */
export function notifyRemoteSharedBoxChanged(friendUserId: string): void {
  if (!friendUserId) return;
  const cached = getCachedSharedBox(friendUserId);
  cacheSharedBox(friendUserId, {
    ...cached,
    hasUnreadFromPartner: true,
    fetchedAt: 0,
  });
  const change = {
    friendUserId,
    items: [],
    forceRefresh: true,
  } satisfies SharedBoxChange;
  for (const listener of sharedBoxChangeListeners) listener(change);
}

/** The shared memory box with one friend. */
export async function fetchSharedBox(friendUserId: string, options?: { force?: boolean }): Promise<SharedBoxItem[]> {
  return (await fetchSharedBoxWithMeta(friendUserId, options)).items;
}

export function fetchSharedBoxWithMeta(
  friendUserId: string,
  options?: { force?: boolean },
): Promise<SharedBoxResult> {
  if (!options?.force && !isSharedBoxCacheStale(friendUserId)) {
    return Promise.resolve(getCachedSharedBox(friendUserId));
  }
  const inflight = sharedBoxFirstRequests.get(friendUserId);
  if (inflight) return inflight;
  const request = (async () => {
  const generation = (sharedBoxFetchGenerations.get(friendUserId) ?? 0) + 1;
  sharedBoxFetchGenerations.set(friendUserId, generation);
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return getCachedSharedBox(friendUserId);
  try {
    const data = await apiClient.get<SharedBoxWireResponse>(
      `/api/friends/box?userId=${encodeURIComponent(userId)}&friendUserId=${encodeURIComponent(friendUserId)}&limit=${SHARED_BOX_PAGE_SIZE}`,
    );
    if (!data.success || !data.items) return getCachedSharedBox(friendUserId);
    const serverItems = mapSharedBoxRows(data.items);
    const appliedGeneration = sharedBoxAppliedGenerations.get(friendUserId) ?? 0;
    if (generation < appliedGeneration) return getCachedSharedBox(friendUserId);
    // Shared rows are append-only. Preserve optimistic rows that may not have
    // reached a racing full response yet; matching ids from the server win so
    // refined descriptions are reconciled in the background.
    const cached = getCachedSharedBox(friendUserId);
    const result: SharedBoxResult = {
      items: mergeSharedBoxItems(cached.items, serverItems),
      hasUnreadFromPartner: !!data.hasUnreadFromPartner,
      readThrough: data.readThrough || new Date(0).toISOString(),
      // A latest-page refresh cannot make already cached deeper history
      // incomplete. Only an empty/first cache takes the server flag directly.
      historyComplete: cached.items.length > serverItems.length
        ? cached.historyComplete
        : !data.hasMore,
      fetchedAt: Date.now(),
      nextBeforeCreatedAt: cached.items.length > serverItems.length
        ? cached.nextBeforeCreatedAt ?? null
        : data.nextBeforeCreatedAt ?? null,
      nextBeforeId: cached.items.length > serverItems.length
        ? cached.nextBeforeId ?? null
        : data.nextBeforeId ?? null,
    };
    cacheSharedBox(friendUserId, result);
    sharedBoxAppliedGenerations.set(friendUserId, generation);
    return result;
  } catch {
    return getCachedSharedBox(friendUserId);
  }
  })().finally(() => sharedBoxFirstRequests.delete(friendUserId));
  sharedBoxFirstRequests.set(friendUserId, request);
  return request;
}

/** Fetch one older Ours page. Concurrent FlatList end events share one promise. */
export function fetchMoreSharedBox(friendUserId: string): Promise<SharedBoxResult> {
  const existing = sharedBoxMoreRequests.get(friendUserId);
  if (existing) return existing;
  const request = (async () => {
    const cached = getCachedSharedBox(friendUserId);
    if (cached.historyComplete || cached.items.length === 0) return cached;
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return cached;
    try {
      const oldest = cached.items[cached.items.length - 1];
      const cursorCreatedAt = cached.nextBeforeCreatedAt || oldest.createdAt;
      const cursorId = cached.nextBeforeId || oldest.id;
      const data = await apiClient.get<SharedBoxWireResponse>(
        `/api/friends/box?userId=${encodeURIComponent(userId)}&friendUserId=${encodeURIComponent(friendUserId)}&limit=${SHARED_BOX_PAGE_SIZE}&beforeCreatedAt=${encodeURIComponent(cursorCreatedAt)}&beforeId=${encodeURIComponent(cursorId)}`,
      );
      if (!data.success || !data.items) return getCachedSharedBox(friendUserId);
      const current = getCachedSharedBox(friendUserId);
      const mergedItems = mergeSharedBoxItems(current.items, mapSharedBoxRows(data.items));
      const result: SharedBoxResult = {
        ...current,
        items: mergedItems,
        historyComplete: !data.hasMore,
        nextBeforeCreatedAt: data.nextBeforeCreatedAt ?? null,
        nextBeforeId: data.nextBeforeId ?? null,
      };
      cacheSharedBox(friendUserId, result);
      return result;
    } catch {
      return getCachedSharedBox(friendUserId);
    }
  })().finally(() => sharedBoxMoreRequests.delete(friendUserId));
  sharedBoxMoreRequests.set(friendUserId, request);
  return request;
}

export async function markSharedBoxRead(friendUserId: string, readThrough: string): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/friends/box', {
      userId, friendUserId, action: 'read', readThrough,
    });
    if (data.success) {
      const cached = getCachedSharedBox(friendUserId);
      storage.set(kSharedBoxState.name, JSON.stringify({
        friendUserId,
        result: { ...cached, hasUnreadFromPartner: false, readThrough },
      } satisfies SharedBoxCache));
    }
    return !!data.success;
  } catch { return false; }
}

// ---- 1:1 pairing (2026-07-23 需求: 那个愿意共享生活点滴的人) ----------------

export interface PairingStatus {
  paired: boolean;
  partner: { userId: string; displayName: string; avatarUrl?: string; isDefaultAvatar?: boolean } | null;
  relationship?: string | null;
  relationshipSince?: string | null;
  pairedAt?: string | null;
  pairedDays?: number;
  fetchedAt?: number;
}

const PAIRING_CACHE_MAX_AGE_MS = 5 * 60_000;
let pairingRequest: Promise<PairingStatus> | null = null;

export function isPairingCacheStale(maxAgeMs = 5 * 60_000): boolean {
  const cached = getCachedPairing();
  return !cached?.fetchedAt || Date.now() - cached.fetchedAt >= maxAgeMs;
}

/** Cached pairing snapshot — tabs paint from this instantly on open. */
export function getCachedPairing(): PairingStatus | null {
  try {
    const raw = storage.getString(kPairingStatus.name);
    if (raw) return JSON.parse(raw) as PairingStatus;
  } catch { /* fall through */ }
  return null;
}

export function fetchPairing(options?: { force?: boolean }): Promise<PairingStatus> {
  const cached = getCachedPairing();
  if (!options?.force && cached?.fetchedAt
    && Date.now() - cached.fetchedAt < PAIRING_CACHE_MAX_AGE_MS) {
    return Promise.resolve(cached);
  }
  if (pairingRequest) return pairingRequest;
  const request = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return { paired: false, partner: null } satisfies PairingStatus;
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
        pairedAt: data.pairedAt ?? null,
        pairedDays: data.pairedDays ?? 0,
        fetchedAt: Date.now(),
      };
      storage.set(kPairingStatus.name, JSON.stringify(status));
      return status;
    } catch {
      return getCachedPairing() ?? { paired: false, partner: null };
    }
  })().finally(() => { pairingRequest = null; });
  pairingRequest = request;
  return request;
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
    if (data.success) {
      await Promise.all([
        fetchPairing({ force: true }).catch(() => null),
        fetchFriends({ force: true }).catch(() => null),
      ]);
      return { ok: true };
    }
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
    if (!data.success) return false;
    storage.set(kPairingStatus.name, JSON.stringify({
      paired: false,
      partner: null,
      fetchedAt: Date.now(),
    } satisfies PairingStatus));
    storage.remove(kCommonItems.name);
    storage.remove(kFriendsStatus.name);
    storage.remove(kFriendsFeed.name);
    storage.remove(kSharedBoxState.name);
    storage.remove(kConnInsights.name);
    return true;
  } catch {
    return false;
  }
}

/** The partner's icon stream for one day (widget + paired view). */
export interface PairedFeed {
  paired: boolean;
  partner: { userId: string; displayName: string; avatarUrl?: string; isDefaultAvatar?: boolean } | null;
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

export type ConnectionModuleKey =
  | 'worth_knowing'
  | 'recent_vibe'
  | 'what_theyre_into'
  | 'how_to_show_up'
  | 'talk_about'
  | 'try_together'
  | 'shared_rhythm';

export interface ConnectionInsightCard {
  label: string;
  headline: string | null;
  body: string;
  supportingText: string | null;
  action: string | null;
}

export interface ConnectionInsights {
  schemaVersion: 2;
  modules: Record<ConnectionModuleKey, ConnectionInsightCard[]>;
  updatedAt?: string;
  lastProcessedReflectId?: string;
}

export type ConnectionHistorySection = 'missed' | 'world' | 'ways_in' | 'between';

export interface ConnectionHistoryCard extends ConnectionInsightCard {
  id: string;
  section: ConnectionHistorySection;
  moduleKey: ConnectionModuleKey;
  date: string;
  createdAt: string;
}

export type ConnectionHistoryResult =
  | { ok: true; paired: boolean; unavailable?: boolean; cards: ConnectionHistoryCard[] }
  | { ok: false; error: 'plus_required' | 'network' };

type ConnectionHistoryListener = (result: ConnectionHistoryResult) => void;

const connectionHistoryListeners = new Set<ConnectionHistoryListener>();
let connectionHistoryRequest: Promise<ConnectionHistoryResult> | null = null;

export type InsightsResult =
  | { ok: true; insights: ConnectionInsights | null; refreshPending?: boolean; resumed?: boolean }
  | { ok: false; error: 'plus_required' | 'network' };

export function getCachedInsights(): InsightsResult | null {
  return (readAnalysisCache().insights as InsightsResult | undefined) ?? null;
}

export function getCachedConnectionHistory(): ConnectionHistoryResult | null {
  const cached = readAnalysisCache().history as ConnectionHistoryResult | undefined;
  return cached?.ok === true ? cached : null;
}

export function subscribeConnectionHistory(listener: ConnectionHistoryListener): () => void {
  connectionHistoryListeners.add(listener);
  return () => connectionHistoryListeners.delete(listener);
}

function publishConnectionHistory(result: ConnectionHistoryResult): void {
  for (const listener of connectionHistoryListeners) {
    try {
      listener(result);
    } catch (error) {
      console.warn('[connection-history] listener failed:', error);
    }
  }
}

/** Cache-first daily reconciliation, plus a one-time refresh after 48h away. */
export function shouldRefreshConnectionDashboard(): boolean {
  const cache = readAnalysisCache();
  return cache.dashboardDate !== localDateKey()
    || shouldResumeAfterAbsence(2, cache.dashboardFetchedAt);
}

/** Long-absence UI signal captured before foreground activity updates the API. */
export function shouldShowConnectionResumeLoading(): boolean {
  return shouldResumeAfterAbsence(2, readAnalysisCache().dashboardFetchedAt);
}

export function markConnectionDashboardRefreshed(): void {
  patchAnalysisCache({ dashboardDate: localDateKey(), dashboardFetchedAt: Date.now() });
}

/** Plus Connection modules. The server may catch up one latest reflection. */
export async function fetchInsights(options?: { resume?: boolean }): Promise<
  { ok: true; insights: ConnectionInsights | null; refreshPending?: boolean; resumed?: boolean }
  | { ok: false; error: 'plus_required' | 'network' }
> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  const date = localDateKey();
  try {
    const data = await apiClient.get<{
      success?: boolean;
      error?: string;
      insights?: ConnectionInsights | null;
      refreshPending?: boolean;
      resumed?: boolean;
    }>(
      `/api/friends/insights?userId=${encodeURIComponent(userId)}&date=${date}&intent=view${options?.resume ? '&resume=1' : ''}`,
    );
    if (data.success) {
      const cachedResult: InsightsResult = { ok: true, insights: data.insights ?? null };
      patchAnalysisCache({ insights: cachedResult });
      return {
        ...cachedResult,
        refreshPending: data.refreshPending === true,
        resumed: data.resumed === true,
      };
    }
    if (data.error === 'plus_required') {
      const res: InsightsResult = { ok: false, error: 'plus_required' };
      patchAnalysisCache({ insights: res });
      return res;
    }
    return getCachedInsights() ?? { ok: false, error: 'network' };
  } catch (err) {
    const e = (err as { body?: { error?: string } })?.body?.error;
    if (e === 'plus_required') return { ok: false, error: e };
    return getCachedInsights() ?? { ok: false, error: 'network' };
  }
}

function mergeConnectionHistoryCards(
  cached: ConnectionHistoryCard[],
  incoming: ConnectionHistoryCard[],
): ConnectionHistoryCard[] {
  const byId = new Map<string, ConnectionHistoryCard>();
  for (const card of [...cached, ...incoming]) {
    if (card?.id) byId.set(card.id, card);
  }
  return [...byId.values()].sort((a, b) => {
    const dateOrder = b.date.localeCompare(a.date);
    if (dateOrder !== 0) return dateOrder;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Append-only Connection cards. Full history is cached locally; Realtime and
 * reconnects request only rows at/after the newest cached timestamp, then
 * de-duplicate by immutable history id.
 */
export async function fetchConnectionHistory(options?: {
  start?: string | null;
  end?: string | null;
  incremental?: boolean;
  force?: boolean;
}): Promise<ConnectionHistoryResult> {
  const cacheable = !options?.start && !options?.end;
  const cached = cacheable ? getCachedConnectionHistory() : null;
  if (!options?.force && !options?.incremental && cached) return cached;
  if (cacheable && connectionHistoryRequest) return connectionHistoryRequest;

  const request = (async (): Promise<ConnectionHistoryResult> => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return { ok: false, error: 'network' };
    const params = new URLSearchParams({ userId });
    if (options?.start) params.set('start', options.start);
    if (options?.end) params.set('end', options.end);
    if (cacheable && options?.incremental && cached?.ok && cached.cards.length > 0) {
      params.set('since', cached.cards.reduce((latest, card) => (
        card.createdAt > latest ? card.createdAt : latest
      ), cached.cards[0].createdAt));
    }
    try {
      const result = await apiClient.get<{
        success?: boolean;
        paired?: boolean;
        unavailable?: boolean;
        cards?: ConnectionHistoryCard[];
        error?: string;
      }>(`/api/friends/insights/history?${params.toString()}`);
      if (result.success) {
        const next: ConnectionHistoryResult = {
          ok: true,
          paired: result.paired === true,
          unavailable: result.unavailable === true,
          cards: cacheable && options?.incremental && cached?.ok
            ? mergeConnectionHistoryCards(cached.cards, Array.isArray(result.cards) ? result.cards : [])
            : (Array.isArray(result.cards) ? result.cards : []),
        };
        if (cacheable) {
          patchAnalysisCache({ history: next, historyFetchedAt: Date.now() });
          publishConnectionHistory(next);
        }
        return next;
      }
      return cached ?? { ok: false, error: result.error === 'plus_required' ? 'plus_required' : 'network' };
    } catch (error) {
      const code = (error as { body?: { error?: string } })?.body?.error;
      return cached ?? { ok: false, error: code === 'plus_required' ? 'plus_required' : 'network' };
    }
  })().finally(() => {
    if (connectionHistoryRequest === request) connectionHistoryRequest = null;
  });

  if (cacheable) connectionHistoryRequest = request;
  return request;
}
