/**
 * Roadmap item 23 (SRCH3, owner request 13): a search inside one section that finds nothing is
 * repeated over all sources, and the hits are shown grouped by the section they belong to:
 * «Поиск по запросу «…» не дал результатов в разделе «…»», then «Результаты раздела «…»:» before
 * each group.
 *
 * Decisions, per mode:
 *  - Lookup sections (КР, препараты, нормативные документы, МКБ, МКБ-11) and a group of «Все
 *    источники» (e.g. «Педиатрия»): the fallback applies. The retry is the «Все источники» search
 *    as the core runs it (lexical, lookup), so the typo and layout corrections of the core apply to
 *    it exactly as they do in «Все».
 *  - «Клинический разбор» never falls back: it already searches every source except ICD-11, so a
 *    miss there is not a section miss and a widened search would add nothing but a wrong label.
 *  - Calculators and questionnaires are tool lists (no text search), personal notes are searched
 *    outside the core: no fallback.
 *  - A scoped search that found anything (a group, an identity hit, a named source) is never
 *    widened and its ranking is never touched.
 */
import type {
  MedicalCore,
  SearchDocumentDescriptor,
  SearchRequest,
  SearchResponse,
  SearchResultGroup,
} from '@localmed/contracts';
import { documentMatchesSearchScope, type SearchScope } from '@/features/search/ScopedMedicalCore';

/** The sections whose own text search can come up empty. */
const SEARCHED_SECTIONS: ReadonlySet<SearchScope> = new Set([
  'guidelines',
  'medications',
  'legal',
  'conditions',
  'icd11',
]);

/**
 * Which section a hit belongs to when several accept its document: the narrower one first (a МКБ
 * card is in «МКБ, симптомы и состояния» and also in «Клинические рекомендации»).
 */
const SECTION_PRIORITY: readonly SearchScope[] = [
  'icd11',
  'medications',
  'legal',
  'calculators',
  'assessments',
  'conditions',
  'guidelines',
];

/** Label of the hits that belong to no section. */
export const OTHER_SOURCES_LABEL = 'Другие источники';

export interface ScopeFallbackSection {
  /** The section a tap on the heading opens; undefined for the group of unplaced hits. */
  readonly scope: SearchScope | undefined;
  readonly label: string;
  readonly groups: readonly SearchResultGroup[];
}

export interface ScopeFallbackResult {
  /** The query that was searched, as the field holds it. */
  readonly query: string;
  /** The section or group the doctor had picked, which found nothing. */
  readonly missedLabel: string;
  readonly sections: readonly ScopeFallbackSection[];
  /** The all-sources response: its spelling correction is the one the search box shows. */
  readonly response: SearchResponse;
}

/** A fallback kept with the section and group it answers, so another selection never shows it. */
export interface StoredScopeFallback extends ScopeFallbackResult {
  readonly scope: SearchScope;
  readonly specialty: string | undefined;
}

/** True when a search in this selection may be repeated over all sources. */
export function scopeFallbackEnabled(input: {
  readonly scope: SearchScope;
  /** A group (specialty, pharmacological group) of the section is picked. */
  readonly grouped: boolean;
  /** The section lists tools without a text search. */
  readonly catalogOnly: boolean;
}): boolean {
  if (input.catalogOnly) return false;
  if (input.scope === 'all') return input.grouped;
  return SEARCHED_SECTIONS.has(input.scope);
}

/** True when the response found nothing at all: no group, no identity hit, no named source. */
export function scopedSearchFoundNothing(response: SearchResponse): boolean {
  return response.groups.length === 0 && !response.identities?.length && !response.sourceScope;
}

export function sectionOfDocument(
  document: Pick<SearchDocumentDescriptor, 'sourceType' | 'metadata'>,
): SearchScope | undefined {
  return SECTION_PRIORITY.find((scope) => documentMatchesSearchScope(document, scope));
}

/**
 * Groups the hits by section. Sections follow the position of their best hit, and a section keeps
 * its hits in the order the search ranked them.
 */
export function groupHitsBySection(
  groups: readonly SearchResultGroup[],
  documents: ReadonlyMap<string, Pick<SearchDocumentDescriptor, 'sourceType' | 'metadata'>>,
  labelOf: (scope: SearchScope) => string,
): readonly ScopeFallbackSection[] {
  const order: (SearchScope | undefined)[] = [];
  const bySection = new Map<SearchScope | undefined, SearchResultGroup[]>();
  for (const group of groups) {
    const document = documents.get(group.documentId);
    const scope = document ? sectionOfDocument(document) : undefined;
    let list = bySection.get(scope);
    if (!list) {
      list = [];
      bySection.set(scope, list);
      order.push(scope);
    }
    list.push(group);
  }
  return order.map((scope) => ({
    scope,
    label: scope === undefined ? OTHER_SOURCES_LABEL : labelOf(scope),
    groups: bySection.get(scope) ?? [],
  }));
}

/** «Поиск по запросу «…» не дал результатов в разделе «…»». */
export function scopeMissLine(query: string, label: string): string {
  return `Поиск по запросу «${query}» не дал результатов в разделе «${label}»`;
}

/** «Результаты раздела «…»:». */
export function scopeResultsHeading(label: string): string {
  return `Результаты раздела «${label}»:`;
}

/**
 * Repeats `request` over all sources with `allSourcesCore` (a `ScopedMedicalCore` of «Все
 * источники») and groups the hits by section. Undefined when the all-sources search fails or finds
 * nothing either.
 */
export async function searchOtherSections(input: {
  readonly allSourcesCore: MedicalCore;
  readonly request: SearchRequest;
  readonly missedLabel: string;
  readonly labelOf: (scope: SearchScope) => string;
}): Promise<ScopeFallbackResult | undefined> {
  const { allSourcesCore, request } = input;
  const [found, documents] = await Promise.all([
    allSourcesCore.search(request),
    allSourcesCore.listSearchDocuments?.() ?? allSourcesCore.listDocuments(),
  ]);
  if (!found.ok || !documents.ok || found.value.groups.length === 0) return undefined;
  const sections = groupHitsBySection(
    found.value.groups,
    new Map(documents.value.map((document) => [document.id, document])),
    input.labelOf,
  );
  return {
    query: request.query,
    missedLabel: input.missedLabel,
    sections,
    response: found.value,
  };
}
