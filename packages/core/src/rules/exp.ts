/**
 * @novame/core/rules/exp
 *
 * EXP / level progression — 99 levels, 2-segment linear curve.
 *
 *   Lv.1-49:  linear step 10, expNeeded = 10 + lv*10
 *             -> L1=20, L2=30, ..., L49=500
 *   Lv.50-98: flat 500
 *   Lv.99:    cap (no further progression)
 *
 * Design target (Stage 6 follow-up):
 *   - L5 cumulative ≥ 120 EXP so a typical first publish (~120 EXP)
 *     can't cross level 5 and trigger the outfit-2 unlock modal at
 *     the same time as the free-tier paywall (Stage 5.WR.2 modal-
 *     stack regression).
 *   - L5 cumulative = 200 (20+30+40+50+60), well above the 120 floor.
 *   - L50 cumulative = 13,240 EXP. With an assumed steady-state
 *     ~130 EXP/day from daily tasks + occasional publishes, reaching
 *     L50 takes ~102 days (≈3.4 months). Calibrated for the reduced
 *     post-Stage-6 EXP sources (some grinding loops were removed).
 *   - L50-L98 flat 500 EXP/level so the late-game pace is steady
 *     and predictable (24,500 EXP across 49 levels ≈ 188 days at
 *     130 EXP/day after L50). L99 is the cap.
 *
 * Formula simplification: L1-L49 collapse to a single expression
 *   expNeeded(lv) = 10 + lv * 10
 * which preserves the "round to 10" requirement and is trivially
 * monotonic. The previous 7-segment curve (with Math.round and
 * fractional steps like 4.44 / 8.89) was historical accretion and
 * is replaced wholesale.
 *
 * EXP_TABLE is computed once at module load and frozen for the lifetime
 * of the process — treat it as a static lookup.
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
    if (lv <= 49) {
      // Linear 10/step: L1=20, L2=30, ..., L49=500. The 200 EXP
      // accumulated by L5 keeps the first-publish + first-tasks
      // bundle (~120 EXP) safely below L5, preserving the modal-
      // stack invariant from the Stage 5.WR.2 fix.
      expNeeded = 10 + lv * 10
    } else if (lv <= 98) {
      // L50-L98 plateau. 500/level chosen to seamlessly continue
      // from L49=500 with no step discontinuity.
      expNeeded = 500
    } else {
      // L99 is the cap. expNeeded = 0 signals "no further progression";
      // getLevelFromExp() returns progress=1 at this row.
      expNeeded = 0
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

/**
 * EXP required to advance from level `lv` to `lv + 1`.
 *
 * Looks up the value from the frozen EXP_TABLE — single source of truth.
 * Out-of-range levels (< 1 or > 99) return 0, matching the table cap.
 *
 * Used by mobile's growth tab for optimistic level-up calculation when
 * the user completes a task, before the server response arrives.
 */
export function getExpNeeded(lv: number): number {
  if (lv < 1 || lv > 99) return 0
  return EXP_TABLE[lv - 1].expNeeded
}
