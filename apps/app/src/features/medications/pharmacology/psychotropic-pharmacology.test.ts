import { describe, expect, it } from 'vitest';

import {
  effectiveRegimenBranches,
  receptorPetalScale,
  sedationActivationBalance,
  splitEffectsByCategory,
} from '@/features/medications/pharmacology/drug-pharmacology-schema';
import {
  evaluatePharmacologyPair,
  extractCypProfile,
} from '@/features/medications/pharmacology/pharmacology-interactions';
import {
  lookupDrugPharmacology,
  PSYCHOTROPIC_PHARMACOLOGY_PROFILES,
} from '@/features/medications/pharmacology/psychotropic-pharmacology';
import { lookupReceptorInfo } from '@/features/medications/pharmacology/receptor-encyclopedia';

describe('psychotropic-pharmacology reference profiles', () => {
  it('resolves Russian/Latin INNs and Russian trade-name aliases case-insensitively', () => {
    const risp = lookupDrugPharmacology('РИСПЕРИДОН');
    expect(risp).not.toBeNull();
    expect(risp?.receptors.some((item) => item.receptor === 'D2L')).toBe(true);
    expect(risp?.receptors.some((item) => item.receptor === '5-HT2A')).toBe(true);

    expect(lookupDrugPharmacology('Quetiapine')).toBe(lookupDrugPharmacology('Кветиапин'));
    expect(lookupDrugPharmacology('Сероквель')).toBe(lookupDrugPharmacology('Кветиапин'));
    expect(lookupDrugPharmacology('Тералиджен')).toBe(lookupDrugPharmacology('Алимемазин'));
    expect(lookupDrugPharmacology('Реагила')).toBe(lookupDrugPharmacology('Карипразин'));
    expect(lookupDrugPharmacology('Бипериден®')).not.toBeNull();
    expect(lookupDrugPharmacology('неизвестное вещество')).toBeNull();
  });

  it('attaches structured patient-group regimen block schemas to flagship psychotropics including Тералиджен', () => {
    const teraligen = lookupDrugPharmacology('Тералиджен');
    expect(teraligen).not.toBeNull();
    if (!teraligen) return;
    const branches = effectiveRegimenBranches(teraligen);
    expect(branches.length).toBeGreaterThanOrEqual(5);
    expect(new Set(branches.map((branch) => branch.group))).toEqual(
      new Set(['adult', 'elderly', 'child', 'acute']),
    );
    expect(branches.some((branch) => branch.courseLength?.includes('2–6'))).toBe(true);
    expect(branches.some((branch) => branch.route.includes('В/м'))).toBe(true);

    const balance = sedationActivationBalance(teraligen.effects);
    expect(balance.sedation).toBe(3);
    expect(balance.activation).toBe(0);
    expect(balance.net).toBe(-3);

    const split = splitEffectsByCategory(teraligen.effects);
    expect(split.therapeutic.some((metric) => metric.kind === 'sedation')).toBe(true);
    expect(split.adverse.length).toBeGreaterThan(0);
    for (let i = 1; i < split.adverse.length; i += 1) {
      expect(split.adverse[i - 1]?.level ?? 0).toBeGreaterThanOrEqual(split.adverse[i]?.level ?? 0);
    }
  });

  it('ensures every profile has half-life, BBB penetration, receptors with encyclopedia info, clinical effects, valid petal scales, explicit regimen schema, and published sources', () => {
    for (const profile of PSYCHOTROPIC_PHARMACOLOGY_PROFILES) {
      const resolved = lookupDrugPharmacology(profile.inns[0]);
      expect(resolved).not.toBeNull();
      expect(resolved?.regimenSchemas?.length ?? 0).toBeGreaterThan(0);
      expect(profile.pk.halfLife.trim().length).toBeGreaterThan(0);
      expect(profile.pk.bbb).toBeDefined();
      expect(profile.pk.bbb?.summary.trim().length ?? 0).toBeGreaterThan(10);
      expect(profile.receptors.length).toBeGreaterThan(0);
      expect(profile.effects.length).toBeGreaterThanOrEqual(3);
      expect(profile.sources.length).toBeGreaterThan(0);
      const branches = effectiveRegimenBranches(resolved ?? profile);
      expect(branches.length).toBeGreaterThan(0);
      for (const branch of branches) {
        expect(branch.steps.length).toBeGreaterThan(0);
      }
      for (const receptor of profile.receptors) {
        expect(receptor.pathway.trim().length).toBeGreaterThan(0);
        expect(receptor.clinicalEffect.trim().length).toBeGreaterThan(0);
        const refInfo = lookupReceptorInfo(receptor.receptor);
        expect(
          refInfo,
          `Missing receptor encyclopedia entry for ${receptor.receptor}`,
        ).not.toBeNull();
        expect(refInfo?.zones.length ?? 0).toBeGreaterThan(0);
        const scale = receptorPetalScale(receptor);
        expect(scale).toBeGreaterThanOrEqual(0.6);
        expect(scale).toBeLessThanOrEqual(1);
      }
    }
  });

  it('evaluates pharmacodynamic and CYP interactions deterministically from JSON drug schemas', () => {
    const sertraline = lookupDrugPharmacology('Сертралин');
    const escitalopram = lookupDrugPharmacology('Эсциталопрам');
    const fluoxetine = lookupDrugPharmacology('Флуоксетин');
    const risperidone = lookupDrugPharmacology('Рисперидон');
    const carbamazepine = lookupDrugPharmacology('Карбамазепин');
    const quetiapine = lookupDrugPharmacology('Кветиапин');
    const teraligen = lookupDrugPharmacology('Тералиджен');
    const diazepam = lookupDrugPharmacology('Диазепам');
    if (
      !sertraline ||
      !escitalopram ||
      !fluoxetine ||
      !risperidone ||
      !carbamazepine ||
      !quetiapine ||
      !teraligen ||
      !diazepam
    ) {
      throw new Error('Expected core psychotropic profiles to exist');
    }

    const ssriPair = evaluatePharmacologyPair(
      sertraline,
      escitalopram,
      'Сертралин',
      'Эсциталопрам',
    );
    expect(ssriPair.some((item) => item.id === 'pd-serotonin' && item.severity === 'high')).toBe(
      true,
    );

    const cypInhPair = evaluatePharmacologyPair(
      fluoxetine,
      risperidone,
      'Флуоксетин',
      'Рисперидон',
    );
    expect(
      cypInhPair.some((item) => item.tags.includes('CYP2D6') && item.severity === 'high'),
    ).toBe(true);
    expect(cypInhPair.some((item) => item.id === 'pk-long-halflife')).toBe(true);

    const cypIndPair = evaluatePharmacologyPair(
      carbamazepine,
      quetiapine,
      'Карбамазепин',
      'Кветиапин',
    );
    expect(
      cypIndPair.some((item) => item.tags.includes('CYP3A4') && item.tags.includes('Индуктор')),
    ).toBe(true);

    const sedativePair = evaluatePharmacologyPair(teraligen, diazepam, 'Тералиджен', 'Диазепам');
    expect(
      sedativePair.some((item) => item.id === 'pd-sedation-high' && item.severity === 'high'),
    ).toBe(true);

    const parsedCyp = extractCypProfile('CYP2D6, CYP3A4 (мощный ингибитор CYP2D6)');
    expect(parsedCyp.substrates).toContain('CYP2D6');
    expect(parsedCyp.substrates).toContain('CYP3A4');
    expect(parsedCyp.inhibitors).toContain('CYP2D6');
  });
});
