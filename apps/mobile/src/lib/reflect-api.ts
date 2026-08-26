/**
 * Reflect submission + local cache.
 *
 * submitReflect posts to /api/reflect, which computes the numbers with the
 * engine and writes them through the submit_reflect RPC, then returns a
 * complete snapshot. We adopt that snapshot as-is (server authority): the cache
 * is a read-only shadow of what the server returned, never a local computation.
 *
 * The cache (kReflectState) holds today's count so the screen can show
 * "N left today" and block a fourth attempt before a round-trip. It is only a
 * fast-path for the UI -- the real limit is the RPC's daily gate, which checks
 * the database under a lock. A stale cache at worst mis-renders for one submit,
 * which the next server response corrects.
 */
import { ApiError } from '@novame/api-client';
import { randomUUID } from 'expo-crypto';

import { apiClient } from './api';
import { confirmCloverAward } from './cosmetics-api';

import { kReflectShareDefaults, kReflectState } from '../shared/storage/keys';
import { storage } from './storage';
import { supabase } from './supabase';

const DAILY_LIMIT = 3;

/** The snapshot /api/reflect returns; the client renders it directly. */
export interface MatchedItem {
  itemId: string;
  displayName: string;
  rarity: string;
  label: string;
  sourceExcerpt?: string;
}

export type MemorySource = 'manual' | 'ai' | 'use_my_words' | 'legacy';

export interface ReflectMemoryDraft {
  itemId: string;
  text: string;
  source: MemorySource;
  visible: boolean;
}

export interface PreparedReflect {
  draftId: string;
  matchedItems: MatchedItem[];
  aiMemories: Record<string, string>;
  bubble: string | null;
  isPaid: boolean;
  reflectsRemaining: number;
}

export interface SharedReflectItem {
  id: string;
  authorUserId: string;
  itemId: string;
  description: string;
  source: 'manual' | 'reflect';
  createdAt: string;
}

export interface ReflectSnapshot {
  reflectId: string;
  xpAwarded: number;
  companionXp: number;
  reflectsToday: number;
  reflectsRemaining: number;
  matchedItems: MatchedItem[];
  /** Shared Memories created by this submission, ready for optimistic merge. */
  sharedItems: SharedReflectItem[];
  bubble: string | null;
  memories?: ReflectMemoryDraft[];
}

export type ReflectError =
  | 'daily_limit' // already reflected 3 times today
  | 'companion_not_ready' // no companion row (should not happen post-onboarding)
  | 'too_long' // body over 5000 chars
  | 'empty' // nothing typed
  | 'plus_required' // Shared Memories creation is a Plus feature
  | 'network'; // request failed / server error

export type SubmitResult =
  | { ok: true; snapshot: ReflectSnapshot }
  | { ok: false; error: ReflectError };

export type PrepareResult =
  | { ok: true; draft: PreparedReflect }
  | { ok: false; error: ReflectError };

interface CachedState {
  date: string; // YYYY-MM-DD (device-local) this count belongs to
  reflectsToday: number;
  lastSnapshot?: ReflectSnapshot;
}

/** Device-local YYYY-MM-DD. The daily boundary follows the user's own day. */
function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readCache(): CachedState | null {
  const raw = storage.getString(kReflectState.name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedState;
  } catch {
    return null;
  }
}

function writeCache(state: CachedState): void {
  storage.set(kReflectState.name, JSON.stringify(state));
}

/**
 * Today's reflect count for the UI. Resets across a day boundary: a cache from
 * a previous date reads as zero today, so the screen re-opens fresh each day
 * without any server call.
 */
/** __DEV__ helper: clear the local reflect count so today resets on device. */
export function clearReflectLocal(): void {
  storage.remove(kReflectState.name);
}

export function getReflectStateToday(): {
  reflectsToday: number;
  reflectsRemaining: number;
} {
  const cache = readCache();
  const today = localDateStr();
  const count = cache && cache.date === today ? cache.reflectsToday : 0;
  return {
    reflectsToday: count,
    reflectsRemaining: Math.max(0, DAILY_LIMIT - count),
  };
}

