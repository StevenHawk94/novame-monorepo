import type { ShopCategory } from '@novame/domain';

// One order and vocabulary for Shop and Collection. Seasonal scenery is not
// purchasable, and the gift shelf has its own Collection tab.
export const BURROW_SHOP_CATEGORIES = [
  'outfits', 'wallpapers', 'couple_dolls', 'cushions', 'tables', 'rugs',
  'vases', 'lamps', 'windows', 'cabinets', 'music_players', 'frames',
  'dresser_plants', 'light_strings', 'ladders', 'shelves',
] as const satisfies readonly ShopCategory[];
export type BurrowShopCategory = typeof BURROW_SHOP_CATEGORIES[number];
export const burrowShopCategoryName = (category: string) => ({
  outfits: 'Outfits', wallpapers: 'Wallpapers', couple_dolls: 'Plushies',
  cushions: 'Cushions', tables: 'Tables', rugs: 'Rugs', vases: 'Flowers',
  lamps: 'Floor Lamps', windows: 'Windows', cabinets: 'Cabinets',
  music_players: 'Music Players', frames: 'Photo Frames', dresser_plants: 'Kettles',
  light_strings: 'String Lights', ladders: 'Ladders', shelves: 'Floating Shelves', shelf_decor: 'Decorations',
}[category] ??
  category.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()));
