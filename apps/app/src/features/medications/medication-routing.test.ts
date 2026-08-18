import { describe, expect, it } from 'vitest';

import {
  isMedicationCatalogRoute,
  legacyMedicationRegistrationFromHash,
  MEDICATION_CATALOG_HASH,
  MEDICATION_CATALOG_ROUTE,
} from '@/features/medications/medication-routing';

describe('medication-routing', () => {
  it('recognizes the catalog route and legacy detail hashes', () => {
    expect(MEDICATION_CATALOG_ROUTE).toBe('modules/documents/medications');
    expect(MEDICATION_CATALOG_HASH).toBe('#/modules/documents/medications');
    expect(isMedicationCatalogRoute('#/modules/documents/medications')).toBe(true);
    expect(isMedicationCatalogRoute('modules/documents/medications')).toBe(true);
    expect(isMedicationCatalogRoute('#/modules/documents/medications/allmed:12')).toBe(true);
    expect(isMedicationCatalogRoute('modules/documents/medications/ЛП-1')).toBe(true);
    expect(isMedicationCatalogRoute('#/modules/documents')).toBe(false);
    expect(isMedicationCatalogRoute('#/modules/documents/d/token')).toBe(false);
  });

  it('extracts legacy registration numbers from detail hashes', () => {
    expect(legacyMedicationRegistrationFromHash('#/modules/documents/medications')).toBeNull();
    expect(legacyMedicationRegistrationFromHash('#/modules/documents/medications/allmed:12')).toBe(
      'allmed:12',
    );
    expect(
      legacyMedicationRegistrationFromHash(
        `#/modules/documents/medications/${encodeURIComponent('ЛП-№(005744)-(РГ-RU)')}`,
      ),
    ).toBe('ЛП-№(005744)-(РГ-RU)');
  });
});
