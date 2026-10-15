import type { MedicalDocumentSummary, MedicalSection } from '@localmed/contracts';
import {
  fullDocumentCandidateId,
  fullDocumentCandidateIds,
  hasFullTextSibling,
  isSameDocumentFamily,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
  summaryDocumentId,
} from '@localmed/core';

import {
  isClinicalRecommendationSource,
  promoteNumberedHeadingSections,
} from '@/features/library/numbered-heading-sections';
import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeReaderLabel as localizedSourceTypeReaderLabel } from '@/i18n/labels';

const REGISTRY_SECTION_PATTERN = /регистрационн|ограничен/i;

export type DocumentSectionHeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface DocumentSectionTree {
  readonly section: MedicalSection;
  readonly children: readonly DocumentSectionTree[];
}

export type MutableDocumentSectionTree = {
  readonly section: MedicalSection;
  children: DocumentSectionTree[];
};

export {
  fullDocumentCandidateId,
  fullDocumentCandidateIds,
  hasFullTextSibling,
  isSameDocumentFamily,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
  summaryDocumentId,
};

const CYRILLIC = /[А-Яа-яЁё]/u;

/**
 * The short title a document is shown under. A reference monograph of a drug (Allmed) keeps its
 * Latin name in the short title («Theraflu») beside the Russian trade name in the title
 * («Терафлю»); the Russian name is what the search result was called, so it is what opens.
 */
function readableShortTitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType'>,
): string | undefined {
  const short = document.shortTitle ?? undefined;
  if (
    short !== undefined &&
    document.sourceType === 'allmed_reference' &&
    !CYRILLIC.test(short) &&
    CYRILLIC.test(document.title)
  ) {
    return undefined;
  }
  return short;
}

export function displayDocumentTitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType' | 'metadata'>,
): string {
  if (document.sourceType === 'official_registry_summary') {
    const inn = document.title.split('—')[0]?.trim();
    if (inn) return inn;
  }
  const title = readableShortTitle(document) ?? document.title;
  const metadata = document.metadata;
  const code = metadata?.['mkbCode'];
  const path = metadata?.['classificationPath'];
  const parent: unknown = Array.isArray(path) ? path[0] : undefined;
  if (
    (document.sourceType === 'rls_mkb_reference' ||
      metadata?.['sourceType'] === 'rls_mkb_reference') &&
    typeof code === 'string' &&
    code.includes('.') &&
    parent &&
    typeof parent === 'object' &&
    'title' in parent &&
    typeof parent.title === 'string' &&
    parent.title.trim()
  ) {
    const prefix = `${code} `;
    const subject = title.startsWith(prefix) ? title.slice(prefix.length) : title;
    return `${prefix}${parent.title.trim()} — ${subject}`;
  }
  return title;
}

/**
 * A list with no query opens on names a doctor knows: titles that begin with a letter come first,
 * those that begin with a digit, bracket or sign (chemical names like «1-(4-БРОМФЕНИЛ)…») follow,
 * each group in the order the catalog gave.
 */
export function wordTitlesFirst(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const startsWithLetter = (document: MedicalDocumentSummary): boolean =>
    /^\p{L}/u.test(displayDocumentTitle(document).trim());
  const words = documents.filter(startsWithLetter);
  return words.length === 0 || words.length === documents.length
    ? documents
    : [...words, ...documents.filter((document) => !startsWithLetter(document))];
}

export function displayDocumentSubtitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'sourceType'>,
): string | null {
  if (document.sourceType === 'official_registry_summary') {
    const form = document.title.split('—').slice(1).join('—').trim();
    return form.length > 0 ? form : browserI18n.getMessage('source_registry_reader_subtitle');
  }
  return null;
}

export function sourceTypeReaderLabel(sourceType: string): string | null {
  return localizedSourceTypeReaderLabel(sourceType);
}

export function documentSectionHeadingTag(
  depth: number,
  documentTitleLevel: 1 | 2 = 1,
): DocumentSectionHeadingTag {
  const level = Math.min(6, Math.max(2, depth + documentTitleLevel));
  switch (level) {
    case 2:
      return 'h2';
    case 3:
      return 'h3';
    case 4:
      return 'h4';
    case 5:
      return 'h5';
    default:
      return 'h6';
  }
}

export function nestDocumentSections(
  sections: readonly MedicalSection[],
  nodeCache?: Map<MedicalSection, MutableDocumentSectionTree>,
): readonly DocumentSectionTree[] {
  const roots: DocumentSectionTree[] = [];
  const stack: Array<{ depth: number; node: MutableDocumentSectionTree }> = [];

  const resolveNode = (section: MedicalSection): MutableDocumentSectionTree => {
    if (!nodeCache) return { section, children: [] };
    let node = nodeCache.get(section);
    if (!node) {
      node = { section, children: [] };
      nodeCache.set(section, node);
    }
    node.children = [];
    return node;
  };

  for (const section of sections) {
    const node = resolveNode(section);
    let parent = stack.at(-1);
    while (parent && parent.depth >= section.depth) {
      stack.pop();
      parent = stack.at(-1);
    }
    if (parent) {
      parent.node.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ depth: section.depth, node });
  }

  return roots;
}

/**
 * Registration details (number, holder, restrictions of a registry card) matter for audit, not for
 * treatment: medication readers show them last, in small print. The data marks them with the
 * `registration` section type; registry cards without that type are recognised by their headings.
 */
