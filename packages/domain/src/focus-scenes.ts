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
export interface FocusScene {
  id: string;
  title: string;
  subtitle: string;
  free: boolean;
}

export const FOCUS_SCENES: FocusScene[] = [
  { id: 'work', title: 'Before a meeting', subtitle: 'Steady yourself before you walk in', free: true },
  { id: 'focus', title: 'Before deep work', subtitle: 'Settle in and find your focus', free: true },
  { id: 'calm', title: 'A hard conversation', subtitle: 'Ground yourself before you speak', free: true },
  { id: 'reset', title: 'A midday reset', subtitle: 'Step out of the rush for a minute', free: false },
  { id: 'anxious', title: 'When anxiety rises', subtitle: 'Come back to your breath', free: false },
  { id: 'sleep', title: 'Winding down', subtitle: 'Let the day go', free: false },
  { id: 'morning', title: 'Starting the day', subtitle: 'Set your intention', free: false },
  { id: 'overwhelm', title: "When it's too much", subtitle: 'One thing at a time', free: false },
];

export const FOCUS_SCENE_BY_ID: Record<string, FocusScene> =
  Object.fromEntries(FOCUS_SCENES.map((s) => [s.id, s]));
