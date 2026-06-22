/**
 * Insight payload store (white-screen fix).
 *
 * The wisdom-insight modal previously received the entire card JSON via the
 * route's `payload` query param (encodeURIComponent(JSON.stringify(card))).
 * For long cards (Stage-6 reframe has two multi-sentence paragraphs + full
 * insight + peer_comment), the encoded URL reached ~4900 chars. The native
 * navigation layer truncates very long route params, so the modal's
 * JSON.parse(decodeURIComponent(...)) threw, decodePayload returned null, and
 * the screen fell back to an (invisible, white-on-white) "Could not load"
 * state => permanent white screen, re-rendered identically on every reopen.
 *
 * Fix: stash the payload in this module-level store and navigate with only
 * the short wisdomId. The modal reads the payload from here. No URL length
 * limit, no truncation. Pattern mirrors skin-unlock-store.ts (module-level
 * state, no React Context, no extra deps).
 *
 * Lifetime: last-write-wins single slot keyed by wisdomId. The modal reads it
 * on mount; it persists in memory until overwritten by the next open or
 * cleared on sign-out. A cold launch loses it, but that only happens if the
 * app was killed while the modal route was somehow restored -- in which case
 * the URL `payload` fallback (still passed for back-compat) keeps things
 * working.
 */
import type { InsightCardData } from '@/components/insight/insight-view';

export type InsightPayload = {
  card: InsightCardData | null;
  emotion: string;
};

let _slot: { id: string; payload: InsightPayload } | null = null;

/** Stash the payload to view, keyed by wisdomId. Called before navigating. */
export function setInsightPayload(id: string, payload: InsightPayload): void {
  _slot = { id, payload };
}

/**
 * Read the stashed payload for a given wisdomId. Returns null if nothing is
 * stored or the id doesn't match (stale slot from a different open).
 */
export function getInsightPayload(id: string): InsightPayload | null {
  if (_slot && _slot.id === id) return _slot.payload;
  return null;
}

/** Clear the slot (e.g. on sign-out). */
export function clearInsightPayload(): void {
  _slot = null;
}
