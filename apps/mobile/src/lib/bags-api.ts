/**
 * Bags data: collected items joined with their display info.
 *
 * The server returns only item_ids, counts, and memories; the display info
 * (name, rarity, emoji placeholder) comes from the shared dictionary in
 * @novame/engine, looked up by id. So the emoji swaps to sprite art by editing
 * the dictionary, with no API or client-shape change.
 */
import { ITEM_DICTIONARY, type ItemRarity } from '@novame/engine';
import { remoteItemDef } from './remote-items';

import { kBagsState, kTheirBagsState } from '../shared/storage/keys';
import { apiClient } from './api';
import { storage } from './storage';
import { supabase } from './supabase';

const MINE_CACHE_MAX_AGE_MS = 15 * 60_000;
const THEIR_CACHE_MAX_AGE_MS = 5 * 60_000;
const BAGS_PAGE_SIZE = 100;

export interface ItemMemory {
  excerpt: string;
  rawExcerpt: string;
  reflectId?: string;
  createdAt: string;
}

export interface CollectedItem {
  itemId: string;
  displayName: string;
  rarity: ItemRarity;
  emoji: string;
  category: string;
  count: number;
  firstSeenAt: string;
  memories: ItemMemory[];
  memoriesFetchedAt: number;
  memoriesComplete: boolean;
  nextMemoryBeforeCreatedAt: string | null;
  nextMemoryBeforeId: string | null;
}

interface WireItem {
  itemId: string;
  count: number;
  firstSeenAt: string;
  memories: ItemMemory[];
  memoriesFetchedAt?: number;
  memoriesComplete?: boolean;
  nextMemoryBeforeCreatedAt?: string | null;
  nextMemoryBeforeId?: string | null;
}

interface MineBagsCache {
  version?: number;
  items: WireItem[];
  fetchedAt: number;
  historyComplete?: boolean;
  nextBeforeFirstSeenAt?: string | null;
  nextBeforeItemId?: string | null;
}

interface TheirBagsCache {
  ownerUserId: string | null;
  items: WireItem[];
  fetchedAt: number;
  historyComplete?: boolean;
  nextBeforeFirstSeenAt?: string | null;
  nextBeforeItemId?: string | null;
  /**
   * Feed details may be hidden by the partner's privacy setting. Keep a small
   * stable key ledger so those rows are still de-duplicated without inventing
   * blank memory-detail records in the UI.
   */
  seenReflectItemKeys?: string[];
}

// Reflect completion and the Memories focus effect can request the same
// collection at nearly the same time. Only the newest-started request may
// replace the cache; otherwise a slower stale response can temporarily remove
// the items that a newer response already added.
let mineFetchGeneration = 0;
let theirFetchGeneration = 0;
let mineAppliedGeneration = 0;
let theirAppliedGeneration = 0;
const firstPageInflight = new Map<string, Promise<CollectedItem[]>>();
const nextPageInflight = new Map<string, Promise<CollectedItem[]>>();
const itemDetailsInflight = new Map<string, Promise<CollectedItem | null>>();

/** Join a server item with its dictionary display info. Unknown ids (dictionary
 *  edited since) fall back to a generic label so nothing crashes. */
function decorate(w: WireItem): CollectedItem {
  const def = ITEM_DICTIONARY.items[w.itemId];
  const remote = remoteItemDef(w.itemId);
  return {
    itemId: w.itemId,
    displayName: remote?.name ?? def?.displayName ?? w.itemId,
    rarity: remote?.rarity ?? def?.rarity ?? 'common',
    emoji: def?.emoji ?? '\ud83d\udce6',
    category: remote?.category ?? def?.category ?? 'other',
    count: w.count,
    firstSeenAt: w.firstSeenAt,
    memories: w.memories,
    memoriesFetchedAt: w.memoriesFetchedAt ?? 0,
    memoriesComplete: w.memoriesComplete ?? false,
    nextMemoryBeforeCreatedAt: w.nextMemoryBeforeCreatedAt ?? null,
    nextMemoryBeforeId: w.nextMemoryBeforeId ?? null,
  };
}

/** Present rows from a pair's shared memory box using the same collection
 * shape as Bags. Repeated item ids become one tile with multiple memories. */
