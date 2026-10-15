import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/pediatrics.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);
const FEEDING_DIR = 'content/feeding-norms';

type Inputs = Record<string, number>;

function run(id: string, inputs: Inputs) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${id}`);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const value = (output: string): number => {
    const found = result.outputs.find((candidate) => candidate.id === output);
    if (found?.kind === 'number') return found.value;
    const traced = result.trace.find((candidate) => candidate.id === output);
    if (!traced) throw new Error(`${id}: no numeric value ${output}`);
    return traced.value;
  };
  const interpretation = result.warnings.find((warning) => warning.code === 'interpretation');
  return { value, interpretation: interpretation?.message ?? '', result };
}

function rejects(id: string, inputs: Inputs): string {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${id}`);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  const result = evaluateCalculatorSchema(schema, inputs);
  if (result.ok) throw new Error(`${id}: expected a rejected input`);
  return result.error;
}

describe('feeding calculators of the pediatrics tool module', () => {
  it('declares the six calculators, each with book sources linked to the feeding module', () => {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      version: string;
      tools: readonly unknown[];
    };
    expect(raw.version).toMatch(/^0\.1\.0-preview\.\d+$/u);
    const records = raw.tools.map((tool) => ToolDefinitionRecordSchema.parse(tool));
    const feeding = records.filter((record) =>
      record.sources.some((source) => source.moduleId === 'minimed.reference.feeding.ru'),
    );
    expect(feeding.map((record) => record.slug).sort()).toEqual([
      'child-energy-volume-over-one-year',
      'fruit-puree-juice-volume',
      'hypogalactia-degree',
      'infant-feeding-volume-methods',
      'newborn-feeding-volume',
      'undernutrition-energy-protein-target',
    ]);
    for (const record of feeding) {
      for (const source of record.sources) {
        expect(source.moduleId).toBe('minimed.reference.feeding.ru');
        expect(source.documentId).toMatch(/^reference\.feeding\./u);
        expect(
          existsSync(resolve(process.cwd(), FEEDING_DIR, `${source.documentId}.md`)),
          `${record.id}: ${source.documentId}`,
        ).toBe(true);
      }
      const definition = SCHEMAS.find((schema) => schema.id === record.id);
      expect(definition?.sources.every((source) => (source.page ?? '').length > 0)).toBe(true);
      // The degrees of hypogalactia are bands from the textbook; the other five return volumes.
      expect(definition?.evaluation.status).toBe(
        record.id.endsWith('hypogalactia-degree') ? 'verdict' : 'not-applicable',
      );
    }
  });

  it('newborn: Finkelstein–Tur, Filatov–Zaitseva, the rule of ten and Shabalov', () => {
    const light = run('newborn-feeding-volume', { dayOfLife: 5, birthWeightG: 3000 });
    expect(light.value('finkelsteinTurDaily')).toBe(350); // 5 × 70 (< 3200 g)
    expect(light.value('filatovZaitsevaDaily')).toBeCloseTo(300, 6); // 2 % of 3000 g × 5
    expect(light.value('ruleOfTenFeed')).toBe(50);
    expect(light.value('shabalovFeed')).toBeCloseTo(45, 6); // 3 × 3 kg × 5

    const heavy = run('newborn-feeding-volume', { dayOfLife: 5, birthWeightG: 3500 });
    expect(heavy.value('finkelsteinTurDaily')).toBe(400); // 5 × 80 (> 3200 g)
    expect(heavy.value('filatovZaitsevaDaily')).toBeCloseTo(350, 6);
    expect(heavy.value('shabalovFeed')).toBeCloseTo(52.5, 6);

    // 3200 g itself is not stated by the books; the calculator takes the heavier multiplier
    expect(
      run('newborn-feeding-volume', { dayOfLife: 1, birthWeightG: 3200 }).value(
        'finkelsteinTurDaily',
      ),
    ).toBe(80);
    expect(
      run('newborn-feeding-volume', { dayOfLife: 1, birthWeightG: 3199 }).value(
        'finkelsteinTurDaily',
      ),
    ).toBe(70);
  });

  it('newborn: the solved examples of Kapitan (6th ed., 2019, p. 459)', () => {
    // «масса при рождении 3000 г, ему 4 дня, V = 4 · 70 = 280 мл»
    const tur = run('newborn-feeding-volume', { dayOfLife: 4, birthWeightG: 3000 });
    expect(tur.value('finkelsteinTurDaily')).toBe(280);
    // «малышу 2 дня … 10 · 2 = 20 мл»
    expect(
      run('newborn-feeding-volume', { dayOfLife: 2, birthWeightG: 3000 }).value('ruleOfTenFeed'),
    ).toBe(20);
    // «ребенку 5 дней, масса тела 3300 г … 3 · 5 · 3,3 = 50 мл» (49.5 before the book rounds it)
    const shabalov = run('newborn-feeding-volume', { dayOfLife: 5, birthWeightG: 3300 });
    expect(shabalov.value('shabalovFeed')).toBeCloseTo(49.5, 6);
    expect(Math.round(shabalov.value('shabalovFeed') / 10) * 10).toBe(50);
  });

  it('newborn: notes the day-8 limit of the Finkelstein–Tur formula and light babies', () => {
    expect(
      run('newborn-feeding-volume', { dayOfLife: 9, birthWeightG: 3300 }).interpretation,
    ).toContain('7–8-го дня');
    expect(
      run('newborn-feeding-volume', { dayOfLife: 3, birthWeightG: 2300 }).interpretation,
    ).toContain('ниже 2500 г');
    expect(
      run('newborn-feeding-volume', { dayOfLife: 3, birthWeightG: 3300 }).interpretation,
    ).toContain('Суточный объём делят');
    expect(rejects('newborn-feeding-volume', { dayOfLife: 11, birthWeightG: 3300 })).toBeTruthy();
  });

  it('infant: the worked example of the 2021 textbook (2 months, 5 kg, 700 kcal per litre)', () => {
    // book: 120 kcal/kg × 5 kg = 600 kcal; 1000 ml of milk hold 700 kcal → 857 ml (the book rounds to 850)
    const example = run('infant-feeding-volume-methods', {
      ageMonths: 2,
      weightKg: 5,
      milkKcalPer100Ml: 70,
    });
    expect(example.value('maslovDailyLow')).toBeCloseTo(857.142857, 4);
    expect(example.value('maslovDailyHigh')).toBeCloseTo(892.857143, 4); // upper end 125 kcal/kg
    expect(example.value('programmeDaily')).toBeCloseTo(821.428571, 4); // Programme 2019: 115 kcal/kg, no cap before 3 months
    expect(example.value('volumetricDaily')).toBeCloseTo(833.333333, 4); // 2–4 months: 1/6 of the weight
    expect(example.value('shkarinDaily')).toBe(800); // 2 months = 800 ml
    expect(example.value('singleFeedShkarin')).toBeCloseTo(800 / 6, 6); // default 6 feeds below 4.5 months
  });

  it('infant: the solved examples of Kapitan (6th ed., 2019, pp. 459–460)', () => {
    // «Ребенку 3 мес., масса тела 5200 г; 5200 · 1/6 = 866 мл = 870 мл … 870 мл : 6 = 145 мл»
    const volumetric = run('infant-feeding-volume-methods', {
      ageMonths: 3,
      weightKg: 5.2,
      feedsPerDay: 6,
    });
    expect(volumetric.value('volumetricDaily')).toBeCloseTo(866.666667, 4);
    expect(volumetric.value('singleFeedVolumetric')).toBeCloseTo(144.444444, 4); // the book rounds 866 up to 870 first
    // «Ребенку 7 мес., масса тела 7950 г; 7950 · 1/8 = 993 мл = 1000 мл»
    expect(
      run('infant-feeding-volume-methods', { ageMonths: 7, weightKg: 7.95 }).value(
        'volumetricDaily',
      ),
    ).toBeCloseTo(993.75, 6);
    // «Ребенку 4 мес. Масса тела 6400 г: 115 · 6,4 · 1000 / 700 = 1051 мл … не более 1 л → 1000 мл»
    const four = run('infant-feeding-volume-methods', {
      ageMonths: 4,
      weightKg: 6.4,
      milkKcalPer100Ml: 70,
    });
    expect(four.value('programmeRaw')).toBeCloseTo(1051.428571, 4);
    expect(four.value('kapitanDaily')).toBe(1000);
    // «Ребенку 2 мес., масса тела 3800 г. 115 · 3,8 · 1000 / 700 = 625 мл»
    const two = run('infant-feeding-volume-methods', {
      ageMonths: 2,
      weightKg: 3.8,
      milkKcalPer100Ml: 70,
    });
    expect(two.value('kapitanDaily')).toBeCloseTo(624.285714, 4);
    expect(Math.round(two.value('kapitanDaily') / 5) * 5).toBe(625);
  });

  it('infant: the Programme caps (850, 900, 1000 ml) and the Shkarin month steps', () => {
    const three = run('infant-feeding-volume-methods', {
      ageMonths: 3,
      weightKg: 6,
      milkKcalPer100Ml: 67,
    });
    expect(three.value('programmeDaily')).toBe(850); // 115 × 6 kcal would be 1030 ml
    expect(three.value('shkarinDaily')).toBe(850); // 800 + 50 × (3 − 2)
    expect(three.value('volumetricDaily')).toBe(1000); // 6000 g / 6 = 1000, not above 1000 ml
    expect(three.value('maslovDailyLow')).toBeCloseTo((6 * 115 * 100) / 67, 6); // second quarter 115–120 kcal/kg

    const four = run('infant-feeding-volume-methods', {
      ageMonths: 4.5,
      weightKg: 7.2,
      milkKcalPer100Ml: 70,
    });
    expect(four.value('programmeDaily')).toBe(900);
    expect(four.value('shkarinDaily')).toBe(900); // 800 + 50 × (4 − 2)
    expect(four.value('singleFeedProgramme')).toBe(900 / 5); // 5 feeds from 4.5 months

    const eight = run('infant-feeding-volume-methods', {
      ageMonths: 8,
      weightKg: 8.5,
      milkKcalPer100Ml: 70,
    });
    expect(eight.value('programmeDaily')).toBe(1000);
    expect(eight.value('shkarinDaily')).toBe(1000); // 1100 is limited to 1000 ml
    expect(eight.value('volumetricDaily')).toBe(1000); // 1/8 of 8.5 kg = 1062 ml
    expect(eight.interpretation).toContain('5 кормлений по 200 мл');
  });

  it('infant: Shkarin counts missing weeks below 8 weeks and the milk density defaults to 70 kcal', () => {
    const fortnight = run('infant-feeding-volume-methods', { ageMonths: 0.5, weightKg: 3.5 });
    expect(fortnight.value('shkarinDaily')).toBe(500); // 2 weeks: 800 − 50 × (8 − 2)
    expect(fortnight.value('volumetricDaily')).toBe(700); // 1/5 of 3.5 kg
    expect(fortnight.value('maslovDailyLow')).toBeCloseTo((3.5 * 120 * 100) / 70, 6);
    expect(fortnight.value('singleFeedVolumetric')).toBeCloseTo(700 / 6, 6);
    expect(
      rejects('infant-feeding-volume-methods', { ageMonths: 0.1, weightKg: 3.5 }),
    ).toBeTruthy();
  });

  it('infant: the fractions of the volumetric method change at 2, 4, 6 and 9 months', () => {
    const fractionAt = (ageMonths: number) =>
      run('infant-feeding-volume-methods', { ageMonths, weightKg: 8 }).value('volumetricFraction');
    expect(fractionAt(1.9)).toBeCloseTo(1 / 5, 6);
    expect(fractionAt(2)).toBeCloseTo(1 / 6, 6);
    expect(fractionAt(4)).toBeCloseTo(1 / 7, 6);
    expect(fractionAt(6)).toBeCloseTo(1 / 8, 6);
    expect(fractionAt(9)).toBeCloseTo(1 / 9, 6);
  });

  it('child over one year: 1000 + 100n kcal, 1200 + 100n ml and the meal shares of both editions', () => {
    const edition2021 = run('child-energy-volume-over-one-year', { ageYears: 2, edition: 2021 });
    expect(edition2021.value('dailyKcal')).toBe(1200);
    expect(edition2021.value('dailyVolumeMl')).toBe(1400);
    expect(edition2021.value('kcalBreakfast')).toBe(300);
    expect([edition2021.value('kcalLunchLow'), edition2021.value('kcalLunchHigh')]).toEqual([
      360, 420,
    ]);
    expect([edition2021.value('kcalSnackLow'), edition2021.value('kcalSnackHigh')]).toEqual([
      180, 240,
    ]);
    expect(edition2021.value('kcalDinner')).toBe(240);
    expect(edition2021.value('normKcalMr')).toBe(1400); // third year of life
    expect(edition2021.interpretation).toContain('1400 ккал');

    const edition2014 = run('child-energy-volume-over-one-year', { ageYears: 2, edition: 2014 });
    expect([edition2014.value('kcalLunchLow'), edition2014.value('kcalLunchHigh')]).toEqual([
      420, 480,
    ]);
    expect([edition2014.value('kcalSnackLow'), edition2014.value('kcalSnackHigh')]).toEqual([
      120, 180,
    ]);
    expect(edition2014.value('kcalDinner')).toBe(300);

    const second = run('child-energy-volume-over-one-year', { ageYears: 1.5, edition: 2021 });
    expect(second.value('dailyKcal')).toBe(1150);
    expect(second.value('normKcalMr')).toBe(1200); // second year of life
    expect(second.interpretation).toContain('1200 ккал');
    expect(
      rejects('child-energy-volume-over-one-year', { ageYears: 3.5, edition: 2021 }),
    ).toBeTruthy();
  });

  it('fruit puree and juice: the 10 × n formulas and table 5.1', () => {
    const eight = run('fruit-puree-juice-volume', { ageMonths: 8 });
    expect([eight.value('formulaHigh'), eight.value('formulaLow')]).toEqual([80, 70]);
    expect([eight.value('pureeFrom'), eight.value('pureeTo')]).toEqual([80, 80]);
    expect([eight.value('juiceFrom'), eight.value('juiceTo')]).toEqual([5, 60]);

    const five = run('fruit-puree-juice-volume', { ageMonths: 5 });
    expect([five.value('formulaHigh'), five.value('formulaLow')]).toEqual([50, 40]);
    expect([five.value('pureeFrom'), five.value('pureeTo')]).toEqual([5, 50]);
    expect([five.value('juiceFrom'), five.value('juiceTo')]).toEqual([0, 0]);
    expect(five.interpretation).toContain('с 8 месяцев');

    const twelve = run('fruit-puree-juice-volume', { ageMonths: 12 });
    expect([twelve.value('formulaHigh'), twelve.value('formulaLow')]).toEqual([100, 100]); // not more than 100 ml
    expect([twelve.value('pureeFrom'), twelve.value('pureeTo')]).toEqual([90, 100]);
    expect([twelve.value('juiceFrom'), twelve.value('juiceTo')]).toEqual([80, 100]);
  });

  it('hypogalactia: deficit percentage and the four degrees', () => {
    const second = run('hypogalactia-degree', { requiredMl: 800, receivedMl: 500 });
    expect(second.value('deficitMl')).toBe(300);
    expect(second.value('deficitPercent')).toBeCloseTo(37.5, 6);
    expect(second.value('degree')).toBe(2);
    expect(second.interpretation).toContain('II степени');

    const degreeAt = (receivedMl: number) =>
      run('hypogalactia-degree', { requiredMl: 800, receivedMl }).value('degree');
    expect(degreeAt(800)).toBe(0);
    expect(degreeAt(1000)).toBe(0); // more than needed is not a deficit
    expect(degreeAt(600)).toBe(1); // 25 % deficit stays in degree I
    expect(degreeAt(599)).toBe(2);
    expect(degreeAt(400)).toBe(2); // 50 %
    expect(degreeAt(399)).toBe(3);
    expect(degreeAt(200)).toBe(3); // 75 %
    expect(degreeAt(199)).toBe(4);
    expect(
      run('hypogalactia-degree', { requiredMl: 800, receivedMl: 100 }).interpretation,
    ).toContain('IV степени');
    expect(
      run('hypogalactia-degree', { requiredMl: 800, receivedMl: 800 }).interpretation,
    ).toContain('нет');
  });

  it('undernutrition: 120–160 kcal/kg, 3–4.5 up to 6 g/kg protein and the healthy norms', () => {
    const infant = run('undernutrition-energy-protein-target', { weightKg: 6, ageMonths: 3 });
    expect([
      infant.value('energyLow'),
      infant.value('energyHigh'),
      infant.value('energyExceptional'),
    ]).toEqual([720, 960, 1320]);
    expect([
      infant.value('proteinFrom'),
      infant.value('proteinTo'),
      infant.value('proteinMax'),
    ]).toEqual([18, 27, 36]);
    expect(infant.value('healthyEnergy')).toBe(690); // 115 kcal/kg below 6 months
    expect(infant.value('healthyProteinFrom')).toBeCloseTo(13.2, 6);
    expect(infant.value('healthyProteinTo')).toBeCloseTo(15.6, 6);

    const older = run('undernutrition-energy-protein-target', { weightKg: 6, ageMonths: 8 });
    expect(older.value('healthyEnergy')).toBe(660); // 110 kcal/kg from 6 months
    expect(older.value('healthyProteinFrom')).toBeCloseTo(17.4, 6);
    expect(older.value('healthyProteinTo')).toBeCloseTo(17.4, 6);
  });
});
