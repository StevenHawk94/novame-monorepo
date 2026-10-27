/** Scheduling only: this never disables a button or authorizes a command. */
export function createUiWorkPriority(now: () => number = Date.now) {
  let touches = 0, touchLease = 0, quietUntil = 0;
  const transitions = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => { listeners.forEach(listener => listener()); };
  return {
    // Imperative scheduling subscribers (currently only the idle bunny). Do not
    // publish React state or pause feedback, navigation, rewards or business work.
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    touch(count: number) {
      const before = touches;
      touches = Math.max(0, count); touchLease = now() + 10_000;
      quietUntil = now() + 140;
      if (before !== touches) notify();
    },
    action() { quietUntil = Math.max(quietUntil, now() + 240); notify(); },
    transition(key: string, active: boolean) {
      if (active) transitions.set(key, now() + 1500);
      else { transitions.delete(key); quietUntil = Math.max(quietUntil, now() + 48); }
      notify();
    },
    delay() {
      const time = now();
      for (const [key, until] of transitions) if (until <= time) transitions.delete(key);
      if ((touches > 0 && time < touchLease) || transitions.size) return 100;
      return Math.max(0, quietUntil - time);
    },
    reset() { touches = 0; touchLease = 0; quietUntil = 0; transitions.clear(); notify(); },
  };
}
export const uiWorkPriority = createUiWorkPriority();
