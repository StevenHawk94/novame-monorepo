/**
 * wisdoms API client wrapper — Stage 3.9.A.2.4
 *
 * Wraps GET /api/wisdoms which returns the user's own published
 * wisdoms with the generated wisdom_card joined in. Used by Growth
 * tab's My Logs sub-tab.
 */
import { apiClient } from './api';
import { storage } from './storage';

/**
 * Stage 6 Wisdom Insight redesign — 3-part Core Reframing.
 *
 * Replaces the previous single-block card_b / card_c structure with
 * three distinct micro-paragraphs, each with its own dynamic emoji
 * title (🔍 mirror_hook / 🔄 flipped_lens / 🌱 permission_slip).
 *
 * Persisted as a single jsonb column `reframe` on wisdom_cards.
 * Null on legacy wisdoms created before Stage 6 — UI falls back to
 * rendering card_b via splitTitleBody() in that case.
 */
export type ReframeData = {
  mirror_hook: { title: string; body: string };
  flipped_lens: { title: string; body: string };
  permission_slip: { title: string; body: string };
};

/**
 * Stage 6 Wisdom Insight redesign — Self-Reflection Question.
 *
 * Two-part payload: an empathetic 1-2 sentence validation anchor,
 * then ONE provocative deep question. AI branches dimension by
 * emotional tone (negative → Secondary Gain / Illusion of Control /
 * Comfort of Misery / Bedrock Fear; positive → Hidden Recipe /
 * Future Lows / Unconditional Self / Joy Boundaries).
 *
 * Persisted as jsonb column `reflective_question`. Null on legacy
 * wisdoms — UI hides the "Ask Yourself This" card entirely in that
 * case.
 */
export type ReflectiveQuestion = {
  validation: string;
  question: string;
};

/**
 * Aspire impact entry — produced by AI when the wisdom touches one
 * of the user's aspire keywords. Drives the progress bar in the
 * "How The Community React" band on the insight page.
 */
export type AspireImpact = {
  keyword: string;
  direction: 'positive' | 'negative';
};

export type WisdomCardEmbed = {
  id: string;
  keyword_id: string | null;
  quote_short: string | null;
  insight_full: string | null;
  // Stage 6: wisdom_score retained for legacy wisdoms (UI no longer
  // renders a score ring on the redesigned insight page). New
  // wisdoms write null here.
  wisdom_score: number | null;
  wisdom_emotion: string | null;
  // Stage 6 legacy columns. New wisdoms write null here and use the
  // reframe field below instead. Old wisdoms still flow through
  // these so My Logs can re-render them.
  card_b: string | null;
  card_c: string | null;
  task_1: string | null;
  task_2: string | null;
  // Stage 6 new columns.
  reframe: ReframeData | null;
  reflective_question: ReflectiveQuestion | null;
  aspire_impacts: AspireImpact[] | null;
  // Stage 6 Bug 3: per-wisdom server-rolled "people resonated" (30-999),
  // persisted on wisdom_cards.community_count (migration 20260525123624).
  // NULL for historical wisdoms — Block 4a row hides in that case.
  community_count: number | null;
  // Stage 6 follow-up: per-wisdom Section C "Truth-Telling Peer"
  // text (500-700 chars). Persisted on wisdom_cards.peer_comment
  // (migration 20260527000000). NULL for pre-migration wisdoms;
  // InsightView hides the new chat-bubble block when null.
  peer_comment: string | null;
};

export type WisdomLog = {
  id: string;
  created_at: string;
  text: string | null;
  description: string | null;
  categories: string[] | null;
  card: WisdomCardEmbed | null;
};

export type FetchWisdomsResponse = {
  success: boolean;
  wisdoms: WisdomLog[];
  total: number;
};

export async function fetchWisdoms(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FetchWisdomsResponse> {
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const qs = new URLSearchParams({
    userId,
    limit: String(limit),
    offset: String(offset),
  });
  return apiClient.get<FetchWisdomsResponse>(`/api/wisdoms?${qs.toString()}`);
}

// ============================================================
// SWR Cache Layer — Stage 6 (cache-first reads, publish invalidation)
// MMKV key: novame_wisdom_logs
// Used by: growth.tsx (My Logs sub-tab)
// ============================================================

const WISDOMS_STORAGE_KEY = 'novame_wisdom_logs';

export type CachedWisdoms = {
  wisdoms: WisdomLog[];
  total: number;
  lastFetchedAtMs: number;
};

export function getCachedWisdoms(): { wisdoms: WisdomLog[]; total: number } | null {
  const raw = storage.getString(WISDOMS_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedWisdoms;
    return { wisdoms: parsed.wisdoms, total: parsed.total };
  } catch {
    return null;
  }
}

function setCachedWisdoms(wisdoms: WisdomLog[], total: number): void {
  const payload: CachedWisdoms = { wisdoms, total, lastFetchedAtMs: Date.now() };
  storage.set(WISDOMS_STORAGE_KEY, JSON.stringify(payload));
}

export function invalidateWisdoms(): void {
  storage.remove(WISDOMS_STORAGE_KEY);
}

export async function fetchWisdomsWithCache(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FetchWisdomsResponse> {
  const res = await fetchWisdoms(userId, opts);
  // Only cache the "default first page" view (offset 0). Pagination
  // queries are not cached because they're rare and complex to merge.
  if ((opts.offset ?? 0) === 0) {
    setCachedWisdoms(res.wisdoms ?? [], res.total ?? 0);
  }
  return res;
}

/**
 * Stage 6 publish-side prefetch (Wisdom Insight Bug 1 root-cause fix).
 *
 * Combines invalidate + immediate background fetch into a single call.
 * Used by record.tsx publish success path: while the user reads the
 * Insight (3-5 minutes typical), this fires in parallel with refreshes
 * for all other publish-affected caches so MMKV is hot by the time the
 * user closes the modal and visits any tab.
 *
 * Always uses the default first-page view (offset 0, limit 30) — the
 * cached payload that My Logs and post-publish navigators read.
 *
 * fire-and-forget safe: never throws. Errors are logged so they show
 * up in TestFlight diagnostics without producing unhandled promise
 * rejection warnings.
 */
export async function refreshWisdoms(userId: string): Promise<void> {
  storage.remove(WISDOMS_STORAGE_KEY);
  try {
    await fetchWisdomsWithCache(userId, { limit: 30 });
  } catch (e) {
    console.warn('[refreshWisdoms]', e);
  }
}
