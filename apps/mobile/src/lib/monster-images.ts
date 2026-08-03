/**
 * Monster art (assets/monsters, 2026-07-30) — one normal + one -Hit variant
 * per monster. The -Hit frame flashes for ~0.5s when a skill lands, selling
 * the impact. Keyed by engine monster id; the asset names are the art set's
 * own theme labels, mapped 1:1 to the closest engine monster.
 */
import type { ImageSourcePropType } from 'react-native';

export const MONSTER_ART: Record<string, { normal: ImageSourcePropType; hit: ImageSourcePropType }> = {
  overthinking: {
    normal: require('../../assets/monsters/Overthinking.webp'),
    hit: require('../../assets/monsters/Overthinking-Hit.webp'),
  },
  procrastination: {
    normal: require('../../assets/monsters/Procrastination.webp'),
    hit: require('../../assets/monsters/Procrastination-Hit.webp'),
  },
  the_spiral: {
    normal: require('../../assets/monsters/Anxiety.webp'),
    hit: require('../../assets/monsters/Anxiety-Hit.webp'),
  },
  the_comparer: {
    normal: require('../../assets/monsters/Comparison.webp'),
    hit: require('../../assets/monsters/Comparison-Hit.webp'),
  },
  the_wall: {
    normal: require('../../assets/monsters/Isolation.webp'),
    hit: require('../../assets/monsters/Isolation-Hit.webp'),
  },
  the_fog: {
    normal: require('../../assets/monsters/Lost.webp'),
    hit: require('../../assets/monsters/Lost-Hit.webp'),
  },
  the_hollow: {
    normal: require('../../assets/monsters/Self-Doubt.webp'),
    hit: require('../../assets/monsters/Self-Doubt-Hit.webp'),
  },
  the_swallower: {
    normal: require('../../assets/monsters/People-Pleasing.webp'),
    hit: require('../../assets/monsters/People-Pleasing-Hit.webp'),
  },
};
