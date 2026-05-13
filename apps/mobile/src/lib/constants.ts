/**
 * Mobile shared constants (stage 3.6).
 *
 * Lifted from old Capacitor src/lib/constants.js (276 lines), but only
 * the subset that the new mobile app actually consumes. Wisdom Book,
 * pricing tiers, and other unrelated constants stay in the old project
 * until their respective sub-steps trigger migration.
 *
 * Sections in this file:
 *   - Character outfit unlock levels
 *   - WP (willpower) decay constants
 *   - Speech bubble messages keyed on character state
 *   - Helper functions: getCharacterState, getUnlockedOutfits
 *
 * Note: EXP level functions (getExpNeeded, getLevelFromExp, LevelInfo)
 * live in @novame/core/rules/exp — single source of truth shared with
 * server. Mobile previously had a local mirror here; removed once the
 * shared package's exports proved sufficient.
 *
 * The old constants.js getVideoUrl helper is NOT migrated. The new
 * mobile app reads cached video files directly via
 * asset-cache.getCachedAssetUri(filename) and the filename pattern
 * matches the R2 manifest entry (char1-outfit{N}-{state}.mp4).
 */

// ---- Outfit unlock thresholds ----

/**
 * Character outfit unlock thresholds (level required to unlock each outfit).
 * Index 0 corresponds to outfit 1, index 1 to outfit 2, etc.
 */
export const OUTFIT_UNLOCK_LEVELS = [1, 5, 10, 20, 30, 50] as const;

// ---- WP (Willpower) ----

/** Maximum willpower value. */
export const WP_MAX = 100;

/** WP decay per hour while in study mode. Reaches 0 in 10 hours. */
export const WP_STUDY_DECAY_PER_HOUR = 10;

/** WP decay per hour while in play / chill mode. Reaches 0 in 20 hours. */
export const WP_PLAY_DECAY_PER_HOUR = 5;

/**
 * WP threshold below which the character enters the hunger warning state.
 * Below this value the character earns half EXP for new wisdoms.
 */
export const WP_HUNGER_THRESHOLD = 40;

// ---- Character video state ----

export type CharacterMode = 'play' | 'study';
export type CharacterState = 'chill' | 'hungry' | 'study';

/**
 * Maps WP + mode to the video state shown by VideoCharacter.
 *
 * WP <= 0 => 'hungry' (regardless of mode)
 * WP > 0 + mode 'study' => 'study'
 * WP > 0 + mode 'play' => 'chill'
 */
export function getCharacterState(wp: number, mode: CharacterMode): CharacterState {
  if (wp <= 0) return 'hungry';
  return mode === 'study' ? 'study' : 'chill';
}

/**
 * Returns the list of outfit numbers unlocked at a given level.
 *
 * Example: getUnlockedOutfits(8) => [1, 2] (outfit 1 at level 1, outfit 2 at level 5).
 */
export function getUnlockedOutfits(level: number): number[] {
  return OUTFIT_UNLOCK_LEVELS.filter((lv, i) => level >= lv).map((_, i) => i + 1);
}

// ---- Speech bubble messages ----

export const SPEECH_BUBBLE_HUNGRY = [
  'I need some inspiration, what you have in mind now?',
  'Energy low! One reflection from you is the best way to get my gears turning again.',
  "I'm collecting shiny little thoughts! Did you find any good ones today?",
  "I'm feeling a bit dim now. Do you have a spare spark of wisdom I can borrow?",
  'My brain is officially mush. Just tell me one thing you saw or felt today.',
  "My inner light is flickering... could you brighten me up with a story from your day?",
  "I'm hungry for a breakthrough! Do you have any 'Aha!' moments on the menu today?",
  'My poor brain is a bit lonely. Mind sharing a private thought to keep it company?',
  "I feel like I'm losing my way. Can you guide me with a perspective only you have?",
  "Everything feels a bit 'blah' right now. I bet your day had a hidden gem that could fix that.",
  'My little tummy is rumbling for some deep thoughts!',
  "I'm feeling a bit small. Remind me how big the world is through your eyes?",
  'My wisdom-levels are low, feed me the smartest thing you thought of today!',
  "I'm craving something sweet... like a fresh new perspective!",
  "I'm on a strict diet of pure inspiration. Feed me today's brightest thought!",
] as const;

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
] as const;

export const SPEECH_BUBBLE_PLAY = [
  'Just chilling and growing at my own pace~',
  "Life is good! But I wouldn't mind some wisdom snacks.",
  "Relaxing is important too! Share a thought when you're ready.",
  'Taking it easy today. Got any casual wisdom?',
  "No rush, no pressure. I'm just here, enjoying the vibe.",
  'Letting my thoughts drift... care to drop a little spark of insight?',
  "A little break today for a big leap tomorrow. What's on your mind?",
  "Enjoying the art of doing nothing. It's surprisingly productive!",
] as const;

export const SPEECH_BUBBLE_HUNGER_WARNING = [
  "I'm getting tired... my learning efficiency is dropping.",
  "Running low on energy... I can't focus as well anymore.",
  'My willpower is fading... record some wisdom to recharge me!',
  "Battery critical! I need some 'human energy.' What's on your mind right now?",
  'My energy is fading. Share a thought with me? I need the spark to keep going.',
  'Feeling a bit weak... Even a tiny slice of your day would give me a huge boost!',
  'Focusing is getting harder. A quick insight would really boost my stats.',
  'Energy critical! Even a tiny reflection would help me reboot.',
] as const;

/**
 * Picks a speech bubble line keyed on WP + mode + new-user flag.
 *
 * Mirrors the old HomeView updateBubble logic exactly:
 *   - new user without any wisdoms (charName set, wisdoms.length === 0):
 *     "Share your first story to power up {charName}!"
 *   - WP <= 0: random from HUNGRY
 *   - WP <= HUNGER_THRESHOLD: random from HUNGER_WARNING
 *   - mode === 'study': random from STUDY
 *   - else: random from PLAY
 *
 * Caller is responsible for the lastPublishMessage override (a fresh
 * AI-generated post-publish message takes precedence over any of these).
 */
export function pickSpeechBubble(
  wp: number,
  mode: CharacterMode,
  hasNoWisdoms: boolean,
  charName: string,
): string {
  if (hasNoWisdoms && charName) {
    return `Share your first story to power up ${charName}!`;
  }
  if (wp <= 0) return randomFrom(SPEECH_BUBBLE_HUNGRY);
  if (wp <= WP_HUNGER_THRESHOLD) return randomFrom(SPEECH_BUBBLE_HUNGER_WARNING);
  if (mode === 'study') return randomFrom(SPEECH_BUBBLE_STUDY);
  return randomFrom(SPEECH_BUBBLE_PLAY);
}

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
