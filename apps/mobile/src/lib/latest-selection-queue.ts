/** Serialize writes, coalescing intermediate taps. The latest selection is
 * always the last server write, and reset discards callbacks from old owners. */
export function createLatestSelectionQueue<T>(write: (value: T) => Promise<void>, failed: (value: T) => void) {
  let generation = 0, serial = 0;
  let pending: { serial: number; value: T } | null = null;
  let flight: Promise<void> | null = null;
  return {
    isPending: () => !!pending || !!flight,
    select(value: T) {
      pending = { serial: ++serial, value };
      if (flight) return flight;
      const epoch = generation;
      const run = async () => {
        while (pending && epoch === generation) {
          const choice = pending;
          try { await write(choice.value); }
          catch { if (epoch === generation && pending?.serial === choice.serial) failed(choice.value); }
          if (epoch !== generation) return;
          if (pending?.serial === choice.serial) pending = null;
        }
      };
      const task = run().finally(() => { if (flight === task) flight = null; });
      flight = task; return task;
    },
    reset() { generation++; pending = null; flight = null; },
  };
}
