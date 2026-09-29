type Player = { loop: boolean; volume: number; play(): void; remove(): void };
/** Async mode setup must never resurrect a stale track after None/sign-out. */
export function createBurrowAudioController(
  prepare: () => Promise<void>, create: (key: string) => Player, report: (failed: boolean) => void,
) {
  let generation = 0;
  let player: Player | null = null;
  function stop() {
    generation++;
    try { player?.remove(); } catch { /* Native player already released. */ }
    player = null;
  }
  async function select(key: string | null) {
    stop(); report(false);
    if (!key) return;
    const request = generation;
    try {
      await prepare();
      if (request !== generation) return;
      player = create(key); player.loop = true; player.volume = .35; player.play();
    } catch {
      if (request === generation) { stop(); report(true); }
    }
  }
  return { select, stop };
}
