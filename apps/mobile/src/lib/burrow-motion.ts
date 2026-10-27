/** Finch reference: one short navigation beat, one reward flourish, then release.
 * Only transform/opacity/native text are animated; money remains receipt-driven. */
export const BURROW_MOTION = {
  page: 300, dialogue: 180, popup: 280, dismiss: 180,
  chest: 820, coinEnter: 220, coinFlight: 900, coinStagger: 50,
  coinParticles: 7, coinCorrection: 180, coinHold: 1500, coinFade: 300,
} as const;

/** Count only while coins arrive, never while they are still flying.
 * Receipts can retarget mid-flight without restarting the visual clock. */
export function coinArrivalTiming(elapsed: number) {
  'worklet';
  const first = BURROW_MOTION.coinFlight;
  const last = first + (BURROW_MOTION.coinParticles - 1) * BURROW_MOTION.coinStagger;
  const time = Math.max(0, Math.min(last, elapsed));
  return { flightEnd: last, countDelay: Math.max(0, first - time),
    countDuration: time < last ? last - Math.max(first, time) : BURROW_MOTION.coinCorrection };
}

/** A single credit lasts exactly 3s from flight to dismissal, independent of
 * network corrections. A new flight may extend a merged stream, never rewind it. */
export function coinPresentationTiming(elapsed:number,reduced=false){
  'worklet';
  const fadeStart=coinArrivalTiming(0).flightEnd+BURROW_MOTION.coinHold;
  const total=fadeStart+BURROW_MOTION.coinFade;
  const age=Math.max(0,elapsed);
  return{total,fadeDelay:Math.max(0,(reduced?total:fadeStart)-age),
    fadeDuration:reduced?0:Math.max(0,total-Math.max(age,fadeStart))};
}

export function formatAnimatedCoins(value: number) {
  'worklet';
  const integer = Math.round(Number.isFinite(value) ? value : 0);
  // Display cap only. Wallet receipts, spending and persistence retain the
  // complete balance, including real purchases above the reward cap.
  if (integer >= 99999) return '99999+';
  return String(integer).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
