import { describe, expect, it } from 'vitest';

import {
  GYNECOLOGY_BREAST_CANCER_RISK_SCHEMA,
  GYNECOLOGY_CERVICAL_CANCER_RISK_SCHEMA,
  OBSTETRIC_BISHOP_SCORE_SCHEMA,
  OBSTETRIC_EDD_CONCEPTION_SCHEMA,
  OBSTETRIC_EDD_GIVEN_DATE_SCHEMA,
  OBSTETRIC_EDD_LMP_SCHEMA,
  OBSTETRIC_EDD_QUICKENING_SCHEMA,
  OBSTETRIC_EDD_ULTRASOUND_SCHEMA,
  OBSTETRIC_EFW_MATERNAL_ANTHROPOMETRY_SCHEMA,
  OBSTETRIC_EFW_RUDAKOV_SCHEMA,
  OBSTETRIC_FETAL_GROWTH_DOPPLER_SCHEMA,
  OBSTETRIC_GA_CRL_SCHEMA,
  OBSTETRIC_GA_FROM_EDD_SCHEMA,
  OBSTETRIC_MATERNITY_LEAVE_SCHEMA,
  OBSTETRIC_VBAC_ADMISSION_SCHEMA,
  OBSTETRIC_VBAC_ANTEPARTUM_SCHEMA,
} from '@/features/calculators/calculator-schema-catalog-obstetrics';
import {
  evaluateCalculatorSchema,
  toStoredCalculationResult,
} from '@/features/calculators/calculator-schema-engine';
import {
  calculateBishopScore,
  calculateEddByConception,
  calculateEddByLmp,
  calculateEddByQuickening,
  calculateEddByUltrasound,
  calculateEddForGivenDate,
  calculateGestationalAgeByCrl,
  calculateGestationalAgeFromEdd,
  calculateMaternityLeaveTimeframe,
} from '@/features/calculators/obstetric-calculations';

function textOf(result: unknown, label: string): string | undefined {
  const record = result as {
    readonly textValues?: readonly { readonly label: string; readonly text: string }[];
  };
  return record.textValues?.find((entry) => entry.label === label)?.text;
}

