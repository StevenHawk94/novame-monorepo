/**
 * @novame/core/rules/character
 *
 * Pure functions over character state — no I/O, no DOM, no server deps.
 *
 * Behavior preserved 1:1 from apps/api/src/lib/constants.js.
 *
 * NOTE on getVideoUrl:
 *   The original returns a relative path '/characters/charN-outfitX-state.mp4'.
 *   For mobile (which can't resolve relative paths against an implicit web
 *   origin), Step 4 (this step) keeps the same signature for now. If the
 *   admin/api consumers turn out to need the full URL pre-baked, we can
 *   later add a `baseUrl` parameter or a separate `getVideoPath` helper.
 *   See conversation Decision 3 / Step 4 caveat.
 */

import { OUTFIT_UNLOCK_LEVELS, type CharacterId, type CharacterMode, type CharacterState } from '../constants/character'

/**
 * Build the video URL/path for a given character + outfit + state.
 *
 *   getVideoUrl('char-1', 1, 'hungry')
 *     -> '/characters/char1-outfit1-hungry.mp4'
 */
export function getVideoUrl(
  characterId: CharacterId,
  outfitNum: number,
  state: CharacterState
): string {
  const charNum = characterId.replace('char-', '')
  return `/characters/char${charNum}-outfit${outfitNum}-${state}.mp4`
}

/**
 * Derive the visible character state from current willpower + mode.
 *
 *   wp <= 0           -> 'hungry' (regardless of mode)
 *   wp > 0 + study    -> 'study'
 *   wp > 0 + anything -> 'chill'
 */
export function getCharacterState(wp: number, mode: CharacterMode): CharacterState {
  if (wp <= 0) return 'hungry'
  return mode === 'study' ? 'study' : 'chill'
}

/**
 * Given a level, return the outfit numbers (1..6) currently unlocked.
 *
 *   getUnlockedOutfits(7)  -> [1, 2]      (Lv.1 + Lv.5 unlocks)
 *   getUnlockedOutfits(50) -> [1,2,3,4,5,6]
 */
export function getUnlockedOutfits(level: number): number[] {
  const result: number[] = []
  for (let i = 0; i < OUTFIT_UNLOCK_LEVELS.length; i++) {
    if (level >= OUTFIT_UNLOCK_LEVELS[i]) {
      result.push(i + 1)
    }
  }
  return result
}

/**
 * Currently always false — only one character exists. Kept for API parity
 * so consuming code doesn't need to change when more characters are added.
 */
export function canUnlockNewCharacter(_characterDataList: unknown): boolean {
  return false
}
