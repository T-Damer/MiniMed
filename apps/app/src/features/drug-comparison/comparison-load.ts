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
  pending ??= import('./data/comparison-index.json')
    .then((module) => createComparisonIndex(parseComparisonIndex(module.default as unknown)))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
