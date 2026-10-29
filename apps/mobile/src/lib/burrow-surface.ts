import type { ViewStyle } from 'react-native';

export const BURROW_PAGE_COLORS = ['#793D29','#B85B35','#D6834B'] as const;
export const ADVENTURE_PROGRESS_COLORS = ['#2C0D00','#360E02','#2C0D00'] as const;
export const ADVENTURE_RETURN_COLORS = ['#FFC343','#FFBC32'] as const;
export const ADVENTURE_LOG_BACKGROUND = '#5c2c19';

/** Native edge resistance/rebound; no JS gesture loop or refresh on the map. */
export function burrowPageScrollBehavior(section:string) {
  return {
    bounces:section!=='carrot_shop'&&section!=='quests',
    alwaysBounceVertical:section==='burrow',
    overScrollMode:section==='burrow'?'always' as const:'never' as const,
  };
}

/** Exact existing opaque, vertical, evenly spaced stops. RN 0.81's iOS
 * implementation owns a CAGradientLayer rather than a full-screen CPU bitmap.
 * Keep this narrow: diagonal, translucent and animated gradients are untouched. */
export function nativeVerticalGradientStyle(colors: readonly [string,string,...string[]]): ViewStyle {
  return {backgroundColor:colors[0],experimental_backgroundImage:
    `linear-gradient(180deg, ${colors.map((color,index)=>`${color} ${index/(colors.length-1)*100}%`).join(', ')})`};
}

export function burrowFlatSurface(section:string,adventureEntry:boolean) {
  if(adventureEntry)return ADVENTURE_LOG_BACKGROUND;
  if(section==='quests')return '#6a321c';
  if(section==='burrow')return '#572b1a';
  // HomeArtScene fills its entire viewport with an opaque image + mask.
  // Do not draw an invisible full-screen gradient underneath that artwork.
  if(section==='home')return BURROW_PAGE_COLORS[0];
  // Every other generic BurrowScreen surface has an opaque cover Image.
  // Recording owns its solid soil; Digging owns its visible dark gradient. Keep a plain fallback
  // behind artwork; never rasterize a full-screen gradient that cannot be seen.
  return BURROW_PAGE_COLORS[0];
}
