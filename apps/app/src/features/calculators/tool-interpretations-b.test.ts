import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
} from '@/features/assessments/assessment-types';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import {
  loadToolModuleCalculatorSchemas,
  loadToolModuleRecords,
} from '@/features/calculators/tool-module-test-helpers';

/**
 * Result interpretations of the gastroenterology, neonatology, obstetrics/gynaecology, pediatrics,
 * pediatric growth, psychology, rheumatology/oncology/urology and surgery modules (TOOLS-B): every
 * tool states how its result is read, or says why it cannot be, and the new bands are replayed at
 * their boundaries.
 */
const FILES = [
  'content/tool-modules/gastroenterology.json',
  'content/tool-modules/neonatology.json',
  'content/tool-modules/neurology-rehab.json',
  'content/tool-modules/obstetrics-gynecology.json',
  'content/tool-modules/pediatrics.json',
  'content/tool-modules/pediatrics-growth.json',
  'content/tool-modules/psychology.json',
  'content/tool-modules/rheum-gi-onco-uro.json',
  'content/tool-modules/surgery-trauma.json',
] as const;

const RECORDS = loadToolModuleRecords(FILES);
const SCHEMAS = loadToolModuleCalculatorSchemas(FILES);

function calculatorSchemaFromModules(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`no calculator ${id}`);
  return schema;
}

function registerAll(): void {
  for (const record of RECORDS) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
}

beforeAll(registerAll);
afterEach(() => {
  clearDownloadedAssessments();
  registerAll();
});

describe('every tool of these modules states how its result is read', () => {
  it('has a verdict with rules and sources, or a reason why there is none', () => {
    for (const record of RECORDS) {
      const evaluation = (
        record.definition as {
          evaluation: {
            status: string;
            rules: { verdict: { sourceIds: string[] } }[];
            reason?: string;
            sourceIds: string[];
          };
        }
      ).evaluation;
      const known = new Set(record.sources.map((source) => source.id));
      expect(evaluation.status, record.id).not.toBe('unavailable');
      if (evaluation.status === 'not-applicable') {
        expect(evaluation.reason?.length ?? 0, record.id).toBeGreaterThan(20);
        expect(evaluation.rules, record.id).toEqual([]);
      }
      if (evaluation.status === 'verdict') {
        expect(evaluation.rules.length, record.id).toBeGreaterThan(0);
      }
      for (const id of evaluation.sourceIds)
        expect(known.has(id), `${record.id}: ${id}`).toBe(true);
      for (const rule of evaluation.rules) {
        expect(rule.verdict.sourceIds.length, record.id).toBeGreaterThan(0);
        for (const id of rule.verdict.sourceIds) {
          expect(known.has(id), `${record.id}: ${id}`).toBe(true);
        }
      }
    }
  });
});

/** Answers that sum to `total`: the largest option that still fits, item by item. */
function answersForTotal(definition: AssessmentDefinition, total: number): AssessmentAnswers {
  const answers: Record<string, number> = {};
  let remaining = total;
  for (const question of definition.questions) {
    const options = (question.responseOptions ?? definition.responseOptions).map(
      (option) => option.value,
    );
    const lowest = Math.min(...options);
    const pick = Math.max(...options.filter((value) => value <= remaining), lowest);
    answers[question.id] = pick;
    remaining -= pick;
  }
  if (remaining !== 0) throw new Error(`Cannot reach ${total} in ${definition.id}`);
  return answers;
}

async function rangeFor(slug: string, total: number): Promise<string | undefined> {
  const definition = await loadAssessmentDefinition(slug);
  const result = scoreAssessment(definition, answersForTotal(definition, total));
  if (!result.ok) throw new Error(result.error);
  expect(result.value.scores[0]?.rawScore).toBe(total);
  return result.value.evaluation?.verdict?.rangeId;
}

