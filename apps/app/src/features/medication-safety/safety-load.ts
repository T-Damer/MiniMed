import { createSafetyIndex, parseSafetyIndex, type SafetyIndex } from './safety-index';

/**
 * Loader of the pregnancy / lactation / age-limit index. The JSON is its own chunk: it is fetched
 * the first time a search asks a question the card answers and never belongs to the start-up
 * bundle. Built by `scripts/build-medication-safety.ts` from the released instruction modules; a
 * generated file, never edited by hand.
 */
let pending: Promise<SafetyIndex> | undefined;

export function loadSafetyIndex(): Promise<SafetyIndex> {
  pending ??= import('./data/safety-index.json')
    .then((module) => createSafetyIndex(parseSafetyIndex(module.default as unknown)))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
