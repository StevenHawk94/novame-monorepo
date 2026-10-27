/** Serialize decoding: rapid selections cannot allocate 19 five-layer suites.
 * Only current + one incoming suite are retained. Commit is atomic and the
 * playback clock belongs to the renderer, never to this resource loader. */
export function createLatestOutfitLoader<K, V>(decode: (key: K) => Promise<V>, commit: (key: K, value: V) => void,
  discard: (value: V) => void, failed: (error: unknown) => void) {
  let target: K | undefined, revision = 0, running = false, closed = false;
  async function drain() {
    if (running || closed) return;
    running = true;
    while (!closed && target !== undefined) {
      const key = target, generation = revision;
      target = undefined;
      try {
        const value = await decode(key);
        if (closed || generation !== revision) discard(value);
        else commit(key, value);
      } catch (error) { if (!closed && generation === revision) failed(error); }
    }
    running = false;
  }
  return { request(key: K) { if (closed) return; target = key; revision++; void drain(); },
    close() { closed = true; revision++; target = undefined; } };
}
