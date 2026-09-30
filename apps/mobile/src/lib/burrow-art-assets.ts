import type { ImageSource } from 'expo-image';
import type { MajorUpdateCatalogItem } from './app-major-update-api';

export type BurrowArtAsset = { source: ImageSource; width: number; height: number; bounds: readonly [number, number, number, number] };
// Bounds cover the visible pixels; transparent canvas margins do not move the anchored art.
export const BURROW_ART: Record<string, readonly BurrowArtAsset[]> = {
  cabinets: [
    { source: require('../../assets/burrow-webp/room decoration/Dresser/41.webp'), width: 600, height: 600, bounds: [23, 1, 580, 404] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/42.webp'), width: 600, height: 600, bounds: [25, 1, 579, 405] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/43.webp'), width: 600, height: 600, bounds: [25, 0, 579, 405] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/44.webp'), width: 600, height: 600, bounds: [23, 0, 579, 404] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/45.webp'), width: 600, height: 600, bounds: [24, 0, 578, 396] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/46.webp'), width: 600, height: 600, bounds: [25, 0, 577, 397] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/47.webp'), width: 600, height: 600, bounds: [24, 1, 577, 407] },
    { source: require('../../assets/burrow-webp/room decoration/Dresser/48.webp'), width: 600, height: 600, bounds: [23, 0, 579, 406] },
  ],
  shelves: [
    { source: require('../../assets/burrow-webp/room decoration/bookself/9.webp'), width: 625, height: 187, bounds: [38, 41, 584, 166] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/10.webp'), width: 625, height: 187, bounds: [40, 45, 584, 161] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/11.webp'), width: 625, height: 187, bounds: [38, 40, 585, 163] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/12.webp'), width: 625, height: 187, bounds: [38, 45, 586, 161] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/13.webp'), width: 625, height: 187, bounds: [38, 45, 584, 174] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/14.webp'), width: 625, height: 187, bounds: [41, 44, 584, 166] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/15.webp'), width: 625, height: 187, bounds: [40, 44, 584, 171] },
    { source: require('../../assets/burrow-webp/room decoration/bookself/16.webp'), width: 625, height: 187, bounds: [38, 44, 588, 171] },
  ],
  light_strings: [
    { source: require('../../assets/burrow-webp/room decoration/light string/17.webp'), width: 625, height: 187, bounds: [0, 24, 625, 153] },
    { source: require('../../assets/burrow-webp/room decoration/light string/18.webp'), width: 625, height: 187, bounds: [0, 18, 625, 154] },
    { source: require('../../assets/burrow-webp/room decoration/light string/19.webp'), width: 625, height: 187, bounds: [0, 26, 625, 156] },
    { source: require('../../assets/burrow-webp/room decoration/light string/20.webp'), width: 625, height: 187, bounds: [0, 18, 625, 154] },
    { source: require('../../assets/burrow-webp/room decoration/light string/21.webp'), width: 625, height: 187, bounds: [0, 25, 625, 156] },
    { source: require('../../assets/burrow-webp/room decoration/light string/22.webp'), width: 625, height: 187, bounds: [0, 24, 625, 162] },
    { source: require('../../assets/burrow-webp/room decoration/light string/23.webp'), width: 625, height: 187, bounds: [0, 23, 625, 156] },
    { source: require('../../assets/burrow-webp/room decoration/light string/24.webp'), width: 625, height: 187, bounds: [0, 26, 625, 157] },
  ],
  windows: [
    { source: require('../../assets/burrow-webp/room decoration/windows/25.webp'), width: 600, height: 600, bounds: [29, 67, 575, 598] },
    { source: require('../../assets/burrow-webp/room decoration/windows/26.webp'), width: 600, height: 600, bounds: [35, 68, 569, 599] },
    { source: require('../../assets/burrow-webp/room decoration/windows/27.webp'), width: 600, height: 600, bounds: [30, 60, 573, 599] },
    { source: require('../../assets/burrow-webp/room decoration/windows/28.webp'), width: 600, height: 600, bounds: [23, 56, 579, 598] },
    { source: require('../../assets/burrow-webp/room decoration/windows/29.webp'), width: 600, height: 600, bounds: [10, 71, 587, 599] },
    { source: require('../../assets/burrow-webp/room decoration/windows/30.webp'), width: 600, height: 600, bounds: [24, 62, 584, 600] },
    { source: require('../../assets/burrow-webp/room decoration/windows/31.webp'), width: 600, height: 600, bounds: [32, 48, 576, 598] },
    { source: require('../../assets/burrow-webp/room decoration/windows/32.webp'), width: 600, height: 600, bounds: [24, 49, 580, 598] },
  ],
  ladders: [
    { source: require('../../assets/burrow-webp/room decoration/ladder/33.webp'), width: 600, height: 600, bounds: [120, 12, 500, 600] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/34.webp'), width: 600, height: 600, bounds: [122, 9, 509, 600] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/35.webp'), width: 600, height: 600, bounds: [124, 12, 500, 599] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/36.webp'), width: 600, height: 600, bounds: [128, 23, 497, 600] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/37.webp'), width: 600, height: 600, bounds: [119, 14, 497, 600] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/38.webp'), width: 600, height: 600, bounds: [122, 20, 490, 599] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/39.webp'), width: 600, height: 600, bounds: [125, 8, 493, 600] },
    { source: require('../../assets/burrow-webp/room decoration/ladder/40.webp'), width: 600, height: 600, bounds: [123, 12, 502, 600] },
  ],
  tables: [
    { source: require('../../assets/burrow-webp/room decoration/table/49.webp'), width: 600, height: 600, bounds: [24, 2, 576, 455] },
    { source: require('../../assets/burrow-webp/room decoration/table/50.webp'), width: 600, height: 600, bounds: [25, 1, 578, 454] },
    { source: require('../../assets/burrow-webp/room decoration/table/51.webp'), width: 600, height: 600, bounds: [25, 2, 578, 464] },
    { source: require('../../assets/burrow-webp/room decoration/table/52.webp'), width: 600, height: 600, bounds: [25, 0, 578, 463] },
    { source: require('../../assets/burrow-webp/room decoration/table/53.webp'), width: 600, height: 600, bounds: [24, 1, 575, 465] },
    { source: require('../../assets/burrow-webp/room decoration/table/54.webp'), width: 600, height: 600, bounds: [25, 1, 578, 465] },
    { source: require('../../assets/burrow-webp/room decoration/table/55.webp'), width: 600, height: 600, bounds: [26, 0, 579, 469] },
    { source: require('../../assets/burrow-webp/room decoration/table/56.webp'), width: 600, height: 600, bounds: [24, 1, 577, 470] },
  ],
  frames: [
    { source: require('../../assets/burrow-webp/room decoration/photo frame/57.webp'), width: 600, height: 600, bounds: [122, 1, 478, 553] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/58.webp'), width: 600, height: 600, bounds: [141, 1, 492, 550] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/59.webp'), width: 600, height: 600, bounds: [142, 0, 493, 559] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/60.webp'), width: 600, height: 600, bounds: [140, 2, 493, 588] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/61.webp'), width: 600, height: 600, bounds: [141, 0, 491, 589] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/62.webp'), width: 600, height: 600, bounds: [142, 1, 491, 585] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/63.webp'), width: 600, height: 600, bounds: [140, 1, 495, 554] },
    { source: require('../../assets/burrow-webp/room decoration/photo frame/64.webp'), width: 600, height: 600, bounds: [137, 1, 493, 554] },
  ],
  lamps: [
    { source: require('../../assets/burrow-webp/room decoration/lamp/65.webp'), width: 600, height: 600, bounds: [78, 72, 522, 600] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/66.webp'), width: 600, height: 600, bounds: [53, 73, 550, 600] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/67.webp'), width: 600, height: 600, bounds: [42, 26, 558, 599] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/68.webp'), width: 600, height: 600, bounds: [62, 40, 538, 598] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/69.webp'), width: 600, height: 600, bounds: [79, 35, 523, 594] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/70.webp'), width: 600, height: 600, bounds: [115, 20, 488, 594] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/71.webp'), width: 600, height: 600, bounds: [78, 14, 533, 597] },
    { source: require('../../assets/burrow-webp/room decoration/lamp/72.webp'), width: 600, height: 600, bounds: [54, 16, 550, 600] },
  ],
  couple_dolls: [
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/73.webp'), width: 600, height: 600, bounds: [105, 59, 464, 600] },
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/74.webp'), width: 600, height: 600, bounds: [100, 32, 502, 600] },
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/75.webp'), width: 600, height: 600, bounds: [87, 49, 480, 600] },
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/76.webp'), width: 600, height: 600, bounds: [31, 38, 490, 600] },
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/77.webp'), width: 600, height: 600, bounds: [117, 40, 500, 600] },
    { source: require('../../assets/burrow-webp/room decoration/interative toys on dresser/78.webp'), width: 600, height: 600, bounds: [52, 41, 549, 600] },
  ],
  shelf_decor: [
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/79.webp'), width: 600, height: 600, bounds: [51, 83, 579, 598] },
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/80.webp'), width: 600, height: 600, bounds: [0, 22, 597, 600] },
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/81.webp'), width: 600, height: 600, bounds: [98, 102, 509, 600] },
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/82.webp'), width: 600, height: 600, bounds: [66, 146, 550, 600] },
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/83.webp'), width: 600, height: 600, bounds: [41, 90, 554, 600] },
    { source: require('../../assets/burrow-webp/room decoration/bookshelf decor/84.webp'), width: 600, height: 600, bounds: [72, 92, 553, 600] },
  ],
  dresser_plants: [
    { source: require('../../assets/burrow-rendered/dresser-plant-85.webp'), width: 600, height: 600, bounds: [128, 48, 504, 599] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/86.webp'), width: 600, height: 600, bounds: [6, 0, 548, 600] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/87.webp'), width: 600, height: 600, bounds: [35, 31, 555, 600] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/88.webp'), width: 600, height: 600, bounds: [0, 35, 600, 600] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/89.webp'), width: 600, height: 600, bounds: [0, 28, 600, 600] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/90.webp'), width: 600, height: 600, bounds: [0, 29, 600, 600] },
    { source: require('../../assets/burrow-rendered/dresser-plant-91.webp'), width: 600, height: 600, bounds: [77, 30, 533, 596] },
    { source: require('../../assets/burrow-webp/room decoration/succulent on dresser/92.webp'), width: 600, height: 600, bounds: [49, 0, 600, 600] },
  ],
  rugs: [
    { source: require('../../assets/burrow-webp/room decoration/carpet/1.webp'), width: 625, height: 187, bounds: [2, 35, 621, 149] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/2.webp'), width: 625, height: 187, bounds: [2, 36, 621, 147] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/3.webp'), width: 625, height: 187, bounds: [2, 37, 621, 146] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/4.webp'), width: 625, height: 187, bounds: [2, 32, 621, 163] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/5.webp'), width: 625, height: 187, bounds: [3, 36, 621, 148] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/6.webp'), width: 625, height: 187, bounds: [2, 33, 621, 148] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/7.webp'), width: 625, height: 187, bounds: [2, 33, 621, 148] },
    { source: require('../../assets/burrow-webp/room decoration/carpet/8.webp'), width: 625, height: 187, bounds: [1, 32, 622, 149] },
  ],
  cushions: [
    { source: require('../../assets/burrow-rendered/cushion-1.webp'), width: 800, height: 400, bounds: [33, 22, 769, 393] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/2.webp'), width: 800, height: 400, bounds: [54, 9, 749, 391] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/3.webp'), width: 800, height: 400, bounds: [76, 5, 731, 389] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/4.webp'), width: 800, height: 400, bounds: [81, 8, 736, 390] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/5.webp'), width: 800, height: 400, bounds: [75, 8, 737, 391] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/6.webp'), width: 800, height: 400, bounds: [68, 5, 741, 393] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/7.webp'), width: 800, height: 400, bounds: [79, 5, 732, 398] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/8.webp'), width: 800, height: 400, bounds: [79, 1, 735, 392] },
    { source: require('../../assets/burrow-webp/room decoration/cusion/9.webp'), width: 800, height: 400, bounds: [50, 4, 761, 395] },
  ],
  vases: [
    { source: require('../../assets/burrow-webp/room decoration/flower/1.webp'), width: 600, height: 600, bounds: [63, 35, 510, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/2.webp'), width: 600, height: 600, bounds: [92, 45, 554, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/3.webp'), width: 600, height: 600, bounds: [54, 38, 565, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/4.webp'), width: 600, height: 600, bounds: [55, 41, 519, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/5.webp'), width: 600, height: 600, bounds: [73, 38, 529, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/6.webp'), width: 600, height: 600, bounds: [81, 56, 554, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/7.webp'), width: 600, height: 600, bounds: [109, 3, 489, 600] },
    { source: require('../../assets/burrow-webp/room decoration/flower/8.webp'), width: 600, height: 600, bounds: [116, 5, 483, 600] },
  ],
  music_players: [
    { source: require('../../assets/burrow-webp/room decoration/radio/9.webp'), width: 600, height: 600, bounds: [25, 112, 577, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/10.webp'), width: 600, height: 600, bounds: [28, 114, 577, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/11.webp'), width: 600, height: 600, bounds: [26, 113, 580, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/12.webp'), width: 600, height: 600, bounds: [24, 126, 576, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/13.webp'), width: 600, height: 600, bounds: [21, 147, 583, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/14.webp'), width: 600, height: 600, bounds: [24, 115, 582, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/15.webp'), width: 600, height: 600, bounds: [20, 137, 580, 600] },
    { source: require('../../assets/burrow-webp/room decoration/radio/16.webp'), width: 600, height: 600, bounds: [28, 122, 579, 600] },
  ],
  posters: [
    { source: require('../../assets/burrow-webp/room decoration/poster/17.webp'), width: 600, height: 600, bounds: [97, 0, 494, 542] },
    { source: require('../../assets/burrow-webp/room decoration/poster/18.webp'), width: 600, height: 600, bounds: [113, 0, 512, 545] },
    { source: require('../../assets/burrow-webp/room decoration/poster/19.webp'), width: 600, height: 600, bounds: [97, 0, 494, 568] },
    { source: require('../../assets/burrow-webp/room decoration/poster/20.webp'), width: 600, height: 600, bounds: [99, 0, 496, 572] },
    { source: require('../../assets/burrow-webp/room decoration/poster/21.webp'), width: 600, height: 600, bounds: [95, 0, 495, 538] },
    { source: require('../../assets/burrow-webp/room decoration/poster/22.webp'), width: 600, height: 600, bounds: [97, 0, 494, 531] },
    { source: require('../../assets/burrow-webp/room decoration/poster/23.webp'), width: 600, height: 600, bounds: [97, 0, 494, 539] },
    { source: require('../../assets/burrow-webp/room decoration/poster/24.webp'), width: 600, height: 600, bounds: [96, 0, 502, 548] },
  ],
};

