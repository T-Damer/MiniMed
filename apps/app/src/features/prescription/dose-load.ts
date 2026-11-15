import { createDoseIndex, type DoseIndex, trustBundledDoseRuleIndex } from './dose-index';

/**
 * Loader of the dose-rule index. The JSON is its own chunk: it is fetched the first time the
 * prescription tool or a dose question opens and never belongs to the start-up bundle. Built by
 * `scripts/build-dose-rules.ts` from the released instruction modules and the ЕСКЛП cards; a
 * generated file, never edited by hand.
 */
let pending: Promise<DoseIndex> | undefined;

export function loadDoseIndex(): Promise<DoseIndex> {
  pending ??= import('./data/dose-rules-index.json')
    // Checked against the schema by `dose-load.test.ts`, not on every first use (see the trust
    // function's note).
    .then((module) => createDoseIndex(trustBundledDoseRuleIndex(module.default as unknown)))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
