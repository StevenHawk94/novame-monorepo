import { storage } from '@/lib/storage';
import { kReflectionPaywallCount } from '@/shared/storage';

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
