import type { AudioPlayer } from 'expo-audio';

/** Foreground-only, fail-soft one-shot. No React updates on audio progress. */
export function createCompletionSoundPlayer(player: AudioPlayer, isActive: () => boolean) {
  let phase: 'idle' | 'loading' | 'starting' | 'playing' = 'idle';
  let disposed = false;
  let generation = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const clearDeadline = () => { clearTimeout(deadline); deadline = undefined; };
  const stop = () => {
    generation += 1;
    phase = 'idle';
    clearDeadline();
    if (!disposed) {
      try { player.pause(); } catch { /* A released native player must not affect completion. */ }
    }
  };
  const start = async () => {
    if (phase !== 'loading' || disposed) return;
    phase = 'starting';
    const request = generation;
    try {
      // The first play starts immediately; subsequent plays rewind the same player.
      if (player.currentTime > 0) await player.seekTo(0);
      if (disposed || request !== generation) return;
      if (!isActive()) { stop(); return; }
      phase = 'playing';
      player.play();
      clearDeadline();
      // The bundled clip lasts 2.14s. Never retain playback after a lost end event.
      deadline = setTimeout(stop, 6000);
    } catch (error) {
      if (!disposed && request === generation) stop();
      console.warn('[completion-sound] playback unavailable:', error);
    }
  };
  player.loop = false;
  const subscription = player.addListener('playbackStatusUpdate', (status) => {
    if (disposed) return;
    if (phase === 'playing' && status.didJustFinish) {
      phase = 'idle';
      clearDeadline();
    } else if (phase === 'loading' && status.isLoaded) {
      void start();
    }
  });
  return {
    play(): boolean {
      if (disposed || phase !== 'idle' || !isActive()) return false;
      generation += 1;
      phase = 'loading';
      // Do not surprise the user with a delayed sound if loading fails.
      deadline = setTimeout(stop, 1500);
      try {
        if (player.currentStatus.isLoaded) void start();
      } catch (error) {
        stop();
        console.warn('[completion-sound] player unavailable:', error);
        return false;
      }
      return true;
    },
    stop,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      try { subscription.remove(); } catch { /* Already detached. */ }
      try { player.remove(); } catch { /* Already released. */ }
    },
  };
}
