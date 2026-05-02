/**
 * @novame/core/constants/character
 *
 * Character roster, outfit unlock schedule, and speech bubble templates
 * keyed by character state (hungry / study / play).
 */

export type CharacterId = 'char-1'

export type CharacterState = 'hungry' | 'study' | 'chill'

export type CharacterMode = 'study' | 'play' | 'chill'

export type CharacterDef = {
  id: CharacterId
  name: string
  image: string
  unlockLevel: number
}

export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'char-1', name: 'Character 1', image: '/characters/char-1.webp', unlockLevel: 0 },
]

/** Levels at which the 6 outfits per character unlock. */
export const OUTFIT_UNLOCK_LEVELS: readonly number[] = [1, 5, 10, 20, 30, 50]

/** Legacy hunger-state timeout (kept for backward compat with existing api routes). */
export const HUNGER_TIMEOUT_HOURS = 12

// ============================================
// Speech bubble templates
// ============================================

export const SPEECH_BUBBLE_HUNGRY: readonly string[] = [
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

export const SPEECH_BUBBLE_STUDY: readonly string[] = [
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

export const SPEECH_BUBBLE_PLAY: readonly string[] = [
  "Just chilling and growing at my own pace~",
  "Life is good! But I wouldn't mind some wisdom snacks.",
  "Relaxing is important too! Share a thought when you're ready.",
  "Taking it easy today. Got any casual wisdom?",
]

export const SPEECH_BUBBLE_HUNGER_WARNING: readonly string[] = [
  "I'm getting tired... my learning efficiency is dropping.",
  "Running low on energy... I can't focus as well anymore.",
  "My willpower is fading... record some wisdom to recharge me!",
]
