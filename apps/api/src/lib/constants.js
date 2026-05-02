/**
 * lib/constants.js — Re-export shim for @novame/core
 *
 * As of 1.4 stage migration, all constants and rule functions live in
 * the shared @novame/core package. This file is preserved as a thin
 * re-export layer so existing consumers (create-payment, book-payment,
 * generate-card, etc.) keep working without changing their import paths.
 *
 * New code should import directly from '@novame/core' instead.
 */

// Pricing
export {
  PRICING_TIERS,
  BOOK_UNLOCK_WORDS,
  CARDS_UNLOCK_COUNT,
  PRINTED_BOOK_PRICE,
  BOOK_MILESTONE_MINS,
} from '@novame/core'

// Character system (data + rules)
export {
  CHARACTERS,
  OUTFIT_UNLOCK_LEVELS,
  HUNGER_TIMEOUT_HOURS,
  SPEECH_BUBBLE_HUNGRY,
  SPEECH_BUBBLE_STUDY,
  SPEECH_BUBBLE_PLAY,
  SPEECH_BUBBLE_HUNGER_WARNING,
  getCharacterState,
  getUnlockedOutfits,
  getVideoUrl,
  canUnlockNewCharacter,
} from '@novame/core'

// Willpower / EXP constants and table
export {
  WP_MAX,
  WP_STUDY_DECAY_PER_HOUR,
  WP_PLAY_DECAY_PER_HOUR,
  WP_HUNGER_THRESHOLD,
  EXP_PER_10S_RECORDING,
  EXP_AFK_STUDY_FULL_HOURS,
  EXP_AFK_STUDY_HUNGRY_HOURS,
  EXP_AFK_PLAY_FULL_HOURS,
  EXP_AFK_PLAY_HUNGRY_HOURS,
  EXP_TABLE,
  getLevelFromExp,
} from '@novame/core'

// Recording limits
export {
  DAILY_RECORDING_LIMIT_SECONDS,
  MIN_RECORDING_SECONDS,
  MAX_SECONDS_PER_RECORD,
} from '@novame/core'

// Categories
export {
  CATEGORIES,
  WISDOM_DIMENSIONS,
} from '@novame/core'

// Time formatting
export {
  formatMinutes,
  formatSeconds,
} from '@novame/core'

// Keywords — `ALL_KEYWORDS` (legacy name) was a slug list, so we alias
// the core export to preserve the original API surface.
export { ALL_KEYWORD_SLUGS as ALL_KEYWORDS } from '@novame/core'
