import { router } from 'expo-router';

/** One shared, transparent route for every coin checkout. navigate reuses an
 * already-open prompt instead of stacking duplicates after repeated taps. */
export function showInsufficientCoins() {
  router.navigate('/(main)/insufficient-coins');
}

export function isInsufficientCoins(error: unknown): boolean {
  if (error === 'insufficient_balance') return true;
  if (!error || typeof error !== 'object') return false;
  const value = error as { message?: unknown; body?: { error?: unknown } };
  return value.message === 'insufficient_balance' || value.body?.error === 'insufficient_balance';
}
