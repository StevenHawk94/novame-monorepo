/**
 * card-saves API client wrapper — Stage 3.9.A.1.3
 *
 * Wraps /api/card-saves for save/unsave actions in seek-question and
 * card-detail screens.
 *
 * Server-side enforces:
 *   - user cannot save their own card
 *   - quota: saves <= owned cards
 */
import { apiClient } from './api';

export type CardSavesQuota = {
  created: number;
  saved: number;
  available: number;
};

export type SaveActionResult = {
  success: boolean;
  saved: boolean;
  error?: string;
};

export async function saveCard(userId: string, cardId: string): Promise<SaveActionResult> {
  try {
    const data = await apiClient.request<{ success?: boolean; error?: string }>(
      'POST',
      '/api/card-saves',
      { userId, cardId },
    );
    if (data.success) return { success: true, saved: true };
    return { success: false, saved: false, error: data.error || 'Save failed' };
  } catch (e) {
    return {
      success: false,
      saved: false,
      error: e instanceof Error ? e.message : 'Save failed',
    };
  }
}

export async function unsaveCard(userId: string, cardId: string): Promise<SaveActionResult> {
  try {
    const data = await apiClient.request<{ success?: boolean; error?: string }>(
      'DELETE',
      '/api/card-saves',
      { userId, cardId },
    );
    if (data.success) return { success: true, saved: false };
    return { success: false, saved: true, error: data.error || 'Unsave failed' };
  } catch (e) {
    return {
      success: false,
      saved: true,
      error: e instanceof Error ? e.message : 'Unsave failed',
    };
  }
}
