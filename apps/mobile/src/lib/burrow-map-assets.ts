// Literal paths are required by Metro. All eight seasonal banners ship locally.
export const BURROW_MAP_ART = {
  room: require('../../assets/burrow-webp/burrow-page/room.webp'),
  light: require('../../assets/burrow-webp/burrow-page/light.webp'),
  banners: {
    'spring-day': require('../../assets/burrow-webp/burrow-page/spring-day.webp'),
    'spring-night': require('../../assets/burrow-webp/burrow-page/spring-night.webp'),
    'summer-day': require('../../assets/burrow-webp/burrow-page/summer-day.webp'),
    'summer-night': require('../../assets/burrow-webp/burrow-page/summer-night.webp'),
    'autumn-day': require('../../assets/burrow-webp/burrow-page/autumn-day.webp'),
    'autumn-night': require('../../assets/burrow-webp/burrow-page/autumn-night.webp'),
    'winter-day': require('../../assets/burrow-webp/burrow-page/winter-day.webp'),
    'winter-night': require('../../assets/burrow-webp/burrow-page/winter-night.webp'),
  },
} as const;