describe('Bishop score schema matches the hardcoded implementation, including threshold interpretations', () => {
  it.each([
    {
      dilationScore: 3,
      effacementScore: 3,
      stationScore: 3,
      consistencyScore: 2,
      positionScore: 2,
    }, // 13, favorable
    {
      dilationScore: 2,
      effacementScore: 2,
      stationScore: 2,
      consistencyScore: 1,
      positionScore: 1,
    }, // 8, favorable boundary
    {
      dilationScore: 1,
      effacementScore: 2,
      stationScore: 1,
      consistencyScore: 1,
      positionScore: 1,
    }, // 6, intermediate boundary
    {
      dilationScore: 0,
      effacementScore: 1,
      stationScore: 1,
      consistencyScore: 1,
      positionScore: 1,
    }, // 4, unfavorable
    {
      dilationScore: 0,
      effacementScore: 0,
      stationScore: 0,
      consistencyScore: 0,
      positionScore: 0,
    }, // 0, unfavorable
  ])('%o', (input) => {
    const legacy = calculateBishopScore(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_BISHOP_SCORE_SCHEMA, input);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('value' in legacy)) throw new Error('unreachable');
    const output = schemaResult.outputs[0];
    if (output?.kind !== 'number') throw new Error('expected a numeric output');
    expect(output.value).toBe(legacy.value);
    const legacyInterpretation = legacy.warnings[0]?.message;
    const schemaInterpretation = schemaResult.warnings.find(
      (w) => w.code === 'interpretation',
    )?.message;
    expect(schemaInterpretation).toBe(legacyInterpretation);
  });

  it('rejects a non-integer sub-score', () => {
    const result = evaluateCalculatorSchema(OBSTETRIC_BISHOP_SCORE_SCHEMA, {
      dilationScore: 1.5,
      effacementScore: 1,
      stationScore: 1,
      consistencyScore: 1,
      positionScore: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe('gestational age by CRL (Robinson-Fleming) schema matches the hardcoded implementation', () => {
  it.each([{ crlMm: 20 }, { crlMm: 45 }, { crlMm: 80 }])('%o', ({ crlMm }) => {
    const legacy = calculateGestationalAgeByCrl({ crlMm });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_GA_CRL_SCHEMA, { crlMm });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('values' in legacy)) throw new Error('unreachable');
    for (const [index, expected] of legacy.values.entries()) {
      const output = schemaResult.outputs[index];
      if (output?.kind !== 'number') throw new Error('expected a numeric output');
      expect(output.value).toBe(expected.value);
      expect(output.unit).toBe(expected.unit);
    }
  });
});

describe('EDD by LMP (Naegele) schema matches the hardcoded implementation', () => {
  it('produces the same EDD date and today-relative gestational age', () => {
    const lmpDate = '2026-01-01';
    const legacy = calculateEddByLmp({ lmpDate });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_LMP_SCHEMA, { lmpDate });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyEdd = textOf(legacy, 'Предполагаемая дата родов');
    const schemaEdd =
      schemaResult.outputs[0]?.kind === 'text' ? schemaResult.outputs[0].text : undefined;
    expect(schemaEdd).toBe(legacyEdd);
    // Naegele: 2026-01-01 + 280 days = 2026-10-08.
    expect(schemaEdd).toContain('2026');
  });
});

describe('EDD by ultrasound schema matches the hardcoded implementation', () => {
  it('computes the same EDD for a normal exam-date/gestational-age combination', () => {
    const schemaInput = { examDate: '2026-03-01', gaWeeksAtExam: 12, gaDaysAtExam: 3 };
    const legacy = calculateEddByUltrasound({ examDate: '2026-03-01', gaWeeks: 12, gaDays: 3 });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_ULTRASOUND_SCHEMA, schemaInput);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyEdd = textOf(legacy, 'Предполагаемая дата родов');
    const schemaEdd =
      schemaResult.outputs[0]?.kind === 'text' ? schemaResult.outputs[0].text : undefined;
    expect(schemaEdd).toBe(legacyEdd);
  });

  it('rejects a gestational age at exam beyond 40 weeks, via the new assertions mechanism', () => {
    const schemaInput = { examDate: '2026-03-01', gaWeeksAtExam: 41, gaDaysAtExam: 0 };
    const legacy = calculateEddByUltrasound({ examDate: '2026-03-01', gaWeeks: 41, gaDays: 0 });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_ULTRASOUND_SCHEMA, schemaInput);
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });
});

describe('EDD by conception schema matches the hardcoded implementation', () => {
  it('computes the same EDD', () => {
    const input = { conceptionDate: '2026-02-14' };
    const legacy = calculateEddByConception(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_CONCEPTION_SCHEMA, input);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyEdd = textOf(legacy, 'Предполагаемая дата родов');
    const schemaEdd =
      schemaResult.outputs[0]?.kind === 'text' ? schemaResult.outputs[0].text : undefined;
    expect(schemaEdd).toBe(legacyEdd);
  });
});

describe('EDD by quickening schema matches the hardcoded implementation for both parities', () => {
  it.each([
    { quickeningDate: '2026-04-01', parity: 'primigravida' as const },
    { quickeningDate: '2026-04-01', parity: 'multigravida' as const },
  ])('%o', (input) => {
    const legacy = calculateEddByQuickening(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_QUICKENING_SCHEMA, input);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyEdd = textOf(legacy, 'Предполагаемая дата родов');
    const schemaEdd =
      schemaResult.outputs[0]?.kind === 'text' ? schemaResult.outputs[0].text : undefined;
    expect(schemaEdd).toBe(legacyEdd);
  });
});

describe('EDD for a given date schema matches the hardcoded implementation', () => {
  it('computes the same EDD for a normal reference-date/gestational-age combination', () => {
    const schemaInput = { referenceDate: '2026-05-01', gaWeeksGiven: 20, gaDaysGiven: 2 };
    const legacy = calculateEddForGivenDate({
      referenceDate: '2026-05-01',
      gaWeeks: 20,
      gaDays: 2,
    });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_GIVEN_DATE_SCHEMA, schemaInput);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyEdd = textOf(legacy, 'Предполагаемая дата родов');
    const schemaEdd =
      schemaResult.outputs[0]?.kind === 'text' ? schemaResult.outputs[0].text : undefined;
    expect(schemaEdd).toBe(legacyEdd);
  });

  it('rejects a given gestational age beyond 40 weeks', () => {
    const schemaInput = { referenceDate: '2026-05-01', gaWeeksGiven: 41, gaDaysGiven: 0 };
    const legacy = calculateEddForGivenDate({
      referenceDate: '2026-05-01',
      gaWeeks: 41,
      gaDays: 0,
    });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_EDD_GIVEN_DATE_SCHEMA, schemaInput);
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });
});

