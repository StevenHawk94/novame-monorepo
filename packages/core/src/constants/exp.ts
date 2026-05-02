/**
 * @novame/core/constants/exp
 *
 * Willpower (WP) and EXP gain constants. The EXP_TABLE itself (the 99-row
 * lookup) lives in rules/exp.ts because it's computed; only raw constants
 * live here.
 */

// ============================================
// Willpower (WP)
// ============================================

export const WP_MAX = 100

/** Study-mode WP decay: 10 WP/hr → 0 in 10h. */
export const WP_STUDY_DECAY_PER_HOUR = 10

/** Play-mode WP decay: 5 WP/hr → 0 in 20h. */
export const WP_PLAY_DECAY_PER_HOUR = 5

/** Below this WP threshold, character enters "hungry" learning state (half EXP). */
export const WP_HUNGER_THRESHOLD = 40

// ============================================
// EXP gain rates
// ============================================

/** Active recording: +1 EXP per 10 seconds. */
export const EXP_PER_10S_RECORDING = 1

/** AFK study, WP 41-100: +10 EXP per 1h study. */
export const EXP_AFK_STUDY_FULL_HOURS = 0.1

/** AFK study, WP 1-40 (hungry): +10 EXP per 2h study. */
export const EXP_AFK_STUDY_HUNGRY_HOURS = 0.2

/** AFK play, WP 41-100: +10 EXP per 4h play. */
export const EXP_AFK_PLAY_FULL_HOURS = 0.4

/** AFK play, WP 1-40 (hungry): +10 EXP per 8h play. */
export const EXP_AFK_PLAY_HUNGRY_HOURS = 0.8
