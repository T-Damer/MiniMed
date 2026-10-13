import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ToolDefinitionRecordSchema } from '@localmed/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDownloadedCalculators,
  getCalculatorRegistry,
  registerDownloadedCalculator,
} from '@/features/calculators/calculator-registry';
import { getCalculatorSchema } from '@/features/calculators/calculator-schema-catalog';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/surgery-trauma.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number | string>;
type Table = readonly (readonly [number, number])[];

interface Run {
  readonly values: Readonly<Record<string, number>>;
  readonly rangeId: string | undefined;
  readonly status: string;
  readonly interpretation: string | undefined;
  readonly explanation: string | undefined;
}

function schemaOf(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema;
}

function run(id: string, inputs: Inputs): Run {
  const result = evaluateCalculatorSchema(schemaOf(id), inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const values: Record<string, number> = {};
  for (const output of result.outputs) {
    if (output.kind === 'number') values[output.id] = output.value;
  }
  return {
    values,
    rangeId: result.evaluation.verdict?.rangeId,
    status: result.evaluation.status,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
    explanation: result.evaluation.verdict?.explanation,
  };
}

function out(result: Run, key: string): number {
  const found = result.values[key];
  if (found === undefined) throw new Error(`no output ${key}`);
  return found;
}

function failure(id: string, inputs: Inputs): string {
  const result = evaluateCalculatorSchema(schemaOf(id), inputs);
  if (result.ok) throw new Error(`${id}: expected a failure`);
  return result.error;
}

function value(id: string, inputs: Inputs, key = 'score'): number {
  const found = run(id, inputs).values[key];
  if (found === undefined) throw new Error(`${id}: no output ${key}`);
  return found;
}

/** Each [input value, points] pair moves the total by points − basePoints from the baseline. */
function expectTable(
  id: string,
  base: Inputs,
  key: string,
  table: Table,
  basePoints = 1,
  output = 'score',
): void {
  const baseline = value(id, base, output);
  for (const [input, points] of table) {
    expect(value(id, { ...base, [key]: input }, output), `${id} / ${key}=${input}`).toBeCloseTo(
      baseline - basePoints + points,
      6,
    );
  }
}

interface BandCase {
  readonly name: string;
  readonly inputs: Inputs;
  readonly score: number;
  readonly range: string;
  readonly output?: string;
  readonly includes?: string;
}

function expectBands(id: string, cases: readonly BandCase[]): void {
  for (const testCase of cases) {
    const result = run(id, testCase.inputs);
    expect(
      result.values[testCase.output ?? 'score'],
      `${id} / ${testCase.name}: score`,
    ).toBeCloseTo(testCase.score, 6);
    expect(result.rangeId, `${id} / ${testCase.name}: band`).toBe(testCase.range);
    expect(result.interpretation, `${id} / ${testCase.name}: interpretation`).toBe(
      result.explanation,
    );
    if (testCase.includes) {
      expect(result.interpretation, `${id} / ${testCase.name}: published figure`).toContain(
        testCase.includes,
      );
    }
  }
}

interface ItemTables {
  readonly tables: Record<string, Table>;
  readonly base: Inputs;
  readonly edges: readonly (readonly [number, Inputs])[];
}

const VPH = JSON.parse(
  '{"SP":{"tables":{"skin":[[0,1],[1,2],[2,4],[3,7]],"breathing":[[0,1],[1,5],[2,8]],"auscultation":[[0,1],[1,3],[2,7]],"speech":[[0,1],[1,3],[2,6]],"pain":[[0,1],[1,6]],"reflex":[[0,1],[1,8]],"pupils":[[0,1],[1,2],[2,4],[3,6]],"rhythm":[[0,1],[1,8]],"pulse":[[0,1],[1,3],[2,4],[3,7],[4,9]],"sbp":[[0,1],[1,3],[2,4],[3,5],[4,7],[5,8]],"bloodLoss":[[0,1],[1,3],[2,4],[3,6],[4,9]],"bowel":[[0,1],[1,3],[2,5]]},"base":{"skin":0,"breathing":0,"auscultation":0,"speech":0,"pain":0,"reflex":0,"pupils":0,"rhythm":0,"pulse":0,"sbp":0,"bloodLoss":0,"bowel":0},"edges":[[12,{}],[13,{"pupils":1}],[20,{"bloodLoss":4}],[21,{"bloodLoss":3,"bowel":2}],[31,{"sbp":5,"bloodLoss":4,"bowel":2}],[32,{"pulse":1,"sbp":4,"bloodLoss":4,"bowel":2}],[45,{"rhythm":1,"pulse":4,"sbp":4,"bloodLoss":4,"bowel":2}],[46,{"rhythm":1,"pulse":4,"sbp":5,"bloodLoss":4,"bowel":2}],[87,{"skin":3,"breathing":2,"auscultation":2,"speech":2,"pain":1,"reflex":1,"pupils":3,"rhythm":1,"pulse":4,"sbp":5,"bloodLoss":4,"bowel":2}]]},"SG":{"tables":{"gcs":[[15,1],[14,1],[13,3],[11,3],[10,6],[8,6],[7,8],[5,8],[4,9],[3,9]],"breathing":[[0,1],[1,6],[2,9]],"auscultation":[[0,1],[1,3],[2,6]],"rhythm":[[0,1],[1,6]],"hr":[[80,1],[60,1],[59,7],[90,1],[91,3],[100,3],[101,5],[140,5],[141,7],[0,9]],"sbp":[[100,1],[150,1],[99,4],[81,4],[80,8],[61,8],[60,9],[0,9]],"bowel":[[0,1],[1,3],[2,5]],"bilirubin":[[20.5,1],[20.6,4],[10,1]],"protein":[[70,1],[60.1,1],[60,3],[50,3],[49.9,5]],"diuresis":[[1250,1],[2500,1],[2501,2],[1249,5],[0,5]],"creatinine":[[140,1],[141,3],[80,1]],"temp":[[36,1],[37,1],[37.1,2],[38,2],[38.1,3],[35.9,3]],"rbc":[[3,1],[2.9,2],[2.6,2],[2.5,4],[4.5,1]],"wbc":[[4,1],[8,1],[8.1,2],[10,2],[10.1,3],[12,3],[12.1,4],[3.9,4]],"bands":[[5,1],[10,1],[11,2],[20,2],[21,4]],"clotting":[[4.9,5],[5,1],[12,1],[12.5,3],[16,3],[16.5,8]]},"base":{"gcs":15,"breathing":0,"auscultation":0,"rhythm":0,"hr":70,"sbp":120,"bowel":0,"bilirubin":15,"protein":70,"diuresis":2000,"creatinine":100,"temp":36.6,"rbc":4.5,"wbc":6,"bands":5,"clotting":8},"edges":[[16,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1250,"creatinine":140,"temp":36,"rbc":3,"wbc":4,"clotting":5}],[22,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1250,"creatinine":140,"temp":36,"rbc":3,"wbc":8.1,"bands":11,"clotting":4.9}],[23,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1250,"creatinine":140,"temp":36,"rbc":3,"wbc":4,"clotting":16.5}],[32,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1250,"creatinine":140,"temp":36,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}],[33,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1250,"creatinine":140,"temp":37.1,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}],[40,{"hr":80,"sbp":100,"bilirubin":20.5,"diuresis":1249,"creatinine":141,"temp":38.1,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}],[41,{"hr":80,"sbp":100,"bilirubin":20.5,"protein":60,"diuresis":1249,"creatinine":141,"temp":37.1,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}],[50,{"hr":80,"sbp":100,"bowel":2,"bilirubin":20.6,"protein":49.9,"diuresis":1249,"creatinine":141,"temp":37.1,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}],[51,{"hr":80,"sbp":100,"bowel":2,"bilirubin":20.6,"protein":49.9,"diuresis":1249,"creatinine":141,"temp":38.1,"rbc":2.5,"wbc":12.1,"bands":21,"clotting":16.5}]]},"SS":{"tables":{"gcs":[[15,1],[14,1],[13,3],[11,3],[10,6],[8,6],[7,8],[5,8],[4,9],[3,9]],"breathing":[[0,1],[1,6],[2,9],[3,6],[4,9]],"pf":[[400,1],[301,1],[300,4],[150,4],[149,8]],"sao2":[[98,1],[94,1],[93,5],[90,5],[89,9]],"paco2":[[40,1],[32,1],[31,4],[50,1],[51,2],[60,2],[61,4]],"rhythm":[[0,1],[1,6]],"pulse":[[0,1],[1,5],[2,7],[3,8],[4,9]],"sbp":[[120,1],[101,1],[100,4],[81,4],[80,8],[61,8],[60,9]],"inotropes":[[0,1],[1,8]],"si":[[50,1],[40.1,1],[40,3],[28,3],[27.9,5]],"rbc":[[4.5,1],[3.1,1],[3,5],[2.6,5],[2.5,9]],"fibrinogen":[[3,1],[2.3,1],[4,1],[2.2,3],[4.1,3]],"clotting":[[4.9,5],[5,1],[12,1],[12.5,3],[16,3],[16.5,8]],"hourlyDiuresis":[[100,1],[60,1],[59,3]],"creatinine":[[140,1],[141,3],[80,1]],"urea":[[5,1],[8.3,1],[8.4,3]],"bilirubin":[[15,1],[20.5,1],[20.6,4]],"bowel":[[0,1],[1,3],[2,5]],"protein":[[70,1],[60.1,1],[60,3],[50,3],[49.9,5]],"middleMolecules":[[0,1],[1,3],[2,5],[3,7]],"urineIndex":[[0,1],[1,4],[2,9]],"temp":[[36.6,1],[35.9,1],[35.8,3],[37,1],[37.1,2],[38,2],[38.1,3]],"wbc":[[6,1],[4,1],[8,1],[8.1,3],[12,3],[12.1,4],[3.9,4]],"bands":[[5,1],[10,1],[11,2],[20,2],[21,4]],"bacteremia":[[0,1],[1,5]]},"base":{"gcs":15,"breathing":0,"pf":400,"sao2":98,"paco2":40,"rhythm":0,"pulse":0,"sbp":120,"inotropes":0,"si":50,"rbc":4.5,"fibrinogen":3,"clotting":8,"hourlyDiuresis":100,"creatinine":100,"urea":5,"bilirubin":15,"bowel":0,"protein":70,"middleMolecules":0,"urineIndex":0,"temp":36.6,"wbc":6,"bands":5,"bacteremia":0},"edges":[[25,{"clotting":5,"creatinine":140}],[32,{"clotting":5,"creatinine":140,"bands":21,"bacteremia":1}],[33,{"clotting":5,"creatinine":140,"wbc":12.1,"bands":11,"bacteremia":1}],[49,{"clotting":5,"creatinine":140,"middleMolecules":2,"urineIndex":2,"temp":35.8,"wbc":12.1,"bands":21,"bacteremia":1}],[50,{"clotting":5,"creatinine":140,"middleMolecules":3,"urineIndex":2,"temp":37.1,"wbc":12.1,"bands":21,"bacteremia":1}],[69,{"clotting":12.5,"hourlyDiuresis":59,"creatinine":141,"urea":8.4,"bilirubin":20.6,"bowel":2,"protein":49.9,"middleMolecules":3,"urineIndex":2,"temp":37.1,"wbc":12.1,"bands":21,"bacteremia":1}],[70,{"clotting":12.5,"hourlyDiuresis":59,"creatinine":141,"urea":8.4,"bilirubin":20.6,"bowel":2,"protein":49.9,"middleMolecules":3,"urineIndex":2,"temp":35.8,"wbc":12.1,"bands":21,"bacteremia":1}],[98,{"sbp":100,"inotropes":1,"si":27.9,"rbc":2.5,"fibrinogen":2.2,"clotting":16.5,"hourlyDiuresis":59,"creatinine":141,"urea":8.4,"bilirubin":20.6,"bowel":2,"protein":49.9,"middleMolecules":3,"urineIndex":2,"temp":37.1,"wbc":12.1,"bands":21,"bacteremia":1}],[99,{"sbp":100,"inotropes":1,"si":27.9,"rbc":2.5,"fibrinogen":2.2,"clotting":16.5,"hourlyDiuresis":59,"creatinine":141,"urea":8.4,"bilirubin":20.6,"bowel":2,"protein":49.9,"middleMolecules":3,"urineIndex":2,"temp":35.8,"wbc":12.1,"bands":21,"bacteremia":1}]]}}',
) as Record<'SP' | 'SG' | 'SS', ItemTables>;

function expectAllItems(id: string, data: ItemTables, minimum: number): void {
  expect(value(id, data.base), `${id} baseline`).toBe(minimum);
  for (const [key, table] of Object.entries(data.tables)) {
    expectTable(id, data.base, key, table);
  }
}

describe('surgery, trauma and perioperative tool module', () => {
  afterEach(() => clearDownloadedCalculators());

  it('validates, registers and attributes every calculator to a real publication', () => {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), MODULE_FILE), 'utf8')) as {
      tools: readonly unknown[];
    };
    expect(source.tools).toHaveLength(30);
    for (const rawTool of source.tools) {
      const record = ToolDefinitionRecordSchema.parse(rawTool);
      expect(record.sources.length, record.id).toBeGreaterThan(0);
      for (const link of record.sources) {
        expect(link.title).not.toMatch(/MiniMed/iu);
        if (link.url) expect(link.url).toMatch(/^https:\/\//u);
      }
      registerDownloadedCalculator(record);
    }
    const ids = SCHEMAS.map((schema) => schema.id);
    expect(ids).toHaveLength(30);
    const registered = getCalculatorRegistry().filter(
      (calculator) => getCalculatorSchema(calculator.id) !== undefined,
    );
    expect(registered.map((calculator) => calculator.id)).toEqual(expect.arrayContaining(ids));
  });

  it('declares every band as a verdict rule with the same wording as the interpretation', () => {
    for (const schema of SCHEMAS) {
      if (schema.evaluation.status === 'unavailable') {
        expect(schema.interpretations, schema.id).toHaveLength(0);
        expect(schema.evaluation.reason, schema.id).toBeTruthy();
        continue;
      }
      expect(schema.evaluation.status, schema.id).toBe('verdict');
      expect(schema.evaluation.rules.map((rule) => rule.when)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.when),
      );
      expect(schema.evaluation.rules.map((rule) => rule.verdict.explanation)).toEqual(
        schema.interpretations.map((interpretation) => interpretation.message),
      );
    }
  });

  describe('Revised Trauma Score (Champion 1989: coded GCS, SBP, RR; weights 0.9368 / 0.7326 / 0.2908)', () => {
    const id = 'minimed.calculator.rts';
    const base: Inputs = { gcs: 15, sbp: 120, rr: 16 };
    it('codes every published interval of each component', () => {
      expectTable(
        id,
        base,
        'gcs',
        [
          [15, 4],
          [13, 4],
          [12, 3],
          [9, 3],
          [8, 2],
          [6, 2],
          [5, 1],
          [4, 1],
          [3, 0],
        ],
        4,
        'triageRts',
      );
      expectTable(
        id,
        base,
        'sbp',
        [
          [120, 4],
          [90, 4],
          [89, 3],
          [76, 3],
          [75, 2],
          [50, 2],
          [49, 1],
          [1, 1],
          [0, 0],
        ],
        4,
        'triageRts',
      );
      expectTable(
        id,
        base,
        'rr',
        [
          [16, 4],
          [29, 4],
          [10, 4],
          [30, 3],
          [9, 2],
          [6, 2],
          [5, 1],
          [1, 1],
          [0, 0],
        ],
        4,
        'triageRts',
      );
    });
    it('weights the codes for the outcome score and splits the triage criterion at 12', () => {
      expectBands(id, [
        { name: 'all normal', inputs: base, score: 12, range: 'normal', output: 'triageRts' },
        {
          name: 'one component abnormal',
          inputs: { ...base, gcs: 12 },
          score: 11,
          range: 'abnormal',
          output: 'triageRts',
        },
      ]);
      expect(value(id, base, 'rts')).toBeCloseTo(7.8408, 4);
      expect(value(id, { gcs: 12, sbp: 80, rr: 8 }, 'rts')).toBeCloseTo(
        0.9368 * 3 + 0.7326 * 3 + 0.2908 * 2,
        4,
      );
      expect(value(id, { gcs: 3, sbp: 0, rr: 0 }, 'rts')).toBe(0);
    });
  });

  describe('TRISS (MTOS 1995 coefficients; age index at 55; under 15 uses the blunt model)', () => {
    const id = 'minimed.calculator.triss';
    const normal: Inputs = { gcs: 15, sbp: 120, rr: 16, iss: 9, ageYears: 30, mechanism: 0 };
    it('reproduces the blunt and penetrating logistic models', () => {
      expect(value(id, normal, 'survival')).toBeCloseTo(99.4164175, 4);
      expect(value(id, { ...normal, mechanism: 1 }, 'survival')).toBeCloseTo(99.0693118, 4);
      expect(value(id, { ...normal, ageYears: 55 }, 'survival')).toBeCloseTo(96.7544352, 4);
      expect(value(id, { ...normal, ageYears: 54 }, 'survival')).toBeCloseTo(99.4164175, 4);
      const poor: Inputs = { gcs: 8, sbp: 70, rr: 8, iss: 34, ageYears: 70, mechanism: 0 };
      expect(value(id, poor, 'survival')).toBeCloseTo(13.4440244, 4);
      expect(value(id, { ...poor, mechanism: 1 }, 'survival')).toBeCloseTo(12.0217233, 4);
    });
    it('applies the blunt model to a penetrating injury under 15 years', () => {
      expect(value(id, { ...normal, ageYears: 14, mechanism: 1 }, 'survival')).toBeCloseTo(
        99.4164175,
        4,
      );
      expect(value(id, { ...normal, ageYears: 15, mechanism: 1 }, 'survival')).toBeCloseTo(
        99.0693118,
        4,
      );
    });
    it('declares no band: the result is a probability', () => {
      expect(run(id, normal).status).toBe('unavailable');
    });
  });

  describe('Injury Severity Score (Baker 1974: three largest regional AIS, squared; AIS 6 gives 75)', () => {
    const id = 'minimed.calculator.iss';
    const regions = ['headNeck', 'face', 'chest', 'abdomen', 'extremities', 'external'];
    const make = (levels: readonly number[]): Inputs =>
      Object.fromEntries(regions.map((region, index) => [region, levels[index] ?? 0]));
    it('sums the squares of the three largest scores and ignores the rest', () => {
      expectBands(id, [
        {
          name: 'no injury',
          inputs: make([0, 0, 0, 0, 0, 0]),
          score: 0,
          range: 'minor',
          output: 'iss',
        },
        {
          name: '3, 3, 2',
          inputs: make([3, 3, 2, 0, 0, 0]),
          score: 22,
          range: 'severe',
          output: 'iss',
        },
        {
          name: 'order does not matter',
          inputs: make([0, 2, 0, 3, 0, 3]),
          score: 22,
          range: 'severe',
          output: 'iss',
        },
        {
          name: 'six regions at 1',
          inputs: make([1, 1, 1, 1, 1, 1]),
          score: 3,
          range: 'minor',
          output: 'iss',
        },
        {
          name: '4, 4, 3, 3, 2, 2',
          inputs: make([4, 4, 3, 3, 2, 2]),
          score: 41,
          range: 'very-severe',
          output: 'iss',
        },
        {
          name: '5, 4, 3, 2, 1, 0',
          inputs: make([5, 4, 3, 2, 1, 0]),
          score: 50,
          range: 'very-severe',
          output: 'iss',
        },
        {
          name: 'six regions at 2',
          inputs: make([2, 2, 2, 2, 2, 2]),
          score: 12,
          range: 'moderate',
          output: 'iss',
        },
        {
          name: 'three highest tied at 3',
          inputs: make([3, 3, 3, 3, 1, 0]),
          score: 27,
          range: 'very-severe',
          output: 'iss',
        },
      ]);
    });
    it('splits the bands at 8, 15, 24 and 75', () => {
      expectBands(id, [
        { name: '2, 2: eight', inputs: make([2, 2]), score: 8, range: 'minor', output: 'iss' },
        { name: '3: nine', inputs: make([3]), score: 9, range: 'moderate', output: 'iss' },
        {
          name: '3, 2, 1: fourteen',
          inputs: make([3, 2, 1]),
          score: 14,
          range: 'moderate',
          output: 'iss',
        },
        { name: '4: sixteen', inputs: make([4]), score: 16, range: 'severe', output: 'iss' },
        {
          name: '4, 2, 2: twenty-four',
          inputs: make([4, 2, 2]),
          score: 24,
          range: 'severe',
          output: 'iss',
        },
        {
          name: '5: twenty-five',
          inputs: make([5]),
          score: 25,
          range: 'very-severe',
          output: 'iss',
        },
        {
          name: '5, 5, 5: seventy-five by squares',
          inputs: make([5, 5, 5]),
          score: 75,
          range: 'maximal',
          output: 'iss',
        },
        {
          name: 'AIS 6 alone gives 75',
          inputs: make([6]),
          score: 75,
          range: 'maximal',
          output: 'iss',
        },
        {
          name: 'AIS 6 with minor injuries',
          inputs: make([1, 6, 2]),
          score: 75,
          range: 'maximal',
          output: 'iss',
        },
      ]);
    });
  });

  describe('CRAMS (Gormican 1982: five items 0–2; 8 or less is major trauma)', () => {
    const id = 'minimed.calculator.crams';
    const all2: Inputs = { circulation: 2, respiration: 2, abdomen: 2, motor: 2, speech: 2 };
    it('adds the five items and cuts at 8 / 9', () => {
      expectBands(id, [
        { name: 'all normal', inputs: all2, score: 10, range: 'minor', output: 'crams' },
        {
          name: 'nine: minor',
          inputs: { ...all2, speech: 1 },
          score: 9,
          range: 'minor',
          output: 'crams',
        },
        {
          name: 'eight: major',
          inputs: { ...all2, speech: 1, motor: 1 },
          score: 8,
          range: 'major',
          output: 'crams',
        },
        {
          name: 'one zero item',
          inputs: { ...all2, abdomen: 0 },
          score: 8,
          range: 'major',
          output: 'crams',
        },
        {
          name: 'all zero',
          inputs: { circulation: 0, respiration: 0, abdomen: 0, motor: 0, speech: 0 },
          score: 0,
          range: 'major',
          output: 'crams',
        },
      ]);
    });
  });

  describe('South African Triage Scale TEWS (EMSSA manual 2012: adult chart)', () => {
    const id = 'minimed.calculator.sats-tews';
    const base: Inputs = { mobility: 0, rr: 12, hr: 70, sbp: 120, temp: 37, avpu: 0, trauma: 0 };
    it('scores every interval of the chart', () => {
      expectTable(
        id,
        base,
        'rr',
        [
          [8, 2],
          [9, 0],
          [12, 0],
          [14, 0],
          [15, 1],
          [20, 1],
          [21, 2],
          [29, 2],
          [30, 3],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'hr',
        [
          [40, 2],
          [41, 1],
          [50, 1],
          [51, 0],
          [100, 0],
          [101, 1],
          [110, 1],
          [111, 2],
          [129, 2],
          [130, 3],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'sbp',
        [
          [70, 3],
          [71, 2],
          [80, 2],
          [81, 1],
          [100, 1],
          [101, 0],
          [199, 0],
          [200, 2],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'temp',
        [
          [34.9, 2],
          [35, 0],
          [38.4, 0],
          [38.5, 2],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'avpu',
        [
          [0, 0],
          [1, 1],
          [2, 2],
          [3, 3],
          [4, 2],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'mobility',
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        0,
        'tews',
      );
      expectTable(
        id,
        base,
        'trauma',
        [
          [0, 0],
          [1, 1],
        ],
        0,
        'tews',
      );
    });
    it('maps the total to the four SATS priorities', () => {
      expectBands(id, [
        { name: 'zero: routine', inputs: base, score: 0, range: 'green', output: 'tews' },
        {
          name: 'two: routine',
          inputs: { ...base, mobility: 2 },
          score: 2,
          range: 'green',
          output: 'tews',
        },
        {
          name: 'three: urgent',
          inputs: { ...base, mobility: 2, trauma: 1 },
          score: 3,
          range: 'yellow',
          output: 'tews',
        },
        {
          name: 'four: urgent',
          inputs: { ...base, mobility: 2, trauma: 1, avpu: 1 },
          score: 4,
          range: 'yellow',
          output: 'tews',
        },
        {
          name: 'five: very urgent',
          inputs: { ...base, mobility: 2, avpu: 3 },
          score: 5,
          range: 'orange',
          output: 'tews',
        },
        {
          name: 'six: very urgent',
          inputs: { ...base, mobility: 2, avpu: 3, trauma: 1 },
          score: 6,
          range: 'orange',
          output: 'tews',
        },
        {
          name: 'eight: emergency',
          inputs: { ...base, mobility: 2, avpu: 3, trauma: 1, rr: 25 },
          score: 8,
          range: 'red',
          output: 'tews',
        },
        {
          name: 'seven exactly',
          inputs: { mobility: 2, rr: 25, hr: 120, sbp: 120, temp: 37, avpu: 0, trauma: 1 },
          score: 7,
          range: 'red',
          output: 'tews',
        },
      ]);
    });
  });

  describe('ВПХ-СП (Указания по ВПХ 2013: 12 items, printed worked example 32 points)', () => {
    const id = 'minimed.calculator.vph-sp';
    it('scores every option of every item', () => expectAllItems(id, VPH.SP, 12));
    it('reproduces the printed example of 32 points', () => {
      const example: Inputs = {
        skin: 1,
        breathing: 1,
        auscultation: 1,
        speech: 0,
        pain: 0,
        reflex: 0,
        pupils: 0,
        rhythm: 0,
        pulse: 2,
        sbp: 2,
        bloodLoss: 2,
        bowel: 2,
      };
      expectBands(id, [
        { name: 'printed example', inputs: example, score: 32, range: 'extremely-severe' },
      ]);
    });
    it('cuts at 12, 20, 31, 45 and reaches the arithmetic maximum', () => {
      const names: Record<number, string> = {
        12: 'satisfactory',
        13: 'moderate',
        20: 'moderate',
        21: 'severe',
        31: 'severe',
        32: 'extremely-severe',
        45: 'extremely-severe',
        46: 'critical',
        87: 'critical',
      };
      for (const [target, overrides] of VPH.SP.edges) {
        expectBands(id, [
          {
            name: `${target} points`,
            inputs: { ...VPH.SP.base, ...overrides },
            score: target,
            range: names[target] ?? '',
          },
        ]);
      }
    });
  });

  describe('ВПХ-СГ(II) (Указания по ВПХ 2013: 16 items, worst value of the period)', () => {
    const id = 'minimed.calculator.vph-sg';
    it('scores every interval of every item', () => expectAllItems(id, VPH.SG, 16));
    it('cuts at 22, 32, 40 and 50', () => {
      const names: Record<number, string> = {
        16: 'satisfactory',
        22: 'satisfactory',
        23: 'moderate',
        32: 'moderate',
        33: 'severe',
        40: 'severe',
        41: 'extremely-severe',
        50: 'extremely-severe',
        51: 'critical',
      };
      for (const [target, overrides] of VPH.SG.edges) {
        expectBands(id, [
          {
            name: `${target} points`,
            inputs: { ...VPH.SG.base, ...overrides },
            score: target,
            range: names[target] ?? '',
          },
        ]);
      }
    });
  });

  describe('ВПХ-СС (Указания по ВПХ 2013 and Суворов 2005: 25 items)', () => {
    const id = 'minimed.calculator.vph-ss';
    it('scores every interval of every item', () => expectAllItems(id, VPH.SS, 25));
    it('cuts at 32, 49, 69 and 98', () => {
      const names: Record<number, string> = {
        25: 'satisfactory',
        32: 'satisfactory',
        33: 'moderate',
        49: 'moderate',
        50: 'severe',
        69: 'severe',
        70: 'extremely-severe',
        98: 'extremely-severe',
        99: 'critical',
      };
      for (const [target, overrides] of VPH.SS.edges) {
        expectBands(id, [
          {
            name: `${target} points`,
            inputs: { ...VPH.SS.base, ...overrides },
            score: target,
            range: names[target] ?? '',
          },
        ]);
      }
    });
    it('adds the gas-transport block of a ventilated hypoxic patient', () => {
      // ventilator 9 + PaO2/FiO2 8 + HbO2a 9 + PaCO2 4 against four points at baseline
      const hypoxic: Inputs = { ...VPH.SS.base, breathing: 4, pf: 100, sao2: 85, paco2: 70 };
      expectBands('minimed.calculator.vph-ss', [
        { name: 'hypoxic', inputs: hypoxic, score: 25 - 4 + 30, range: 'severe' },
      ]);
    });
  });

  describe('ВПХ-СУ (Указания по ВПХ 2013: cardiac contusion, 15 points and above)', () => {
    const id = 'minimed.calculator.vph-su';
    const base: Inputs = {
      chestTrauma: 0,
      pulseArrhythmia: 0,
      cvp: 0,
      ckmb: 0,
      ecgRhythm: 0,
      stElevation: 0,
      noR: 0,
      stDepression: 0,
    };
    it('scores each criterion', () => {
      expectTable(
        id,
        base,
        'chestTrauma',
        [
          [0, 0],
          [1, 6],
          [2, 8],
          [3, 10],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'pulseArrhythmia',
        [
          [0, 0],
          [1, 8],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'cvp',
        [
          [0, 0],
          [1, 1],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'ckmb',
        [
          [0, 0],
          [1, 1],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'ecgRhythm',
        [
          [0, 0],
          [1, 7],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'stElevation',
        [
          [0, 0],
          [1, 10],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'noR',
        [
          [0, 0],
          [1, 9],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'stDepression',
        [
          [0, 0],
          [1, 6],
        ],
        0,
      );
    });
    it('cuts at 15', () => {
      expectBands(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'below-threshold' },
        {
          name: '14',
          inputs: { ...base, pulseArrhythmia: 1, stDepression: 1 },
          score: 14,
          range: 'below-threshold',
        },
        {
          name: '15',
          inputs: { ...base, pulseArrhythmia: 1, stDepression: 1, cvp: 1 },
          score: 15,
          range: 'contusion',
        },
        {
          name: 'maximum 52',
          inputs: {
            chestTrauma: 3,
            pulseArrhythmia: 1,
            cvp: 1,
            ckmb: 1,
            ecgRhythm: 1,
            stElevation: 1,
            noR: 1,
            stDepression: 1,
          },
          score: 52,
          range: 'contusion',
        },
      ]);
    });
  });

  describe('ВПХ-УЛ (Указания по ВПХ 2013: pulmonary contusion, 9 and 20)', () => {
    const id = 'minimed.calculator.vph-ul';
    const base: Inputs = { chestWall: 0, bronchoscopy: 0, xray: 0, spo2: 0, rrBand: 0 };
    it('scores each criterion', () => {
      expectTable(
        id,
        base,
        'chestWall',
        [
          [0, 0],
          [1, 1],
          [2, 4],
          [3, 8],
          [4, 10],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'bronchoscopy',
        [
          [0, 0],
          [1, 10],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'xray',
        [
          [0, 0],
          [1, 6],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'spo2',
        [
          [0, 0],
          [1, 3],
          [2, 6],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'rrBand',
        [
          [0, 0],
          [1, 3],
          [2, 6],
        ],
        0,
      );
    });
    it('cuts at 9 and 20', () => {
      expectBands(id, [
        { name: '8', inputs: { ...base, chestWall: 3 }, score: 8, range: 'below-threshold' },
        {
          name: '9',
          inputs: { ...base, xray: 1, spo2: 1 },
          score: 9,
          range: 'probable',
          includes: '80 %',
        },
        {
          name: '19',
          inputs: { ...base, bronchoscopy: 1, xray: 1, spo2: 1 },
          score: 19,
          range: 'probable',
        },
        {
          name: '20',
          inputs: { ...base, bronchoscopy: 1, xray: 1, chestWall: 2 },
          score: 20,
          range: 'high',
          includes: '90 %',
        },
        {
          name: 'maximum 38',
          inputs: { chestWall: 4, bronchoscopy: 1, xray: 1, spo2: 2, rrBand: 2 },
          score: 38,
          range: 'high',
        },
      ]);
    });
  });

  describe('ВПХ-ЭХ (Указания по ВПХ 2013: endosurgery risk 0–3 / 4–5 / ≥6)', () => {
    const id = 'minimed.calculator.vph-eh';
    const base: Inputs = { sbp: 120, spo2: 98, sp: 12, clottingBand: 0 };
    it('scores each criterion', () => {
      expectTable(
        id,
        base,
        'sbp',
        [
          [120, 0],
          [101, 0],
          [100, 2],
          [90, 2],
          [89, 5],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'spo2',
        [
          [98, 0],
          [94, 0],
          [93, 3],
          [90, 3],
          [89, 6],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'sp',
        [
          [12, 0],
          [20, 0],
          [21, 1],
          [31, 1],
          [32, 2],
          [45, 2],
          [46, 6],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'clottingBand',
        [
          [0, 0],
          [1, 3],
          [2, 6],
        ],
        0,
      );
    });
    it('cuts at 3, 5 and reports the published complication rates', () => {
      expectBands(id, [
        { name: '0', inputs: base, score: 0, range: 'minimal', includes: '2,5 %' },
        { name: '3', inputs: { ...base, spo2: 93 }, score: 3, range: 'minimal' },
        {
          name: '4',
          inputs: { ...base, spo2: 93, sp: 25 },
          score: 4,
          range: 'probable',
          includes: '3,8 %',
        },
        { name: '5', inputs: { ...base, sbp: 85 }, score: 5, range: 'probable' },
        { name: '6', inputs: { ...base, spo2: 85 }, score: 6, range: 'high', includes: '20,0 %' },
        {
          name: 'maximum 23',
          inputs: { sbp: 80, spo2: 80, sp: 60, clottingBand: 2 },
          score: 23,
          range: 'high',
        },
      ]);
    });
  });

  describe('ASA physical status classification (ASA 2014, amended 2020)', () => {
    const id = 'minimed.calculator.asa-physical-status';
    it('returns the class with the E suffix for emergencies', () => {
      for (const asaClass of [1, 2, 3, 4, 5]) {
        expectBands(id, [
          {
            name: `class ${asaClass}`,
            inputs: { asaClass, emergency: 0 },
            score: asaClass,
            range: `asa-${asaClass}`,
            output: 'asa',
          },
          {
            name: `class ${asaClass} emergency`,
            inputs: { asaClass, emergency: 1 },
            score: asaClass,
            range: `asa-${asaClass}e`,
            output: 'asa',
          },
        ]);
      }
      expectBands(id, [
        {
          name: 'class 6',
          inputs: { asaClass: 6, emergency: 0 },
          score: 6,
          range: 'asa-6',
          output: 'asa',
        },
        {
          name: 'class 6 flagged emergency',
          inputs: { asaClass: 6, emergency: 1 },
          score: 6,
          range: 'asa-6',
          output: 'asa',
        },
      ]);
    });
    it('treats the emergency check box as optional', () => {
      expect(run(id, { asaClass: 3 }).rangeId).toBe('asa-3');
    });
  });

  describe('МНОАР-89 (three components, classes I 1.5 / II 2–3 / III 3.5–5 / IV 5.5–8 / V from 8.5)', () => {
    const id = 'minimed.calculator.mnoar-89';
    const base: Inputs = { state: 0, surgery: 0, anesthesia: 0 };
    it('sums the component points and cuts into five classes', () => {
      expectBands(id, [
        { name: 'minimum 1.5', inputs: base, score: 1.5, range: 'class-1' },
        { name: '3', inputs: { state: 1, surgery: 1, anesthesia: 1 }, score: 3, range: 'class-2' },
        {
          name: '3.5',
          inputs: { state: 1, surgery: 2, anesthesia: 1 },
          score: 3.5,
          range: 'class-3',
        },
        { name: '5', inputs: { state: 2, surgery: 1, anesthesia: 3 }, score: 5, range: 'class-3' },
        {
          name: '5.5',
          inputs: { state: 2, surgery: 2, anesthesia: 3 },
          score: 5.5,
          range: 'class-4',
        },
        { name: '8', inputs: { state: 3, surgery: 3, anesthesia: 3 }, score: 8, range: 'class-4' },
        {
          name: '8.5',
          inputs: { state: 3, surgery: 3, anesthesia: 4 },
          score: 8.5,
          range: 'class-5',
        },
        {
          name: 'maximum 11',
          inputs: { state: 4, surgery: 4, anesthesia: 4 },
          score: 11,
          range: 'class-5',
        },
        {
          name: 'emergency adds 1',
          inputs: { ...base, emergency: 1 },
          score: 2.5,
          range: 'class-2',
        },
        {
          name: 'maximum with emergency',
          inputs: { state: 4, surgery: 4, anesthesia: 4, emergency: 1 },
          score: 12,
          range: 'class-5',
        },
      ]);
    });
    it('scores each grade of each component', () => {
      expectTable(
        id,
        base,
        'state',
        [
          [0, 0.5],
          [1, 1],
          [2, 2],
          [3, 4],
          [4, 6],
        ],
        0.5,
      );
      expectTable(
        id,
        base,
        'surgery',
        [
          [0, 0.5],
          [1, 1],
          [2, 1.5],
          [3, 2],
          [4, 2.5],
        ],
        0.5,
      );
      expectTable(
        id,
        base,
        'anesthesia',
        [
          [0, 0.5],
          [1, 1],
          [2, 1.5],
          [3, 2],
          [4, 2.5],
        ],
        0.5,
      );
    });
  });

  describe('Goldman cardiac risk index (1977: nine factors, 53 points; 0–5 / 6–12 / 13–25 / ≥26)', () => {
    const id = 'minimed.calculator.goldman-cardiac-risk';
    const base: Inputs = { ageYears: 50 };
    it('scores each factor with the published points', () => {
      const points: Record<string, number> = {
        jvd: 11,
        recentMi: 10,
        nonSinus: 7,
        pvc: 7,
        aorticStenosis: 3,
        poorCondition: 3,
        highRiskSurgery: 3,
        emergencySurgery: 4,
      };
      for (const [key, expected] of Object.entries(points)) {
        expect(value(id, { ...base, [key]: 1 }), key).toBe(expected);
      }
      expect(value(id, { ageYears: 70 })).toBe(0);
      expect(value(id, { ageYears: 71 })).toBe(5);
    });
    it('cuts into the four published classes', () => {
      expectBands(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'class-1' },
        { name: '5', inputs: { ageYears: 71 }, score: 5, range: 'class-1', includes: '0,7 %' },
        {
          name: '6',
          inputs: { ...base, aorticStenosis: 1, poorCondition: 1 },
          score: 6,
          range: 'class-2',
        },
        {
          name: '12',
          inputs: { ageYears: 71, nonSinus: 1 },
          score: 12,
          range: 'class-2',
          includes: '5 %',
        },
        {
          name: '13',
          inputs: { ...base, recentMi: 1, highRiskSurgery: 1 },
          score: 13,
          range: 'class-3',
        },
        {
          name: '25',
          inputs: { ...base, jvd: 1, recentMi: 1, emergencySurgery: 1 },
          score: 25,
          range: 'class-3',
          includes: '11 %',
        },
        {
          name: '26',
          inputs: { ageYears: 71, jvd: 1, recentMi: 1 },
          score: 26,
          range: 'class-4',
          includes: '56 %',
        },
        {
          name: 'maximum 53',
          inputs: {
            ageYears: 80,
            jvd: 1,
            recentMi: 1,
            nonSinus: 1,
            pvc: 1,
            aorticStenosis: 1,
            poorCondition: 1,
            highRiskSurgery: 1,
            emergencySurgery: 1,
          },
          score: 53,
          range: 'class-4',
        },
      ]);
    });
  });

  describe('Detsky modified multifactorial index (1986: classes 0–15 / 20–30 / >30)', () => {
    const id = 'minimed.calculator.detsky-modified-cardiac-risk';
    const base: Inputs = { mi: 0, angina: 0, pulmonaryEdema: 0, ageYears: 50 };
    it('scores each factor with the published points', () => {
      expectTable(
        id,
        base,
        'mi',
        [
          [0, 0],
          [10, 10],
          [5, 5],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'angina',
        [
          [0, 0],
          [10, 10],
          [20, 20],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'pulmonaryEdema',
        [
          [0, 0],
          [10, 10],
          [5, 5],
        ],
        0,
      );
      const points: Record<string, number> = {
        unstableAngina: 10,
        aorticStenosis: 20,
        nonSinus: 5,
        pvc: 5,
        poorCondition: 5,
        emergencySurgery: 10,
      };
      for (const [key, expected] of Object.entries(points)) {
        expect(value(id, { ...base, [key]: 1 }), key).toBe(expected);
      }
      expect(value(id, { ...base, ageYears: 70 })).toBe(0);
      expect(value(id, { ...base, ageYears: 71 })).toBe(5);
    });
    it('cuts at 15, 30', () => {
      expectBands(id, [
        { name: 'nothing', inputs: base, score: 0, range: 'class-1' },
        { name: '15', inputs: { ...base, mi: 10, ageYears: 75 }, score: 15, range: 'class-1' },
        { name: '20', inputs: { ...base, angina: 20 }, score: 20, range: 'class-2' },
        {
          name: '30',
          inputs: { ...base, mi: 10, unstableAngina: 1, pulmonaryEdema: 10 },
          score: 30,
          range: 'class-2',
        },
        {
          name: '35',
          inputs: { ...base, mi: 10, unstableAngina: 1, pulmonaryEdema: 10, ageYears: 75 },
          score: 35,
          range: 'class-3',
        },
      ]);
    });
  });

  describe('ARISCAT (Canet 2010: <26 / 26–44 / ≥45)', () => {
    const id = 'minimed.calculator.ariscat';
    const base: Inputs = { ageYears: 40, spo2: 98, incision: 0, duration: 0 };
    it('scores each predictor', () => {
      expectTable(
        id,
        base,
        'ageYears',
        [
          [50, 0],
          [51, 3],
          [80, 3],
          [81, 16],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'spo2',
        [
          [100, 0],
          [96, 0],
          [95, 8],
          [91, 8],
          [90, 24],
          [85, 24],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'incision',
        [
          [0, 0],
          [15, 15],
          [24, 24],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'duration',
        [
          [0, 0],
          [16, 16],
          [23, 23],
        ],
        0,
      );
      expect(value(id, { ...base, infection: 1 })).toBe(17);
      expect(value(id, { ...base, anemia: 1 })).toBe(11);
      expect(value(id, { ...base, emergency: 1 })).toBe(8);
    });
    it('cuts at 26 and 45', () => {
      expectBands(id, [
        { name: '0', inputs: base, score: 0, range: 'low' },
        { name: '25', inputs: { ...base, infection: 1, spo2: 93 }, score: 25, range: 'low' },
        {
          name: '26',
          inputs: { ...base, incision: 15, anemia: 1 },
          score: 26,
          range: 'intermediate',
        },
        {
          name: '44',
          inputs: { ...base, duration: 16, anemia: 1, infection: 1 },
          score: 44,
          range: 'intermediate',
        },
        {
          name: '45',
          inputs: { ageYears: 60, spo2: 98, incision: 15, duration: 16, anemia: 1 },
          score: 45,
          range: 'high',
        },
        {
          name: 'maximum 123',
          inputs: {
            ageYears: 90,
            spo2: 85,
            incision: 24,
            duration: 23,
            infection: 1,
            anemia: 1,
            emergency: 1,
          },
          score: 123,
          range: 'high',
        },
      ]);
    });
  });

  describe('Caprini 2005 (1 / 2 / 3 / 5 point factors; 0 / 1–2 / 3–4 / ≥5 per ACCP 2012)', () => {
    const id = 'minimed.calculator.caprini-vte-2005';
    const base: Inputs = { ageYears: 30 };
    const one = [
      'minorSurgery',
      'priorMajorSurgery',
      'varicose',
      'ibd',
      'swollenLegs',
      'obesity',
      'acuteMi',
      'chf',
      'sepsis',
      'lungDisease',
      'copd',
      'bedRestMedical',
      'otherRisk',
      'hormones',
      'pregnancy',
      'obstetricHistory',
    ];
    const two = [
      'arthroscopy',
      'malignancy',
      'majorSurgery',
      'laparoscopy',
      'bedConfined',
      'cast',
      'centralVenous',
    ];
    const three = [
      'previousVte',
      'familyVte',
      'factorV',
      'prothrombin',
      'homocysteine',
      'lupus',
      'anticardiolipin',
      'hit',
      'thrombophilia',
    ];
    const five = ['arthroplasty', 'fracture', 'stroke', 'multiTrauma', 'spinalCord'];
    it('weights every factor as printed on the 2005 form', () => {
      for (const key of one) expect(value(id, { ...base, [key]: 1 }), key).toBe(1);
      for (const key of two) expect(value(id, { ...base, [key]: 1 }), key).toBe(2);
      for (const key of three) expect(value(id, { ...base, [key]: 1 }), key).toBe(3);
      for (const key of five) expect(value(id, { ...base, [key]: 1 }), key).toBe(5);
    });
    it('steps the age points at 41, 61 and 75', () => {
      expectTable(
        id,
        base,
        'ageYears',
        [
          [40, 0],
          [41, 1],
          [60, 1],
          [61, 2],
          [74, 2],
          [75, 3],
          [95, 3],
        ],
        0,
      );
    });
    it('cuts at 0, 2, 4 and reaches the maximum of 85', () => {
      expectBands(id, [
        { name: 'no factors', inputs: base, score: 0, range: 'very-low', includes: '0,5 %' },
        { name: 'age 50', inputs: { ageYears: 50 }, score: 1, range: 'low' },
        {
          name: 'two',
          inputs: { ageYears: 50, minorSurgery: 1 },
          score: 2,
          range: 'low',
          includes: '1,5 %',
        },
        {
          name: 'three',
          inputs: { ageYears: 50, minorSurgery: 1, varicose: 1 },
          score: 3,
          range: 'moderate',
          includes: '3 %',
        },
        {
          name: 'four',
          inputs: { ageYears: 50, minorSurgery: 1, varicose: 1, swollenLegs: 1 },
          score: 4,
          range: 'moderate',
        },
        {
          name: 'five',
          inputs: { ageYears: 50, minorSurgery: 1, varicose: 1, swollenLegs: 1, obesity: 1 },
          score: 5,
          range: 'high',
          includes: '6 %',
        },
        {
          name: 'laparoscopy in an older woman on hormones',
          inputs: { ageYears: 66, laparoscopy: 1, hormones: 1 },
          score: 5,
          range: 'high',
        },
        {
          name: 'every factor',
          inputs: Object.fromEntries([
            ['ageYears', 80],
            ...[...one, ...two, ...three, ...five].map((key) => [key, 1]),
          ]),
          score: 85,
          range: 'high',
        },
      ]);
    });
  });

  describe('POSSUM and P-POSSUM (Copeland 1991, Prytherch 1998)', () => {
    const id = 'minimed.calculator.possum';
    const best: Inputs = {
      age: 40,
      cardiac: 0,
      respiratory: 0,
      sbp: 120,
      pulse: 70,
      gcs: 15,
      hb: 14,
      wbc: 7,
      urea: 5,
      sodium: 140,
      potassium: 4.2,
      ecg: 0,
      severity: 0,
      procedures: 0,
      bloodLoss: 50,
      soiling: 0,
      malignancy: 0,
      mode: 0,
    };
    const logistic = (x: number): number => 100 / (1 + Math.exp(-x));
    it('reports the minimum physiological (12) and operative (6) scores', () => {
      const result = run(id, best);
      expect(out(result, 'ps')).toBe(12);
      expect(out(result, 'os')).toBe(6);
      expect(out(result, 'possumMortality')).toBeCloseTo(logistic(-7.04 + 0.13 * 12 + 0.16 * 6), 6);
      expect(out(result, 'pPossumMortality')).toBeCloseTo(
        logistic(-9.065 + 0.1692 * 12 + 0.155 * 6),
        6,
      );
      expect(out(result, 'possumMorbidity')).toBeCloseTo(logistic(-5.91 + 0.16 * 12 + 0.19 * 6), 6);
    });
    it('reproduces a worked patient (physiological 19, operative 12)', () => {
      const patient: Inputs = {
        age: 65,
        cardiac: 1,
        respiratory: 1,
        sbp: 120,
        pulse: 85,
        gcs: 15,
        hb: 12,
        wbc: 12,
        urea: 8,
        sodium: 138,
        potassium: 4.2,
        ecg: 0,
        severity: 2,
        procedures: 0,
        bloodLoss: 300,
        soiling: 1,
        malignancy: 1,
        mode: 0,
      };
      const result = run(id, patient);
      expect(out(result, 'ps')).toBe(19);
      expect(out(result, 'os')).toBe(12);
      expect(out(result, 'possumMortality')).toBeCloseTo(6.598900949, 6);
      expect(out(result, 'pPossumMortality')).toBeCloseTo(1.816012462, 6);
      expect(out(result, 'possumMorbidity')).toBeCloseTo(35.66348543, 6);
      expect(result.status).toBe('unavailable');
    });
    it('reaches the arithmetic maximum of 88 and 48', () => {
      const worst: Inputs = {
        age: 80,
        cardiac: 3,
        respiratory: 3,
        sbp: 80,
        pulse: 130,
        gcs: 5,
        hb: 8,
        wbc: 25,
        urea: 20,
        sodium: 120,
        potassium: 6.5,
        ecg: 2,
        severity: 3,
        procedures: 2,
        bloodLoss: 1500,
        soiling: 3,
        malignancy: 3,
        mode: 2,
      };
      const result = run(id, worst);
      expect(out(result, 'ps')).toBe(88);
      expect(out(result, 'os')).toBe(48);
      expect(out(result, 'possumMortality')).toBeCloseTo(
        logistic(-7.04 + 0.13 * 88 + 0.16 * 48),
        6,
      );
    });
    it('scores every interval of the numeric variables', () => {
      const t = (key: string, table: Table): void => expectTable(id, best, key, table, 1, 'ps');
      t('age', [
        [18, 1],
        [60, 1],
        [61, 2],
        [70, 2],
        [71, 4],
      ]);
      t('sbp', [
        [89, 8],
        [90, 4],
        [99, 4],
        [100, 2],
        [109, 2],
        [110, 1],
        [130, 1],
        [131, 2],
        [170, 2],
        [171, 4],
      ]);
      t('pulse', [
        [39, 8],
        [40, 2],
        [49, 2],
        [50, 1],
        [80, 1],
        [81, 2],
        [100, 2],
        [101, 4],
        [120, 4],
        [121, 8],
      ]);
      t('gcs', [
        [15, 1],
        [14, 2],
        [12, 2],
        [11, 4],
        [9, 4],
        [8, 8],
        [3, 8],
      ]);
      t('hb', [
        [9.9, 8],
        [10, 4],
        [11.4, 4],
        [11.5, 2],
        [12.9, 2],
        [13, 1],
        [16, 1],
        [16.1, 2],
        [17, 2],
        [17.1, 4],
        [18, 4],
        [18.1, 8],
      ]);
      t('wbc', [
        [3, 4],
        [3.1, 2],
        [3.9, 2],
        [4, 1],
        [10, 1],
        [10.1, 2],
        [20, 2],
        [20.1, 4],
      ]);
      t('urea', [
        [7.5, 1],
        [7.6, 2],
        [10, 2],
        [10.1, 4],
        [15, 4],
        [15.1, 8],
      ]);
      t('sodium', [
        [136, 1],
        [135, 2],
        [131, 2],
        [130, 4],
        [126, 4],
        [125, 8],
      ]);
      t('potassium', [
        [3.5, 1],
        [5, 1],
        [3.4, 2],
        [3.2, 2],
        [3.1, 4],
        [2.9, 4],
        [2.8, 8],
        [5.1, 2],
        [5.3, 2],
        [5.4, 4],
        [5.9, 4],
        [6, 8],
      ]);
      expectTable(
        id,
        best,
        'bloodLoss',
        [
          [0, 1],
          [100, 1],
          [101, 2],
          [500, 2],
          [501, 4],
          [999, 4],
          [1000, 8],
        ],
        1,
        'os',
      );
    });
    it('scores every option of the categorical variables', () => {
      expectTable(
        id,
        best,
        'cardiac',
        [
          [0, 1],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        1,
        'ps',
      );
      expectTable(
        id,
        best,
        'respiratory',
        [
          [0, 1],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        1,
        'ps',
      );
      expectTable(
        id,
        best,
        'ecg',
        [
          [0, 1],
          [1, 4],
          [2, 8],
        ],
        1,
        'ps',
      );
      expectTable(
        id,
        best,
        'severity',
        [
          [0, 1],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        1,
        'os',
      );
      expectTable(
        id,
        best,
        'procedures',
        [
          [0, 1],
          [1, 4],
          [2, 8],
        ],
        1,
        'os',
      );
      expectTable(
        id,
        best,
        'soiling',
        [
          [0, 1],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        1,
        'os',
      );
      expectTable(
        id,
        best,
        'malignancy',
        [
          [0, 1],
          [1, 2],
          [2, 4],
          [3, 8],
        ],
        1,
        'os',
      );
      expectTable(
        id,
        best,
        'mode',
        [
          [0, 1],
          [1, 4],
          [2, 8],
        ],
        1,
        'os',
      );
    });
  });

  describe('Mannheim Peritonitis Index (Linder 1987; Billing 1994: <21 / 21–29 / >29)', () => {
    const id = 'minimed.calculator.mannheim-peritonitis-index';
    const base: Inputs = { ageYears: 40, sex: 0, exudate: 0 };
    it('adds the published points', () => {
      expect(value(id, { ...base, ageYears: 50 })).toBe(0);
      expect(value(id, { ...base, ageYears: 51 })).toBe(5);
      expect(value(id, { ...base, sex: 1 })).toBe(5);
      const points: Record<string, number> = {
        organFailure: 7,
        malignancy: 4,
        duration: 4,
        nonColonic: 4,
        diffuse: 6,
      };
      for (const [key, expected] of Object.entries(points))
        expect(value(id, { ...base, [key]: 1 }), key).toBe(expected);
      expectTable(
        id,
        base,
        'exudate',
        [
          [0, 0],
          [6, 6],
          [12, 12],
        ],
        0,
      );
    });
    it('cuts at 21 and 29 with the Billing 1994 mortality', () => {
      expectBands(id, [
        {
          name: '17',
          inputs: { ageYears: 60, sex: 1, organFailure: 1, exudate: 0 },
          score: 17,
          range: 'class-1',
          includes: '2,3 %',
        },
        {
          name: '21',
          inputs: { ageYears: 60, sex: 1, organFailure: 1, exudate: 0, nonColonic: 1 },
          score: 21,
          range: 'class-2',
          includes: '22,5 %',
        },
        {
          name: '29',
          inputs: {
            ageYears: 60,
            sex: 1,
            organFailure: 1,
            malignancy: 1,
            duration: 1,
            nonColonic: 1,
            exudate: 0,
          },
          score: 29,
          range: 'class-2',
        },
        {
          name: '30',
          inputs: { ageYears: 60, sex: 0, organFailure: 1, diffuse: 1, exudate: 12 },
          score: 30,
          range: 'class-3',
          includes: '59,1 %',
        },
        {
          name: 'maximum 47',
          inputs: {
            ageYears: 60,
            sex: 1,
            organFailure: 1,
            malignancy: 1,
            duration: 1,
            nonColonic: 1,
            diffuse: 1,
            exudate: 12,
          },
          score: 47,
          range: 'class-3',
        },
      ]);
    });
  });

  describe('Pusajó relaparotomy predictive index (1993; Moscow instruction 2017: ≤10 / 11–12 / 13–14 / ≥15)', () => {
    const id = 'minimed.calculator.pusajo-relaparotomy-index';
    const points: Record<string, number> = {
      emergencyFirst: 3,
      respiratoryFailure: 2,
      renalFailure: 2,
      ileus: 4,
      pain: 5,
      woundInfection: 8,
      consciousness: 2,
      lateSymptoms: 6,
    };
    it('adds the published points', () => {
      for (const [key, expected] of Object.entries(points))
        expect(value(id, { [key]: 1 }), key).toBe(expected);
      expect(value(id, Object.fromEntries(Object.keys(points).map((key) => [key, 1])))).toBe(32);
    });
    it('cuts at 10, 12, 14', () => {
      expectBands(id, [
        { name: '0', inputs: {}, score: 0, range: 'low' },
        {
          name: '10',
          inputs: { woundInfection: 1, respiratoryFailure: 1 },
          score: 10,
          range: 'low',
          includes: '8,7 %',
        },
        {
          name: '11',
          inputs: { pain: 1, ileus: 1, consciousness: 1 },
          score: 11,
          range: 'intermediate',
          includes: '40 %',
        },
        { name: '12', inputs: { woundInfection: 1, ileus: 1 }, score: 12, range: 'intermediate' },
        {
          name: '13',
          inputs: { woundInfection: 1, pain: 1 },
          score: 13,
          range: 'high',
          includes: '90 %',
        },
        {
          name: '14',
          inputs: { woundInfection: 1, ileus: 1, consciousness: 1 },
          score: 14,
          range: 'high',
        },
        {
          name: '15',
          inputs: { lateSymptoms: 1, pain: 1, ileus: 1 },
          score: 15,
          range: 'very-high',
        },
      ]);
    });
  });

  describe('Ranson criteria (1974, 1976: non-gallstone and gallstone thresholds)', () => {
    const id = 'minimed.calculator.ranson-pancreatitis';
    const base: Inputs = {
      etiology: 0,
      ageYears: 40,
      wbc: 8,
      glucose: 6,
      ldh: 200,
      ast: 40,
      hctFall: 2,
      ureaRise: 0.5,
      calcium: 2.3,
      pao2: 90,
      baseDeficit: 0,
      fluid: 1,
    };
    const crit = 'criteria';
    const t = (inputs: Inputs, key: string, table: Table): void =>
      expectTable(id, inputs, key, table, 0, crit);
    it('counts each non-gallstone criterion at its published threshold', () => {
      t(base, 'ageYears', [
        [55, 0],
        [56, 1],
      ]);
      t(base, 'wbc', [
        [16, 0],
        [16.1, 1],
      ]);
      t(base, 'glucose', [
        [11.1, 0],
        [11.2, 1],
      ]);
      t(base, 'ldh', [
        [350, 0],
        [351, 1],
      ]);
      t(base, 'ast', [
        [250, 0],
        [251, 1],
      ]);
      t(base, 'hctFall', [
        [10, 0],
        [10.5, 1],
      ]);
      t(base, 'ureaRise', [
        [1.8, 0],
        [1.9, 1],
      ]);
      t(base, 'calcium', [
        [2, 0],
        [1.99, 1],
      ]);
      t(base, 'pao2', [
        [60, 0],
        [59, 1],
      ]);
      t(base, 'baseDeficit', [
        [4, 0],
        [4.1, 1],
      ]);
      t(base, 'fluid', [
        [6, 0],
        [6.1, 1],
      ]);
    });
    it('counts each gallstone criterion at its published threshold and ignores PaO2', () => {
      const gall: Inputs = { ...base, etiology: 1 };
      t(gall, 'ageYears', [
        [70, 0],
        [71, 1],
      ]);
      t(gall, 'wbc', [
        [18, 0],
        [18.1, 1],
      ]);
      t(gall, 'glucose', [
        [12.2, 0],
        [12.3, 1],
      ]);
      t(gall, 'ldh', [
        [400, 0],
        [401, 1],
      ]);
      t(gall, 'ast', [
        [250, 0],
        [251, 1],
      ]);
      t(gall, 'hctFall', [
        [10, 0],
        [10.5, 1],
      ]);
      t(gall, 'ureaRise', [
        [0.7, 0],
        [0.8, 1],
      ]);
      t(gall, 'calcium', [
        [2, 0],
        [1.99, 1],
      ]);
      t(gall, 'baseDeficit', [
        [5, 0],
        [5.1, 1],
      ]);
      t(gall, 'fluid', [
        [4, 0],
        [4.1, 1],
      ]);
      t(gall, 'pao2', [
        [90, 0],
        [40, 0],
      ]);
    });
    it('uses the age threshold of the chosen etiology', () => {
      expect(value(id, { ...base, ageYears: 60 }, crit)).toBe(1);
      expect(value(id, { ...base, ageYears: 60, etiology: 1 }, crit)).toBe(0);
    });
    it('cuts at 2, 4 and 6 criteria', () => {
      const flagged = (count: number): Inputs => {
        const overrides: Inputs[] = [
          { ageYears: 60 },
          { wbc: 17 },
          { glucose: 12 },
          { ldh: 400 },
          { ast: 300 },
          { hctFall: 12 },
          { ureaRise: 2 },
          { calcium: 1.8 },
          { pao2: 50 },
          { baseDeficit: 6 },
          { fluid: 7 },
        ];
        return Object.assign({}, base, ...overrides.slice(0, count));
      };
      expectBands(id, [
        { name: '0', inputs: flagged(0), score: 0, range: 'low', output: crit },
        { name: '2', inputs: flagged(2), score: 2, range: 'low', output: crit },
        { name: '3', inputs: flagged(3), score: 3, range: 'moderate', output: crit },
        { name: '4', inputs: flagged(4), score: 4, range: 'moderate', output: crit },
        { name: '5', inputs: flagged(5), score: 5, range: 'severe', output: crit },
        { name: '6', inputs: flagged(6), score: 6, range: 'severe', output: crit },
        { name: '7', inputs: flagged(7), score: 7, range: 'critical', output: crit },
        { name: '11', inputs: flagged(11), score: 11, range: 'critical', output: crit },
      ]);
    });
  });

  describe('Complete Rockall score (Rockall 1996: 0–11, rebleeding and mortality by score)', () => {
    const id = 'minimed.calculator.rockall-complete';
    const base: Inputs = { ageYears: 40, shock: 0, comorbidity: 0, diagnosis: 0, stigmata: 0 };
    it('scores each variable', () => {
      expectTable(
        id,
        base,
        'ageYears',
        [
          [59, 0],
          [60, 1],
          [79, 1],
          [80, 2],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'shock',
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'comorbidity',
        [
          [0, 0],
          [2, 2],
          [3, 3],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'diagnosis',
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'stigmata',
        [
          [0, 0],
          [2, 2],
        ],
        0,
      );
    });
    it('reports the published rates for every score and the pre-endoscopy subtotal', () => {
      const rates: readonly (readonly [number, string, string])[] = [
        [0, '4,9', '0'],
        [1, '3,4', '0'],
        [2, '5,3', '0,2'],
        [3, '11,2', '2,9'],
        [4, '14,1', '5,3'],
        [5, '24,1', '10,8'],
        [6, '32,9', '17,3'],
        [7, '43,8', '27'],
      ];
      const builders: Inputs[] = [
        base,
        { ...base, diagnosis: 1 },
        { ...base, diagnosis: 2 },
        { ...base, diagnosis: 2, shock: 1 },
        { ...base, diagnosis: 2, stigmata: 2 },
        { ...base, diagnosis: 2, stigmata: 2, shock: 1 },
        { ...base, diagnosis: 2, stigmata: 2, shock: 2 },
        { ...base, diagnosis: 2, stigmata: 2, shock: 2, ageYears: 60 },
      ];
      for (const [score, rebleeding, mortality] of rates) {
        expectBands(id, [
          {
            name: `${score}`,
            inputs: builders[score] ?? base,
            score,
            range: `s${score}`,
            includes: `повторное кровотечение у ${rebleeding} %, летальность ${mortality} %`,
          },
        ]);
      }
      expectBands(id, [
        {
          name: '8',
          inputs: { ageYears: 80, shock: 2, comorbidity: 2, diagnosis: 2, stigmata: 0 },
          score: 8,
          range: 's8plus',
          includes: '41,1 %',
        },
      ]);
      expectBands(id, [
        {
          name: 'maximum 11',
          inputs: { ageYears: 85, shock: 2, comorbidity: 3, diagnosis: 2, stigmata: 2 },
          score: 11,
          range: 's8plus',
        },
      ]);
    });
  });

  describe('Evans burn resuscitation (Evans 1952)', () => {
    const id = 'minimed.calculator.evans-burn-fluids';
    it('returns 1 mL/kg/% of colloid and crystalloid plus 2000 mL glucose, halved on day 2', () => {
      const result = run(id, { weightKg: 70, tbsa: 30 });
      expect(result.values).toMatchObject({
        colloid1: 2100,
        crystalloid1: 2100,
        glucose1: 2000,
        colloid2: 1050,
        crystalloid2: 1050,
        glucose2: 2000,
      });
      expect(result.status).toBe('unavailable');
    });
  });

  describe('Blood loss by haematocrit (Gross 1983 with Nadler 1962 blood volume)', () => {
    const id = 'minimed.calculator.blood-loss-hematocrit';
    it('reproduces a male and a female worked example', () => {
      const male = run(id, { sex: 'male', heightCm: 175, weightKg: 80, htBefore: 42, htAfter: 30 });
      expect(out(male, 'bloodVolume')).toBeCloseTo(5145.6546875, 4);
      expect(out(male, 'bloodLoss')).toBeCloseTo(1715.2182292, 4);
      expect(out(male, 'bloodLossPercent')).toBeCloseTo(100 / 3, 4);
      const female = run(id, {
        sex: 'female',
        heightCm: 165,
        weightKg: 60,
        htBefore: 40,
        htAfter: 32,
      });
      expect(out(female, 'bloodVolume')).toBeCloseTo(3767.7457125, 4);
      expect(out(female, 'bloodLoss')).toBeCloseTo(837.276825, 4);
    });
    it('rejects a haematocrit that rose', () => {
      expect(
        failure(id, { sex: 'male', heightCm: 175, weightKg: 80, htBefore: 30, htAfter: 35 }),
      ).toContain('Гематокрит');
    });
  });

  describe('Red-cell transfusion volume for a newborn (МЗ РК protocol 2023)', () => {
    const id = 'minimed.calculator.neonatal-rbc-transfusion-volume';
    it('applies weight × blood volume × Hb deficit / donor Hb', () => {
      const defaultDonor = run(id, {
        weightKg: 1,
        bloodVolumePerKg: 85,
        targetHb: 130,
        currentHb: 90,
      });
      expect(out(defaultDonor, 'volume')).toBeCloseTo(17, 6);
      expect(out(defaultDonor, 'volumePerKg')).toBeCloseTo(17, 6);
      expect(out(defaultDonor, 'fractionOfBloodVolume')).toBeCloseTo(20, 6);
      expect(defaultDonor.rangeId).toBe('within-limit');
      const custom = run(id, {
        weightKg: 1.2,
        bloodVolumePerKg: 80,
        targetHb: 120,
        currentHb: 80,
        donorHb: 220,
      });
      expect(out(custom, 'volume')).toBeCloseTo(17.4545455, 6);
    });
    it('flags more than 60 % of blood volume and rejects a target below the current value', () => {
      const over = run(id, { weightKg: 1, bloodVolumePerKg: 85, targetHb: 200, currentHb: 60 });
      expect(out(over, 'fractionOfBloodVolume')).toBeCloseTo(70, 6);
      expect(over.rangeId).toBe('over-limit');
      expect(
        run(id, { weightKg: 1, bloodVolumePerKg: 85, targetHb: 180, currentHb: 70 }).rangeId,
      ).toBe('within-limit');
      expect(
        failure(id, { weightKg: 1, bloodVolumePerKg: 85, targetHb: 90, currentHb: 90 }),
      ).toContain('Желаемый гемоглобин');
    });
  });

  describe('Norton scale (Norton 1962; ГОСТ Р 56819-2015 table Б.3: ≤12 / ≤14 / >14)', () => {
    const id = 'minimed.calculator.norton-pressure-ulcer';
    const make = (indexSum: number): Inputs => {
      const keys = ['physical', 'mental', 'activity', 'mobility', 'incontinence'];
      const inputs: Record<string, number> = {};
      let left = indexSum;
      for (const key of keys) {
        const part = Math.min(3, left);
        inputs[key] = part;
        left -= part;
      }
      return inputs;
    };
    it('adds five items and cuts at 12 and 14', () => {
      expectBands(id, [
        { name: 'maximum 20', inputs: make(0), score: 20, range: 'low' },
        { name: '15', inputs: make(5), score: 15, range: 'low' },
        { name: '14', inputs: make(6), score: 14, range: 'risk' },
        { name: '13', inputs: make(7), score: 13, range: 'risk' },
        { name: '12', inputs: make(8), score: 12, range: 'very-likely' },
        { name: 'minimum 5', inputs: make(15), score: 5, range: 'very-likely' },
      ]);
    });
    it('scores each option as 4, 3, 2, 1', () => {
      expectTable(
        id,
        make(0),
        'physical',
        [
          [0, 4],
          [1, 3],
          [2, 2],
          [3, 1],
        ],
        4,
      );
    });
  });

  describe('Extended Norton scale (Bienstein addition, ГОСТ Р 56819-2015 table Б.4: ≤25 at risk)', () => {
    const id = 'minimed.calculator.norton-bienstein-pressure-ulcer';
    const keys = [
      'physical',
      'mental',
      'activity',
      'mobility',
      'incontinence',
      'communication',
      'age',
      'skin',
      'comorbidity',
    ];
    const make = (indexSum: number): Inputs => {
      const inputs: Record<string, number> = {};
      let left = indexSum;
      for (const key of keys) {
        const part = Math.min(3, left);
        inputs[key] = part;
        left -= part;
      }
      return inputs;
    };
    it('adds nine items and cuts at 25', () => {
      expectBands(id, [
        { name: 'maximum 36', inputs: make(0), score: 36, range: 'no-risk' },
        { name: '26', inputs: make(10), score: 26, range: 'no-risk' },
        { name: '25', inputs: make(11), score: 25, range: 'risk' },
        { name: 'minimum 9', inputs: make(27), score: 9, range: 'risk' },
      ]);
    });
    it('scores the added items as 4, 3, 2, 1', () => {
      for (const key of ['communication', 'age', 'skin', 'comorbidity']) {
        expectTable(
          id,
          make(0),
          key,
          [
            [0, 4],
            [1, 3],
            [2, 2],
            [3, 1],
          ],
          4,
        );
      }
    });
  });

  describe('Morse Fall Scale (Morse 1989: six items, high risk from 45)', () => {
    const id = 'minimed.calculator.morse-fall-scale';
    const base: Inputs = {
      fell: 0,
      secondaryDiagnosis: 0,
      ambulatoryAid: 0,
      iv: 0,
      gait: 0,
      mental: 0,
    };
    it('scores each item', () => {
      expectTable(
        id,
        base,
        'fell',
        [
          [0, 0],
          [1, 25],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'secondaryDiagnosis',
        [
          [0, 0],
          [1, 15],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'ambulatoryAid',
        [
          [0, 0],
          [1, 15],
          [2, 30],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'iv',
        [
          [0, 0],
          [1, 20],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'gait',
        [
          [0, 0],
          [1, 10],
          [2, 20],
        ],
        0,
      );
      expectTable(
        id,
        base,
        'mental',
        [
          [0, 0],
          [1, 15],
        ],
        0,
      );
    });
    it('cuts at 25 and 45', () => {
      expectBands(id, [
        { name: '0', inputs: base, score: 0, range: 'none' },
        { name: '20', inputs: { ...base, iv: 1 }, score: 20, range: 'none' },
        { name: '25', inputs: { ...base, fell: 1 }, score: 25, range: 'low' },
        {
          name: '40',
          inputs: { ...base, secondaryDiagnosis: 1, ambulatoryAid: 1, gait: 1 },
          score: 40,
          range: 'low',
        },
        {
          name: '45',
          inputs: { ...base, secondaryDiagnosis: 1, ambulatoryAid: 1, mental: 1 },
          score: 45,
          range: 'high',
        },
        {
          name: 'maximum 125',
          inputs: { fell: 1, secondaryDiagnosis: 1, ambulatoryAid: 2, iv: 1, gait: 2, mental: 1 },
          score: 125,
          range: 'high',
        },
      ]);
    });
  });

  describe('VIP phlebitis score (Jackson 1998)', () => {
    const id = 'minimed.calculator.vip-phlebitis-score';
    it('maps each grade to its stage and action', () => {
      const actions: readonly (readonly [number, string])[] = [
        [0, 'Наблюдение'],
        [1, 'Наблюдение'],
        [2, 'Сменить катетер'],
        [3, 'рассмотреть лечение'],
        [4, 'рассмотреть лечение'],
        [5, 'Начать лечение'],
      ];
      for (const [grade, action] of actions) {
        expectBands(id, [
          {
            name: `grade ${grade}`,
            inputs: { grade },
            score: grade,
            range: `vip-${grade}`,
            output: 'vip',
            includes: action,
          },
        ]);
      }
    });
  });

  describe('Maximum local anaesthetic dose in dentistry (Haas 2002; Decloux 2021)', () => {
    const id = 'minimed.calculator.local-anesthetic-max-dose';
    it('uses the smaller of the weight-based dose and the absolute limit', () => {
      const articaine = run(id, { drug: 0, weightKg: 70, cartridgeMl: 1.7 });
      expect(out(articaine, 'maxMg')).toBeCloseTo(490, 6);
      expect(out(articaine, 'maxMl')).toBeCloseTo(12.25, 6);
      expect(out(articaine, 'maxCartridges')).toBeCloseTo(12.25 / 1.7, 6);
      expect(value(id, { drug: 0, weightKg: 90 }, 'maxMg')).toBe(500);
      expect(value(id, { drug: 5, weightKg: 70 }, 'maxMg')).toBe(90);
      expect(value(id, { drug: 5, weightKg: 70 }, 'maxMl')).toBeCloseTo(18, 6);
      expect(value(id, { drug: 2, weightKg: 60 }, 'maxMg')).toBeCloseTo(396, 6);
      expect(value(id, { drug: 2, weightKg: 60 }, 'maxMl')).toBeCloseTo(13.2, 6);
    });
    it('defaults the cartridge to 1.8 mL', () => {
      expect(value(id, { drug: 1, weightKg: 50 }, 'maxCartridges')).toBeCloseTo(
        (7 * 50) / 20 / 1.8,
        6,
      );
      expect(value(id, { drug: 4, weightKg: 70 }, 'maxMg')).toBe(500);
      expect(value(id, { drug: 3, weightKg: 70 }, 'maxMg')).toBe(400);
    });
  });
});
