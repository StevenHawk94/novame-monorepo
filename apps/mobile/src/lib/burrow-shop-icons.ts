/** User-supplied transparent WebP category symbols; retain the existing rail order. */
export const BURROW_SHOP_ICONS = {
  wallpapers: require('../../assets/burrow-webp/burrow-shop-icons/wallpapers.webp'),
  outfits: require('../../assets/burrow-webp/burrow-shop-icons/outfits.webp'),
  cushions: require('../../assets/burrow-webp/burrow-shop-icons/cushions.webp'),
  tables: require('../../assets/burrow-webp/burrow-shop-icons/tables.webp'),
  rugs: require('../../assets/burrow-webp/burrow-shop-icons/rugs.webp'),
  vases: require('../../assets/burrow-webp/burrow-shop-icons/Flowers.webp'),
  lamps: require('../../assets/burrow-webp/burrow-shop-icons/floor-lamp.webp'),
  windows: require('../../assets/burrow-webp/burrow-shop-icons/windows.webp'),
  cabinets: require('../../assets/burrow-webp/burrow-shop-icons/cabinets.webp'),
  shelves: require('../../assets/burrow-webp/burrow-shop-icons/floating-shelves.webp'),
  music_players: require('../../assets/burrow-webp/burrow-shop-icons/music-players.webp'),
  frames: require('../../assets/burrow-webp/burrow-shop-icons/photo-frames.webp'),
  couple_dolls: require('../../assets/burrow-webp/burrow-shop-icons/dolls.webp'),
  light_strings: require('../../assets/burrow-webp/burrow-shop-icons/string-lights.webp'),
  ladders: require('../../assets/burrow-webp/burrow-shop-icons/ladders.webp'),
  dresser_plants: require('../../assets/burrow-webp/burrow-shop-icons/kettle.webp'),
} as const;

// Measured alpha bounds in the 300px source canvases. Align visible artwork,
// not transparent margins; no bitmap decoding/cropping on the UI thread.
export const BURROW_SHOP_ICON_SOURCE_SIZE = 300;
export const BURROW_SHOP_ICON_BOUNDS = {
  wallpapers: [11,0,300,300], outfits: [0,25,300,275], cushions: [0,74,300,231],
  tables: [0,20,300,280], rugs: [0,68,300,233], vases: [50,0,250,300],
  lamps: [82,0,219,300], windows: [23,0,277,300], cabinets: [0,19,300,281],
  shelves: [0,12,300,286], music_players: [0,8,300,293], frames: [18,0,282,300],
  couple_dolls: [65,0,237,300], light_strings: [0,105,300,195], ladders: [6,0,294,300],
  dresser_plants: [5,3,300,300],
} as const satisfies Record<keyof typeof BURROW_SHOP_ICONS,readonly [number,number,number,number]>;