describe('score bands replay at their boundaries', () => {
  it.each([
    [
      'pediatric-ulcerative-colitis-activity-index',
      [
        [5, 1],
        [10, 2],
        [30, 2],
        [35, 3],
        [60, 3],
        [65, 4],
      ],
    ],
    [
      'vesikari-gastroenteritis',
      [
        [6, 1],
        [7, 2],
        [10, 2],
        [11, 3],
      ],
    ],
    [
      'partial-mayo-score',
      [
        [0, 'partial-mayo-remission'],
        [1, 'partial-mayo-borderline'],
        [2, 'partial-mayo-mild'],
        [3, 'partial-mayo-moderate'],
        [5, 'partial-mayo-moderate'],
        [6, 'partial-mayo-severe'],
      ],
    ],
    [
      'silverman-andersen-respiratory-distress',
      [
        [0, 1],
        [2, 2],
        [3, 3],
        [4, 4],
        [6, 4],
        [7, 5],
        [8, 6],
      ],
    ],
    [
      'downes-vidyasagar-respiratory-distress',
      [
        [4, 1],
        [5, 2],
        [7, 2],
        [8, 3],
      ],
    ],
    [
      'nips-neonatal-infant-pain-scale',
      [
        [1, 1],
        [2, 2],
        [4, 3],
        [5, 4],
      ],
    ],
    [
      'apgar',
      [
        [3, 1],
        [4, 2],
        [6, 2],
        [7, 3],
      ],
    ],
    [
      'ferriman-gallwey',
      [
        [7, 1],
        [8, 2],
      ],
    ],
    [
      'whooley',
      [
        [0, 1],
        [1, 2],
      ],
    ],
    [
      'flacc-pain-scale',
      [
        [0, 1],
        [3, 2],
        [4, 3],
        [6, 3],
        [7, 4],
      ],
    ],
  ] as const)('%s', async (slugPart, cases) => {
    const record = RECORDS.find(
      (candidate) => candidate.slug.includes(slugPart) || candidate.id.includes(slugPart),
    );
    if (!record) throw new Error(`no tool ${slugPart}`);
    const definition = (await loadAssessmentDefinition(record.slug)) as AssessmentDefinition;
    const scaleId = definition.scales[0]?.id ?? '';
    for (const [total, expected] of cases as readonly (readonly [number, number | string])[]) {
      const range = await rangeFor(record.slug, total);
      const wanted = typeof expected === 'number' ? `${scaleId}-${expected}` : expected;
      expect(range, `${record.slug} at ${total}`).toBe(wanted);
    }
  });

  it('EPDS: below and at the screening reference of 8', async () => {
    const record = RECORDS.find((candidate) => candidate.slug.includes('epds'));
    if (!record) throw new Error('no EPDS');
    expect(await rangeFor(record.slug, 7)).toBe('epds-below');
    expect(await rangeFor(record.slug, 8)).toBe('epds-screen-positive');
  });
});

describe('calculator bands', () => {
  function rangeOf(id: string, inputs: Record<string, number | string>): string | undefined {
    const result = evaluateCalculatorSchema(calculatorSchemaFromModules(id), inputs);
    if (!result.ok) throw new Error(result.error);
    return result.evaluation.verdict?.rangeId;
  }

  it('blood loss by hematocrit: ATLS classes by share of the blood volume', () => {
    const base = { sex: 'male', heightCm: 180, weightKg: 80 };
    const at = (htBefore: number, htAfter: number) =>
      rangeOf('minimed.calculator.blood-loss-hematocrit', { ...base, htBefore, htAfter });
    expect(at(40, 36)).toBe('blood-loss-1'); // 10.5 %
    expect(at(40, 32)).toBe('blood-loss-2'); // 22 %
    expect(at(40, 28)).toBe('blood-loss-3'); // 35 %
    expect(at(40, 25)).toBe('blood-loss-4'); // 46 %
  });

  it('fetal growth: the weight percentile from the protocol against the ISUOG 3rd and 10th', () => {
    const at = (efwPercentile: number) =>
      rangeOf('obstetric-fetal-growth-doppler', {
        gaWeeks: 30,
        gaDays: 0,
        efwG: 1300,
        efwPercentile,
        umbilicalArteryPi: 1,
        middleCerebralArteryPi: 1.5,
        uterineArteryPiRight: 1,
        uterineArteryPiLeft: 1,
      });
    expect(at(2)).toBe('efw-percentile-1');
    expect(at(3)).toBe('efw-percentile-2');
    expect(at(9.9)).toBe('efw-percentile-2');
    expect(at(10)).toBe('efw-percentile-3');
    expect(at(60)).toBe('efw-percentile-3');
  });

  it('breast cancer risk: the 5-year threshold of 1.66 % separates two bands', () => {
    const base = { race: 'white', atypicalHyperplasia: 0 };
    const low = rangeOf('gynecology-breast-cancer-risk', {
      ...base,
      ageYears: 30,
      biopsiesCategory: 0,
      menarcheCategory: 0,
      firstBirthCategory: 0,
      relativesCategory: 0,
    });
    const high = rangeOf('gynecology-breast-cancer-risk', {
      ...base,
      ageYears: 60,
      biopsiesCategory: 2,
      menarcheCategory: 2,
      firstBirthCategory: 3,
      relativesCategory: 2,
    });
    expect(low).toBe('bcrat-5y-1');
    expect(high).toBe('bcrat-5y-2');
  });

  it('hypogalactia: the degree from the milk deficit', () => {
    const at = (receivedMl: number) =>
      rangeOf('minimed.calculator.hypogalactia-degree', { requiredMl: 1000, receivedMl });
    expect(at(1000)).toBe('hypogalactia-1');
    expect(at(800)).toBe('hypogalactia-2'); // 20 % deficit
    expect(at(600)).toBe('hypogalactia-3'); // 40 %
    expect(at(400)).toBe('hypogalactia-4'); // 60 %
    expect(at(100)).toBe('hypogalactia-5'); // 90 %
  });
});

