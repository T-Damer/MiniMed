import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  hasFullTextSibling,
  isFullTextDocumentId,
  nestDocumentSections,
  orderDocumentSections,
  preferReadableDocuments,
  resolveReadableDocumentId,
  summaryDocumentId,
  visibleReaderSections,
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
  it('preserves Markdown section depth in rendered heading levels', () => {
    expect([1, 2, 3, 4, 5, 6].map((depth) => documentSectionHeadingTag(depth))).toEqual([
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'h6',
    ]);
    expect(documentSectionHeadingTag(1, 2)).toBe('h3');
  });

  it('nests sections so parent sticky headings contain their children', () => {
    const sections = [1, 2, 3, 2, 1].map((depth, index) => ({
      ...section(`section-${index}`),
      depth,
    }));
    const tree = nestDocumentSections(sections);
    expect(tree.map((node) => node.section.title)).toEqual(['section-0', 'section-4']);
    expect(tree[0]?.children.map((node) => node.section.title)).toEqual(['section-1', 'section-3']);
    expect(tree[0]?.children[0]?.children.map((node) => node.section.title)).toEqual(['section-2']);
  });

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

  it('drops empty sections and the redundant Allmed medication card section', () => {
    const emptySection = { ...section('Пустой'), chunks: [] };
    const visible = visibleReaderSections(
      [section('Карточка препарата'), emptySection, section('Показания')],
      'allmed_reference',
    );
    expect(visible.map((item) => item.title)).toEqual(['Показания']);
  });

  it('keeps a Карточка препарата heading on non-medication documents', () => {
    const visible = visibleReaderSections(
      [section('Карточка препарата'), section('Показания')],
      'clinical_recommendation',
    );
    expect(visible.map((item) => item.title)).toEqual(['Карточка препарата', 'Показания']);
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

  it('prefers installed structured recommendations over starter summaries', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2']);
    expect(resolveReadableDocumentId('kr.rf.714_2.pneumonia', available)).toBe('kr.rf.714_2');
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

  it('hides starter summaries when their structured recommendation is installed', () => {
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
        id: 'kr.rf.714_2',
        title: 'Пневмония (внебольничная)',
        shortTitle: null,
        sourceType: 'clinical_recommendation',
        status: 'active',
        specialties: [],
        versionId: 'v2',
        versionLabel: '714_2',
        effectiveFrom: null,
      },
    ]);
    expect(visible.map((document) => document.id)).toEqual(['kr.rf.714_2']);
  });

  it('detects full-text siblings for summary cards', () => {
    const available = new Set(['kr.rf.714_2.pneumonia', 'kr.rf.714_2.pneumonia.full']);
    expect(hasFullTextSibling('kr.rf.714_2.pneumonia', available)).toBe(true);
    expect(isFullTextDocumentId('kr.rf.714_2.pneumonia.full')).toBe(true);
    expect(summaryDocumentId('kr.rf.714_2.pneumonia.full')).toBe('kr.rf.714_2.pneumonia');
  });
});
