/** Optimistic presentation only; the accepted server deadline always wins. */
export const ADVENTURE_FREE_DURATION_MS = 6 * 60 * 60 * 1000;
export const ADVENTURE_PLUS_DURATION_MS = 3 * 60 * 60 * 1000;
export const adventureDurationMs = (hasPlus: boolean) => hasPlus ? ADVENTURE_PLUS_DURATION_MS : ADVENTURE_FREE_DURATION_MS;
