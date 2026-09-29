import { SPECIAL_QUEST_STEPS } from '@novame/domain';

export const ROOM_NEED_MAX = 100;
export const ROOM_NEED_DECAY_INTERVAL_MS = 5 * 60 * 1000;
export const FREE_AFFECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const FREE_ADVENTURE_DURATION_MS = 8 * 60 * 60 * 1000;
export const PLUS_ADVENTURE_DURATION_MS = 2 * 60 * 60 * 1000;
export const DAILY_QUEST_COUNT = 3;

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Derive a need value without writing one database row every five minutes. */
export function projectedRoomNeed(
  valueAtUpdate: number,
  updatedAtMs: number,
  nowMs: number,
): number {
  const base = clampInteger(valueAtUpdate, 0, ROOM_NEED_MAX);
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs) || nowMs <= updatedAtMs) {
    return base;
  }
  const elapsedSteps = Math.floor((nowMs - updatedAtMs) / ROOM_NEED_DECAY_INTERVAL_MS);
  return Math.max(0, base - elapsedSteps);
}

export function canRefillRoomNeed(currentValue: number): boolean {
  return clampInteger(currentValue, 0, ROOM_NEED_MAX) < ROOM_NEED_MAX;
}

export function affectionCooldownRemainingMs(
  lastFreeAffectionAtMs: number | null,
  nowMs: number,
  hasPlus: boolean,
): number {
  if (hasPlus || lastFreeAffectionAtMs === null) return 0;
  if (!Number.isFinite(lastFreeAffectionAtMs) || !Number.isFinite(nowMs)) {
    return FREE_AFFECTION_COOLDOWN_MS;
  }
  return Math.max(0, lastFreeAffectionAtMs + FREE_AFFECTION_COOLDOWN_MS - nowMs);
}

export function adventureDurationMs(hasPlus: boolean): number {
  return hasPlus ? PLUS_ADVENTURE_DURATION_MS : FREE_ADVENTURE_DURATION_MS;
}

/**
 * Applying Plus during an active adventure can only shorten the remaining
 * time. If less than two hours remain, the existing end timestamp is kept.
 */
export function acceleratedAdventureEndMs(
  currentEndsAtMs: number,
  upgradedAtMs: number,
): number {
  if (!Number.isFinite(currentEndsAtMs) || !Number.isFinite(upgradedAtMs)) {
    return currentEndsAtMs;
  }
  if (currentEndsAtMs <= upgradedAtMs) return currentEndsAtMs;
  return Math.min(currentEndsAtMs, upgradedAtMs + PLUS_ADVENTURE_DURATION_MS);
}

// Daily assignment is server-only (MD5 ordering persisted per user/local day).
// Do not locally reshuffle a second, potentially divergent task list.
export function specialQuestTarget(stage: number, kind: keyof typeof SPECIAL_QUEST_STEPS): number {
  const safeStage = Math.max(1, clampInteger(stage, 1, 10_000));
  return SPECIAL_QUEST_STEPS[kind] * safeStage;
}

export type PairItemDisposition = 'grant_self' | 'gift_partner' | 'exclude';

/** Product rule: at most two copies across a pair, one useful copy per user. */
export function pairItemDisposition(
  selfOwns: boolean,
  partnerOwns: boolean,
): PairItemDisposition {
  if (!selfOwns) return 'grant_self';
  if (!partnerOwns) return 'gift_partner';
  return 'exclude';
}
