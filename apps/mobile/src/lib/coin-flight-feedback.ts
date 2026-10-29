type Feedback = { now(): number; isActive(): boolean; pulse(): unknown; play(): unknown; stopSound(): unknown };
export const COIN_FLIGHT_PULSES = 20;

/** One bounded timer for the whole flight, not a JS animation driver. Absolute
 * deadlines skip missed pulses rather than bursting/catching up after a stall. */
export function createCoinFlightFeedback(deps: Feedback) {
  let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, lastId: string | undefined;
  const safely = (action: () => unknown) => { try { void Promise.resolve(action()).catch(() => {}); } catch {} };
  const stopPulses = () => { generation++; clearTimeout(timer); timer = undefined; };
  const stop = () => { stopPulses(); safely(deps.stopSound); };
  return {
    start(id: string, duration: number) {
      if (lastId === id) return;
      lastId = id; stop();
      if (!deps.isActive() || !Number.isFinite(duration) || duration <= 0) return;
      const token = generation, start = deps.now(), interval = duration / (COIN_FLIGHT_PULSES - 1);
      safely(deps.play);
      const tick = (index: number) => {
        timer = undefined;
        if (token !== generation || !deps.isActive()) { stop(); return; }
        const age = Math.max(0, deps.now() - start);
        if (age > duration) return;
        // At most one request per live slot. Never repay missed sensations.
        if (age - index * interval < interval / 2) safely(deps.pulse);
        const next = Math.max(index + 1, Math.ceil(age / interval));
        if (next < COIN_FLIGHT_PULSES) timer = setTimeout(() => tick(next), Math.max(0, start + next * interval - deps.now()));
      };
      tick(0);
    },
    stopPulses,
    stop,
  };
}
