import { describe, expect, it } from 'vitest';

import { readerEdition, readerMetaParts } from '@/features/library/reader-meta-line';

describe('readerMetaParts', () => {
  it('names a clinical recommendation by kind and audience; the edition is «Информация»', () => {
    const recommendation = {
      sourceType: 'clinical_recommendation',
      versionLabel: '359_3',
      metadata: { ageGroups: ['Взрослые', 'дети'] },
    };
    expect(readerMetaParts(recommendation)).toEqual(['Клинические рекомендации', 'взрослые, дети']);
    expect(readerEdition(recommendation)).toBe('ред. 3');
  });

  it('keeps the edition line of an act for «Информация» and leaves out audience slugs', () => {
    const act = {
      sourceType: 'regulatory_act',
      versionLabel: '2026-10-14',
      metadata: {
        documentKind: 'приказ',
        edition: 'с изменениями приказа № 677н (с 01.09.2024)',
        ageGroups: ['children', 'adolescents'],
      },
    };
    expect(readerMetaParts(act)).toEqual(['Приказ']);
    expect(readerEdition(act)).toBe('с изменениями приказа № 677н (с 01.09.2024)');
  });

  it('never prints a build date or an internal id as an edition', () => {
    expect(
      readerMetaParts({
        sourceType: 'medical_reference',
        versionLabel: 'site-36954b711a3c',
        metadata: { audienceLabel: 'Для детей и взрослых' },
      }),
    ).toEqual(['Справочник', 'Для детей и взрослых']);
  });
});
