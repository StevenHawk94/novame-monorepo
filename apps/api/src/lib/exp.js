/**
 * Server-side EXP rules (Stage 5.WR.2 — third-pass technical-debt cleanup).
 *
 * Single source of truth for level/exp calculations on the server.
 * Before this file, getExpNeeded and getLevelFromExp were duplicated
 * across:
 *   - apps/api/src/app/api/character-state/route.js
 *   - apps/api/src/app/api/daily-tasks/route.js
 *   - apps/api/src/app/api/study-claim/route.js
 *   - apps/api/src/app/api/publish-wisdom/route.js
 *
 * The duplication caused build-11's EXP curve change to land only in
 * mobile (packages/core/src/rules/exp.ts) while every server endpoint
 * kept the old curve, so the player-visible level (computed server-side
 * and returned in every response) was unaffected by the mobile change.
 *
 * Going forward: server endpoints import from here. The mobile app
 * imports its own copy at packages/core/src/rules/exp.ts (TypeScript).
 * Both must be kept in sync; the formulas below are the JS mirror of
 * the core package's buildExpTable.
 *
 * Why not import the @novame/core TS file directly from this Edge
 * runtime route: the api package is plain JS on Vercel Edge and the
 * core package's TS source is consumed by the mobile app via Metro,
 * which has its own bundler config. A pure-JS mirror here is simpler
 * than wiring core's build output into the Edge runtime.
 *
 * If you change the formula here, also change it in
 * packages/core/src/rules/exp.ts. There is no automated check; the
 * mobile EXP display is purely cosmetic — the server's number is
 * authoritative.
 */

/**
 * EXP required to advance from level `lv` to `lv + 1`.
 *
 * 7-segment curve. Bumped level 1-5 in build 11 to slow new-user
 * progression so the first publish doesn't simultaneously trigger
 * the outfit-2 unlock modal and the free-tier paywall.
 */
export function getExpNeeded(lv) {
  if (lv <= 5) return 30 + (lv - 1) * 10
  if (lv <= 15) return Math.round(50 + (lv - 6) * 4.44)
  if (lv <= 25) return Math.round(120 + (lv - 16) * 8.89)
  if (lv <= 40) return Math.round(220 + (lv - 26) * 12.86)
  if (lv <= 50) return Math.round(420 + (lv - 41) * 13.33)
  if (lv <= 90) return 800
  return 1000
}

/**
 * Resolve total accumulated EXP into level + progress info. Caps at lv 99.
 *
 * Returns { level, currentExp, expNeeded, totalExp, progress } — the
 * exact shape every server endpoint was already constructing inline.
 */
export function getLevelFromExp(totalExp) {
  let remaining = totalExp
  for (let lv = 1; lv <= 99; lv++) {
    const needed = getExpNeeded(lv)
    if (remaining < needed) {
      return {
        level: lv,
        currentExp: remaining,
        expNeeded: needed,
        totalExp,
        progress: remaining / needed,
      }
    }
    remaining -= needed
  }
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp, progress: 1 }
}
