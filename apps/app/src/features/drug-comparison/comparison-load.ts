import {
  type ComparisonIndex,
  createComparisonIndex,
  parseComparisonIndex,
} from './comparison-index';

/**
 * Loader of the drug-comparison index. The JSON is its own chunk: it is fetched the first time the
 * comparison tool opens and never belongs to the start-up bundle. Built by
 * `scripts/build-drug-comparison.ts` from the released instruction modules, the ЕСКЛП cards and the
 * ГРЛС register; a generated file, never edited by hand.
 */
let pending: Promise<ComparisonIndex> | undefined;

export function loadComparisonIndex(): Promise<ComparisonIndex> {
  // Three tasks, not one: the 2.4 MB chunk is evaluated, then checked, then indexed, and a tap gets
  // the thread between them (together they were a 1.2 s frame on a phone, inside the first search).
  pending ??= import('./data/comparison-index.json')
    .then(inNextTask)
    .then((module) => parseComparisonIndex(module.default as unknown))
    .then(inNextTask)
    .then(createComparisonIndex)
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  // Each caller continues in a task of its own: several screens wait for the index, and what they
  // build from it ran back to back in the task that parsed it (a 1.3 s step on a phone).
  return pending.then(inNextTask);
}

function inNextTask<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 0);
  });
}
