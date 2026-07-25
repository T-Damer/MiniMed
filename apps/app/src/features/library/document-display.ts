import type { MedicalDocumentSummary, MedicalSection } from '@localmed/contracts';
import {
  fullDocumentCandidateId,
  hasFullTextSibling,
  isSupersededSummaryDocument,
  resolveReadableDocumentId,
  summaryDocumentId,
} from '@localmed/core';

import { browserI18n } from '@/i18n/browser-i18n';
import { sourceTypeReaderLabel as localizedSourceTypeReaderLabel } from '@/i18n/labels';

const REGISTRY_SECTION_PATTERN = /регистрационн|ограничен/i;

export {
  fullDocumentCandidateId,
  hasFullTextSibling,
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

export function orderDocumentSections(
  sections: readonly MedicalSection[],
  sourceType: string,
): readonly MedicalSection[] {
  if (sourceType !== 'official_registry_summary') return sections;
  const primary = sections.filter((section) => !REGISTRY_SECTION_PATTERN.test(section.title));
  const administrative = sections.filter((section) => REGISTRY_SECTION_PATTERN.test(section.title));
  return [...primary, ...administrative];
}

export function isFullTextDocumentId(documentId: string): boolean {
  return documentId.endsWith('.full');
}

export function preferReadableDocuments(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicalDocumentSummary[] {
  const availableIds = new Set(documents.map((document) => document.id));
  const hiddenSummaryIds = new Set(
    documents
      .filter((document) => document.id.endsWith('.full'))
      .map((document) => document.id.replace(/\.full$/, ''))
      .filter((summaryId) => availableIds.has(summaryId)),
  );
  return documents.filter((document) => !hiddenSummaryIds.has(document.id));
}
