import type { MedicalDocument } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import { medicationPreviewExcerpts } from '@/features/library/medication-link-preview';

const document: MedicalDocument = {
  id: 'registry.one',
  title: 'Препарат',
  shortTitle: null,
  sourceType: 'official_registry_summary',
  status: 'active',
  specialties: [],
  versionId: 'registry.one@1',
  versionLabel: '1',
  effectiveFrom: null,
  sections: [],
  metadata: {
    contentMode: 'registry-normalized',
    registrationNumber: 'RU-1',
    tradeName: 'Препарат',
    inn: 'Вещество',
    registrationStatus: 'active',
    presentations: [
      { dosageForm: 'суспензия', strength: '100 мг/5 мл', route: 'внутрь', packages: [] },
    ],
  },
};

describe('medication inline preview', () => {
  it('preserves the source concentration denominator and route without calculating a dose', () => {
    expect(medicationPreviewExcerpts(document, 'Препарат')).toEqual([
      {
        text: 'Препарат\nФорма: суспензия\nКоличество / концентрация: 100 мг/5 мл\nПуть введения: внутрь',
      },
    ]);
  });
  it('does not invent a concentration from a medication title', () => {
    expect(medicationPreviewExcerpts({ ...document, metadata: {} }, 'Препарат')).toEqual([]);
  });
  it('keeps strength from the pointer section heading and links its original chunk', () => {
    const pointer: MedicalDocument = {
      ...document,
      sourceType: 'core_catalog_pointer',
      metadata: { catalogFamily: 'medication' },
      sections: [
        {
          id: 'section',
          documentVersionId: document.versionId,
          parentSectionId: null,
          title: 'Суспензия 100 мг/5 мл',
          sectionType: null,
          depth: 1,
          orderIndex: 0,
          pageStart: null,
          pageEnd: null,
          anchor: 'section-anchor',
          sectionPath: [],
          chunks: [
            {
              id: 'chunk',
              sectionId: 'section',
              documentVersionId: document.versionId,
              orderIndex: 0,
              originalText: 'ТН: Препарат; форма/дозировка: НЕ УКАЗАНО',
              pageStart: null,
              pageEnd: null,
              anchor: 'source-anchor',
            },
          ],
        },
      ],
    };
    expect(medicationPreviewExcerpts(pointer, 'Препарат')).toEqual([
      {
        text: 'Суспензия 100 мг/5 мл\nТН: Препарат; форма/дозировка: НЕ УКАЗАНО',
        anchor: 'source-anchor',
      },
    ]);
  });
});
