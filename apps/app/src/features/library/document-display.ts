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

export function displayDocumentTitle(
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType' | 'metadata'>,
): string {
  if (document.sourceType === 'official_registry_summary') {
    const inn = document.title.split('—')[0]?.trim();
    if (inn) return inn;
  }
  const title = document.shortTitle ?? document.title;
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
const MEDICATION_READER_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'allmed_reference',
  'official_drug_instruction',
  'official_registry_summary',
]);

export function visibleReaderSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  const visible = orderDocumentSections(sections, sourceType).filter((section) => {
    if (section.chunks.length === 0) return false;
    return !(
      MEDICATION_READER_SOURCE_TYPES.has(sourceType) &&
      section.title === REDUNDANT_MEDICATION_SECTION_TITLE
    );
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