describe('gestational age from EDD schema matches the hardcoded implementation', () => {
  it('computes the same weeks/days for an explicit as-of date', () => {
    const input = { eddDate: '2026-10-08', asOfDate: '2026-06-01' };
    const legacy = calculateGestationalAgeFromEdd(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_GA_FROM_EDD_SCHEMA, input);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('values' in legacy)) throw new Error('unreachable');
    for (const [index, expected] of legacy.values.entries()) {
      const output = schemaResult.outputs[index];
      if (output?.kind !== 'number') throw new Error('expected a numeric output');
      expect(output.value).toBe(expected.value);
    }
  });

  it('defaults the as-of date to today when left blank, same as the hardcoded implementation', () => {
    const legacy = calculateGestationalAgeFromEdd({ eddDate: '2026-10-08' });
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_GA_FROM_EDD_SCHEMA, {
      eddDate: '2026-10-08',
    });
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok || !('values' in legacy)) throw new Error('unreachable');
    for (const [index, expected] of legacy.values.entries()) {
      const output = schemaResult.outputs[index];
      if (output?.kind !== 'number') throw new Error('expected a numeric output');
      expect(output.value).toBe(expected.value);
    }
  });

  it('rejects an as-of date before the implied LMP', () => {
    const input = { eddDate: '2026-10-08', asOfDate: '2025-12-01' };
    const legacy = calculateGestationalAgeFromEdd(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_GA_FROM_EDD_SCHEMA, input);
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });

  it('rejects an as-of date more than 3 weeks past the EDD', () => {
    const input = { eddDate: '2026-10-08', asOfDate: '2026-11-15' };
    const legacy = calculateGestationalAgeFromEdd(input);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_GA_FROM_EDD_SCHEMA, input);
    expect(legacy.ok).toBe(false);
    expect(schemaResult.ok).toBe(false);
  });
});

describe('maternity leave timeframe schema matches the hardcoded implementation', () => {
  it.each([
    { eddDate: '2026-10-08', pregnancyType: 'single' as const, complicatedBirth: 'no' as const },
    { eddDate: '2026-10-08', pregnancyType: 'multiple' as const, complicatedBirth: 'no' as const },
    { eddDate: '2026-10-08', pregnancyType: 'single' as const, complicatedBirth: 'yes' as const },
  ])('%o', (schemaInput) => {
    const legacyInput = {
      eddDate: schemaInput.eddDate,
      pregnancyType: schemaInput.pregnancyType,
      complicatedBirth: schemaInput.complicatedBirth === 'yes',
    };
    const legacy = calculateMaternityLeaveTimeframe(legacyInput);
    const schemaResult = evaluateCalculatorSchema(OBSTETRIC_MATERNITY_LEAVE_SCHEMA, schemaInput);
    expect(legacy.ok).toBe(true);
    expect(schemaResult.ok).toBe(true);
    if (!legacy.ok || !schemaResult.ok) throw new Error('unreachable');
    const legacyStart = textOf(legacy, 'Начало отпуска по беременности и родам');
    const legacyEnd = textOf(legacy, 'Окончание отпуска (при выдаче единым листом)');
    const legacyDuration = textOf(legacy, 'Продолжительность');

    const stored = toStoredCalculationResult(schemaResult);
    const schemaStart = textOf(stored, 'Начало отпуска по беременности и родам');
    const schemaEnd = textOf(stored, 'Окончание отпуска (при выдаче единым листом)');
    const schemaDuration = textOf(stored, 'Продолжительность');

    expect(schemaStart).toBe(legacyStart);
    expect(schemaEnd).toBe(legacyEnd);
    expect(schemaDuration).toBe(legacyDuration);
  });
});

