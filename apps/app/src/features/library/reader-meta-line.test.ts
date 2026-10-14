import { describe, expect, it } from 'vitest';

import { readerMetaParts } from '@/features/library/reader-meta-line';

describe('readerMetaParts', () => {
  it('names a clinical recommendation by kind, edition number and audience', () => {
    expect(
      readerMetaParts({
        sourceType: 'clinical_recommendation',
        versionLabel: '359_3',
        metadata: { ageGroups: ['Взрослые', 'дети'] },
      }),
    ).toEqual(['Клинические рекомендации', 'ред. 3', 'взрослые, дети']);
  });

  it('shows the edition line of an act and leaves out audience slugs in other languages', () => {
    expect(
      readerMetaParts({
        sourceType: 'regulatory_act',
        versionLabel: '2026-10-14',
        metadata: {
          documentKind: 'приказ',
          edition: 'с изменениями приказа № 677н (с 01.09.2024)',
          ageGroups: ['children', 'adolescents'],
        },
      }),
    ).toEqual(['Приказ', 'с изменениями приказа № 677н (с 01.09.2024)']);
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
