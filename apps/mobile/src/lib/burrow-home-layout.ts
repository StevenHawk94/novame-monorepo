export const HOME_ART_WIDTH = 900;
export const HOME_ART_HEIGHT = 1950;
export const HOME_BACKGROUND_HEIGHT = 2000;
// Reconstruct the old sheet FROM THE FLOOR, never from the viewport top.
// Source canvases are 800x680 (floor) and 800x560 (rim), with their padding.
// In the old 900x2000 sheet: floor y=1235, rim bottom=630, clear gap=605.
// Visible edges remain ~1242 / 628 after the supplied alpha margins are added.
export const HOME_RIM_TO_FLOOR_GAP = 605;
export function homeBackgroundLayout() {
  const sourceScale=HOME_ART_WIDTH/800;
  const floorHeight=680*sourceScale,topHeight=560*sourceScale;
  const offset=HOME_ART_HEIGHT-HOME_BACKGROUND_HEIGHT;
  const floorTop=HOME_BACKGROUND_HEIGHT-floorHeight;
  const topBottom=floorTop-HOME_RIM_TO_FLOOR_GAP;
  return {floor:{x:0,y:offset+floorTop,width:HOME_ART_WIDTH,height:floorHeight},
    rim:{x:0,y:offset+topBottom-topHeight,width:HOME_ART_WIDTH,height:topHeight}};
}
export const HOME_TAB_BAR_TOP_SPACE = 12;
// Add headroom above the icon/label stack, including phones with a home indicator.
export const homeTabBarHeight = (width: number, safeBottom: number) => Math.max(
  160 * width / HOME_ART_WIDTH,
  safeBottom + Math.max(44, (64 + 28) * width / HOME_ART_WIDTH + 4),
) + HOME_TAB_BAR_TOP_SPACE;
export const HOME_LIGHT_STRING_TOP = 416;
// Keep a full 66 design pixels above the first replaceable item.
export const HOME_MAX_TOP_CROP = 350;
// The room preview can omit empty floor below the rug, while keeping every
// replaceable object visible and preserving the Home stage's aspect ratio.
export const HOME_PREVIEW_BOTTOM_CROP = 300;

export type HomeArtPlacement = { key: string; category: string; slot: string; x: number; anchorY: number; visibleWidth: number; anchor: 'top' | 'bottom'; canvasWidth?: number };
// 900 × 1950 reference coordinates. Supporting surfaces are shared instead of
// independently guessed for every ornament; transparent padding never counts.
const SHELF_TOP = 708;
const DRESSER_TOP = 1039;
const TABLE_TOP = 1263;
const TABLE_SURFACE = TABLE_TOP + 42;
export const HOME_ART_PLACEMENTS: HomeArtPlacement[] = [
  { key: 'light-string', category: 'light_strings', slot: 'light_string', x: 146, anchorY: 416, visibleWidth: 563, anchor: 'top' },
  { key: 'window', category: 'windows', slot: 'window', x: 121, anchorY: 836, visibleWidth: 252, anchor: 'bottom' },
  { key: 'shelf', category: 'shelves', slot: 'shelf', x: 555, anchorY: SHELF_TOP, visibleWidth: 261, anchor: 'top' },
  // Gift canvases share one placement; never enlarge narrow silhouettes.
  { key: 'shelf-decor', category: 'shelf_decor', slot: 'shelf_decor', x: 572 - 89 * .2 / 2, anchorY: SHELF_TOP + 5, visibleWidth: 89 * 1.2, canvasWidth: 89 * 1.2, anchor: 'bottom' },
  { key: 'radio', category: 'music_players', slot: 'music_player', x: 682, anchorY: SHELF_TOP + 1, visibleWidth: 117, anchor: 'bottom' },
  { key: 'dresser', category: 'cabinets', slot: 'cabinet', x: 277, anchorY: DRESSER_TOP, visibleWidth: 329, anchor: 'top' },
  // Kettles share the supplied 500px canvas. Use one canvas size (calibrated
  // to Diamond Band), not a separate silhouette fit for each design.
  { key: 'dresser-plant', category: 'dresser_plants', slot: 'dresser_plant', x: 465, anchorY: DRESSER_TOP + 2, visibleWidth: 119, canvasWidth: 500 * 119 / 410, anchor: 'bottom' },
  { key: 'lamp', category: 'lamps', slot: 'lamp', x: 17, anchorY: 1271, visibleWidth: 177, anchor: 'bottom' },
  // Floor layers precede everything resting on them.
  { key: 'rug', category: 'rugs', slot: 'rug', x: 389, anchorY: 1457, visibleWidth: 499, anchor: 'bottom' },
  { key: 'cushion', category: 'cushions', slot: 'cushion', x: 71, anchorY: 1478, visibleWidth: 304, anchor: 'bottom' },
  { key: 'ladder', category: 'ladders', slot: 'ladder', x: 748, anchorY: 1266, visibleWidth: 221, anchor: 'bottom' },
  { key: 'table', category: 'tables', slot: 'table', x: 516, anchorY: TABLE_TOP, visibleWidth: 244, anchor: 'top' },
  // All flowers share a 500px canvas and matching vase size. Preserve that
  // scale across variants; a wider bouquet must not shrink its vase. Match
  // the Default-Calendula reference size and keep the canvas centered here.
  { key: 'flowers', category: 'vases', slot: 'vase', x: 610, anchorY: TABLE_SURFACE, visibleWidth: 140, canvasWidth: 500 * 140 / 353, anchor: 'bottom' },
];
// All Toy assets share a 512px canvas. Keep Default's existing placement,
// but use ONE canvas size for every costume, never normalize its silhouette.
export const HOME_DOLL_PLACEMENT: HomeArtPlacement = { key: 'doll', category: 'couple_dolls', slot: 'couple_doll', x: 335, anchorY: DRESSER_TOP + 15, visibleWidth: 100, canvasWidth: 512 * 100 / 300, anchor: 'bottom' };
// Preserve Classic's reference size, not each frame's outer silhouette width.
export const HOME_FRAME_PLACEMENT: HomeArtPlacement = { key: 'frame', category: 'frames', slot: 'frame', x: 631, anchorY: 763, visibleWidth: 116, canvasWidth: 500 * 116 / 304, anchor: 'top' };
export const HOME_LETTER_PLACEMENT: HomeArtPlacement = { key: 'letter', category: 'letter', slot: 'letter', x: 557, anchorY: TABLE_SURFACE, visibleWidth: 71, anchor: 'bottom' };

