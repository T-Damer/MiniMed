import { createDefinitionLookup, type DefinitionLookup } from '@localmed/core';

let assets: Promise<readonly unknown[]> | undefined;
let pending: Promise<DefinitionLookup> | undefined;
/** Explicit DEV preview; an owner overlay remains in page memory, never uploaded. */
export function loadDefinitionDraftLookup(overlay?: unknown): Promise<DefinitionLookup> {
  if (!import.meta.env.DEV)
    return Promise.reject(new Error('Definition drafts are not a published edition.'));
  assets ??= Promise.all([
    import('../../../../content/definition-drafts/catalog.json'),
    import('../../../../content/definition-drafts/ruwiktionary-2026.9.16.json'),
    import('../../../../content/definition-drafts/prepared-source-excerpts-2026.09.21.json'),
    import('../../../../content/definition-drafts/clinical-source-excerpt-assets'),
  ])
    .then(async ([editorial, russian, prepared, clinical]) => [
      editorial.default,
      russian.default,
      prepared.default,
      ...(await clinical.loadClinicalSourceExcerptAssets()),
    ])
    .catch((error: unknown) => {
      assets = undefined;
      throw error;
    });
  const loaded = assets;
  const build = () =>
    loaded.then(([first, ...rest]) =>
      overlay === undefined
        ? createDefinitionLookup(first, ...rest)
        : createDefinitionLookup(first, ...rest, overlay),
    );
  if (overlay !== undefined) return build();
  pending ??= build().catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