export function sharedBoxToCollectedItems(
  rows: { itemId: string; description: string; createdAt: string }[],
): CollectedItem[] {
  const grouped = new Map<string, WireItem>();
  for (const row of rows) {
    const current = grouped.get(row.itemId);
    const memory: ItemMemory = {
      excerpt: row.description,
      rawExcerpt: row.description,
      createdAt: row.createdAt,
    };
    if (current) {
      current.count += 1;
      current.memories.push(memory);
      if (row.createdAt > current.firstSeenAt) current.firstSeenAt = row.createdAt;
    } else {
      grouped.set(row.itemId, {
        itemId: row.itemId,
        count: 1,
        firstSeenAt: row.createdAt,
        memories: [memory],
      });
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .map(decorate);
}

export function getCachedBags(): CollectedItem[] {
  return (readMineCache()?.items ?? []).map(decorate);
}

export function getCachedTheirBags(expectedOwnerUserId?: string): CollectedItem[] {
  const raw = storage.getString(kTheirBagsState.name);
  if (!raw) return [];
  try {
    const cached = JSON.parse(raw) as TheirBagsCache;
    if (!Array.isArray(cached.items)) return [];
    if (expectedOwnerUserId && cached.ownerUserId !== expectedOwnerUserId) return [];
    return cached.items.map(decorate);
  } catch {
    return [];
  }
}

function readMineCache(): MineBagsCache | null {
  const raw = storage.getString(kBagsState.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WireItem[] | MineBagsCache;
    if (Array.isArray(parsed)) {
      storage.remove(kBagsState.name);
      return null;
    }
    if (parsed.version !== 2) {
      storage.remove(kBagsState.name);
      return null;
    }
    return Array.isArray(parsed.items)
      ? { ...parsed, fetchedAt: parsed.fetchedAt ?? 0, historyComplete: parsed.historyComplete ?? false }
      : null;
  } catch { return null; }
}

function readTheirCache(): TheirBagsCache | null {
  const raw = storage.getString(kTheirBagsState.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TheirBagsCache;
    return Array.isArray(parsed.items)
      ? { ...parsed, fetchedAt: parsed.fetchedAt ?? 0, historyComplete: parsed.historyComplete ?? false }
      : null;
  } catch { return null; }
}

export function isBagsHistoryComplete(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
): boolean {
  const cache = scope === 'mine' ? readMineCache() : readTheirCache();
  if (!cache) return false;
  if (scope === 'their' && expectedOwnerUserId && (cache as TheirBagsCache).ownerUserId !== expectedOwnerUserId) {
    return false;
  }
  return cache.historyComplete === true;
}

function memoryKey(memory: ItemMemory): string {
  return memory.reflectId || `${memory.createdAt}:${memory.rawExcerpt || memory.excerpt}`;
}

/** Merge pages and optimistic rows without allowing a slower first-page
 * revalidation to make already-rendered history disappear. */
function mergeWireItems(existing: WireItem[], incoming: WireItem[]): WireItem[] {
  const byId = new Map(existing.map((item) => [item.itemId, {
    ...item,
    memories: [...item.memories],
  }]));
  for (const next of incoming) {
    const current = byId.get(next.itemId);
    if (!current) {
      byId.set(next.itemId, { ...next, memories: [...next.memories] });
      continue;
    }
    const memories = new Map(current.memories.map((memory) => [memoryKey(memory), memory]));
    for (const memory of next.memories) memories.set(memoryKey(memory), memory);
    current.count = Math.max(current.count, next.count);
    current.firstSeenAt = current.firstSeenAt > next.firstSeenAt ? current.firstSeenAt : next.firstSeenAt;
    current.memories = [...memories.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (next.memoriesFetchedAt != null) current.memoriesFetchedAt = next.memoriesFetchedAt;
    if (next.memoriesComplete != null) current.memoriesComplete = next.memoriesComplete;
    if (next.nextMemoryBeforeCreatedAt !== undefined) {
      current.nextMemoryBeforeCreatedAt = next.nextMemoryBeforeCreatedAt;
    }
    if (next.nextMemoryBeforeId !== undefined) current.nextMemoryBeforeId = next.nextMemoryBeforeId;
  }
  return [...byId.values()].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
}

/** Old cache formats still paint immediately, but revalidate once. */
export function isBagsCacheStale(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
  maxAgeMs = scope === 'mine' ? MINE_CACHE_MAX_AGE_MS : THEIR_CACHE_MAX_AGE_MS,
): boolean {
  const cache = scope === 'mine' ? readMineCache() : readTheirCache();
  if (!cache) return true;
  if (scope === 'their' && expectedOwnerUserId && (cache as TheirBagsCache).ownerUserId !== expectedOwnerUserId) return true;
  return Date.now() - cache.fetchedAt >= maxAgeMs;
}

export async function refreshBagsIfStale(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
): Promise<CollectedItem[]> {
  if (!isBagsCacheStale(scope, expectedOwnerUserId)) {
    return scope === 'mine' ? getCachedBags() : getCachedTheirBags(expectedOwnerUserId);
  }
  return fetchBags(scope, expectedOwnerUserId);
}

/** Immediately merge a successful personal Reflect into Mine. */
export function cacheReflectItems(snapshot: {
  reflectId: string;
  matchedItems: { itemId: string; label: string }[];
  memories?: { itemId: string; text: string }[];
}): void {
  if (!snapshot.reflectId) return;
  const cached = readMineCache();
  const items = cached?.items ? [...cached.items] : [];
  const now = new Date().toISOString();
  const byId = new Map(items.map((item) => [item.itemId, item]));
  // Reconcile this reflect exactly: blank memories must not survive in Mine.
  for (const current of [...byId.values()]) {
    const before = current.memories.length;
    current.memories = current.memories.filter((memory) => memory.reflectId !== snapshot.reflectId);
    const removed = before - current.memories.length;
    if (removed > 0) current.count = Math.max(0, current.count - removed);
    // First-page Bags rows intentionally omit details until the tile is
    // opened. An empty `memories` array therefore does not mean the item has
    // no stored memories; only remove the tile when its authoritative count
    // reaches zero.
    if (current.count === 0) byId.delete(current.itemId);
  }
  const actual = (snapshot.memories ?? []).filter((memory) => memory.text.trim());
  for (const memoryDraft of actual) {
    const matched = snapshot.matchedItems.find((item) => item.itemId === memoryDraft.itemId);
    if (!matched) continue;
    const current = byId.get(matched.itemId);
    const memory: ItemMemory = {
      excerpt: memoryDraft.text.trim(),
      rawExcerpt: memoryDraft.text.trim(),
      reflectId: snapshot.reflectId,
      createdAt: now,
    };
    if (current) {
      current.count += 1;
      current.memories = [memory, ...current.memories];
      current.firstSeenAt = now;
    } else {
      const created: WireItem = {
        itemId: matched.itemId,
        count: 1,
        firstSeenAt: now,
        memories: [memory],
        memoriesFetchedAt: Date.now(),
        memoriesComplete: true,
        nextMemoryBeforeCreatedAt: null,
        nextMemoryBeforeId: null,
      };
      byId.set(matched.itemId, created);
    }
  }
  const reconciled = [...byId.values()].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  storage.set(kBagsState.name, JSON.stringify({
    version: 2,
    items: reconciled,
    fetchedAt: cached?.fetchedAt ?? 0,
    historyComplete: cached?.historyComplete ?? false,
    nextBeforeFirstSeenAt: cached?.nextBeforeFirstSeenAt ?? null,
    nextBeforeItemId: cached?.nextBeforeItemId ?? null,
  } satisfies MineBagsCache));
}

/** Targeted semantic invalidation after a memory edit. TTL values and every
 * other page cache remain untouched. */
export function invalidateMineBagsCache(): void {
  storage.remove(kBagsState.name);
}

/** A successful Paired feed can append the partner's new tiles locally. */
export function cacheTheirItemsFromFeed(
  ownerUserId: string,
  entries: { reflectId: string; createdAt: string; itemIds: string[]; details: { itemId: string; text: string }[] | null }[],
): void {
  if (!ownerUserId || entries.length === 0) return;
  const cached = readTheirCache();
  const items = cached?.ownerUserId === ownerUserId ? [...cached.items] : [];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const seenKeys = new Set(
    cached?.ownerUserId === ownerUserId ? cached.seenReflectItemKeys ?? [] : [],
  );
  // Older cache versions did not have the explicit ledger. Visible memories
  // still provide enough information to bootstrap it safely.
  for (const item of items) {
    for (const memory of item.memories) {
      if (memory.reflectId) seenKeys.add(`${memory.reflectId}:${item.itemId}`);
    }
  }
  for (const entry of entries) {
    for (const itemId of entry.itemIds) {
      const current = byId.get(itemId);
      const stableKey = `${entry.reflectId}:${itemId}`;
      const alreadyIncluded = seenKeys.has(stableKey);
      const detail = entry.details?.find((candidate) => candidate.itemId === itemId)?.text;
      if (current) {
        if (!alreadyIncluded) current.count += 1;
        if (!alreadyIncluded && detail) {
          current.memories = [{ excerpt: detail, rawExcerpt: detail, reflectId: entry.reflectId, createdAt: entry.createdAt }, ...current.memories];
        }
        if (entry.createdAt > current.firstSeenAt) current.firstSeenAt = entry.createdAt;
      } else {
        const created: WireItem = {
          itemId,
          count: 1,
          firstSeenAt: entry.createdAt,
          memories: detail ? [{ excerpt: detail, rawExcerpt: detail, reflectId: entry.reflectId, createdAt: entry.createdAt }] : [],
        };
        items.push(created);
        byId.set(itemId, created);
      }
      seenKeys.add(stableKey);
    }
  }
  items.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  storage.set(kTheirBagsState.name, JSON.stringify({
    ownerUserId,
    items,
    fetchedAt: cached?.ownerUserId === ownerUserId ? cached.fetchedAt : 0,
    historyComplete: cached?.ownerUserId === ownerUserId ? cached.historyComplete ?? false : false,
    nextBeforeFirstSeenAt: cached?.ownerUserId === ownerUserId ? cached.nextBeforeFirstSeenAt ?? null : null,
    nextBeforeItemId: cached?.ownerUserId === ownerUserId ? cached.nextBeforeItemId ?? null : null,
    seenReflectItemKeys: [...seenKeys],
  } satisfies TheirBagsCache));
}

/** Fetch collected items, refreshing the cache. Cache stores the wire shape
 *  (ids only), decorated on read, so a dictionary edit reflects immediately. */
export async function fetchBags(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
): Promise<CollectedItem[]> {
  const inflightKey = `${scope}:${expectedOwnerUserId || ''}`;
  const existingRequest = firstPageInflight.get(inflightKey);
  if (existingRequest) return existingRequest;
  const request = fetchBagsFirstPage(scope, expectedOwnerUserId)
    .finally(() => firstPageInflight.delete(inflightKey));
  firstPageInflight.set(inflightKey, request);
  return request;
}

async function fetchBagsFirstPage(
  scope: 'mine' | 'their',
  expectedOwnerUserId?: string,
): Promise<CollectedItem[]> {
  const generation = scope === 'mine' ? ++mineFetchGeneration : ++theirFetchGeneration;
  const { data: sess } = await supabase.auth.getSession();
  const userId = sess.session?.user?.id;
  if (!userId) return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();

  try {
    const data = await apiClient.get<{
      success?: boolean;
      ownerUserId?: string | null;
      items?: WireItem[];
      hasMore?: boolean;
      nextBeforeFirstSeenAt?: string | null;
      nextBeforeItemId?: string | null;
    }>(
      `/api/bags?userId=${encodeURIComponent(userId)}&scope=${scope}&limit=${BAGS_PAGE_SIZE}`,
    );
    if (!data.success || !data.items) return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();

    // Mine must belong to the signed-in account; Their must never come back
    // with that same owner. Reject a stale/mismatched API response instead of
    // painting it under the wrong tab.
    if (scope === 'mine' && data.ownerUserId && data.ownerUserId !== userId) return getCachedBags();
    if (scope === 'their' && data.ownerUserId === userId) return getCachedTheirBags(expectedOwnerUserId);
    if (scope === 'their' && expectedOwnerUserId && data.ownerUserId !== expectedOwnerUserId) {
      return getCachedTheirBags(expectedOwnerUserId);
    }

    const latestApplied = scope === 'mine' ? mineAppliedGeneration : theirAppliedGeneration;
    if (generation < latestApplied) {
      return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
    }

    if (scope === 'mine') {
      const previous = readMineCache();
      const merged = mergeWireItems(previous?.items ?? [], data.items);
      const hasDeeperCachedHistory = (previous?.items.length ?? 0) > data.items.length;
      storage.set(kBagsState.name, JSON.stringify({
        version: 2,
        items: merged,
        fetchedAt: Date.now(),
        historyComplete: hasDeeperCachedHistory
          ? previous?.historyComplete ?? false
          : data.hasMore !== true,
        nextBeforeFirstSeenAt: hasDeeperCachedHistory
          ? previous?.nextBeforeFirstSeenAt ?? null
          : data.nextBeforeFirstSeenAt ?? null,
        nextBeforeItemId: hasDeeperCachedHistory
          ? previous?.nextBeforeItemId ?? null
          : data.nextBeforeItemId ?? null,
      } satisfies MineBagsCache));
      mineAppliedGeneration = generation;
    }
    if (scope === 'their') {
      const previous = readTheirCache();
      const previousItems = previous && previous.ownerUserId === data.ownerUserId
        ? previous.items
        : [];
      const merged = mergeWireItems(previousItems, data.items);
      const hasDeeperCachedHistory = previousItems.length > data.items.length;
      storage.set(kTheirBagsState.name, JSON.stringify({
        ownerUserId: data.ownerUserId ?? null,
        items: merged,
        fetchedAt: Date.now(),
        historyComplete: hasDeeperCachedHistory
          ? previous?.historyComplete ?? false
          : data.hasMore !== true,
        nextBeforeFirstSeenAt: hasDeeperCachedHistory
          ? previous?.nextBeforeFirstSeenAt ?? null
          : data.nextBeforeFirstSeenAt ?? null,
        nextBeforeItemId: hasDeeperCachedHistory
          ? previous?.nextBeforeItemId ?? null
          : data.nextBeforeItemId ?? null,
        // Preserve hidden feed-row keys across authoritative refreshes. The
        // bags API intentionally omits private details, so it cannot recreate
        // this ledger by itself.
        seenReflectItemKeys: previous && previous.ownerUserId === data.ownerUserId
          ? previous.seenReflectItemKeys ?? []
          : [],
      } satisfies TheirBagsCache));
      theirAppliedGeneration = generation;
    }
    return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
  } catch {
    return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
  }
}

/** Load one older page only when the user reaches the cached tail. */
export async function fetchMoreBags(
  scope: 'mine' | 'their' = 'mine',
  expectedOwnerUserId?: string,
): Promise<CollectedItem[]> {
  const cache = scope === 'mine' ? readMineCache() : readTheirCache();
  if (!cache || cache.historyComplete) {
    return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
  }
  if (scope === 'their' && expectedOwnerUserId && (cache as TheirBagsCache).ownerUserId !== expectedOwnerUserId) {
    return fetchBags(scope, expectedOwnerUserId);
  }
  const cursor = cache.nextBeforeFirstSeenAt
    || cache.items[cache.items.length - 1]?.firstSeenAt;
  const cursorItemId = cache.nextBeforeItemId
    || cache.items[cache.items.length - 1]?.itemId;
  if (!cursor || !cursorItemId) return fetchBags(scope, expectedOwnerUserId);

  const inflightKey = `${scope}:${expectedOwnerUserId || ''}:${cursor}:${cursorItemId}`;
  const existingRequest = nextPageInflight.get(inflightKey);
  if (existingRequest) return existingRequest;
  const request = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
    try {
      const data = await apiClient.get<{
        success?: boolean;
        ownerUserId?: string | null;
        items?: WireItem[];
        hasMore?: boolean;
        nextBeforeFirstSeenAt?: string | null;
        nextBeforeItemId?: string | null;
      }>(
        `/api/bags?userId=${encodeURIComponent(userId)}&scope=${scope}&limit=${BAGS_PAGE_SIZE}&beforeFirstSeenAt=${encodeURIComponent(cursor)}&beforeItemId=${encodeURIComponent(cursorItemId)}`,
      );
      if (!data.success || !Array.isArray(data.items)) {
        return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
      }
      if (scope === 'mine' && data.ownerUserId && data.ownerUserId !== userId) return getCachedBags();
      if (scope === 'their' && (data.ownerUserId === userId
        || (expectedOwnerUserId && data.ownerUserId !== expectedOwnerUserId))) {
        return getCachedTheirBags(expectedOwnerUserId);
      }

      if (scope === 'mine') {
        const latest = readMineCache();
        storage.set(kBagsState.name, JSON.stringify({
          version: 2,
          items: mergeWireItems(latest?.items ?? [], data.items),
          fetchedAt: latest?.fetchedAt ?? Date.now(),
          historyComplete: data.hasMore !== true,
          nextBeforeFirstSeenAt: data.nextBeforeFirstSeenAt ?? null,
          nextBeforeItemId: data.nextBeforeItemId ?? null,
        } satisfies MineBagsCache));
        return getCachedBags();
      }

      const latest = readTheirCache();
      const sameOwner = Boolean(latest && latest.ownerUserId === data.ownerUserId);
      storage.set(kTheirBagsState.name, JSON.stringify({
        ownerUserId: data.ownerUserId ?? null,
        items: mergeWireItems(sameOwner && latest ? latest.items : [], data.items),
        fetchedAt: sameOwner && latest ? latest.fetchedAt : Date.now(),
        historyComplete: data.hasMore !== true,
        nextBeforeFirstSeenAt: data.nextBeforeFirstSeenAt ?? null,
        nextBeforeItemId: data.nextBeforeItemId ?? null,
        seenReflectItemKeys: sameOwner && latest ? latest.seenReflectItemKeys ?? [] : [],
      } satisfies TheirBagsCache));
      return getCachedTheirBags(expectedOwnerUserId);
    } catch {
      return scope === 'their' ? getCachedTheirBags(expectedOwnerUserId) : getCachedBags();
    }
  })().finally(() => nextPageInflight.delete(inflightKey));
  nextPageInflight.set(inflightKey, request);
  return request;
}

function cachedItem(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId?: string,
): CollectedItem | null {
  const items = scope === 'mine' ? getCachedBags() : getCachedTheirBags(expectedOwnerUserId);
  return items.find((item) => item.itemId === itemId) ?? null;
}

function writeItemDetails(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId: string | undefined,
  details: {
    memories: ItemMemory[];
    hasMore: boolean;
    nextBeforeCreatedAt: string | null;
    nextBeforeMemoryId: string | null;
  },
  append: boolean,
): CollectedItem | null {
  const cache = scope === 'mine' ? readMineCache() : readTheirCache();
  if (!cache) return null;
  if (scope === 'their') {
    const theirCache = cache as TheirBagsCache;
    if (expectedOwnerUserId && theirCache.ownerUserId !== expectedOwnerUserId) return null;
  }

  const items = cache.items.map((item) => {
    if (item.itemId !== itemId) return item;
    // Mine is immutable user-owned history: keep every detail page already
    // viewed while merging a refreshed first page. Their is replaced on first
    // page refresh so a partner's privacy changes can never leave stale details
    // visible locally.
    const existing = append || scope === 'mine' ? item.memories : [];
    const memories = new Map(existing.map((memory) => [memoryKey(memory), memory]));
    for (const memory of details.memories) memories.set(memoryKey(memory), memory);
    return {
      ...item,
      memories: [...memories.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      memoriesFetchedAt: Date.now(),
      memoriesComplete: !details.hasMore,
      nextMemoryBeforeCreatedAt: details.nextBeforeCreatedAt,
      nextMemoryBeforeId: details.nextBeforeMemoryId,
    };
  });

  if (scope === 'mine') {
    const mineCache = cache as MineBagsCache;
    storage.set(kBagsState.name, JSON.stringify({ ...mineCache, items } satisfies MineBagsCache));
  } else {
    const theirCache = cache as TheirBagsCache;
    storage.set(kTheirBagsState.name, JSON.stringify({ ...theirCache, items } satisfies TheirBagsCache));
  }
  return cachedItem(scope, itemId, expectedOwnerUserId);
}

export function isItemMemoriesStale(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId?: string,
): boolean {
  const item = cachedItem(scope, itemId, expectedOwnerUserId);
  if (!item) return true;
  const maxAge = scope === 'mine' ? MINE_CACHE_MAX_AGE_MS : THEIR_CACHE_MAX_AGE_MS;
  return Date.now() - item.memoriesFetchedAt >= maxAge;
}

/** Read an item's first detail page only when its sheet is opened. Cached
 * detail rows paint synchronously; stale rows are replaced in the background. */
export async function fetchItemMemories(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId?: string,
  options?: { force?: boolean },
): Promise<CollectedItem | null> {
  if (!options?.force && !isItemMemoriesStale(scope, itemId, expectedOwnerUserId)) {
    return cachedItem(scope, itemId, expectedOwnerUserId);
  }
  return fetchItemMemoryPage(scope, itemId, expectedOwnerUserId, false);
}

/** Continue from the per-item composite cursor when the sheet reaches its
 * cached tail. This never refetches detail pages the user has already seen. */
export async function fetchMoreItemMemories(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId?: string,
): Promise<CollectedItem | null> {
  const item = cachedItem(scope, itemId, expectedOwnerUserId);
  if (!item || item.memoriesComplete) return item;
  if (!item.nextMemoryBeforeCreatedAt || !item.nextMemoryBeforeId) {
    return fetchItemMemoryPage(scope, itemId, expectedOwnerUserId, false);
  }
  return fetchItemMemoryPage(scope, itemId, expectedOwnerUserId, true);
}

async function fetchItemMemoryPage(
  scope: 'mine' | 'their',
  itemId: string,
  expectedOwnerUserId: string | undefined,
  append: boolean,
): Promise<CollectedItem | null> {
  const current = cachedItem(scope, itemId, expectedOwnerUserId);
  if (!current) return null;
  const cursor = append
    ? `&beforeCreatedAt=${encodeURIComponent(current.nextMemoryBeforeCreatedAt || '')}&beforeMemoryId=${encodeURIComponent(current.nextMemoryBeforeId || '')}`
    : '';
  const inflightKey = `${scope}:${expectedOwnerUserId || ''}:${itemId}:${append ? cursor : 'first'}`;
  const existingRequest = itemDetailsInflight.get(inflightKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) return cachedItem(scope, itemId, expectedOwnerUserId);
    try {
      const data = await apiClient.get<{
        success?: boolean;
        ownerUserId?: string | null;
        itemId?: string;
        memories?: ItemMemory[];
        hasMore?: boolean;
        nextBeforeCreatedAt?: string | null;
        nextBeforeMemoryId?: string | null;
      }>(
        `/api/bags?userId=${encodeURIComponent(userId)}&scope=${scope}&itemId=${encodeURIComponent(itemId)}&memoryLimit=50${cursor}`,
      );
      if (!data.success || data.itemId !== itemId || !Array.isArray(data.memories)) {
        return cachedItem(scope, itemId, expectedOwnerUserId);
      }
      if (scope === 'mine' && data.ownerUserId && data.ownerUserId !== userId) {
        return cachedItem(scope, itemId, expectedOwnerUserId);
      }
      if (scope === 'their' && (data.ownerUserId === userId
        || (expectedOwnerUserId && data.ownerUserId !== expectedOwnerUserId))) {
        return cachedItem(scope, itemId, expectedOwnerUserId);
      }
      return writeItemDetails(scope, itemId, expectedOwnerUserId, {
        memories: data.memories,
        hasMore: data.hasMore === true,
        nextBeforeCreatedAt: data.nextBeforeCreatedAt ?? null,
        nextBeforeMemoryId: data.nextBeforeMemoryId ?? null,
      }, append);
    } catch {
      return cachedItem(scope, itemId, expectedOwnerUserId);
    }
  })().finally(() => itemDetailsInflight.delete(inflightKey));
  itemDetailsInflight.set(inflightKey, request);
  return request;
}

export const RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#9B8FBF',
  uncommon: '#5B9BD5',
  rare: '#E0A030',
};
