/**
 * Home scenes (C). Six backdrop scenes for the Home companion view. Free users
 * get the first two; the rest are a Plus perk. Each scene is a day/night pair --
 * the client picks the day or night image by the local hour (12h each), so
 * switching a scene swaps both at once.
 *
 * Images live at assets/scenes/scene{n}-{day|night}.webp for the test phase
 * (later R2). Until the art lands, the client falls back to a tinted backdrop
 * per scene (dayBg/nightBg below), so the selection + switching logic is real
 * even without the final images.
 *
 * scene copy + placeholder colors are first-draft, to be tuned.
 */
export interface HomeScene {
  id: string;         // 'scene1'..'scene6'
  title: string;
  free: boolean;
  // Placeholder tints until the webp art lands (day / night / ground).
  dayBg: string;
  nightBg: string;
  dayGround: string;
  nightGround: string;
}

export const HOME_SCENES: HomeScene[] = [
  { id: 'scene1', title: 'Meadow',   free: true,  dayBg: '#BFE3F5', nightBg: '#241C4A', dayGround: '#A8D89A', nightGround: '#2A2450' },
  { id: 'scene2', title: 'Shore',    free: true,  dayBg: '#CDEAF0', nightBg: '#1B2440', dayGround: '#E4D5A8', nightGround: '#232A47' },
  { id: 'scene3', title: 'Forest',   free: false, dayBg: '#B4DDC0', nightBg: '#152A24', dayGround: '#8Fc49A', nightGround: '#1C3329' },
  { id: 'scene4', title: 'Desert',   free: false, dayBg: '#F5DEB8', nightBg: '#3A2A38', dayGround: '#E8C48F', nightGround: '#3E3040' },
  { id: 'scene5', title: 'Mountain', free: false, dayBg: '#D6E4F0', nightBg: '#1E2438', dayGround: '#B8C4D0', nightGround: '#262C42' },
  { id: 'scene6', title: 'Aurora',   free: false, dayBg: '#C8E8E0', nightBg: '#101A30', dayGround: '#98C0B8', nightGround: '#182440' },
];

export const HOME_SCENE_BY_ID: Record<string, HomeScene> =
  Object.fromEntries(HOME_SCENES.map((s) => [s.id, s]));

export const DEFAULT_SCENE_ID = 'scene1';
