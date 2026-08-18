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

import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeReaderLabel as localizedSourceTypeReaderLabel } from '@/i18n/labels';

const REGISTRY_SECTION_PATTERN = /регистрационн|ограничен/i;

export type DocumentSectionHeadingTag = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface DocumentSectionTree {
  readonly section: MedicalSection;
  readonly children: readonly DocumentSectionTree[];
}

type MutableDocumentSectionTree = {
  readonly section: MedicalSection;
  readonly children: DocumentSectionTree[];
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
  document: Pick<MedicalDocumentSummary, 'title' | 'shortTitle' | 'sourceType'>,
): string {
  if (document.sourceType === 'official_registry_summary') {
    const inn = document.title.split('—')[0]?.trim();
    if (inn) return inn;
  }
  return document.shortTitle ?? document.title;
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
): readonly DocumentSectionTree[] {
  const roots: DocumentSectionTree[] = [];
  const stack: Array<{ depth: number; node: MutableDocumentSectionTree }> = [];

  for (const section of sections) {
    const node: MutableDocumentSectionTree = {
      section,
      children: [],
    };
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

export function orderDocumentSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  if (sourceType !== 'official_registry_summary') return sections;
  const primary = sections.filter((section) => !REGISTRY_SECTION_PATTERN.test(section.title));
  const administrative = sections.filter((section) => REGISTRY_SECTION_PATTERN.test(section.title));
  return [...primary, ...administrative];
}

const REDUNDANT_MEDICATION_SECTION_TITLE = 'Карточка препарата';
const MEDICATION_READER_SOURCE_TYPES = new Set([
  'allmed_reference',
  'official_drug_instruction',
  'official_registry_summary',
]);

export function visibleReaderSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  return orderDocumentSections(sections, sourceType).filter((section) => {
    if (section.chunks.length === 0) return false;
    return !(
      MEDICATION_READER_SOURCE_TYPES.has(sourceType) &&
      section.title === REDUNDANT_MEDICATION_SECTION_TITLE
    );
  });
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
