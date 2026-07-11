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
  /** Keyed to a dimension; the theme IS that dimension's "struggle" framing. */
  dimension: DimensionId;
  /** The capsule label on the picker. */
  capsule: string;
}

export const LENS_THEMES: readonly LensTheme[] = [
  { dimension: 'expression', capsule: 'Holding it in' },
  { dimension: 'awareness',  capsule: 'Overthinking everything' },
  { dimension: 'momentum',   capsule: 'Stuck in place' },
  { dimension: 'direction',  capsule: 'Not sure what I want' },
  { dimension: 'steadiness', capsule: 'Everything feels shaky' },
  { dimension: 'confidence', capsule: 'Doubting myself' },
  { dimension: 'gratitude',  capsule: 'Nothing feels enough' },
  { dimension: 'connection', capsule: 'Feeling distant' },
];

/**
 * The guiding line for a reflect routed in from New Lens's "I see it
 * differently". Shown in place of the usual prompt list; the reflect is
 * credited to the theme's dimension via a preset, and tagged source_kit =
 * 'new_lens' so the origin is recoverable.
 */
export const NEW_LENS_PROMPT = "You saw that differently. Tell me how it actually feels to you.";
