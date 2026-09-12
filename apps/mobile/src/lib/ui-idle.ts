import { AppState, InteractionManager } from 'react-native';

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
    timer = setTimeout(() => {
      timer = null;
      if (cancelled) return;
      if (options?.requireForeground !== false && AppState.currentState !== 'active') return;
      task();
    }, Math.max(0, options?.delayMs ?? 32));
  });

  return () => {
    cancelled = true;
    interaction.cancel();
    if (timer) clearTimeout(timer);
  };
}

/** Schedule several foreground jobs without starting them in the same frame. */
export function stageForegroundJobs(
  jobs: ReadonlyArray<{ delayMs: number; run: () => void }>,
): () => void {
  let cancelled = false;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const interaction = InteractionManager.runAfterInteractions(() => {
    if (cancelled || AppState.currentState !== 'active') return;
    for (const job of jobs) {
      timers.push(setTimeout(() => {
        if (!cancelled && AppState.currentState === 'active') job.run();
      }, Math.max(0, job.delayMs)));
    }
  });

  return () => {
    cancelled = true;
    interaction.cancel();
    for (const timer of timers) clearTimeout(timer);
  };
}
