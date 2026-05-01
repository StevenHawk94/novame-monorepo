/**
 * Character Engine — WP & EXP calculation utilities
 * 
 * All calculations are pure functions (no state mutation).
 * Called by appStore and APIs to compute current values.
 */

import {
  WP_MAX, WP_STUDY_DECAY_PER_HOUR, WP_PLAY_DECAY_PER_HOUR, WP_HUNGER_THRESHOLD,
  EXP_PER_10S_RECORDING,
  EXP_AFK_STUDY_FULL_HOURS, EXP_AFK_STUDY_HUNGRY_HOURS,
  EXP_AFK_PLAY_FULL_HOURS, EXP_AFK_PLAY_HUNGRY_HOURS,
  getLevelFromExp,
} from './constants'

/**
 * Calculate current WP based on last update time, mode, and elapsed time
 * @param {number} wpAtLastUpdate - WP value when last updated (0-100)
 * @param {string} mode - 'study' | 'play'
 * @param {number} elapsedMs - milliseconds since last WP update
 * @returns {number} current WP (0-100, integer)
 */
export function calculateCurrentWP(wpAtLastUpdate, mode, elapsedMs) {
  if (wpAtLastUpdate <= 0) return 0
  const hours = elapsedMs / (1000 * 60 * 60)
  const decayRate = mode === 'study' ? WP_STUDY_DECAY_PER_HOUR : WP_PLAY_DECAY_PER_HOUR
  const currentWP = Math.max(0, Math.round(wpAtLastUpdate - hours * decayRate))
  return currentWP
}

/**
 * Calculate AFK EXP earned during a time period in a specific mode
 * Uses accumulated seconds approach — fractional hours carry over
 * 
 * @param {string} mode - 'study' | 'play'
 * @param {number} wp - current WP at start of period
 * @param {number} accumulatedSeconds - previously accumulated seconds in this mode
 * @param {number} newSeconds - new seconds to add
 * @returns {{ expGained: number, remainingSeconds: number }}
 */
export function calculateAFKExp(mode, wp, accumulatedSeconds, newSeconds) {
  if (wp <= 0) return { expGained: 0, remainingSeconds: accumulatedSeconds + newSeconds }
  
  const totalSeconds = accumulatedSeconds + newSeconds
  const isHungry = wp <= WP_HUNGER_THRESHOLD
  
  let hoursPerExp
  if (mode === 'study') {
    hoursPerExp = isHungry ? EXP_AFK_STUDY_HUNGRY_HOURS : EXP_AFK_STUDY_FULL_HOURS
  } else {
    hoursPerExp = isHungry ? EXP_AFK_PLAY_HUNGRY_HOURS : EXP_AFK_PLAY_FULL_HOURS
  }
  
  const secondsPerExp = hoursPerExp * 3600
  const expGained = Math.floor(totalSeconds / secondsPerExp)
  const remainingSeconds = totalSeconds % secondsPerExp
  
  return { expGained, remainingSeconds }
}

/**
 * Calculate EXP from recording duration
 * @param {number} durationSeconds - recording duration
 * @returns {number} EXP gained
 */
export function calculateRecordingExp(durationSeconds) {
  return Math.floor(durationSeconds / 10) * EXP_PER_10S_RECORDING
}

/**
 * Process a full WP/EXP update tick
 * Called periodically (every minute) to update state
 * 
 * @param {Object} state - current character state from DB/store
 * @returns {Object} updated values to write back
 */
export function processCharacterTick(state) {
  const {
    wp, wpLastUpdated, mode, modeChangedAt,
    afkStudySeconds, afkPlaySeconds,
    totalExp,
  } = state
  
  const now = Date.now()
  const elapsedMs = now - new Date(wpLastUpdated).getTime()
  
  // Calculate current WP
  const currentWP = calculateCurrentWP(wp, mode, elapsedMs)
  
  // Calculate AFK EXP since last update
  const elapsedSeconds = Math.floor(elapsedMs / 1000)
  const currentAfkField = mode === 'study' ? 'afkStudySeconds' : 'afkPlaySeconds'
  const currentAfkAccum = mode === 'study' ? afkStudySeconds : afkPlaySeconds
  
  let afkResult = { expGained: 0, remainingSeconds: currentAfkAccum }
  
  if (wp > 0) { // Only earn AFK EXP if WP was > 0
    afkResult = calculateAFKExp(mode, currentWP, currentAfkAccum, elapsedSeconds)
  }
  
  // Apply EXP and level up
  const newTotalExp = totalExp + afkResult.expGained
  const levelInfo = getLevelFromExp(newTotalExp)
  
  return {
    wp: currentWP,
    wpLastUpdated: new Date(now).toISOString(),
    afkStudySeconds: mode === 'study' ? afkResult.remainingSeconds : afkStudySeconds,
    afkPlaySeconds: mode === 'play' ? afkResult.remainingSeconds : afkPlaySeconds,
    totalExp: newTotalExp,
    level: levelInfo.level,
    expGained: afkResult.expGained,
  }
}

/**
 * Process recording completion — restore WP + add recording EXP
 * @param {number} durationSeconds - recording duration
 * @param {number} currentTotalExp - current total EXP
 * @returns {{ wp: number, expGained: number, newTotalExp: number, levelInfo: Object }}
 */
export function processRecording(durationSeconds, currentTotalExp) {
  const expGained = calculateRecordingExp(durationSeconds)
  const newTotalExp = currentTotalExp + expGained
  const levelInfo = getLevelFromExp(newTotalExp)
  
  return {
    wp: WP_MAX, // Recording restores WP to 100
    expGained,
    newTotalExp,
    levelInfo,
  }
}
