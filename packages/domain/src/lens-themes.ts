/**
 * Fixed New Lens themes shown on the "what's on your mind lately" picker.
 * Card content lives in lens_cards and can be updated independently. Choosing
 * "I see it differently" opens an unclassified reflection; New Lens no longer
 * maps themes to growth dimensions.
 */

export interface LensTheme {
  /** Stable identifier used by lens_cards, lens_progress, and the API. */
  key: string;
  /** The capsule label on the picker. */
  capsule: string;
}

export const LENS_THEMES: readonly LensTheme[] = [
  { key: 'expression',    capsule: 'Holding it in' },
  { key: 'awareness',     capsule: 'Overthinking everything' },
  { key: 'momentum',      capsule: 'Stuck in place' },
  { key: 'direction',     capsule: 'Not sure what I want' },
  { key: 'steadiness',    capsule: 'Everything feels shaky' },
  { key: 'confidence',    capsule: 'Doubting myself' },
  { key: 'gratitude',     capsule: 'Nothing feels enough' },
  { key: 'connection',    capsule: 'Feeling distant' },
  { key: 'comparison',    capsule: 'Comparing myself to others' },
  { key: 'fear_of_wrong', capsule: 'Afraid to get it wrong' },
  { key: 'running_empty', capsule: 'Running on empty' },
];

/** Valid theme keys, for API-side validation. */
export const LENS_THEME_KEYS: readonly string[] = LENS_THEMES.map((t) => t.key);

export const LENS_THEME_BY_KEY: Record<string, LensTheme> = Object.fromEntries(
  LENS_THEMES.map((t) => [t.key, t]),
);

/**
 * Guiding line for a reflection opened from "I see it differently". It is
 * intentionally unclassified and tagged source_kit = 'new_lens' only so the
 * origin remains recoverable.
 */
export const NEW_LENS_PROMPT = "You saw that differently. Tell me how it actually feels to you.";
