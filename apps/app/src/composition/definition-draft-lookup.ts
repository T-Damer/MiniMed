import { createDefinitionLookup, type DefinitionLookup } from '@localmed/core';

let pending: Promise<DefinitionLookup> | undefined;

/** Opt-in DEV preview only; querying never contacts a source website or a model. */
export function loadDefinitionDraftLookup(): Promise<DefinitionLookup> {
  if (!import.meta.env.DEV) {
    return Promise.reject(new Error('Definition drafts are not a published content edition.'));
  }
  if (!pending) {
    pending = Promise.all([
      import('../../../../content/definition-drafts/catalog.json'),
      import('../../../../content/definition-drafts/ruwiktionary-2026.9.16.json'),
    ])
      .then(([editorial, source]) => createDefinitionLookup(editorial.default, source.default))
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
  }
  return pending;
}
