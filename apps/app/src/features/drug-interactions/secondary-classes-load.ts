import { parseSecondaryClassAsset, type SecondaryClassCatalog } from './secondary-classes';

/**
 * Loader of the secondary-classes file (CLS2). The JSON is its own chunk of a few kB, fetched the
 * first time a drug screen asks for it; the 2.1 MB interaction index is not touched. Built by
 * `scripts/build-drug-interactions.ts` together with the index; a generated file, never edited by
 * hand.
 */
let pending: Promise<SecondaryClassCatalog> | undefined;

export function loadSecondaryClasses(): Promise<SecondaryClassCatalog> {
  pending ??= import('./data/secondary-classes.json')
    .then((module) => parseSecondaryClassAsset(module.default as unknown))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