describe('WHO growth: plain wording and a band for every z-score', () => {
  const schema = calculatorSchemaFromModules('minimed.calculator.pediatric-anthropometry-who');

  it('names the reference used and the way the length was measured', () => {
    const position = schema.inputs.find((input) => input.id === 'measure_position');
    expect(position?.label).toBe('Как измерены длина или рост');
    expect(position?.options?.map((option) => option.label)).toEqual([
      'По возрасту: до 2 лет лёжа, с 2 лет стоя',
      'Лёжа (длина)',
      'Стоя (рост)',
    ]);
    const labels = schema.steps.filter((step) => step.isOutput).map((step) => step.label);
    expect(labels.some((label) => label.includes('(ВОЗ 0–5)'))).toBe(true);
    expect(labels.some((label) => label.includes('(ВОЗ 5–19)'))).toBe(true);
    expect(labels.join(' ')).not.toMatch(/z-score|BMI/u);
  });

  it('places each calculated z-score on its band', () => {
    const result = evaluateCalculatorSchema(schema, {
      date_of_birth: '2025-01-01',
      measurement_date: '2025-07-01',
      biological_sex: 'male',
      measure_position: 'auto',
      length_height_cm: 60,
      weight_g: 6000,
      head_circumference_cm: 41,
    });
    if (!result.ok) throw new Error(result.error);
    const zIds = schema.steps
      .filter((step) => step.id.endsWith('_z') && step.isOutput)
      .map((step) => step.id);
    expect(zIds.length).toBe(10);
    for (const scale of schema.scoreScales) {
      expect(zIds).toContain(scale.valueId);
      expect(scale.bands.length).toBeGreaterThanOrEqual(3);
    }
    const shown = result.scales.filter((scale) => zIds.includes(scale.valueId));
    expect(shown.length).toBeGreaterThanOrEqual(3);
    for (const scale of shown) expect(scale.activeBand).toBeDefined();
  });
});

describe('profile tests read the leading scale without clinical claims', () => {
  function answersLeading(definition: AssessmentDefinition, scaleId: string): AssessmentAnswers {
    const answers: Record<string, number> = {};
    for (const question of definition.questions) {
      const highest = question.reverse ? 1 : 5;
      const lowest = question.reverse ? 5 : 1;
      answers[question.id] = question.scaleId === scaleId ? highest : lowest;
    }
    return answers;
  }

  it.each(['braverman-behavioral', 'egogram', 'paei', 'team-roles'])(
    '%s: the highest scale is named, with no verdict',
    async (slugPart) => {
      const record = RECORDS.find(
        (candidate) => candidate.slug.includes(slugPart) || candidate.id.includes(slugPart),
      );
      if (!record) throw new Error(`no tool ${slugPart}`);
      const definition = await loadAssessmentDefinition(record.slug);
      for (const scale of definition.scales) {
        const result = scoreAssessment(definition, answersLeading(definition, scale.id));
        if (!result.ok) throw new Error(result.error);
        expect(result.value.headline, scale.id).toContain(scale.label);
        expect(result.value.summary, scale.id).not.toMatch(/диагноз:|заболевани/u);
        expect(result.value.evaluation?.status).toBe('not-applicable');
      }
    },
  );
});
