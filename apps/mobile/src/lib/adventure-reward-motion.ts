/** Display-only timings. Opening never claims a reward or waits on a request. */
export const ADVENTURE_REWARD_MOTION = {
  opening: 1200, rotation: 36_000, idlePause: 480, idlePeriod: 1000,
  overshoot: 1.3, revealStart: .16, revealPeak: .40, revealEnd: .92,
  burstStart: .44, burstEnd: .76, rayCount: 12,
  textStart: .78, textEnd: 1,
  headingDelay: 90, panelDelay: 180, buttonDelay: 300, entrance: 260,
} as const;

export const REWARD_REVEAL_KEYFRAMES = [
  [ADVENTURE_REWARD_MOTION.revealStart, 0], [ADVENTURE_REWARD_MOTION.revealPeak, 1.3],
  [.50, 1], [.61, 1.2], [.71, 1], [.81, 1.1], [ADVENTURE_REWARD_MOTION.revealEnd, 1],
] as const;

export function rewardRevealScale(progress: number) {
  'worklet';
  const m = ADVENTURE_REWARD_MOTION;
  if (progress <= m.revealStart) return 0;
  // Smooth extrema, with three successively smaller rebounds. One UI-thread
  // clock drives both flight and scale; rapid taps cannot stack springs.
  const frames = REWARD_REVEAL_KEYFRAMES;
  for (let i = 1; i < frames.length; i++) {
    if (progress <= frames[i][0]) {
      const t = (progress - frames[i - 1][0]) / (frames[i][0] - frames[i - 1][0]);
      return frames[i - 1][1] + (frames[i][1] - frames[i - 1][1]) * t * t * (3 - 2 * t);
    }
  }
  return 1;
}

export function rewardRevealFrame(progress: number, rise: number) {
  'worklet';
  const m = ADVENTURE_REWARD_MOTION;
  const flight = Math.max(0, Math.min(1, (progress - m.revealStart) / (m.revealPeak - m.revealStart)));
  return { opacity: progress <= m.revealStart ? 0 : 1,
    translateY: rise * (1 - flight * flight * (3 - 2 * flight)), scale: rewardRevealScale(progress) };
}

export function rewardSunburstOpacity(progress: number) {
  'worklet';
  const m = ADVENTURE_REWARD_MOTION;
  const t = Math.max(0, Math.min(1, (progress - m.burstStart) / (m.burstEnd - m.burstStart)));
  return t * t * (3 - 2 * t);
}

/** Product flight finishes first, then rays fade in, then the copy. All three
 * use the same UI-thread clock, including after a slow JS frame. */
export function rewardTextOpacity(progress: number) {
  'worklet';
  const m = ADVENTURE_REWARD_MOTION;
  const t = Math.max(0, Math.min(1, (progress - m.textStart) / (m.textEnd - m.textStart)));
  return t * t * (3 - 2 * t);
}

/** Fade to transparent before the nearest horizontal viewport edge. The
 * offscreen clipping then cannot reveal a rectangular canvas boundary. */
export function adventureSunburstRadius(width: number, height: number, centerY: number) {
  return Math.max(1, Math.min(width * .92, height * .48, centerY, height - centerY));
}

export function adventureGiftLayout(width: number, height: number, top: number, bottom: number) {
  const cardSize = Math.min(width * .36, height * .21), centerY = height * .47;
  return { cardSize, centerY, cardTop: centerY - cardSize / 2,
    boxSize: Math.min(width * .48, height * .29), boxCenterY: height * .50,
    titleTop: Math.max(top + 42, height * .115),
    headingTop: Math.max(top + 42, centerY - cardSize / 2 - 72),
    prizeTop: centerY + cardSize * .65 + 22,
    footerBottom: Math.max(24, bottom + 12), buttonHeight: Math.max(52, Math.min(60, width * .145)),
  };
}