export function homeAnchoredBox(asset: { width: number; height: number; bounds: readonly [number, number, number, number] }, placement: HomeArtPlacement, scale: number) {
  const [left, top, right, bottom] = asset.bounds;
  const ratio = placement.canvasWidth == null ? placement.visibleWidth / (right - left) : placement.canvasWidth / asset.width;
  const edge = placement.category === 'couple_dolls' || placement.category === 'shelf_decor'
    ? (placement.anchor === 'top' ? 0 : asset.height)
    : (placement.anchor === 'top' ? top : bottom);
  return { position: 'absolute' as const,
    left: (placement.canvasWidth == null ? placement.x - left * ratio : placement.x + placement.visibleWidth / 2 - placement.canvasWidth / 2) * scale,
    top: (placement.anchorY - edge * ratio) * scale,
    width: asset.width * ratio * scale, height: asset.height * ratio * scale };
}

export function homeArtLayout(width: number, height: number, tabBarHeight: number, preview = false) {
  const widthScale = width / HOME_ART_WIDTH;
  const scale = preview ? widthScale : Math.min(widthScale,
    (height + tabBarHeight) / (HOME_ART_HEIGHT - HOME_MAX_TOP_CROP));
  const artWidth = HOME_ART_WIDTH * scale;
  const artHeight = HOME_ART_HEIGHT * scale;
  const visibleHeight = height + (preview ? 0 : tabBarHeight);
  return { scale, artWidth, artHeight, left: (width - artWidth) / 2,
    cropTop: Math.max(0, artHeight - visibleHeight) };
}

export function decorationPreviewLayout(width: number, availableHeight: number) {
  const scale = Math.min(width / HOME_ART_WIDTH,
    availableHeight / (HOME_ART_HEIGHT - HOME_MAX_TOP_CROP - HOME_PREVIEW_BOTTOM_CROP));
  const artWidth = HOME_ART_WIDTH * scale;
  const artHeight = HOME_ART_HEIGHT * scale;
  const viewportHeight = Math.min((HOME_ART_HEIGHT - HOME_MAX_TOP_CROP - HOME_PREVIEW_BOTTOM_CROP) * scale, availableHeight);
  return { scale, artWidth, artHeight, viewportHeight,
    cropTop: artHeight - HOME_PREVIEW_BOTTOM_CROP * scale - viewportHeight,
    cropBottom: HOME_PREVIEW_BOTTOM_CROP * scale };
}
