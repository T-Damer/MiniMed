/**
 * Runs tasks one after another. A task starts when every earlier one has settled, whether it
 * succeeded or failed; each caller still gets its own task's result or error.
 */
export interface SerialQueue {
  readonly run: <T>(task: () => Promise<T>) => Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run: <T>(task: () => Promise<T>): Promise<T> => {
      const result = tail.then(task, task);
      // The caller receives `result` and its failure; the chain only has to wait for it to settle.
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
