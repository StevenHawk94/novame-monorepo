/**
 * Focus scenes (C10). Six preparation scenes (v2.0 design: 'What are you preparing for?');
 * free users get the first three, paid all six. Locked ones stay visible
 * as a conversion point.
 *
 * Audio lives at focus/{sceneId}/{sceneId}{n}.mp3 on R2 (a manifest declares
 * each scene's track count). For the test phase, the first track of the free
 * scenes is bundled locally; the client falls back to the bundled asset when a
 * remote track isn't available yet. Tracks cycle by the user's next_index.
 *
 * scene copy is first-draft, to be tuned.
 */
import type { DimensionId } from './dimensions';

export interface FocusScene {
  id: string;
  title: string;
  subtitle: string;
  free: boolean;
  /** PRD §1.2: a completed Focus credits its scene's dimension +10. The 1:1
   *  mapping below is a first pass (2026-07, Q9) — product will retune; only
   *  'anxious' → steadiness is anchored by the PRD's Anxiety↔Steadiness row. */
  dimension: DimensionId;
}

export const FOCUS_SCENES: FocusScene[] = [
  { id: 'work', title: 'Work', subtitle: 'Do your best work with a clear mind.', free: true, dimension: 'momentum' },
  { id: 'learn', title: 'Learn', subtitle: 'Stay curious and absorb deeply.', free: true, dimension: 'awareness' },
  { id: 'connect', title: 'Connect', subtitle: 'Show up openly and connect with others.', free: true, dimension: 'connection' },
  { id: 'daily', title: 'Daily Tasks', subtitle: 'Get started and move forward.', free: false, dimension: 'direction' },
  { id: 'family', title: 'Family', subtitle: 'Be fully there for the people who matter.', free: false, dimension: 'gratitude' },
  { id: 'challenge', title: 'Challenge', subtitle: 'Stay calm and perform when it matters.', free: false, dimension: 'steadiness' },
];

export const FOCUS_SCENE_BY_ID: Record<string, FocusScene> =
  Object.fromEntries(FOCUS_SCENES.map((s) => [s.id, s]));
