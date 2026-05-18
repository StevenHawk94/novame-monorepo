/**
 * Wisdom card report helper -- Stage 6 UGC compliance.
 *
 * POST wrapper around /api/wisdom-card-reports. Reports differ from
 * blocks in intent and effect:
 *
 *   Block (existing): user's personal "don't show me this" -- only
 *     affects their own seek-question feed. No admin review.
 *
 *   Report (this lib): user flags content as violating community
 *     guidelines -- written to wisdom_card_reports for admin review,
 *     with a 24-hour response policy per Apple App Store Guideline 1.2.
 *
 * UX flow on submit:
 *   1. POST /api/wisdom-card-reports
 *   2. Server writes wisdom_card_reports row (UNIQUE user_id+card_id;
 *      duplicate reports are accepted silently as already-reported)
 *   3. Server ALSO writes wisdom_card_blocks (auto-block on report,
 *      industry standard -- user who reports doesn't want to see it
 *      anymore either)
 *   4. Client shows toast "Thanks, reviewed within 24 hours" and
 *      optimistically drops the card from local list state
 *
 * Available report reasons (must match server CHECK constraint):
 *   - spam              (spam or misleading)
 *   - inappropriate     (inappropriate or offensive)
 *   - harassment        (hate speech or harassment)
 *   - violence          (violence or dangerous content)
 *   - sexual            (sexual content)
 *   - self_harm         (self-harm or suicide)
 *   - misinformation    (misinformation)
 *   - other             (other, with required detail)
 */
import { apiClient } from './api';

export type ReportReason =
  | 'spam'
  | 'inappropriate'
  | 'harassment'
  | 'violence'
  | 'sexual'
  | 'self_harm'
  | 'misinformation'
  | 'other';

export type ReportResult = {
  success: boolean;
  reportedAt?: string;
  alreadyReported?: boolean;
  error?: string;
};

export async function reportWisdomCard(
  userId: string,
  cardId: string,
  reason: ReportReason,
  detail?: string,
): Promise<ReportResult> {
  try {
    const data = await apiClient.post<{
      success: boolean;
      reportedAt?: string;
      alreadyReported?: boolean;
      error?: string;
    }>('/api/wisdom-card-reports', {
      userId,
      cardId,
      reason,
      detail: detail?.trim() || null,
    });

    if (!data.success) {
      return { success: false, error: data.error ?? 'Unknown server error' };
    }
    return {
      success: true,
      reportedAt: data.reportedAt,
      alreadyReported: data.alreadyReported,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Network error',
    };
  }
}
