/** Bound UI waits without cancelling durable server work/background downloads. */
export function withDeadline<T>(work: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Operation timed out')), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Invalidates late callbacks when an operation is replaced or its screen exits. */
export function createOperationScope() {
  let revision = 0;
  return {
    begin() { const own = ++revision; return () => own === revision; },
    invalidate() { revision += 1; },
  };
}
