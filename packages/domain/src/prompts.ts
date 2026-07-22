/**
 * The nine Reflect prompts (v2.0 copy, 2026-07 design pass). Eight map
 * one-to-one onto the growth dimensions (decision D3d); the ninth — Open
 * Reflection — is free-form with no dimension.
 *
 * A prompt is a nudge to help someone find what to write -- not a dimension
 * test. The mapping is a backstage mechanic: choosing "Journalling" credits
 * momentum (the Log motif), but the user just sees a title and a line that
 * matches how their day felt. This is the single source of truth for
 * prompt_id -> dimension, read by the Reflect screen (to render the choices)
 * and by /api/reflect (to credit the prompt dimension before any AI
 * analysis).
 *
 * `title` is the picker's bold label; `text` is the one-line description
 * under it AND the header shown while writing. Ids are stable and persisted
 * on reflects.prompt_id — reorder copy, never renumber.
 */
import type { DimensionId } from './dimensions';

export interface ReflectPrompt {
  /** 1..9, stable; stored on reflects.prompt_id. */
  id: number;
  /** Picker card label ("Journalling"). */
  title: string;
  /** One-line description; also the writing screen's header. */
  text: string;
  /** null for the free-form prompt (id 9), which credits no dimension. */
  dimension: DimensionId | null;
}

export const REFLECT_PROMPTS: readonly ReflectPrompt[] = [
  { id: 1, dimension: 'momentum',   title: 'Journalling',     text: 'Capture what happened in your day.' },
  { id: 2, dimension: 'connection', title: 'Someone',         text: 'A moment I shared with someone.' },
  { id: 3, dimension: 'expression', title: 'Feeling',         text: 'A feeling I noticed today.' },
  { id: 4, dimension: 'awareness',  title: 'Learning',        text: 'Something today taught me about myself.' },
  { id: 5, dimension: 'confidence', title: 'Proud',           text: 'Something I want to give myself credit for.' },
  { id: 6, dimension: 'direction',  title: 'Realization',     text: 'Something I see differently now.' },
  { id: 7, dimension: 'steadiness', title: 'Challenge',       text: 'Something that challenged me today.' },
  { id: 8, dimension: 'gratitude',  title: 'Appreciation',    text: 'A small moment worth appreciating.' },
  { id: 9, dimension: null,         title: 'Open Reflection', text: "Write whatever's here right now." },
];

/** The prompt dimension for a given prompt_id, or null (free-form / bad id). */
export function promptDimension(promptId: number): DimensionId | null {
  return REFLECT_PROMPTS.find((p) => p.id === promptId)?.dimension ?? null;
}
