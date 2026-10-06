/**
 * Reflect Feed data (C11b): the user's OWN reflections grouped by day, each with
 * the items collected that day. Private -- friends never see this (they get the
 * emoji glimpse only). Item emoji resolved from the shared dictionary by id.
 */
import { apiClient } from './api';
import { storage } from './storage';
import { kReflectFeed } from '../shared/storage/keys';
import { supabase } from './supabase';
import { mergedItemDictionary } from './remote-items';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';
import { withDeadline } from './async-lifecycle';

export interface FeedDay {
  date: string;
  reflects: {
    id: string;
    body: string;
    mode: 'typing' | 'prompt' | 'items';
    sharedToFriends: boolean;
    itemIds: string[];
    hasMemories: boolean;
  }[];
  itemIds: string[];
  itemEmoji: string[]; // decorated
}

interface ReflectFeedCache {
  userId?: string;
  schemaVersion?: number;
  days: FeedDay[];
  fetchedAtMs: number;
}

const REFLECT_FEED_SCHEMA_VERSION = 2;
const REFLECT_FEED_TTL_MS = 15 * 60 * 1000;
let feedInflight: Promise<FeedDay[]> | null = null;
let feedForcedFollowup: Promise<FeedDay[]> | null = null;
let feedRevision = 0;
subscribeSessionIdentity(() => { feedRevision++; feedInflight = null; feedForcedFollowup = null; });

function emojiFor(itemId: string): string {
  return mergedItemDictionary().items[itemId]?.emoji ?? '✨';
}

function readCache(): ReflectFeedCache | null {
  const raw = storage.getString(kReflectFeed.name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReflectFeedCache | FeedDay[];
    if (Array.isArray(parsed)) return { days: parsed, fetchedAtMs: 0 };
    if (parsed && Array.isArray(parsed.days)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function isCurrentCache(cache: ReflectFeedCache | null): cache is ReflectFeedCache {
  return !!cache && typeof sessionUserId() === 'string' && cache.userId === sessionUserId()
    && cache.schemaVersion === REFLECT_FEED_SCHEMA_VERSION && cache.days.every((day) =>
    day && Array.isArray(day.reflects) && Array.isArray(day.itemIds) && day.reflects.every((reflect) =>
      reflect && typeof reflect.hasMemories === 'boolean'
      && ['typing', 'prompt', 'items'].includes(reflect.mode),
    ),
  );
}

/** Cached feed for cache-first render (returns [] if none). */
export function getCachedFeed(): FeedDay[] {
  const cached = readCache();
  return isCurrentCache(cached) ? cached.days : [];
}

/** Apply the edit receipt before navigation can reveal an older MMKV copy.
 * fetchedAtMs=0 keeps the API authoritative on the next normal read. */
export function patchCachedReflectEntry(
  reflectId: string,
  patch: { body: string; itemIds?: string[]; hasMemories?: boolean },
): FeedDay[] {
  const current = getCachedFeed();
  const days = current.map((day) => {
    if (!day.reflects.some((reflect) => reflect.id === reflectId)) return day;
    const reflects = day.reflects.map((reflect) => reflect.id === reflectId
      ? { ...reflect, ...patch }
      : reflect);
    const itemIds = reflects.flatMap((reflect) => reflect.itemIds);
    return { ...day, reflects, itemIds, itemEmoji: itemIds.map(emojiFor) };
  });
  feedRevision += 1;
  storage.set(kReflectFeed.name, JSON.stringify({
    userId: sessionUserId() ?? undefined,
    schemaVersion: REFLECT_FEED_SCHEMA_VERSION,
    days,
    fetchedAtMs: 0,
  } satisfies ReflectFeedCache));
  return days;
}

export function fetchReflectFeed(options?: { force?: boolean }): Promise<FeedDay[]> {
  const cached = readCache();
  const cacheIsCurrent = isCurrentCache(cached);
  if (!options?.force && cached && cacheIsCurrent && Date.now() - cached.fetchedAtMs < REFLECT_FEED_TTL_MS) {
    return Promise.resolve(cached.days);
  }
  if (feedInflight) {
    if (!options?.force) return feedInflight;
    if (!feedForcedFollowup) {
      const epoch = sessionEpoch();
      const followup = feedInflight
        .then(() => epoch === sessionEpoch() ? fetchReflectFeed({ force: true }) : [])
        .finally(() => { if (feedForcedFollowup === followup) feedForcedFollowup = null; });
      feedForcedFollowup = followup;
    }
    return feedForcedFollowup;
  }

  const requestRevision = feedRevision;
  const epoch = sessionEpoch();
  const task = (async () => {
    try {
      const { data: sess } = await withDeadline(supabase.auth.getSession(), 5_000);
      const userId = sess.session?.user?.id;
      if (!userId || epoch !== sessionEpoch()) return [];
      const data = await withDeadline(apiClient.get<{
        success?: boolean;
        days?: {
          date: string;
          reflects: {
            id: string;
            body: string;
            mode?: 'typing' | 'prompt' | 'items';
            sharedToFriends: boolean;
            itemIds?: string[];
            hasMemories?: boolean;
          }[];
          itemIds: string[];
        }[];
      }>(`/api/reflect-feed?userId=${encodeURIComponent(userId)}`), 15_000);
      if (epoch !== sessionEpoch() || requestRevision !== feedRevision) return [];
      if (!data.success || !data.days) return getCachedFeed();
      const responseHasReflectModes = data.days.every((day) => day.reflects.every((reflect) =>
        ['typing', 'prompt', 'items'].includes(reflect.mode ?? ''),
      ));
      const days = data.days.map((d) => ({
        ...d,
        reflects: d.reflects.map((reflect) => ({
          ...reflect,
          mode: ['typing', 'prompt', 'items'].includes(reflect.mode ?? '')
            ? reflect.mode as 'typing' | 'prompt' | 'items'
            : 'typing',
          itemIds: reflect.itemIds ?? [],
          hasMemories: reflect.hasMemories === true,
        })),
        itemEmoji: d.itemIds.map(emojiFor),
      }));
      // A local edit receipt supersedes any request that began before it.
      if (requestRevision !== feedRevision) return getCachedFeed();
      // Do not turn an old API response without `mode` into a valid-looking
      // cache. Once the API is deployed, the next focus fetches the typed data
      // immediately instead of preserving the compatibility fallback for 15m.
      if (responseHasReflectModes) {
        storage.set(
          kReflectFeed.name,
          JSON.stringify({
            userId,
            schemaVersion: REFLECT_FEED_SCHEMA_VERSION,
            days,
            fetchedAtMs: Date.now(),
          } satisfies ReflectFeedCache),
        );
      }
      return days;
    } catch {
      return getCachedFeed();
    }
  })();
  const request = task.finally(() => { if (feedInflight === request) feedInflight = null; });
  feedInflight = request;
  return request;
}

/** A day label like "Jul 12" from a YYYY-MM-DD string. */
export function formatDayLabel(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}
