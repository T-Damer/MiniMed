import { describe, expect, it } from 'vitest';

import { BASE_MODULE_CATALOG } from '@/features/modules/module-catalog';
import { clinicalTitleCandidates } from '@/features/search/discovery-clinical-titles';

describe('early clinical titles', () => {
  it('keeps both audiences for an unqualified title and respects an explicit audience', () => {
    expect(
      clinicalTitleCandidates(BASE_MODULE_CATALOG, 'Мигрень')
        .map(({ id }) => id)
        .sort(),
    ).toEqual(['kr.rf.169_2', 'kr.rf.295_4']);
    expect(
      clinicalTitleCandidates(BASE_MODULE_CATALOG, 'мигрень у детей').map(({ id }) => id),
    ).toEqual(['kr.rf.169_2']);
    expect(
      clinicalTitleCandidates(BASE_MODULE_CATALOG, 'мигрень у взрослых').map(({ id }) => id),
    ).toEqual(['kr.rf.295_4']);
  });

  it('leaves symptom descriptions and evidence queries to full search', () => {
    expect(clinicalTitleCandidates(BASE_MODULE_CATALOG, 'мигрень лечение')).toEqual([]);
  });
});
