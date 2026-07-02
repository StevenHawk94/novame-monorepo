/**
 * study-claim API client wrapper — Stage 3.9.A.2.5
 */
import { getLevelFromExp } from '@novame/core';

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

// Seconds of banked study time that equal 1 XP. MUST mirror the server's
// STUDY_SECS_PER_XP in apps/api/src/app/api/study-claim/route.js. If the
// server curve changes, change it here too (same contract as the exp table
// shared via @novame/core).
const STUDY_SECS_PER_XP = 360;

/**
 * Computes the study-claim result LOCALLY from the banked WP>0 seconds
 * (character-state's afkStudySeconds) and the current total EXP, producing
 * the same StudyClaimResponse the server would for the deterministic fields.
 * This lets Home show the claim modal instantly (no "Wrapping up" spinner,
 * no round-trip) while postStudyClaim reconciles the authoritative values
 * (and the server-random souls / cardKeyword) in the background.
 *
 * Deterministic — every field here is a byte-for-byte mirror of
 * study-claim/route.js: floor(accumSecs/360) XP, hours/mins from accumSecs,
 * old/new level via the SAME getLevelFromExp used by the server, leveledUp,
 * and nothingToClaim = accumSecs <= 0 (the server settles nothing when its
 * atomic claim finds accumSecs <= 0).
 *
 * Server-random fields cannot be known locally, so they are placeholders
 * that the background reconcile overwrites onto Home counters (they are NOT
 * shown in the modal): totalSouls/resonanceBoost = 0, cardKeyword = 'Momentum'.
 */
export function computeLocalStudyClaim(
  accumSecs: number,
  oldTotalExp: number,
): StudyClaimResponse {
  const secs = Math.max(0, Math.floor(accumSecs));
  const studyHours = Math.floor(secs / 3600);
  const studyMins = Math.floor((secs % 3600) / 60);
  const expGained = Math.floor(secs / STUDY_SECS_PER_XP);
  const oldLevelInfo = getLevelFromExp(oldTotalExp);
  const newLevelInfo = getLevelFromExp(oldTotalExp + expGained);
  return {
    success: true,
    expGained,
    studyHours,
    studyMins,
    totalSouls: 0,
    cardKeyword: 'Momentum',
    resonanceBoost: 0,
    oldExp: oldLevelInfo.currentExp,
    oldLevel: oldLevelInfo.level,
    oldExpNeeded: oldLevelInfo.expNeeded,
    newExp: newLevelInfo.currentExp,
    newLevel: newLevelInfo.level,
    newExpNeeded: newLevelInfo.expNeeded,
    leveledUp: newLevelInfo.level > oldLevelInfo.level,
    nothingToClaim: secs <= 0,
  };
}
