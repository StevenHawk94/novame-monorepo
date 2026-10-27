import { storage } from './storage';
import { kOfficialRatingMilestones } from '../shared/storage/keys';
import { sessionEpoch, sessionUserId, subscribeSessionIdentity } from './session-lifecycle';

export type RatingMilestone = { id: string; kind: 'affection' | 'purchase' | 'toy'; userId: string };
type State = { affection: string[]; purchase: string[]; toy: boolean; pending: RatingMilestone | null };
const listeners = new Set<() => void>();
const inlineAffection = new Set<{ userId: string; id: string }>();
function notify() {
  for (const listener of listeners) try { listener(); } catch (error) { console.warn('[rating] listener failed:', error); }
}
subscribeSessionIdentity(() => { inlineAffection.clear(); notify(); });
/** Inline presentation is allowed only while this exact Sent screen remains
 * mounted. A restored request cannot interrupt a new Affection gesture. */
export function registerInlineAffectionRating(userId: string, receiptId: string) {
  if (sessionUserId() !== userId) return () => {};
  const owner = { userId, id: `affection:${receiptId}` };
  inlineAffection.add(owner); notify();
  return () => { if (inlineAffection.delete(owner)) notify(); };
}
export function canPresentRatingInline(request: RatingMilestone) {
  return sessionUserId() === request.userId && [...inlineAffection].some(owner => owner.userId === request.userId && owner.id === request.id);
}
function read(userId: string): State {
  try {
    const value = JSON.parse(storage.getString(kOfficialRatingMilestones.keyFor(userId)) ?? 'null');
    if (value && ['affection', 'purchase'].every(key => Array.isArray(value[key]) && value[key].every((id: unknown) => typeof id === 'string'))
      && typeof value.toy === 'boolean' && (value.pending === null || (value.pending?.userId === userId
        && typeof value.pending.id === 'string' && ['affection', 'purchase', 'toy'].includes(value.pending.kind)))) return value;
  } catch { /* Review marketing must never gate a successful operation. */ }
  return { affection: [], purchase: [], toy: false, pending: null };
}
export function ratingMilestoneDue(count: number) { return count === 1 || count > 0 && count % 10 === 0; }

/** Only committed sending receipts or completed photo-backed Toy gestures enter here. */
export function recordRatingMilestone(userId: string, kind: RatingMilestone['kind'], receiptId: string) {
  if (!userId || sessionUserId() !== userId || !receiptId) return;
  try {
    const previous = read(userId);
    if (kind === 'toy' ? previous.toy : previous[kind].includes(receiptId)) return;
    const ids = kind === 'toy' ? [] : [...previous[kind], receiptId];
    const due = kind === 'toy' || ratingMilestoneDue(ids.length);
    const next = { ...previous, ...(kind === 'toy' ? { toy: true } : { [kind]: ids }),
      pending: due ? { id: `${kind}:${receiptId}`, kind, userId } : previous.pending };
    storage.set(kOfficialRatingMilestones.keyFor(userId), JSON.stringify(next));
    notify();
  } catch (error) { console.warn('[rating] milestone receipt failed:', error); }
}
export function recordPhotoToyPlayForRating(userId: string, toyId?: string, photoId?: string) {
  if (toyId && photoId) recordRatingMilestone(userId, 'toy', `${toyId}:${photoId}`);
}
export function peekRatingMilestone(): RatingMilestone | null {
  const userId = sessionUserId();
  return userId ? read(userId).pending : null;
}
export function consumeRatingMilestone(request: RatingMilestone) {
  if (sessionUserId() !== request.userId) return;
  try {
    const previous = read(request.userId);
    if (previous.pending?.id !== request.id) return;
    storage.set(kOfficialRatingMilestones.keyFor(request.userId), JSON.stringify({ ...previous, pending: null }));
    notify();
  } catch (error) { console.warn('[rating] consumption receipt failed:', error); }
}
export function subscribeRatingMilestones(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One paid catalog transaction, including a multi-item room checkout, is one
 * purchase. Server purchase ids/operation keys dedupe lost-response retries.
 * Merely equipping owned items, zero-cost claims and coin top-ups never count. */
export function trackItemPurchaseForRating<T extends { purchaseId?: unknown; total?: unknown; error?: unknown }>(
  promise: Promise<T>, operationId: string, quotedPrice?: number, bulk = false,
): Promise<T> {
  const userId = sessionUserId(), epoch = sessionEpoch();
  return promise.then(receipt => {
    if (userId && epoch === sessionEpoch() && userId === sessionUserId() && !receipt.error) {
      const paid = bulk ? Number(receipt.total) > 0 : typeof receipt.purchaseId === 'string' && (quotedPrice ?? 0) > 0;
      if (paid) recordRatingMilestone(userId, 'purchase', bulk ? `room:${operationId}` : `item:${receipt.purchaseId}`);
    }
    return receipt;
  });
}
