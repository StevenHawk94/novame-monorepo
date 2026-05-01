/**
 * App Constants — Character Level System
 * 
 * - 1 character (char-1) with 6 skins unlocked at different levels
 * - 6 outfits × 3 states = 18 videos
 * - States: hungry (WP=0), study (WP>0 + study mode), chill (WP>0 + chill mode)
 * - 99 levels with EXP progression table
 * - WP decays over time, mode-dependent
 */

// ============================================
// Characters
// ============================================

export const CHARACTERS = [
  { id: 'char-1', name: 'Character 1', image: '/characters/char-1.webp', unlockLevel: 0 },
]

// Outfit unlock levels (6 outfits per character)
export const OUTFIT_UNLOCK_LEVELS = [1, 5, 10, 20, 30, 50]

/**
 * Video naming convention:
 * /characters/char1-outfit{N}-{state}.mp4
 * 
 * States: hungry, study, chill
 * Outfits: 1-6
 * 
 * Example:
 *   char1-outfit1-hungry.mp4
 *   char1-outfit1-study.mp4
 *   char1-outfit1-chill.mp4
 *   char1-outfit2-hungry.mp4  (unlocks at Lv.5)
 *   ...
 *   char1-outfit6-chill.mp4   (unlocks at Lv.50)
 */
export function getVideoUrl(characterId, outfitNum, state) {
  const charNum = characterId.replace('char-', '')
  return `/characters/char${charNum}-outfit${outfitNum}-${state}.mp4`
}

/**
 * Get current video state based on WP and mode
 * WP=0 → 'hungry' (regardless of mode)
 * WP>0 + study mode → 'study'
 * WP>0 + play/chill mode → 'chill'
 */
export function getCharacterState(wp, mode) {
  if (wp <= 0) return 'hungry'
  return mode === 'study' ? 'study' : 'chill'
}

// ============================================
// EXP Level Table — Lv.1 to Lv.99
// ============================================

// Per-level EXP requirements
function buildExpTable() {
  const table = [] // table[i] = { level: i+1, expNeeded: X, cumulativeExp: Y }
  let cumulative = 0

  for (let lv = 1; lv <= 99; lv++) {
    let expNeeded
    if (lv <= 5) {
      // Lv.1-5: 20~40, step=5, tier sum=150
      expNeeded = 20 + (lv - 1) * 5
    } else if (lv <= 15) {
      // Lv.6-15: 50~90, step≈4.44, tier sum=700, cum=850
      expNeeded = Math.round(50 + (lv - 6) * 4.44)
    } else if (lv <= 25) {
      // Lv.16-25: 120~200, step≈8.89, tier sum=1600, cum=2450
      expNeeded = Math.round(120 + (lv - 16) * 8.89)
    } else if (lv <= 40) {
      // Lv.26-40: 220~400, step≈12.86, tier sum=4650, cum=7100
      expNeeded = Math.round(220 + (lv - 26) * 12.86)
    } else if (lv <= 50) {
      // Lv.41-50: 420~540, step≈13.33
      expNeeded = Math.round(420 + (lv - 41) * 13.33)
    } else if (lv <= 90) {
      // Lv.51-90: fixed 800
      expNeeded = 800
    } else {
      // Lv.91-99: fixed 1000
      expNeeded = 1000
    }

    cumulative += expNeeded
    table.push({ level: lv, expNeeded, cumulativeExp: cumulative })
  }
  return table
}

export const EXP_TABLE = buildExpTable()

/** Get level info for a given total EXP */
export function getLevelFromExp(totalExp) {
  let level = 1
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
    level = row.level + 1
  }
  // Max level 99
  return { level: 99, currentExp: 0, expNeeded: 0, totalExp, progress: 1 }
}

/** Get unlocked outfits for a given level */
export function getUnlockedOutfits(level) {
  return OUTFIT_UNLOCK_LEVELS.filter(lv => level >= lv).map((_, i) => i + 1)
}

/** Check if a character can be unlocked — currently only 1 character, no unlock */
export function canUnlockNewCharacter(characterDataList) {
  return false
}

// ============================================
// WP (Willpower) Constants
// ============================================

export const WP_MAX = 100
export const WP_STUDY_DECAY_PER_HOUR = 10 // study: 10 WP/hr → 0 in 10h
export const WP_PLAY_DECAY_PER_HOUR = 5   // play: 5 WP/hr → 0 in 20h
export const WP_HUNGER_THRESHOLD = 40     // below this = hunger state (half EXP)

// ============================================
// EXP Gain Constants
// ============================================

export const EXP_PER_10S_RECORDING = 1     // +1 EXP per 10s of recording
export const EXP_AFK_STUDY_FULL_HOURS = 0.1   // WP 41-100: +10 EXP per 1h study (was +1)
export const EXP_AFK_STUDY_HUNGRY_HOURS = 0.2  // WP 1-40: +10 EXP per 2h study (was +1)
export const EXP_AFK_PLAY_FULL_HOURS = 0.4     // WP 41-100: +10 EXP per 4h play (was +1)
export const EXP_AFK_PLAY_HUNGRY_HOURS = 0.8   // WP 1-40: +10 EXP per 8h play (was +1)

// ============================================
// Recording Limits
// ============================================

export const DAILY_RECORDING_LIMIT_SECONDS = 600
export const MIN_RECORDING_SECONDS = 20
export const MAX_SECONDS_PER_RECORD = 600

// ============================================
// Pricing
// ============================================