export const BURROW_BACKGROUNDS = {
  common: require('../../assets/burrow-webp/background-collection room,quests,game room,rage room.webp'),
  home: require('../../assets/burrow-webp/home-background.webp'),
  burrowDay: require('../../assets/burrow-webp/burrow-page-bg-day.webp'),
  burrowNight: require('../../assets/burrow-webp/burrow-page-bg-night.webp'),
  friendsRoom: require('../../assets/burrow-webp/friends-room-bg.webp'),
  adventure: require('../../assets/burrow-webp/adventure-page-bg.webp'),
  adventureFinish: require('../../assets/burrow-webp/adventure finish-bg.webp'),
  affectionSelect: require('../../assets/burrow-webp/affection-select-bg.webp'),
  affectionSend: require('../../assets/burrow-webp/affection-send-bg.webp'),
  carrotShop: require('../../assets/burrow-webp/Coin-purchase-page/7526eef1-0d6a-4d6b-ad95-d26b93fb7c21.webp'),
};

export const BURROW_FIXED_ART = {
  loveLetter: require('../../assets/burrow-webp/room decoration/love-letter.webp'),
  treasureClosed: require('../../assets/burrow-webp/adventure-page/chest-box.webp'),
  treasureOpen: require('../../assets/burrow-webp/adventure-page/chest-box-open.webp'),
};

export function burrowArtFor(category: string, ordinal = 1): BurrowArtAsset | undefined {
  return BURROW_ART[category]?.[Math.max(0, ordinal - 1)];
}

export function burrowArtForItem(item: MajorUpdateCatalogItem | undefined, fallbackCategory?: string): BurrowArtAsset | undefined {
  const category = item?.category ?? fallbackCategory;
  if (!category || !BURROW_ART[category]) return undefined;
  const ordinal = item?.metadata.artOrdinal ?? 1;
  return burrowArtFor(category, ordinal);
}
