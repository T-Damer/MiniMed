import { describe, expect, it } from 'vitest';
import { rlsMedicationPackagingLinks } from '@/features/library/rls-medication-packaging';

const link = {
  medicationEntityId: 'medication.brand.abc',
  name: 'Название источника®',
  packagingDocumentId: 'rls.packaging.abc',
  sourceUrl: 'https://www.rlsnet.ru/drugs/source',
};

describe('source-listed RLS packaging links', () => {
  it('preserves exact source identities and deduplicates packaging documents', () => {
    expect(
      rlsMedicationPackagingLinks({ metadata: { rlsMedicationPackaging: [link, link] } }),
    ).toEqual([link]);
  });
  it('does not infer packaging from names or accept malformed/foreign source links', () => {
    expect(rlsMedicationPackagingLinks({ metadata: { tradeName: link.name } })).toEqual([]);
    expect(
      rlsMedicationPackagingLinks({
        metadata: {
          rlsMedicationPackaging: [
            null,
            {},
            { ...link, packagingDocumentId: 'other' },
            { ...link, sourceUrl: 'javascript:alert(1)' },
            { ...link, sourceUrl: 'https://example.com/drugs/source' },
          ],
        },
      }),
    ).toEqual([]);
  });
});