export const PRICING_TIERS = {
  free: { name: 'Free', monthlyPrice: 0, yearlyPrice: 0, monthlyAnalyses: 1, maxSecondsPerRecord: 300, dailyRecordSeconds: 300, dailyTypeChars: 2000, features: ['1 wisdom insight / month', 'Basic character'] },
  basic: { name: 'Basic', monthlyPrice: 4.99, yearlyPrice: 39.99, monthlyAnalyses: 15, maxSecondsPerRecord: 300, dailyRecordSeconds: 300, dailyTypeChars: 3000, features: ['15 insights / month', '5 min recording / day', '3000 chars / day'] },
  pro: { name: 'Pro', monthlyPrice: 9.99, yearlyPrice: 79.99, monthlyAnalyses: 30, maxSecondsPerRecord: 600, dailyRecordSeconds: 600, dailyTypeChars: 5000, features: ['30 insights / month', '10 min recording / day', '5000 chars / day'] },
  ultra: { name: 'Ultra', monthlyPrice: 16.99, yearlyPrice: 129.99, monthlyAnalyses: 60, maxSecondsPerRecord: 600, dailyRecordSeconds: 600, dailyTypeChars: 5000, features: ['60 insights / month', '10 min recording / day', '5000 chars / day'] },
}

// Wisdom Book: unlock at 20000 words total
export const BOOK_UNLOCK_WORDS = 20000
// Wisdom Cards: unlock when 48 unique keywords collected
export const CARDS_UNLOCK_COUNT = 48

// ============================================
// Categories
// ============================================

export const CATEGORIES = [
  'Self-Love','Romance','Love','Inspirational','Happiness','Parenting',
  'Friendship','Career','Productivity','Communication','Emotional Intelligence',
  'Resilience','Creativity','Change','Life',
]

// ============================================
// Speech Bubble Templates (WP=0 / hungry state)
// ============================================

export const SPEECH_BUBBLE_HUNGRY = [
  "I need some inspiration, what you have in mind now?",
  "Energy low! One reflection from you is the best way to get my gears turning again.",
  "I'm collecting shiny little thoughts! Did you find any good ones today?",
  "I'm feeling a bit dim now. Do you have a spare spark of wisdom I can borrow?",
  "My brain is officially mush. Just tell me one thing you saw or felt today.",
  "My inner light is flickering... could you brighten me up with a story from your day?",
  "I'm hungry for a breakthrough! Do you have any 'Aha!' moments on the menu today?",
  "My poor brain is a bit lonely. Mind sharing a private thought to keep it company?",
  "I feel like I'm losing my way. Can you guide me with a perspective only you have?",
  "Everything feels a bit 'blah' right now. I bet your day had a hidden gem that could fix that.",
  "My little tummy is rumbling for some deep thoughts!",
  "I'm feeling a bit small. Remind me how big the world is through your eyes?",
  "My wisdom-levels are low, feed me the smartest thing you thought of today!",
  "I'm craving something sweet... like a fresh new perspective!",
  "I'm on a strict diet of pure inspiration. Feed me today's brightest thought!",
]

export const SPEECH_BUBBLE_STUDY = [
  "I'm absorbing every spark you share.",
  "I'm focusing deeply on your truth.",
  "I'm locking in your hidden insights.",
  "I'm evolving with your today's share.",
  "I'm transforming your thoughts into light.",
  "I'm feeling the power of your words.",
  "I'm syncing my energy with yours.",
  "I'm capturing the essence of your day.",
  "I'm resonating with your inner voice.",
  "I'm feeling the pulse of your soul.",
  "I'm aligning my spirit with yours.",
  "I'm flowing through your shared moments.",
]

export const SPEECH_BUBBLE_PLAY = [
  "Just chilling and growing at my own pace~",
  "Life is good! But I wouldn't mind some wisdom snacks.",
  "Relaxing is important too! Share a thought when you're ready.",
  "Taking it easy today. Got any casual wisdom?",
]

export const SPEECH_BUBBLE_HUNGER_WARNING = [
  "I'm getting tired... my learning efficiency is dropping.",
  "Running low on energy... I can't focus as well anymore.",
  "My willpower is fading... record some wisdom to recharge me!",
]

// ============================================
// Hunger State Timing (legacy compat)
// ============================================

export const HUNGER_TIMEOUT_HOURS = 12

// ============================================
// Wisdom Book
// ============================================

export const BOOK_MILESTONE_MINS = 300
export const PRINTED_BOOK_PRICE = 99.99

// ============================================
// Weekly Insight Dimensions (8)
// ============================================

export const WISDOM_DIMENSIONS = [
  'Reflection','Resilience','Empathy','Vision',
  'Courage','Acceptance','Authenticity','Humility',
]

// ============================================
// Time Formatting
// ============================================

export function formatMinutes(totalMins) {
  if (totalMins >= 60) {
    const h = Math.floor(totalMins / 60)
    const m = Math.round(totalMins % 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const m = Math.floor(totalMins)
  const s = Math.round((totalMins - m) * 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function formatSeconds(totalSecs) {
  return formatMinutes(totalSecs / 60)
}

// All 48 wisdom keywords
export const ALL_KEYWORDS = [
  'Clarity','Grounding','Focus','Curiosity','Stillness','Objectivity','Adaptability','Unlearning','Vision','Acceptance','Humor','Intuition',
  'Resilience','Boundaries','Self-Compassion','Courage','Vulnerability','Empathy','Gratitude','Patience','Forgiveness','Release','Balance','Joy',
  'Initiative','Consistency','Discipline','Decisiveness','Purpose','Rest','Resourcefulness','Accountability','Boldness','Endurance','Communication','Momentum',
  'Sovereignty','Authenticity','Inspiration','Generosity','Trust','Reciprocity','Collaboration','Leadership','Harmony','Legacy','Respect','Loyalty',
]