export function isAdministrativeMedicationSection(
  section: Pick<MedicalSection, 'title' | 'sectionType'>,
  sourceType: string,
): boolean {
  if (!MEDICATION_READER_SOURCE_TYPES.has(sourceType)) return false;
  if (section.sectionType === 'registration') return true;
  return sourceType === 'official_registry_summary' && REGISTRY_SECTION_PATTERN.test(section.title);
}

/**
 * Sections a catalog card carries about itself (names, codes, identifiers, where the full text
 * lives). Readers keep them after the document's own text in small print; search shows their
 * fragments after the document's own ones.
 */
export const TECHNICAL_SECTION_TITLES: ReadonlySet<string> = new Set([
  'Сведения о документе',
  'Сведения МКБ-10',
  'Классификационный контекст',
  'Ограничение покрытия',
]);

/**
 * Sections whose catalogue wording is cleaned (storage note, empty fields, identifiers) but which
 * stay in place: a drug pointer's «Указатель препарата» carries the drug's МНН, its most useful line.
 */
export const CLEANED_SECTION_TITLES: ReadonlySet<string> = new Set([
  ...TECHNICAL_SECTION_TITLES,
  'Указатель препарата',
]);

export function isTechnicalSection(section: Pick<MedicalSection, 'title'>): boolean {
  return TECHNICAL_SECTION_TITLES.has(section.title.trim());
}

/** Registration details of a medication or a card's technical section: last and in small print. */
export function isAdministrativeSection(
  section: Pick<MedicalSection, 'title' | 'sectionType'>,
  sourceType: string,
): boolean {
  return isAdministrativeMedicationSection(section, sourceType) || isTechnicalSection(section);
}

export function orderDocumentSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  const primary = sections.filter((section) => !isAdministrativeSection(section, sourceType));
  // A card made only of technical sections keeps its order: there is nothing to put first.
  if (primary.length === sections.length || primary.length === 0) return sections;
  const administrative = sections.filter((section) => isAdministrativeSection(section, sourceType));
  return [...primary, ...administrative];
}

const REDUNDANT_MEDICATION_SECTION_TITLE = 'Карточка препарата';
/** A statement about what the app's index lacks; it tells a doctor nothing about the code or drug. */
const COVERAGE_NOTE_SECTION_TITLE = 'Ограничение покрытия';
const MEDICATION_READER_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'allmed_reference',
  'official_drug_instruction',
  'official_registry_summary',
]);

/** A glossary the recommendation template puts first; it is reference, not the start of the text. */
const GLOSSARY_SECTION_TITLE = /^список сокращений\.?$/iu;

/**
 * The reader opens on the text itself: the abbreviation list that clinical recommendations carry
 * before their first chapter moves, with its subsections, behind the chapters.
 */
export function glossaryLast(sections: readonly MedicalSection[]): readonly MedicalSection[] {
  if (sections.length === 0) return sections;
  const rootDepth = Math.min(...sections.map((section) => section.depth));
  const blocks: MedicalSection[][] = [];
  for (const section of sections) {
    if (section.depth <= rootDepth || blocks.length === 0) blocks.push([section]);
    else blocks.at(-1)?.push(section);
  }
  const isGlossary = (block: readonly MedicalSection[]): boolean =>
    GLOSSARY_SECTION_TITLE.test(block[0]?.title.trim() ?? '');
  return blocks.some(isGlossary) ? reordered(blocks, isGlossary) : sections;
}

function reordered(
  blocks: readonly (readonly MedicalSection[])[],
  isGlossary: (block: readonly MedicalSection[]) => boolean,
): readonly MedicalSection[] {
  return [
    ...blocks.filter((block) => !isGlossary(block)).flat(),
    ...blocks.filter(isGlossary).flat(),
  ];
}

export function visibleReaderSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  const ordered = (
    isClinicalRecommendationSource(sourceType)
      ? glossaryLast(orderDocumentSections(sections, sourceType))
      : orderDocumentSections(sections, sourceType)
  ).filter(
    (section) =>
      section.title.trim() !== COVERAGE_NOTE_SECTION_TITLE &&
      !(
        MEDICATION_READER_SOURCE_TYPES.has(sourceType) &&
        section.title === REDUNDANT_MEDICATION_SECTION_TITLE
      ),
  );
  // A section without text of its own stays when it heads deeper sections that have text: a chapter
  // («3. Лечение») is the parent of its subsections. Dropped, its children nested under whatever
  // section came before it and the chapter vanished from the page and the contents.
  const visible = ordered.filter((section, index) => {
    if (section.chunks.length > 0) return true;
    for (const next of ordered.slice(index + 1)) {
      if (next.depth <= section.depth) return false;
      if (next.chunks.length > 0) return true;
    }
    return false;
  });
  // Sub-headings the source kept as numbered paragraphs become sections of the reader. After the
  // filter above: a section left without its own text still shows its title.
  return isClinicalRecommendationSource(sourceType)
    ? promoteNumberedHeadingSections(visible)
    : visible;
}

export function isFullTextDocumentId(documentId: string): boolean {
  return documentId.endsWith('.full');
}

export function preferReadableDocuments(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const availableIds = new Set(documents.map((document) => document.id));
  return documents.filter((document) => !isSupersededSummaryDocument(document.id, availableIds));
}
