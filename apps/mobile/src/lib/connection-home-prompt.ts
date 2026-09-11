import type { ConnectionHistoryResult } from './friends-api';
import { kConnectionHomePrompt } from '../shared/storage/keys';
import { storage } from './storage';

export const NEW_CONNECTION_HOME_MESSAGE =
  'Hey, there’s something new worth knowing about your person. Go take a look.';

interface StoredConnectionHomePrompt {
  partnerId: string;
  latestCardId: string | null;
}

function readStoredPrompt(): StoredConnectionHomePrompt | null {
  const raw = storage.getString(kConnectionHomePrompt.name);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredConnectionHomePrompt>;
    if (typeof value.partnerId !== 'string') return null;
    if (value.latestCardId !== null && typeof value.latestCardId !== 'string') return null;
    return { partnerId: value.partnerId, latestCardId: value.latestCardId ?? null };
  } catch {
    return null;
  }
}

function writeStoredPrompt(value: StoredConnectionHomePrompt): void {
  storage.set(kConnectionHomePrompt.name, JSON.stringify(value));
}

/**
 * Compare the newest immutable Connection History card with the card known on
 * the previous Home visit. The first authoritative result for a pairing only
 * establishes a baseline, so updating the app never advertises old cards as
 * new. A later card is consumed exactly once, including after a cold launch.
 */
export function consumeNewConnectionHomeMessage(
  result: ConnectionHistoryResult | null,
  partnerId: string | null,
): string | null {
  if (!partnerId || !result?.ok || !result.paired || result.unavailable) return null;

  const newest = result.cards.reduce<(typeof result.cards)[number] | null>((latest, card) => {
    if (!latest) return card;
    if (card.createdAt !== latest.createdAt) return card.createdAt > latest.createdAt ? card : latest;
    return card.id > latest.id ? card : latest;
  }, null);
  const newestId = newest?.id ?? null;
  const stored = readStoredPrompt();

  if (!stored || stored.partnerId !== partnerId) {
    writeStoredPrompt({ partnerId, latestCardId: newestId });
    return null;
  }
  // An empty incremental response must not erase the previous cursor. If the
  // server/cache later repopulates, that old card would otherwise look new.
  if (!newestId) return null;
  if (stored.latestCardId === newestId) return null;

  writeStoredPrompt({ partnerId, latestCardId: newestId });
  return NEW_CONNECTION_HOME_MESSAGE;
}
