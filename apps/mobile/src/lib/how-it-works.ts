import { storage } from './storage';

/**
 * One-shot handoff from the Menu's "How It Works" row to the Friends tab:
 * the row sets the flag and navigates; the Friends tab consumes it on focus
 * and starts the demo feed (Mochi preview).
 */
const KEY = 'burrow.how_it_works_requested';

export function requestHowItWorks(): void {
  storage.set(KEY, 1);
}

export function consumeHowItWorksRequest(): boolean {
  const v = storage.getNumber(KEY);
  if (v) {
    storage.remove(KEY);
    return true;
  }
  return false;
}
