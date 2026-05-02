/**
 * @novame/core/rules/exp
 *
 * EXP / level progression — 99 levels with tiered EXP curves.
 *
 *   Lv.1-5:   20-40,    step=5,  tier sum=150
 *   Lv.6-15:  50-90,    step≈4.44
 *   Lv.16-25: 120-200,  step≈8.89
 *   Lv.26-40: 220-400,  step≈12.86
 *   Lv.41-50: 420-540,  step≈13.33
 *   Lv.51-90: flat 800
 *   Lv.91-99: flat 1000
 *
 * EXP_TABLE is computed once at module load and frozen for the lifetime
 * of the process — treat it as a static lookup.
 *
 * Behavior preserved 1:1 from apps/api/src/lib/constants.js.
 */

export type ExpRow = {
  level: number
  expNeeded: number
  cumulativeExp: number
}

export type LevelInfo = {
  level: number
  currentExp: number
  expNeeded: number
  totalExp: number
  /** 0..1 — fraction of the way through the current level. */
  progress: number
}

function buildExpTable(): readonly ExpRow[] {
  const table: ExpRow[] = []
  let cumulative = 0

  for (let lv = 1; lv <= 99; lv++) {
    let expNeeded: number
    if (lv <= 5) {
      expNeeded = 20 + (lv - 1) * 5
    } else if (lv <= 15) {
      expNeeded = Math.round(50 + (lv - 6) * 4.44)
    } else if (lv <= 25) {
      expNeeded = Math.round(120 + (lv - 16) * 8.89)
    } else if (lv <= 40) {
      expNeeded = Math.round(220 + (lv - 26) * 12.86)
    } else if (lv <= 50) {
      expNeeded = Math.round(420 + (lv - 41) * 13.33)
    } else if (lv <= 90) {
      expNeeded = 800
    } else {
      expNeeded = 1000
    }

    cumulative += expNeeded
    table.push({ level: lv, expNeeded, cumulativeExp: cumulative })
  }
  return table
}

/** The full 99-row EXP requirement table. Computed once at module load. */
export const EXP_TABLE: readonly ExpRow[] = buildExpTable()

/** Resolve total accumulated EXP into level + progress info. Caps at Lv.99. */
export function getLevelFromExp(totalExp: number): LevelInfo {
  let remaining = totalExp
  for (const row of EXP_TABLE) {
    if (remaining < row.expNeeded) {
      return {
        level: row.level,
        currentExp: remaining,
        expNeeded: row.expNeeded,
        totalExp,
        progress: remaining / row.expNeeded,
      }
    }
    remaining -= row.expNeeded
  }
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp, progress: 1 }
}
