import type { SearchFilters, SearchResult, SearchResultGroup } from '@localmed/contracts';
import type { SectionRecord } from '@localmed/domain';
import { normalizeSurfaceText } from '@localmed/search-lexical';
import type { LexicalHit, MedicalStore, SearchDocumentDescriptor } from '@localmed/storage';

import type { QueryDocumentIndex } from './query-document-index';

/**
 * A drug named by its bare name opens with a line that says what the drug is, not with the
 * catalogue's own identity line («Стандартизированное МНН: АМОКСИЦИЛЛИН.»): the pharmacotherapeutic
 * group, the pharmacological action or the indications, quoted from the first source that has one.
 * A core pointer carries no such text, so the passage is read from the product records linked to
 * its substance (`linkedMnnDocumentId`: an installed instruction, an Allmed card). The passage is a
 * source chunk, unchanged; its result keeps the id of the document it comes from.
 */

/** Overview kinds in reading order; the first kind a document has wins. */
const OVERVIEW_TITLES: readonly RegExp[] = [
  // «Фармакотерапевтическая группа», «Фармакологическая группа»
  /фармако(?:терапевтическ|логическ)\p{L}*\s+групп/iu,
  // «Фармакологическое действие», «Фармакологические свойства», «Фармакодинамика»
  /фармакологическ\p{L}*\s+(?:действи|свойств)|фармакодинамик/iu,
  /^показани/iu,
];
const OVERVIEW_TYPES: readonly (string | null)[] = [null, 'pharmacology', 'indications'];

/** True when a result already opens with an overview section (by its title or its type). */
export function isOverviewResult(
  result: Pick<SearchResult, 'sectionPath' | 'sectionType'>,
): boolean {
  return (
    overviewRank({ title: result.sectionPath.at(-1) ?? '', sectionType: result.sectionType }) !==
    undefined
  );
}

const MEDICATION_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'allmed_reference',
  'official_drug_instruction',
  'official_registry_summary',
]);

/** A drug card: a catalogue pointer to a substance, an Allmed card, an instruction, a registry row. */
export function isMedicationDescriptor(
  document: Pick<SearchDocumentDescriptor, 'sourceType' | 'metadata'>,
): boolean {
  return (
    document.metadata['catalogFamily'] === 'medication' ||
    MEDICATION_SOURCE_TYPES.has(document.sourceType)
  );
}

function overviewRank(section: {
  readonly title: string;
  readonly sectionType: string | null;
}): number | undefined {
  const title = normalizeSurfaceText(section.title);
  for (let rank = 0; rank < OVERVIEW_TITLES.length; rank += 1) {
    const type = OVERVIEW_TYPES[rank];
    if (OVERVIEW_TITLES[rank]?.test(title) || (type && section.sectionType === type)) return rank;
  }
  return undefined;
}

/** The document's overview section: the best kind first, then the order of the document. */
export function pickOverviewSection(sections: readonly SectionRecord[]): SectionRecord | undefined {
  let best: { readonly section: SectionRecord; readonly rank: number } | undefined;
  for (const section of sections.toSorted((left, right) => left.orderIndex - right.orderIndex)) {
    const rank = overviewRank(section);
    if (rank !== undefined && (!best || rank < best.rank)) best = { section, rank };
  }
  return best?.section;
}

/** Documents whose passage may stand for a medication group, the group's own document first. */
export function overviewDocumentIds(
  documentId: string,
  index: QueryDocumentIndex,
): readonly string[] {
  const document = index.byId.get(documentId);
  if (!document) return [];
  const target = document.metadata['targetDocumentId'];
  const substance = typeof target === 'string' ? target : documentId;
  // An instruction first (the index orders those), then the record titled like the group itself.
  const title = normalizeSurfaceText(document.title);
  const linked = index.linkedProductIds(substance).filter((id) => id !== documentId);
  const sameTitle = (id: string): boolean =>
    normalizeSurfaceText(index.byId.get(id)?.title ?? '') === title;
  return [
    documentId,
    ...linked.filter((id) => index.byId.get(id)?.sourceType === 'official_drug_instruction'),
    ...linked.filter(
      (id) => index.byId.get(id)?.sourceType !== 'official_drug_instruction' && sameTitle(id),
    ),
    ...linked.filter(
      (id) => index.byId.get(id)?.sourceType !== 'official_drug_instruction' && !sameTitle(id),
    ),
  ];
}

/**
 * The first readable chunk of the best overview section among `documentIds`, or null. A document
 * outside the request's filters is skipped, as for any exact identity.
 */
export async function readOverviewHit(
  store: MedicalStore,
  documentIds: readonly string[],
  filters: SearchFilters,
): Promise<LexicalHit | null> {
  for (const documentId of documentIds) {
    if (filters.documentIds?.length && !filters.documentIds.includes(documentId)) continue;
    const document = await store.getDocument(documentId);
    if (!document) continue;
    const section = pickOverviewSection(await store.getSectionsByDocument(documentId));
    if (!section) continue;
    const chunk = (await store.getChunksBySection(section.id)).find(
      (candidate) => candidate.originalText.trim().length > 0,
    );
    if (chunk) return { chunk, section, document, rank: 1 };
  }
  return null;
}

/** The group with `overview` first; a result of the group that is the same chunk moves, not repeats. */
export function withOverviewFirst(
  group: SearchResultGroup,
  overview: SearchResult,
): SearchResultGroup {
  return {
    ...group,
    results: [overview, ...group.results.filter((result) => result.chunkId !== overview.chunkId)],
  };
}
