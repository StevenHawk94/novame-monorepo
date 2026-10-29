/** Coordinates measured from the approved 600px-wide reference. Vertical
 * gaps depend on width, never spare viewport height; small screens scroll. */
export function adventureEntryLayout(width: number, safeTop = 0) {
  const scale = Math.max(1, width) / 600;
  return {
    bannerRatio: 1528 / 1029,
    titleTop: Math.max(88 * scale, safeTop + 10),
    titleFont: Math.max(17, Math.min(30, 26 * scale)),
    side: 28 * scale,
    bannerGap: 28 * scale,
    compass: 40 * scale,
    headingGap: 26 * scale,
    headingFont: Math.max(18, Math.min(28, 26 * scale)),
    headingLine: Math.max(26, 34 * scale),
    choiceGap: 36 * scale,
    headingBottom: 35 * scale,
    choiceHeight: Math.max(76, 110 * scale),
    choicePadding: Math.max(16, 28 * scale),
    choiceRadius: 25 * scale,
    choiceIcon: Math.max(44, 64 * scale),
    choiceTitle: Math.max(16, Math.min(24, 22 * scale)),
    choiceText: Math.max(13, Math.min(20, 18 * scale)),
  };
}
