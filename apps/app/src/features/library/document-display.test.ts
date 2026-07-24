import type { MedicalSection } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  orderDocumentSections,
} from './document-display';

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
});
