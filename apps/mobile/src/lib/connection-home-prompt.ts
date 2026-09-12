import {
  fetchConnectionHistory,
  fetchPairing,
  getCachedConnectionHistory,
  type ConnectionHistoryResult,
} from './friends-api';
import { kConnectionHomePrompt } from '../shared/storage/keys';
import { storage } from './storage';

export const NEW_CONNECTION_HOME_MESSAGE =
  'Hey, there’s something new worth knowing about your person. Go take a look.';

interface StoredConnectionHomePrompt {
  partnerId: string;
  lastAnnouncedCardId: string | null;
  pendingCardId: string | null;
}

export interface PendingConnectionHomeMessage {
  partnerId: string;
  cardId: string;
  line: string;
}

function readStoredPrompt(): StoredConnectionHomePrompt | null {
  const raw = storage.getString(kConnectionHomePrompt.name);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredConnectionHomePrompt> & {
      /** Pre-pending/ack schema; interpreted as already announced. */
      latestCardId?: unknown;
    };
    if (typeof value.partnerId !== 'string') return null;
    const legacyLatestCardId = typeof value.latestCardId === 'string' ? value.latestCardId : null;
    const lastAnnouncedCardId = typeof value.lastAnnouncedCardId === 'string'
      ? value.lastAnnouncedCardId : legacyLatestCardId;
    const pendingCardId = typeof value.pendingCardId === 'string' ? value.pendingCardId : null;
    return { partnerId: value.partnerId, lastAnnouncedCardId, pendingCardId };
  } catch {
    return null;
  }
}

function writeStoredPrompt(value: StoredConnectionHomePrompt): void {
  storage.set(kConnectionHomePrompt.name, JSON.stringify(value));
}

/**
 * Stage (but do not acknowledge) the newest immutable Connection History card.
 * Advancing the cursor here used to lose the one-off line whenever Home's
 * focus/tier effects re-ran before the text actually painted. A pending card is
 * durable and can be recovered after a route change or process restart.
 */
export function stageNewConnectionHomeMessage(
  result: ConnectionHistoryResult | null,
  partnerId: string | null,
): PendingConnectionHomeMessage | null {
  if (!partnerId) return null;

  const stored = readStoredPrompt();
  if (!result?.ok || !result.paired || result.unavailable) {
    return stored?.partnerId === partnerId && stored.pendingCardId
      ? { partnerId, cardId: stored.pendingCardId, line: NEW_CONNECTION_HOME_MESSAGE }
      : null;
  }

  const newest = result.cards.reduce<(typeof result.cards)[number] | null>((latest, card) => {
    if (!latest) return card;
    if (card.createdAt !== latest.createdAt) return card.createdAt > latest.createdAt ? card : latest;
    return card.id > latest.id ? card : latest;
  }, null);
  const newestId = newest?.id ?? null;

  if (!stored || stored.partnerId !== partnerId) {
    // First authoritative result establishes the pairing baseline so an app
    // update/fresh install does not announce historical cards as new.
    writeStoredPrompt({ partnerId, lastAnnouncedCardId: newestId, pendingCardId: null });
    return null;
  }
  if (stored.pendingCardId) {
    // Multiple cards can land before Home paints. One generic announcement is
    // enough, but acknowledge the newest id so the batch is not announced
    // again on the following visit.
    const pendingCardId = newestId && newestId !== stored.lastAnnouncedCardId
      ? newestId : stored.pendingCardId;
    if (pendingCardId !== stored.pendingCardId) {
      writeStoredPrompt({ ...stored, pendingCardId });
    }
    return { partnerId, cardId: pendingCardId, line: NEW_CONNECTION_HOME_MESSAGE };
  }
  // An empty incremental response must not erase the previous cursor. If the
  // server/cache later repopulates, that old card would otherwise look new.
  if (!newestId) return null;
  if (stored.lastAnnouncedCardId === newestId) return null;

  writeStoredPrompt({ ...stored, pendingCardId: newestId });
  return { partnerId, cardId: newestId, line: NEW_CONNECTION_HOME_MESSAGE };
}

/** Mark a staged line consumed only after Home has visibly painted it. */
export function acknowledgeNewConnectionHomeMessage(
  message: PendingConnectionHomeMessage,
): void {
  const stored = readStoredPrompt();
  if (!stored || stored.partnerId !== message.partnerId || stored.pendingCardId !== message.cardId) return;
  writeStoredPrompt({
    ...stored,
    lastAnnouncedCardId: message.cardId,
    pendingCardId: null,
  });
}

/**
 * Reconcile the one-off Home companion line while the entry cover is still
 * visible. Both reads remain cache-first on failure. The returned line stays
 * pending until Home confirms that it painted after the cover was removed.
 */
export async function prepareHomeConnectionMessage(): Promise<PendingConnectionHomeMessage | null> {
  const pairing = await fetchPairing({ force: true });
  const partnerId = pairing.paired ? pairing.partner?.userId ?? null : null;
  if (!partnerId) return null;
  // Establish a missing baseline from the pre-network cache first. Without
  // this ordering, the first incremental response after an app update could
  // contain a genuinely new card and be mistaken for historical state.
  stageNewConnectionHomeMessage(getCachedConnectionHistory(), partnerId);
  const history = await fetchConnectionHistory({ incremental: true });
  return stageNewConnectionHomeMessage(history, partnerId);
}
