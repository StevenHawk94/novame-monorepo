/**
 * The nine Reflect prompts. Eight map one-to-one onto the growth dimensions
 * (decision D3d); the ninth is free-form with no dimension.
 *
 * A prompt is a nudge to help someone find what to write -- not a dimension
 * test. The mapping is a backstage mechanic: choosing prompt 1 credits the
 * expression dimension, but the user just sees a line that matches how their
 * day felt. This is the single source of truth for prompt_id -> dimension, read
 * by the Reflect screen (to render the choices) and by /api/reflect (to credit
 * the prompt dimension before any AI analysis).
 *
 * Per D3b the dimensions are topics, not emotional polarity: the "steadiness"
 * prompt is about handling a wobble, not about feeling good or bad. The system
 * only adds gems, never judges.
 */
import type { DimensionId } from './dimensions';

export interface ReflectPrompt {
  /** 1..9, stable; stored on reflects.prompt_id. */
  id: number;
  text: string;
  /** null for the free-form prompt (id 9), which credits no dimension. */
  dimension: DimensionId | null;
}

export const REFLECT_PROMPTS: readonly ReflectPrompt[] = [
  { id: 1, dimension: 'expression', text: "I said something today I'd usually keep to myself." },
  { id: 2, dimension: 'awareness',  text: "Something I did today surprised me — and I'm still figuring out why." },
  { id: 3, dimension: 'momentum',   text: "I finally started something I'd been putting off." },
  { id: 4, dimension: 'direction',  text: "I got a little clearer on what I actually want." },
  { id: 5, dimension: 'steadiness', text: "Something threw me off today, and here's how I handled it." },
  { id: 6, dimension: 'confidence', text: "I trusted myself on something, even when I wasn't sure." },
  { id: 7, dimension: 'gratitude',  text: "A small moment today was better than I expected." },
  { id: 8, dimension: 'connection', text: "Someone was on my mind today." },
  { id: 9, dimension: null,         text: "Whatever's here right now — just write it." },
];

/** The prompt dimension for a given prompt_id, or null (free-form / bad id). */
export function promptDimension(promptId: number): DimensionId | null {
  return REFLECT_PROMPTS.find((p) => p.id === promptId)?.dimension ?? null;
}
