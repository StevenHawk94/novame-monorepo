/** Presentation only: preserve source aspect, labels, column widths and IDs.
 * Moments/ItemSprite use their own layout and must not shrink a second time. */
export const TAP_DAY_ICON_SCALE = 0.7;
export function tapDayIconSize(size: number) {
  return Math.max(1, size) * TAP_DAY_ICON_SCALE;
}
