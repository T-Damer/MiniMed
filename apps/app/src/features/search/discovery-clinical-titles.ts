import type { ContentModuleCatalog, MedicalDocumentSummary } from '@localmed/contracts';
import { searchSubjectText } from '@localmed/search-lexical';

import { readInstalledModuleDocument } from '@/composition/create-browser-core';
import { prioritizeInstalledModuleRead } from '@/features/modules/browser-module-runtime';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';

const AUDIENCE_SUFFIX = / у (детей|взрослых)$/u;
const CLINICAL_TITLE_LIMIT = 4;

export function clinicalTitleCandidates(catalog: ContentModuleCatalog, query: string) {
  const fullTitle = searchSubjectText(query);
  const suffix = fullTitle.match(AUDIENCE_SUFFIX)?.[1];
  const subject = fullTitle.replace(AUDIENCE_SUFFIX, '');
  const audience = suffix === 'детей' ? 'дети' : 'взрослые';
  return catalog.modules
    .flatMap((module) => {
      if (module.kind !== 'clinical') return [];
      const title = searchSubjectText(module.title);
      if (title !== fullTitle && title !== subject) return [];
      if (
        title !== fullTitle &&
        module.populations.length > 0 &&
        !module.populations.some((population) => population.toLowerCase() === audience)
      ) {
        return [];
      }
      return module.documents
        .filter((document) => document.status === 'active')
        .map((document) => ({ module, id: document.documentId, exact: title === fullTitle }));
    })
    .toSorted((left, right) => Number(right.exact) - Number(left.exact))
    .slice(0, CLINICAL_TITLE_LIMIT);
}

/** Read only the verified headers of clinical recommendations whose titles name the query. */
export async function readDiscoveryClinicalTitles(
  query: string,
  isCurrent: () => boolean,
): Promise<readonly MedicalDocumentSummary[]> {
  const catalog = await loadModuleCatalog();
  if (!isCurrent()) return [];
  const candidates = clinicalTitleCandidates(catalog, query);
  if (candidates.length === 0) return [];
  return prioritizeInstalledModuleRead(async () => {
    const results = await Promise.all(
      candidates.map(async ({ module, id }) => {
        try {
          return await readInstalledModuleDocument(module, id, true);
        } catch (cause) {
          console.warn('An installed clinical title could not be opened early.', cause);
          return undefined;
        }
      }),
    );
    return [
      ...new Map(results.flatMap((result) => (result ? [[result.id, result]] : []))).values(),
    ];
  });
}
