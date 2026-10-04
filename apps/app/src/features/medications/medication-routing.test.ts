import { describe, expect, it } from 'vitest';

import {
  isMedicationCatalogRoute,
  legacyMedicationRegistrationFromHash,
  MEDICATION_ATC_HASH,
  MEDICATION_CATALOG_HASH,
  MEDICATION_CATALOG_ROUTE,
  medicationAtcHash,
  medicationCatalogViewFromHash,
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

  it('opens the ATC tree at a node and keeps it out of the legacy registration route', () => {
    expect(MEDICATION_ATC_HASH).toBe('#/modules/documents/medications/atc');
    expect(isMedicationCatalogRoute(MEDICATION_ATC_HASH)).toBe(true);
    expect(legacyMedicationRegistrationFromHash(MEDICATION_ATC_HASH)).toBeNull();
    expect(legacyMedicationRegistrationFromHash(medicationAtcHash('N06B'))).toBeNull();
    expect(medicationCatalogViewFromHash(MEDICATION_CATALOG_HASH)).toEqual({ view: 'list' });
    expect(medicationCatalogViewFromHash('#/modules/documents/medications/ЛП-1')).toEqual({
      view: 'list',
    });
    expect(medicationCatalogViewFromHash(MEDICATION_ATC_HASH)).toEqual({
      view: 'atc',
      code: null,
    });
    expect(medicationCatalogViewFromHash(medicationAtcHash('N06B'))).toEqual({
      view: 'atc',
      code: 'N06B',
    });
    expect(medicationCatalogViewFromHash(medicationAtcHash('none'))).toEqual({
      view: 'atc',
      code: 'none',
    });
  });

  it('normalises look-alike letters and drops codes that are not groups', () => {
    // Cyrillic С and В typed on a Russian keyboard.
    expect(
      medicationCatalogViewFromHash(
        `#/modules/documents/medications/atc/${encodeURIComponent('С01В')}`,
      ),
    ).toEqual({ view: 'atc', code: 'C01B' });
    // A substance code (level 5) and garbage fall back to the list of groups.
    expect(medicationCatalogViewFromHash(medicationAtcHash('N06BX03'))).toEqual({
      view: 'atc',
      code: null,
    });
    expect(medicationCatalogViewFromHash('#/modules/documents/medications/atc/%E0%A4%A')).toEqual({
      view: 'atc',
      code: null,
    });
    expect(medicationCatalogViewFromHash('#/modules/documents/medications/atc/zzz')).toEqual({
      view: 'atc',
      code: null,
    });
  });
});
