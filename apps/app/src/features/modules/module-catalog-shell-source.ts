import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  ToolCatalogEntry,
} from '@localmed/contracts';

export const BUNDLED_CORE_MODULE_ID = 'minimed.core.ru';

/** Document sections of the search home whose counters come from the catalog, not from what is installed. */
export type CatalogDocumentSectionId = 'conditions' | 'guidelines' | 'medications' | 'legal';

/**
 * How many entities each document section names, whatever is installed: ICD-10 and disease
 * articles, current clinical recommendations, active substances (МНН), regulatory documents.
 */
export type SectionDocumentCounts = Readonly<Record<CatalogDocumentSectionId, number>>;

/**
 * The part of the release catalog that startup code reads synchronously: the bundled core
 * descriptor, the tool index and the document counts of the home sections. It stays ~150 KB while
 * the full catalog, with exact document membership and terminology, is ~10 MB and is loaded only
 * when module features need it.
 */
export interface ModuleCatalogShell {
  readonly catalogVersion: string;
  readonly publishedAt: string;
  readonly coreModule: ContentModuleCatalogEntry;
  readonly sectionDocumentCounts: SectionDocumentCounts;
  readonly tools: readonly {
    readonly moduleId: string;
    readonly tool: ToolCatalogEntry;
  }[];
}

const INDIVIDUAL_RECOMMENDATION_TAG = 'individual-recommendation';

/** Documents a module lists, from its table or, for a module whose list is not expanded, its preview count. */
export function listedModuleDocumentCount(module: ContentModuleCatalogEntry): number {
  return Math.max(module.previewDocumentCount ?? 0, module.documents.length);
}

function sumDocuments(
  modules: readonly ContentModuleCatalogEntry[],
  matches: (module: ContentModuleCatalogEntry) => boolean,
  count: (module: ContentModuleCatalogEntry) => number = listedModuleDocumentCount,
): number {
  return modules.filter(matches).reduce((total, module) => total + count(module), 0);
}

/**
 * Per-section document counts from the catalog's module membership, so a number does not change
 * when a pack is installed and the home never counts a document twice (pointer and real card).
 * A replaced clinical edition is not a current recommendation; the ЕСКЛП modules hold one document
 * per МНН; ICD-11 and the packaging reference are no part of «МКБ, симптомы и состояния».
 */
export function deriveSectionDocumentCounts(catalog: ContentModuleCatalog): SectionDocumentCounts {
  const { modules } = catalog;
  return {
    conditions: sumDocuments(
      modules,
      (module) => module.kind === 'reference' && module.collection === 'conditions',
    ),
    guidelines: sumDocuments(
      modules,
      (module) => module.kind === 'clinical' && module.tags.includes(INDIVIDUAL_RECOMMENDATION_TAG),
      (module) => module.documents.filter((document) => document.status === 'active').length,
    ),
    medications: sumDocuments(
      modules,
      (module) => module.kind === 'medication' && module.collection === 'esklp',
    ),
    legal: sumDocuments(modules, (module) => module.kind === 'regulatory'),
  };
}

export function deriveModuleCatalogShell(catalog: ContentModuleCatalog): ModuleCatalogShell {
  const coreModule = catalog.modules.find((module) => module.id === BUNDLED_CORE_MODULE_ID);
  if (!coreModule) throw new Error('Release catalog has no bundled core module.');
  return {
    catalogVersion: catalog.catalogVersion,
    publishedAt: catalog.publishedAt,
    coreModule,
    sectionDocumentCounts: deriveSectionDocumentCounts(catalog),
    tools: catalog.modules.flatMap((module) =>
      (module.tools ?? []).map((tool) => ({ moduleId: module.id, tool })),
    ),
  };
}
