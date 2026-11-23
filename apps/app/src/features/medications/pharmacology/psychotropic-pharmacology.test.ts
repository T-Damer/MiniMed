import { describe, expect, it } from 'vitest';

import {
  lookupDrugPharmacology,
  PSYCHOTROPIC_PHARMACOLOGY_PROFILES,
} from '@/features/medications/pharmacology/psychotropic-pharmacology';

describe('psychotropic-pharmacology reference profiles', () => {
  it('resolves Russian and Latin INNs case-insensitively and ignores trademark marks', () => {
    const risp = lookupDrugPharmacology('РИСПЕРИДОН');
    expect(risp).not.toBeNull();
    expect(risp?.receptors.some((item) => item.receptor === 'D2L')).toBe(true);
    expect(risp?.receptors.some((item) => item.receptor === '5-HT2A')).toBe(true);

    expect(lookupDrugPharmacology('Quetiapine')).toBe(lookupDrugPharmacology('Кветиапин'));
    expect(lookupDrugPharmacology('Бипериден®')).not.toBeNull();
    expect(lookupDrugPharmacology('неизвестное вещество')).toBeNull();
  });

  it('ensures every profile has half-life, receptors with pathways/effects, and published sources', () => {
    for (const profile of PSYCHOTROPIC_PHARMACOLOGY_PROFILES) {
      expect(profile.pk.halfLife.trim().length).toBeGreaterThan(0);
      expect(profile.receptors.length).toBeGreaterThan(0);
      expect(profile.sources.length).toBeGreaterThan(0);
      for (const receptor of profile.receptors) {
        expect(receptor.pathway.trim().length).toBeGreaterThan(0);
        expect(receptor.clinicalEffect.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
