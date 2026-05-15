/**
 * Wisdom card block helper — Stage 6.
 *
 * Lightweight POST wrapper around /api/wisdom-card-blocks. The server
 * endpoint is idempotent (POSTing an already-blocked card is safe;
 * the original blocked_at is preserved). Server-side, blocked cards
 * are filtered out of subsequent /api/seek-questions?userId=X GET
 * responses, so mobile only needs to:
 *
 *   1. Call blockWisdomCard() when the user picks "Block".
 *   2. Optimistically drop the card from local list state.
 *   3. On failure, re-insert the card at its original position and
 *      surface an alert.
 *
 * There is no local cache of the block list in MMKV — the source of
 * truth lives on the server, and the next list fetch will already
 * have the blocked card filtered out. We don't anticipate offline
 * block operations, so no queue / sync layer is needed in v1.
 */
import { apiClient } from './api';

export type BlockResult = {
  success: boolean;
  blockedAt?: string;
  error?: string;
};

export async function blockWisdomCard(
  userId: string,
  cardId: string,
): Promise<BlockResult> {
  try {
    const data = await apiClient.post<{
      success: boolean;
      blockedAt?: string;
      error?: string;
    }>('/api/wisdom-card-blocks', { userId, cardId });

    if (!data.success) {
      return { success: false, error: data.error ?? 'Unknown server error' };
    }
    return { success: true, blockedAt: data.blockedAt };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Network error',
    };
  }
}
