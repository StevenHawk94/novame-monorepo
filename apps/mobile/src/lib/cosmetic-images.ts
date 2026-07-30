/**
 * Static image maps for Home scenes. React Native's require() must take a
 * literal path, so every asset is listed explicitly.
 *
 * Scenes: scene1 art is bundled (day + night). scenes 2-6 fall back to the
 * tinted placeholder from HOME_SCENES until their webp lands -- add the
 * require() pair here when it does.
 *
 * (The old per-skin SKIN_IMAGES map is gone — companion looks are outfits
 * now, catalogued in R2's video-manifest and rendered via outfits.ts.)
 */
import type { ImageSourcePropType } from 'react-native';

type DayNight = { day: ImageSourcePropType; night: ImageSourcePropType };

export const SCENE_IMAGES: Record<string, DayNight | undefined> = {
  scene1: {
    day: require('../../assets/scenes/scene1-day.webp'),
    night: require('../../assets/scenes/scene1-night.webp'),
  },
  // scene2..scene6: add { day: require(...), night: require(...) } when art lands.
};
