type Priority = { subscribe(listener: () => void): () => void; delay(): number };

/** Freeze the LAST pose immediately; resume only this decorative clock after
 * one quiet second. No navigation/command ever waits for this timer. A missing
 * transition-end uses the priority lease recovery, not a permanent pause. */
export function scheduleBunnyIdle(priority: Priority, setRunning: (running: boolean) => void) {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resume = () => {
    if (!live) return;
    const delay = priority.delay();
    if (delay > 0) { timer = setTimeout(resume, Math.max(100, delay)); return; }
    timer = undefined;
    setRunning(true);
  };
  const pause = () => {
    clearTimeout(timer);
    setRunning(false);
    timer = setTimeout(resume, 1000);
  };
  const unsubscribe = priority.subscribe(pause);
  pause();
  return () => { live = false; clearTimeout(timer); unsubscribe(); setRunning(false); };
}
