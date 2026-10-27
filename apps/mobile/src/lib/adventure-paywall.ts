import { storage } from './storage';
import { kAdventurePaywall } from '../shared/storage/keys';
import { sessionUserId, subscribeSessionIdentity } from './session-lifecycle';

type State = { count: number; completedIds: string[]; pending: string | null };
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) {
  try { listener(); } catch (error) { console.warn('[adventure-paywall] listener failed:', error); }
} };
subscribeSessionIdentity(notify);

function read(owner: string): State {
  try {
    const value = JSON.parse(storage.getString(kAdventurePaywall.keyFor(owner)) ?? 'null');
    if (Number.isSafeInteger(value?.count) && value.count >= 0 && Array.isArray(value.completedIds)
      && value.completedIds.every((id: unknown) => typeof id === 'string')
      && (value.pending === null || typeof value.pending === 'string')) return value;
  } catch { /* A promotional receipt must never block completion. */ }
  return { count: 0, completedIds: [], pending: null };
}

export function shouldShowAdventurePaywall(count: number): boolean {
  return Number.isSafeInteger(count) && (count === 1 || count === 5 || (count >= 20 && count % 20 === 0));
}

/** Called only by the final explicit reward exit, not Save, chest opening,
 * intermediate treasure claims, Back, or a background settlement receipt.
 * The entry-frozen server ordinal continues an existing account's progress;
 * local receipts cover consecutive completions before bootstrap catches up. */
export function recordAdventurePaywallCompletion(input: {
  userId: string; adventureId: string; hasPlus: boolean; ordinal?: number;
}) {
  if (input.hasPlus || !input.adventureId || sessionUserId() !== input.userId) return;
  try {
    const previous = read(input.userId);
    if (previous.completedIds.includes(input.adventureId)) return;
    const ordinal = Number.isSafeInteger(input.ordinal) && input.ordinal! > 0 ? input.ordinal! : 0;
    const count = Math.max(previous.count + 1, ordinal);
    storage.set(kAdventurePaywall.keyFor(input.userId), JSON.stringify({ count,
      completedIds: [...previous.completedIds, input.adventureId],
      pending: shouldShowAdventurePaywall(count) ? input.adventureId : previous.pending }));
    notify();
  } catch (error) { console.warn('[adventure-paywall] completion receipt failed:', error); }
}

export function peekAdventurePaywall(): string | null {
  const owner = sessionUserId();
  return owner ? read(owner).pending : null;
}

/** Consume after the unified modal mounts, or when the user becomes Plus. */
export function consumeAdventurePaywall(id: string) {
  const owner = sessionUserId();
  if (!owner) return;
  try {
    const previous = read(owner);
    if (previous.pending !== id) return;
    storage.set(kAdventurePaywall.keyFor(owner), JSON.stringify({ ...previous, pending: null }));
    notify();
  } catch (error) { console.warn('[adventure-paywall] presentation receipt failed:', error); }
}

export function subscribeAdventurePaywall(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
