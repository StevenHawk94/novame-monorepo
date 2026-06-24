/**
 * study-claim API client wrapper — Stage 3.9.A.2.5
 */
import { apiClient } from './api';

export type StudyClaimResponse = {
  success: true;
  expGained: number;
  studyHours: number;
  studyMins: number;
  totalSouls: number;
  cardKeyword: string;
  resonanceBoost: number;
  oldExp: number;
  oldLevel: number;
  oldExpNeeded: number;
  newExp: number;
  newLevel: number;
  newExpNeeded: number;
  leveledUp: boolean;
  /** Server signals a no-op claim (already settled / 0 banked). The modal
   *  suppresses the celebration when this is true. */
  nothingToClaim?: boolean;
};

export async function postStudyClaim(
  userId: string,
): Promise<StudyClaimResponse> {
  return apiClient.request<StudyClaimResponse>(
    'POST',
    '/api/study-claim',
    { userId },
  );
}
