/**
 * Official App Store / Google Play rating cadence.
 *
 * A successful Reflect counts when its result Claim button is pressed. Request
 * opportunities occur at 2, 7, 12, 17... claims on this device; Apple/Google
 * remain authoritative over whether their native prompt is actually shown.
 */
import { storage } from '@/lib/storage';
import { kRatingReflectClaimCount } from '@/shared/storage';

type Listener = () => void;

const listeners = new Set<Listener>();

function getReflectClaimCount(): number {
  try {
    const raw = storage.getString(kRatingReflectClaimCount.name);
    if (!raw) return 0;
    const count = Number.parseInt(raw, 10);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

/** Increment exactly once per claimed Reflect and report whether this is 2 + 5n. */
export function recordReflectClaimForRating(): boolean {
  const next = getReflectClaimCount() + 1;
  try {
    storage.set(kRatingReflectClaimCount.name, String(next));
  } catch (error) {
    console.warn('[official-rating] claim count write failed:', error);
    return false;
  }
  return next >= 2 && (next - 2) % 5 === 0;
}

/** Queue an official rating opportunity in the mounted Main navigation gate. */
export function emitOfficialRatingRequest(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[official-rating] listener failed:', error);
    }
  }
}

export function subscribeOfficialRatingRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
