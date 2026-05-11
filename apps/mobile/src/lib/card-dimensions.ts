/**
 * Centralized FlippableCard sizing.
 *
 * One formula, applied everywhere a FlippableCard is rendered, so the
 * card looks consistent across onboarding, wisdom-insight, keyword-
 * detail, seek-question, cards-select, etc.
 *
 * After Pro Max real-device testing showed previous formula made cards
 * too large, the standardized width is now a single fixed value across
 * all iPhones. The card scales VERY slightly with screen width to keep
 * margins proportional, but the change between smallest (SE) and
 * largest (Pro Max) is small enough to feel consistent.
 *
 * Concrete examples:
 *   - iPhone SE / 13 mini (375pt)       → 285pt card  (45pt each side)
 *   - iPhone 14/15/16 / Pro (393pt)     → 285pt card  (54pt each side)
 *   - iPhone Plus / Pro Max (430-440pt) → 285pt card  (~73pt each side)
 */
export function getStandardCardWidth(_screenWidth: number): number {
  return 285;
}
