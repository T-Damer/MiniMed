import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  hasFullTextSibling,
  isFullTextDocumentId,
  orderDocumentSections,
  preferReadableDocuments,
  resolveReadableDocumentId,
  summaryDocumentId,
} from '@/features/library/document-display';

const section = (title: string): MedicalSection => ({
  id: title,
  documentVersionId: 'v1',
  parentSectionId: null,
  title,
  sectionType: null,
  depth: 0,
  orderIndex: 0,
  pageStart: null,
  pageEnd: null,
  anchor: title,
  sectionPath: [title],
  chunks: [
    {
      id: `${title}-chunk`,
      sectionId: title,
      documentVersionId: 'v1',
      orderIndex: 0,
      originalText: 'text',
      pageStart: null,
      pageEnd: null,
      anchor: `${title}-chunk`,
    },
  ],
});

describe('document-display', () => {
  it('uses INN for registry drug titles', () => {
    expect(
      displayDocumentTitle({
        title: 'Цефтриаксон — порошок для инъекций 1 г',
        shortTitle: 'Цефтриаксон 1 г',
        sourceType: 'official_registry_summary',
      }),
    ).toBe('Цефтриаксон');
  });

  it('keeps clinical titles unchanged', () => {
    expect(
      displayDocumentTitle({
        title: 'Внебольничная пневмония у детей',
        shortTitle: 'Пневмония',
        sourceType: 'clinical_recommendation_summary',
      }),
    ).toBe('Пневмония');
  });

  it('moves registry sections to the end', () => {
    const ordered = orderDocumentSections(
      [section('Регистрационная запись'), section('Показания'), section('Ограничения')],
      'official_registry_summary',
    );
    expect(ordered.map((item) => item.title)).toEqual([
      'Показания',
      'Регистрационная запись',
      'Ограничения',
    ]);
  });

  it('exposes registry form as subtitle', () => {
    expect(
      displayDocumentSubtitle({
        title: 'Цефтриаксон — порошок для инъекций 1 г',
        sourceType: 'official_registry_summary',
      }),
    ).toBe('порошок для инъекций 1 г');
  });

  it('prefers installed full-text siblings when opening documents', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia', available)).toBe(
      'kr.rf.714_2.pneumonia.full',
    );
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia.full', available)).toBe(
      'kr.rf.714_2.pneumonia.full',
    );
  });

  it('hides pilot summaries when full-text packs are installed', () => {
    const visible = preferReadableDocuments([
      {
        id: 'kr.rf.714_2.pneumonia',
        title: 'Внебольничная пневмония у детей',
        shortTitle: null,
        sourceType: 'clinical_recommendation_summary',
        status: 'active',
        specialties: [],
        versionId: 'v1',
        versionLabel: '714_2-2025',
        effectiveFrom: null,
      },
      {
        id: 'kr.rf.714_2.pneumonia.full',
        title: 'Внебольничная пневмония у детей',
        shortTitle: null,
        sourceType: 'clinical_recommendation',
        status: 'active',
        specialties: [],
        versionId: 'v2',
        versionLabel: '714_2-2025-full',
        effectiveFrom: null,
      },
    ]);
    expect(visible.map((document) => document.id)).toEqual(['kr.rf.714_2.pneumonia.full']);
  });

  it('detects full-text siblings for summary cards', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(hasFullTextSibling('kr.rf.714_2.pneumonia', available)).toBe(true);
    expect(isFullTextDocumentId('kr.rf.714_2.pneumonia.full')).toBe(true);
    expect(summaryDocumentId('kr.rf.714_2.pneumonia.full')).toBe('kr.rf.714_2.pneumonia');
  });
});
