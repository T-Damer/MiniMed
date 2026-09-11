import type {
  ContentModuleCatalog,
  ContentModuleCatalogEntry,
  MedicalDocumentSummary,
} from '@localmed/contracts';
import { CALCULATOR_REGISTRY } from '@/features/calculators/calculator-registry';
import { medicationDocumentGroups } from '@/features/medications/medicationGroups';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import {
  parseModulePointerMetadata,
  selectModuleForPointer,
} from '@/features/modules/module-pointer-install';
import {
  documentMatchesConditionGroup,
  documentMatchesSearchScope,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import {
  CONDITION_GROUPS,
  SEARCH_SECTIONS,
  type SearchCatalogTool,
  unifiedSearchSpecialty,
} from '@/features/search/searchCatalog';

export interface SearchDownloadBlock {
  readonly modules: readonly ContentModuleCatalogEntry[];
  readonly local: boolean;
  readonly unavailable: boolean;
}
export const EMPTY_SEARCH_DOWNLOAD_BLOCK: SearchDownloadBlock = {
  modules: [],
  local: false,
  unavailable: false,
};

/** Use document membership and declared tool ids, never a module's title or broad specialty tag. */
export function searchSectionDownloadBlocks(
  documents: readonly MedicalDocumentSummary[],
  tools: readonly SearchCatalogTool[],
  catalog: ContentModuleCatalog,
): ReadonlyMap<string, SearchDownloadBlock> {
  const byDocument = new Map<string, ContentModuleCatalogEntry[]>();
  const byTool = new Map<string, ContentModuleCatalogEntry[]>();
  for (const module of catalog.modules) {
    for (const document of module.documents) {
      if (
        !module.artifacts.some(
          (artifact) =>
            artifact.id === document.indexArtifactId &&
            artifact.kind === 'index' &&
            artifact.required &&
            artifact.url &&
            artifact.sha256,
        )
      )
        continue;
      const matches = byDocument.get(document.documentId) ?? [];
      matches.push(module);
      byDocument.set(document.documentId, matches);
    }
    for (const tool of module.tools ?? []) {
      const key = `${tool.kind}/${tool.id}`;
      const matches = byTool.get(key) ?? [];
      matches.push(module);
      byTool.set(key, matches);
    }
  }
  const blocks = new Map<
    string,
    { modules: Map<string, ContentModuleCatalogEntry>; local: boolean; unavailable: boolean }
  >();
  const add = (
    scope: SearchScope,
    groups: readonly string[],
    module: ContentModuleCatalogEntry | undefined,
    local: boolean,
  ): void => {
    for (const group of new Set(['', ...groups])) {
      const key = `${scope}/${group}`;
      const block = blocks.get(key) ?? { modules: new Map(), local: false, unavailable: false };
      if (module) block.modules.set(module.id, module);
      block.local ||= local;
      block.unavailable ||= !module && !local;
      blocks.set(key, block);
    }
  };
  // The fresh core need not already contain pointers for every downloadable medication pack.
  for (const module of catalog.modules) {
    if (module.kind !== 'medication' || !isModuleReleased(module)) continue;
    add('medications', [`module:${module.id}`], module, false);
    add('all', [], module, false);
  }
  for (const document of documents) {
    const pointer = parseModulePointerMetadata(document.metadata);
    const isPointer =
      document.sourceType === 'core_catalog_pointer' ||
      document.metadata?.['contentMode'] === 'module-pointer';
    const candidates = byDocument.get(pointer?.targetDocumentId ?? document.id) ?? [];
    const module = pointer
      ? (selectModuleForPointer(pointer, { ...catalog, modules: candidates }) ?? undefined)
      : isPointer
        ? undefined
        : candidates.find(isModuleReleased);
    const local = !isPointer && !module;
    for (const section of SEARCH_SECTIONS) {
      if (
        section.id === 'diagnosis' ||
        section.id === 'assessments' ||
        section.id === 'calculators' ||
        !documentMatchesSearchScope(document, section.id)
      )
        continue;
      const groups =
        section.id === 'medications'
          ? medicationDocumentGroups(document)
          : section.id === 'conditions'
            ? CONDITION_GROUPS.filter((group) =>
                documentMatchesConditionGroup(document, group.id),
              ).map((group) => group.id)
            : section.id === 'all'
              ? document.specialties.map(unifiedSearchSpecialty)
              : document.specialties;
      add(section.id, groups, module, local);
    }
  }
  for (const tool of tools) {
    const candidates =
      byTool.get(`${tool.scope === 'assessments' ? 'assessment' : 'calculator'}/${tool.id}`) ?? [];
    const module = candidates.find(isModuleReleased);
    const local =
      tool.scope === 'calculators' && CALCULATOR_REGISTRY.some((entry) => entry.id === tool.id);
    add(tool.scope, [tool.group], module, local);
    add('all', [unifiedSearchSpecialty(tool.group)], module, local);
  }
  return new Map(
    [...blocks].map(([key, block]) => [key, { ...block, modules: [...block.modules.values()] }]),
  );
}
