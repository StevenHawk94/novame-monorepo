/**
 * Responsive scaling helpers — Stage 0 of responsive typography system.
 *
 * Pure functions, zero react-native dependency (keeps ui-tokens consumable by
 * admin/api). The caller passes the current screen width; mobile wraps these
 * in a hook backed by useWindowDimensions (see apps/mobile).
 *
 * Base width 375pt (iPhone SE) — the smallest target device, so the SE renders
 * at 1:1 (no shrink) and larger screens scale up moderately.
 *
 * Algorithm: react-native-size-matters standard.
 *   scale         = (screenW / base) * size            (linear)
 *   moderateScale = size + (scale(size) - size) * factor   (controlled)
 * factor 0.5 default; titles use ~0.3 (scale slower), per Apple's philosophy
 * that large text should not grow as fast as body text on bigger screens.
 */

export const BASE_WIDTH = 375

export function makeScalers(screenWidth: number, baseWidth: number = BASE_WIDTH) {
  const ratio = screenWidth / baseWidth

  /** Linear scale by screen width. */
  const scale = (size: number) => ratio * size

  /** Controlled scale: factor 0..1 dampens the linear scaling. */
  const moderateScale = (size: number, factor: number = 0.5) =>
    size + (scale(size) - size) * factor

  /**
   * Scale a font size with a minimum floor (never smaller than min).
   * Titles should pass factor ~0.3; body/caption ~0.5.
   */
  const scaleFont = (size: number, min: number, factor: number = 0.5) =>
    Math.max(min, Math.round(moderateScale(size, factor)))

  return { scale, moderateScale, scaleFont, ratio }
}

export type Scalers = ReturnType<typeof makeScalers>
