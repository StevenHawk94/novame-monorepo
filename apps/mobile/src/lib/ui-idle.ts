import { AppState, InteractionManager } from 'react-native';
import { uiWorkPriority } from './ui-work-priority';

/**
 * Run cache reconciliation only after the navigation/native interaction that
 * revealed a screen has settled. The returned cleanup is safe to call from a
 * focus-effect cleanup and prevents a queued task from mutating a hidden tab.
 */
export function afterUiSettles(
  task: () => void,
  options?: { delayMs?: number; requireForeground?: boolean },
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const interaction = InteractionManager.runAfterInteractions(() => {
    if (cancelled) return;
    const run = () => {
      timer = null;
      if (cancelled) return;
      if (options?.requireForeground !== false && AppState.currentState !== 'active') return;
      const wait = uiWorkPriority.delay();
      if (wait > 0) { timer = setTimeout(run, wait); return; }
      task();
    };
    timer = setTimeout(run, Math.max(0, options?.delayMs ?? 32));
  });

  return () => {
    cancelled = true;
    interaction.cancel();
    if (timer) clearTimeout(timer);
  };
}

/** Network I/O can run during a gesture. Background reconciliation/publication
 * yields here; local user intents and their durable writes never use this. */
export function yieldToUi(delayMs=32):Promise<void>{
  return new Promise(resolve=>{afterUiSettles(resolve,{delayMs,requireForeground:false});});
}

/** Schedule several foreground jobs without starting them in the same frame. */
export function stageForegroundJobs(
  jobs: ReadonlyArray<{ delayMs: number; run: () => void | Promise<unknown> }>,
): () => void {
  let cancelled = false;
  const started = Date.now();
  let cancelCurrent: (() => void) | undefined;
  const next = (index: number) => {
    if (cancelled || index >= jobs.length) return;
    cancelCurrent = afterUiSettles(() => {
      if (cancelled) return;
      // One job at a time; a rejection must not starve subsequent warmups.
      try { void Promise.resolve(jobs[index].run()).catch(() => {}).then(() => next(index + 1)); }
      catch { next(index + 1); }
    }, { delayMs: Math.max(32, started + jobs[index].delayMs - Date.now()) });
  };
  next(0);

  return () => {
    cancelled = true;
    cancelCurrent?.();
  };
}
