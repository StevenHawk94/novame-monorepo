export const HOME_ART_WIDTH = 900;
export const HOME_ART_HEIGHT = 1950;
export const HOME_LIGHT_STRING_TOP = 416;
// Keep a full 66 design pixels above the first replaceable item.
export const HOME_MAX_TOP_CROP = 350;

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
    availableHeight / (HOME_ART_HEIGHT - HOME_MAX_TOP_CROP));
  const artWidth = HOME_ART_WIDTH * scale;
  const artHeight = HOME_ART_HEIGHT * scale;
  const viewportHeight = Math.min(artHeight, availableHeight);
  return { scale, artWidth, artHeight, viewportHeight,
    cropTop: artHeight - viewportHeight };
}
