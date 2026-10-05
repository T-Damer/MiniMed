import {
  parseSubstanceFallbackAsset,
  type SubstanceFallbackAsset,
} from '@/features/medications/instruction-fallback';

/**
 * Loader of the same-substance fallback asset (ADR-0023). The JSON is its own chunk: it is fetched
 * the first time a medication screen asks for it and never belongs to the start-up bundle. Built by
 * `tools/ingest/scripts/build_substance_fallback.py` from the released ЕСКЛП cards and instruction
 * modules; it is a generated file and is never edited by hand.
 */
let pending: Promise<SubstanceFallbackAsset> | undefined;

export function loadSubstanceFallback(): Promise<SubstanceFallbackAsset> {
  pending ??= import('@/features/medications/substance-fallback.json')
    .then((module) => parseSubstanceFallbackAsset(module.default))
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
