/**
 * Static image maps for Home scenes and companion skins. React Native's
 * require() must take a literal path, so every asset is listed explicitly.
 *
 * Scenes: scene1 art is bundled (day + night). scenes 2-6 fall back to the
 * tinted placeholder from HOME_SCENES until their webp lands -- add the
 * require() pair here when it does.
 *
 * Skins: pet1 has all six skins bundled. pet2/pet3 fall back to a placeholder
 * until their art lands.
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

// pet id -> [skin1..skin6] images. Index 0 = skin1.
export const SKIN_IMAGES: Record<string, (ImageSourcePropType | undefined)[]> = {
  pet1: [
    require('../../assets/characters/char-1-skin1.webp'),
    require('../../assets/characters/char-1-skin2.webp'),
    require('../../assets/characters/char-1-skin3.webp'),
    require('../../assets/characters/char-1-skin4.webp'),
    require('../../assets/characters/char-1-skin5.webp'),
    require('../../assets/characters/char-1-skin6.webp'),
  ],
  // pet2, pet3: add when art lands.
};
