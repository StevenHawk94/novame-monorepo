/**
 * New Lens themes (C5). Eight themes, one per growth dimension, shown on the
 * theme-picker as "what's on your mind lately" capsules. Themes are FIXED and
 * live here; only the card content behind them is dynamic (lens_cards table,
 * edited live). The dimension is load-bearing: the reflect the user is routed
 * into on "I see it differently" is credited to it.
 *
 * NEW_LENS_PROMPT is the guiding line shown when that routing happens -- a
 * hidden Reflect prompt in the sense that it never appears in the normal
 * prompt list; it only arrives with a preset from New Lens, carrying the
 * theme's dimension. Copy is first-draft and revised later.
 */
import type { DimensionId } from './dimensions';

export interface LensTheme {
  /**
   * Stable identifier used as lens_cards.theme / lens_progress.theme and in
   * the API. The original eight equal their dimension id (preserves the
   * per-user cursors seeded before v2); the 2026-08-06 additions get their
   * own keys and borrow the nearest dimension for reflect crediting.
   */
  key: string;
  /** The dimension a "I see it differently" reflect is credited to. */
  dimension: DimensionId;
  /** The capsule label on the picker. */
  capsule: string;
}

export const LENS_THEMES: readonly LensTheme[] = [
  { key: 'expression',    dimension: 'expression', capsule: 'Holding it in' },
  { key: 'awareness',     dimension: 'awareness',  capsule: 'Overthinking everything' },
  { key: 'momentum',      dimension: 'momentum',   capsule: 'Stuck in place' },
  { key: 'direction',     dimension: 'direction',  capsule: 'Not sure what I want' },
  { key: 'steadiness',    dimension: 'steadiness', capsule: 'Everything feels shaky' },
  { key: 'confidence',    dimension: 'confidence', capsule: 'Doubting myself' },
  { key: 'gratitude',     dimension: 'gratitude',  capsule: 'Nothing feels enough' },
  { key: 'connection',    dimension: 'connection', capsule: 'Feeling distant' },
  { key: 'comparison',    dimension: 'confidence', capsule: 'Comparing myself to others' },
  { key: 'fear_of_wrong', dimension: 'momentum',   capsule: 'Afraid to get it wrong' },
  { key: 'running_empty', dimension: 'steadiness', capsule: 'Running on empty' },
];

/** Valid theme keys, for API-side validation. */
export const LENS_THEME_KEYS: readonly string[] = LENS_THEMES.map((t) => t.key);

export const LENS_THEME_BY_KEY: Record<string, LensTheme> = Object.fromEntries(
  LENS_THEMES.map((t) => [t.key, t]),
);

/**
 * The guiding line for a reflect routed in from New Lens's "I see it
 * differently". Shown in place of the usual prompt list; the reflect is
 * credited to the theme's dimension via a preset, and tagged source_kit =
 * 'new_lens' so the origin is recoverable.
 */
export const NEW_LENS_PROMPT = "You saw that differently. Tell me how it actually feels to you.";
