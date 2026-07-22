/**
 * Tame Enemy combat resolution. Decision record B3 (line 129) + the decision
 * that skill rarity is rolled at generation time, not in battle.
 *
 * Rarity is persisted on the skill, so the Skills-tab glow is stable and a
 * skill taught to a friend keeps its rarity. This module therefore rolls
 * nothing: it maps a skill kind to damage and reports the monster's visual
 * tier from remaining HP. Pure and deterministic.
 */

// PRD §2.4 (v2.0 economy pass): base HP 50, and each cleared stage adds 100.
// "Stage" = how many times THIS monster was tamed before (the natural reading
// of "每过一个阶段" — pending explicit product confirmation, tracked as plan
// doc Q15; the function keeps the policy in one place either way).
export const MONSTER_HP = 50;

/** 2026-07 ruling (Q15 follow-up): staged HP is capped at 300. */
export const MONSTER_HP_CAP = 300;

export function monsterHpForStage(timesTamedBefore: number): number {
  return Math.min(MONSTER_HP_CAP, MONSTER_HP + 100 * Math.max(0, timesTamedBefore));
}

// ---- Battle points & milestone rewards (PRD §2.4 + 2026-07 ruling) --------
// Each tame banks the defeated monster's max HP as battle points. Milestones
// sit at GROWING intervals: the n-th gap is n × 1000, so the cumulative
// thresholds run 1000, 3000, 6000, 10000, … (base × n(n+1)/2). Every crossed
// milestone pays BATTLE_MILESTONE_REWARD currency.
//
// The reward amount is a PLACEHOLDER (product hasn't priced it); change the
// constant, nothing else. The threshold rule is mirrored in the
// record_tame_points RPC (closed form) so the pay stays atomic server-side.
export const BATTLE_MILESTONE_BASE = 1000;
export const BATTLE_MILESTONE_REWARD = 200; // per the prep-screen mock (🍀 x200)

/** How many milestones a running points total has fully crossed. */
export function battleMilestoneCount(totalPoints: number): number {
  if (totalPoints <= 0) return 0;
  // Largest n with base * n(n+1)/2 <= points.
  return Math.floor((Math.sqrt(1 + (8 * totalPoints) / BATTLE_MILESTONE_BASE) - 1) / 2);
}

/** The n-th milestone's cumulative threshold (1-based): base * n(n+1)/2. */
export function battleMilestoneThreshold(n: number): number {
  return (BATTLE_MILESTONE_BASE * n * (n + 1)) / 2;
}

/** The next `count` un-crossed thresholds, for the prep screen's track. */
export function nextMilestoneThresholds(totalPoints: number, count: number): number[] {
  const crossed = battleMilestoneCount(totalPoints);
  return Array.from({ length: count }, (_, i) => battleMilestoneThreshold(crossed + i + 1));
}

// Four tiers per PRD §2.4: 默认 10 / 普通 20 / 中级 30 / 高级 50. The fixed
// 81-card library assigns each card a tier; 'learned'/'hidden' remain as the
// legacy names for normal/advanced so existing rows keep working.
export type SkillKind = 'default' | 'learned' | 'intermediate' | 'hidden';

export const SKILL_DAMAGE: Record<SkillKind, number> = {
  default: 10,
  learned: 20,
  intermediate: 30,
  hidden: 50,
};

export type MonsterTier = 'healthy' | 'wounded' | 'defeated';

/**
 * Visual tier from remaining HP, defined on integer HP (fractions of the
 * 50-HP scale invite off-by-one arguments):
 *
 *   >= 34 HP        healthy    (34 = ceil(50 * 2/3): "at least two thirds")
 *    1..33 HP       wounded    (the middle band runs to 1, not to 33%)
 *   <= 0 HP         defeated   (the tamed terminal state, not a visual band)
 *
 * Staged monsters (HP > 50) reuse the same fraction of their own max via
 * monsterTierFor.
 */
export const HEALTHY_MIN_HP = 34;

export function monsterTier(remainingHp: number): MonsterTier {
  if (remainingHp <= 0) return 'defeated';
  if (remainingHp >= HEALTHY_MIN_HP) return 'healthy';
  return 'wounded';
}

/** Tier against an arbitrary max HP (staged monsters). */
export function monsterTierFor(remainingHp: number, maxHp: number): MonsterTier {
  if (remainingHp <= 0) return 'defeated';
  if (remainingHp >= Math.ceil((maxHp * 2) / 3)) return 'healthy';
  return 'wounded';
}

export function damageFor(kind: SkillKind): number {
  return SKILL_DAMAGE[kind];
}

/** Apply one hit, clamping HP at zero. */
export function applyHit(remainingHp: number, kind: SkillKind): number {
  return Math.max(0, remainingHp - damageFor(kind));
}

export function isTamed(remainingHp: number): boolean {
  return remainingHp <= 0;
}