/** Wire shape from /api/reflect (snake_case from the RPC snapshot). */
interface WireSnapshot {
  success?: boolean;
  error?: string;
  reflect_id?: string;
  xp_awarded?: number;
  companion_xp?: number;
  reflects_today?: number;
  reflects_remaining?: number;
  matchedItems?: MatchedItem[];
  sharedItems?: {
    id: string;
    author_user_id: string;
    item_id: string;
    description: string;
    source: 'manual' | 'reflect';
    created_at: string;
  }[];
  bubble?: string | null;
}

function toSnapshot(w: WireSnapshot): ReflectSnapshot {
  return {
    reflectId: w.reflect_id ?? '',
    xpAwarded: w.xp_awarded ?? 0,
    companionXp: w.companion_xp ?? 0,
    reflectsToday: w.reflects_today ?? 0,
    reflectsRemaining: w.reflects_remaining ?? 0,
    matchedItems: w.matchedItems ?? [],
    sharedItems: (w.sharedItems ?? []).map((item) => ({
      id: item.id,
      authorUserId: item.author_user_id,
      itemId: item.item_id,
      description: item.description,
      source: item.source,
      createdAt: item.created_at,
    })),
    bubble: w.bubble ?? null,
  };
}

export async function prepareReflect(params: {
  promptId: number;
  body: string;
  sourceKit?: 'new_lens';
  friendUserId?: string;
  mode?: 'typing' | 'prompt' | 'items';
  selectedItems?: { itemId: string }[];
  removedItemIds?: string[];
  idempotencyKey?: string;
}): Promise<PrepareResult> {
  const mode = params.mode ?? 'typing';
  const body = params.body.trim();
  if (mode === 'typing' && !body) return { ok: false, error: 'empty' };
  if (mode !== 'typing' && (params.selectedItems?.length ?? 0) === 0) {
    return { ok: false, error: 'empty' };
  }
  if (body.length > 5000) return { ok: false, error: 'too_long' };
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const wire = await apiClient.post<{
      success?: boolean;
      error?: string;
      draftId?: string;
      matches?: MatchedItem[];
      aiMemories?: Record<string, string>;
      bubble?: string | null;
      isPaid?: boolean;
      reflectsRemaining?: number;
    }>('/api/reflect/prepare', {
      userId,
      promptId: params.promptId,
      body,
      localDate: localDateStr(),
      sourceKit: params.sourceKit,
      friendUserId: params.friendUserId,
      mode,
      selectedItems: params.selectedItems,
      removedItemIds: params.removedItemIds,
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
    });
    if (!wire.success || !wire.draftId) return { ok: false, error: 'network' };
    return {
      ok: true,
      draft: {
        draftId: wire.draftId,
        matchedItems: wire.matches ?? [],
        aiMemories: wire.aiMemories ?? {},
        bubble: wire.bubble ?? null,
        isPaid: wire.isPaid === true,
        reflectsRemaining: wire.reflectsRemaining ?? getReflectStateToday().reflectsRemaining,
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return { ok: false, error: 'plus_required' };
    if (error instanceof ApiError && error.status === 409) {
      const code = typeof error.body === 'object' && error.body && 'error' in error.body
        ? error.body.error : '';
      if (code === 'daily_limit_reached') {
        writeCache({ date: localDateStr(), reflectsToday: DAILY_LIMIT });
        return { ok: false, error: 'daily_limit' };
      }
    }
    return { ok: false, error: 'network' };
  }
}

export async function enrichReflectDraft(
  draftId: string,
  emptyItemIds: string[],
): Promise<{ ok: boolean; aiMemories: Record<string, string>; bubble: string | null }> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return { ok: false, aiMemories: {}, bubble: null };
  try {
    const result = await apiClient.post<{
      success?: boolean; aiMemories?: Record<string, string>; bubble?: string | null;
    }>('/api/reflect/enrich', { userId, draftId, emptyItemIds });
    return {
      ok: result.success === true,
      aiMemories: result.aiMemories ?? {},
      bubble: result.bubble ?? null,
    };
  } catch {
    return { ok: false, aiMemories: {}, bubble: null };
  }
}