describe('additional obstetrics and gynecology schemas', () => {
  it('calculates the growth and fetal-weight indices with explicit limitations', () => {
    const growth = evaluateCalculatorSchema(OBSTETRIC_FETAL_GROWTH_DOPPLER_SCHEMA, {
      gaWeeks: 32,
      gaDays: 0,
      efwG: 1800,
      efwPercentile: 35,
      umbilicalArteryPi: 1.2,
      middleCerebralArteryPi: 1.8,
      uterineArteryPiRight: 0.7,
      uterineArteryPiLeft: 0.9,
    });
    expect(growth.ok).toBe(true);
    if (!growth.ok) throw new Error('unreachable');
    expect(growth.outputs.find((output) => output.label.includes('ЦПС'))).toMatchObject({
      value: 1.5,
    });

    const anthropometry = evaluateCalculatorSchema(OBSTETRIC_EFW_MATERNAL_ANTHROPOMETRY_SCHEMA, {
      gaWeeks: 39,
      gaDays: 0,
      fetalSex: 0,
      maternalHeightCm: 165,
      maternalWeightAt26Kg: 70,
      thirdTrimesterWeightGainKg: 5,
      parity: 0,
    });
    const rudakov = evaluateCalculatorSchema(OBSTETRIC_EFW_RUDAKOV_SCHEMA, {
      gaWeeks: 39,
      abdominalCircumferenceCm: 100,
      fundalHeightCm: 35,
    });
    expect(anthropometry.ok).toBe(true);
    expect(rudakov.ok).toBe(true);
    if (!rudakov.ok) throw new Error('unreachable');
    expect(rudakov.outputs.find((output) => output.label.includes('масса'))).toMatchObject({
      value: 3500,
    });
  });

  it('evaluates both Grobman VBAC models and keeps the result in probability bounds', () => {
    const antepartum = evaluateCalculatorSchema(OBSTETRIC_VBAC_ANTEPARTUM_SCHEMA, {
      ageYears: 30,
      bmi: 25,
      race: 'other',
      anyPriorVaginal: 'yes',
      priorVbac: 'no',
      indication: 'nonrecurring',
    });
    const admission = evaluateCalculatorSchema(OBSTETRIC_VBAC_ADMISSION_SCHEMA, {
      ageYears: 30,
      bmi: 25,
      race: 'other',
      anyPriorVaginal: 'yes',
      priorVbac: 'no',
      indication: 'nonrecurring',
      gaWeeks: 39,
      hypertensiveDisease: 'no',
      effacement: 80,
      dilation: 5,
      station: 0,
      laborInduction: 'no',
    });
    expect(antepartum.ok).toBe(true);
    expect(admission.ok).toBe(true);
    for (const result of [antepartum, admission]) {
      if (!result.ok) throw new Error('unreachable');
      const output = result.outputs[0];
      if (output?.kind !== 'number') throw new Error('expected probability output');
      expect(output.value).toBeGreaterThan(0);
      expect(output.value).toBeLessThan(100);
    }
  });

  it('calculates Gail risk and labels cervical screening as a pathway band', () => {
    const lowRisk = evaluateCalculatorSchema(GYNECOLOGY_BREAST_CANCER_RISK_SCHEMA, {
      ageYears: 45,
      race: 'white',
      biopsiesCategory: 0,
      menarcheCategory: 0,
      firstBirthCategory: 0,
      relativesCategory: 0,
      atypicalHyperplasia: 0,
    });
    const highRisk = evaluateCalculatorSchema(GYNECOLOGY_BREAST_CANCER_RISK_SCHEMA, {
      ageYears: 45,
      race: 'white',
      biopsiesCategory: 2,
      menarcheCategory: 2,
      firstBirthCategory: 3,
      relativesCategory: 2,
      atypicalHyperplasia: 1,
    });
    const cervical = evaluateCalculatorSchema(GYNECOLOGY_CERVICAL_CANCER_RISK_SCHEMA, {
      ageYears: 35,
      cytology: 'hsil',
      hpvStatus: 'positive',
      hpv16Or18: 'yes',
      priorCin2Plus: 'unknown',
      immunosuppressed: 'no',
    });
    expect(lowRisk.ok).toBe(true);
    expect(highRisk.ok).toBe(true);
    expect(cervical.ok).toBe(true);
    if (!lowRisk.ok || !highRisk.ok || !cervical.ok) throw new Error('unreachable');
    const low = lowRisk.outputs[0];
    const high = highRisk.outputs[0];
    const band = cervical.outputs[0];
    if (low?.kind !== 'number' || high?.kind !== 'number' || band?.kind !== 'number') {
      throw new Error('expected numeric outputs');
    }
    expect(high.value).toBeGreaterThan(low.value);
    expect(band.value).toBe(3);
  });
});
