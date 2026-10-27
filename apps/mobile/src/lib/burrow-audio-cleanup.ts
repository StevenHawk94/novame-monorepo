/** Do not let a failed native call or listener removal leave looping audio alive. */
export function releaseBurrowAudio(player: { pause(): void; volume: number; remove(): void; release(): void },
  unsubscribe: () => void) {
  try { player.pause(); } catch {}
  try { player.volume = 0; } catch {}
  try { unsubscribe(); } catch {}
  try { player.remove(); } catch {}
  // createAudioPlayer is manually owned (unlike useAudioPlayer). Release its
  // shared object now, rather than waiting for JavaScript garbage collection.
  try { player.release(); } catch {}
}
