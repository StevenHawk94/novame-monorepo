/**
 * Tame Enemy combat resolution. Decision record B3 (line 129) + the decision
 * that skill rarity is rolled at generation time, not in battle.
 *
 * Rarity is persisted on the skill, so the Skills-tab glow is stable and a
 * skill taught to a friend keeps its rarity. This module therefore rolls
 * nothing: it maps a skill kind to damage and reports the monster's visual
 * tier from remaining HP. Pure and deterministic.
 */

export const MONSTER_HP = 60;

export type SkillKind = 'default' | 'learned' | 'hidden';

// Line 129: default 10 (x6 to clear), learned 20 (x3), hidden 50 (x2).
export const SKILL_DAMAGE: Record<SkillKind, number> = {
  default: 10,
  learned: 20,
  hidden: 50,
};

export type MonsterTier = 'healthy' | 'wounded' | 'defeated';

/**
 * Visual tier from remaining HP. Line 129 gives the bands as ">66% / 33-66% /
 * <=0", but a 60-HP scale has no integer at 66% (39.6) or 33% (19.8), so
 * fractions invite off-by-one arguments about 40 HP (66.7%) vs 39 (65%). The
 * bands are defined on integer HP instead:
 *
 *   >= 40 HP        healthy    (40 = ceil(60 * 2/3): "at least two thirds")
 *    1..39 HP       wounded    (the middle band runs to 1, not to 33%)
 *   <= 0 HP         defeated   (the tamed terminal state, not a visual band)
 */
export const HEALTHY_MIN_HP = 40;

export function monsterTier(remainingHp: number): MonsterTier {
  if (remainingHp <= 0) return 'defeated';
  if (remainingHp >= HEALTHY_MIN_HP) return 'healthy';
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
