/**
 * publish-count.ts -- Stage 6.RatingPrompt
 *
 * Lifetime MMKV counter for completed wisdom publishes. Used by the
 * rating prompt (rating-prompt.ts) to decide when to ask for an
 * App Store rating or feedback.
 *
 * Semantics: counter increments exactly once per fully-completed
 * publish -- defined as the moment the user has seen the generated
 * wisdom card in PhaseInsight and tapped Done. This aligns with
 * Apple HIG's "after a signature interaction" guidance: the
 * satisfying moment is when the user has consumed their insight
 * and chosen to dismiss it, not the earlier server-success ping.
 *
 * Failed publishes (network error, transcription failure, quota
 * exhausted) and aborted flows (user closes record modal before
 * publish completes) do NOT increment.
 *
 * Stored in MMKV at key `novame_publish_count`, persisting across
 * cold launches but NOT synced cross-device. iOS's
 * SKStoreReviewController already rate-limits to 3 presentations
 * per 365 days regardless -- worst case a fresh device gets one
 * extra prompt that iOS will silently no-op anyway.
 */
import { storage } from '@/lib/storage';

const PUBLISH_COUNT_KEY = 'novame_publish_count';

/**
 * Read the lifetime publish counter. Returns 0 when MMKV is empty
 * (fresh install or counter cleared).
 */
export function getPublishCount(): number {
  try {
    const raw = storage.getString(PUBLISH_COUNT_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Increment the lifetime publish counter and return the new value.
 *
 * Call exactly once from PhaseInsight.handleDone, AFTER the prefetch
 * await resolves and BEFORE handleClose. Per docs: this is the
 * moment the user has finished consuming their insight.
 */
export function incrementPublishCount(): number {
  const current = getPublishCount();
  const next = current + 1;
  try {
    storage.set(PUBLISH_COUNT_KEY, String(next));
  } catch (e) {
    // MMKV writes essentially never fail. If it does, the counter
    // stays at its prior value -- worst case the user doesn't get a
    // rating prompt this time. Not worth retrying.
    console.warn('[publish-count] MMKV write failed:', e);
  }
  return next;
}
