/**
 * Focus scenes (C10). Eight mindfulness scenes; free users get the first three,
 * paid all eight. The locked five stay visible as a conversion point.
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
  { id: 'work', title: 'Before a meeting', subtitle: 'Steady yourself before you walk in', free: true, dimension: 'confidence' },
  { id: 'focus', title: 'Before deep work', subtitle: 'Settle in and find your focus', free: true, dimension: 'momentum' },
  { id: 'calm', title: 'A hard conversation', subtitle: 'Ground yourself before you speak', free: true, dimension: 'connection' },
  { id: 'reset', title: 'A midday reset', subtitle: 'Step out of the rush for a minute', free: false, dimension: 'awareness' },
  { id: 'anxious', title: 'When anxiety rises', subtitle: 'Come back to your breath', free: false, dimension: 'steadiness' },
  { id: 'sleep', title: 'Winding down', subtitle: 'Let the day go', free: false, dimension: 'gratitude' },
  { id: 'morning', title: 'Starting the day', subtitle: 'Set your intention', free: false, dimension: 'direction' },
  { id: 'overwhelm', title: "When it's too much", subtitle: 'One thing at a time', free: false, dimension: 'expression' },
];

export const FOCUS_SCENE_BY_ID: Record<string, FocusScene> =
  Object.fromEntries(FOCUS_SCENES.map((s) => [s.id, s]));
