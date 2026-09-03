import { storage } from '@/lib/storage';
import { kReflectionPaywallCount, kReflectionPaywallNextVariant } from '@/shared/storage';

const listeners = new Set<() => void>();

export type ReflectionPaywallVariant = '1' | '2';

/** Read without consuming so a rejected navigation does not skip a variant. */
export function getNextReflectionPaywallVariant(): ReflectionPaywallVariant {
  return storage.getString(kReflectionPaywallNextVariant.name) === '2' ? '2' : '1';
}

/** Advance only after that modal has actually mounted (idempotent/CAS-like). */
export function recordReflectionPaywallVariantShown(variant: ReflectionPaywallVariant): void {
  try {
    if (getNextReflectionPaywallVariant() !== variant) return;
    storage.set(kReflectionPaywallNextVariant.name, variant === '1' ? '2' : '1');
  } catch (error) {
    // Variant rotation is promotional state and must never block the paywall.
    console.warn('[reflection-paywall] variant write failed:', error);
  }
}

export function incrementReflectionPaywallCount(): number {
  const raw = storage.getString(kReflectionPaywallCount.name);
  const current = raw ? Number.parseInt(raw, 10) : 0;
  const next = (Number.isFinite(current) && current >= 0 ? current : 0) + 1;
  storage.set(kReflectionPaywallCount.name, String(next));
  return next;
}

/** Show on claims 1, 3, 5, then every third claim: 8, 11, 14, ... */
export function shouldShowReflectionPaywall(count: number): boolean {
  return count === 1 || count === 3 || count === 5 || (count > 5 && (count - 5) % 3 === 0);
}

/** Called once after a successful Done, never during Save, edits or recovery. */
export function recordReflectionPaywallClaim(isFree: boolean): void {
  if (!isFree) return;
  try {
    if (!shouldShowReflectionPaywall(incrementReflectionPaywallCount())) return;
  } catch (error) {
    // A promotional counter must never interrupt completion/navigation.
    console.warn('[reflection-paywall] count write failed:', error);
    return;
  }
  for (const listener of listeners) {
    try { listener(); } catch (error) {
      console.warn('[reflection-paywall] listener failed:', error);
    }
  }
}

export function subscribeReflectionPaywallRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