export async function finalizeReflect(
  draft: PreparedReflect,
  memories: ReflectMemoryDraft[],
): Promise<SubmitResult> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };
  try {
    const wire = await apiClient.post<WireSnapshot>('/api/reflect/finalize', {
      userId,
      draftId: draft.draftId,
      memories: memories.map(({ itemId, text, source }) => ({ itemId, text: text.trim(), source })),
      visibility: memories.map(({ itemId, visible }) => ({ itemId, visible })),
    });
    if (wire.error === 'daily_limit_reached') {
      writeCache({ date: localDateStr(), reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    if (wire.error || !wire.success) return { ok: false, error: 'network' };
    const snapshot = { ...toSnapshot(wire), memories };
    writeCache({ date: localDateStr(), reflectsToday: snapshot.reflectsToday, lastSnapshot: snapshot });
    confirmCloverAward(snapshot.xpAwarded);
    return { ok: true, snapshot };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { ok: false, error: 'plus_required' };
    }
    if (error instanceof ApiError && error.status === 409) {
      writeCache({ date: localDateStr(), reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    return { ok: false, error: 'network' };
  }
}

/**
 * Submit one Reflect. Returns the server snapshot on success, or a typed error
 * the screen maps to a message. Refreshes the local count cache from whichever
 * the server reports -- success or daily_limit both carry the true count.
 */
export async function submitReflect(params: {
  promptId: number;
  body: string;
  /** New Lens routes here with a source tag. */
  sourceKit?: 'new_lens';
  /**
   * Co-creation / 共享回忆开关: matched items also land in the shared memory
   * box with this friend. Server re-verifies the friendship; a bad id just
   * skips the box write, never fails the reflect.
   */
  friendUserId?: string;
  /**
   * Which entry made this reflect (2026-07-23 三流程). 'typing' (default)
   * matches the body server-side; 'prompt' / 'items' submit explicit picks.
   */
  mode?: 'typing' | 'prompt' | 'items';
  /** prompt/items modes: the user's picks; note becomes the memory excerpt. */
  selectedItems?: { itemId: string; note?: string }[];
  /** typing mode: chips dismissed in the live-match bar (remove-only). */
  removedItemIds?: string[];
  /** typing mode: per-item notes from the edit sheet (override the label). */
  itemNotes?: Record<string, string>;
  /** "对好友可见"（细节可见性，结果页 toggle 提交后还可改）. */
  visibleToFriend?: boolean;
}): Promise<SubmitResult> {
  const mode = params.mode ?? 'typing';
  const body = params.body.trim();
  if (mode === 'typing' && body.length === 0) return { ok: false, error: 'empty' };
  if (mode !== 'typing' && (params.selectedItems?.length ?? 0) === 0) {
    return { ok: false, error: 'empty' };
  }
  if (body.length > 5000) return { ok: false, error: 'too_long' };

  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return { ok: false, error: 'network' };

  const today = localDateStr();

  try {
    const data = await apiClient.post<WireSnapshot>('/api/reflect', {
      userId,
      promptId: params.promptId,
      body,
      localDate: today,
      sourceKit: params.sourceKit,
      friendUserId: params.friendUserId,
      mode,
      selectedItems: params.selectedItems,
      removedItemIds: params.removedItemIds,
      itemNotes: params.itemNotes,
      visibleToFriend: params.visibleToFriend,
    });

    if (data.error === 'daily_limit_reached') {
      writeCache({ date: today, reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    if (data.error === 'companion_not_initialized') {
      return { ok: false, error: 'companion_not_ready' };
    }
    if (data.error === 'plus_required') {
      return { ok: false, error: 'plus_required' };
    }
    if (data.error || !data.success) {
      return { ok: false, error: 'network' };
    }

    const snapshot = toSnapshot(data);
    writeCache({
      date: today,
      reflectsToday: snapshot.reflectsToday,
      lastSnapshot: snapshot,
    });
    confirmCloverAward(snapshot.xpAwarded);
    return { ok: true, snapshot };
  } catch (e) {
    if (
      e instanceof ApiError
      && e.status === 403
      && typeof e.body === 'object'
      && e.body !== null
      && 'error' in e.body
      && e.body.error === 'plus_required'
    ) {
      return { ok: false, error: 'plus_required' };
    }
    // ApiError with a 409 carries the daily-limit body; other codes are network.
    if (e instanceof ApiError && e.status === 409) {
      writeCache({ date: today, reflectsToday: DAILY_LIMIT });
      return { ok: false, error: 'daily_limit' };
    }
    return { ok: false, error: 'network' };
  }
}

/**
 * "Add Memories Manually" (claim screen): overwrite this reflect's matched
 * memory excerpts with the user's own words. Fire-and-check; failures are
 * non-fatal (the rule-matched label stays).
 */
export async function editReflectMemories(
  reflectId: string,
  edits: { itemId: string; text: string; source?: MemorySource; visible?: boolean }[],
): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId || edits.length === 0) return false;
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/reflect/edit-memories', {
      userId,
      reflectId,
      edits,
    });
    if (data.success) {
      const cacheKey = reflectMemoryCacheKey(userId, reflectId);
      const cached = reflectMemoryCache.get(cacheKey);
      if (cached) {
        const editsByItem = new Map(edits.map((edit) => [edit.itemId, edit]));
        reflectMemoryCache.set(cacheKey, {
          ...cached,
          items: cached.items.map((item) => {
            const edit = editsByItem.get(item.itemId);
            return edit ? {
              ...item,
              text: edit.text,
              source: edit.source ?? item.source,
              visible: edit.visible !== false,
            } : item;
          }),
        });
      }
    }
    return !!data.success;
  } catch {
    return false;
  }
}

export interface ReflectMemoryEditorData {
  shared: boolean;
  items: Array<{
    itemId: string;
    displayName: string;
    sourceExcerpt: string;
    text: string;
    source: MemorySource;
    visible: boolean;
  }>;
}

const reflectMemoryCache = new Map<string, ReflectMemoryEditorData>();
const reflectMemoryInflight = new Map<string, Promise<ReflectMemoryEditorData | null>>();

function reflectMemoryCacheKey(userId: string, reflectId: string): string {
  return `${userId}:${reflectId}`;
}

export async function fetchReflectMemories(
  reflectId: string,
  options?: { force?: boolean },
): Promise<ReflectMemoryEditorData | null> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  const cacheKey = reflectMemoryCacheKey(userId, reflectId);
  if (!options?.force) {
    const cached = reflectMemoryCache.get(cacheKey);
    if (cached) return cached;
    const inflight = reflectMemoryInflight.get(cacheKey);
    if (inflight) return inflight;
  }

  const request = (async () => {
    try {
      const result = await apiClient.get<{ success?: boolean } & ReflectMemoryEditorData>(
        `/api/reflect/edit-memories?userId=${encodeURIComponent(userId)}&reflectId=${encodeURIComponent(reflectId)}`,
      );
      if (!result.success) return null;
      const normalized = { shared: result.shared, items: result.items };
      reflectMemoryCache.set(cacheKey, normalized);
      return normalized;
    } catch {
      return null;
    } finally {
      reflectMemoryInflight.delete(cacheKey);
    }
  })();
  reflectMemoryInflight.set(cacheKey, request);
  return request;
}

/**
 * 右上角双开关的记忆（2026-07-23 需求: 记住上次选择）:
 * visibleToFriend — 此回忆对好友可见; shareToBox — 此回忆进共享回忆盒子.
 * Defaults: visible, not shared to box.
 */
export interface ReflectShareDefaults {
  visibleToFriend: boolean;
  shareToBox: boolean;
}

export function getReflectShareDefaults(): ReflectShareDefaults {
  try {
    const raw = storage.getString(kReflectShareDefaults.name);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReflectShareDefaults>;
      return { visibleToFriend: p.visibleToFriend !== false, shareToBox: p.shareToBox === true };
    }
  } catch {
    // fall through to defaults
  }
  return { visibleToFriend: true, shareToBox: false };
}

export function setReflectShareDefaults(d: ReflectShareDefaults): void {
  storage.set(kReflectShareDefaults.name, JSON.stringify(d));
}

/**
 * Result-page toggle: whether the paired partner can see this reflect's
 * memory DETAILS (icons always show). Fire-and-forget from the claim screen.
 */
export async function setReflectVisibility(reflectId: string, visible: boolean): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return false;
  try {
    const data = await apiClient.post<{ success?: boolean }>('/api/reflect/visibility', {
      userId,
      reflectId,
      visible,
    });
    return !!data.success;
  } catch {
    return false;
  }
}
