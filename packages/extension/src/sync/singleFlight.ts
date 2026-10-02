// One run at a time. Calls made while a run is going share a single next run with their options merged, so each caller
// waits for a run that started after it asked.
export function singleFlight<T>(
  run: (options: T) => Promise<void>,
  merge: (a: T, b: T) => T,
): (options: T) => Promise<void> {
  let running: Promise<void> | undefined;
  let queued: { options: T; done: Promise<void> } | undefined;

  const start = (options: T): Promise<void> => {
    const current: Promise<void> = run(options).finally(() => {
      if (running === current) running = undefined;
    });
    running = current;
    return current;
  };

  return (options) => {
    if (queued) {
      queued.options = merge(queued.options, options);
      return queued.done;
    }
    if (!running) return start(options);
    const next: { options: T; done: Promise<void> } = {
      options,
      done: running
        .catch(() => undefined)
        .then(() => {
          queued = undefined;
          return start(next.options);
        }),
    };
    queued = next;
    return next.done;
  };
}
