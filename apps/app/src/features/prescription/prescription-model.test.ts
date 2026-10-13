import type { DoseRule } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import type { ResolvedInstruction, ResolvedRule } from './dose-document';
import { createDoseIndex, parseDoseRuleIndex } from './dose-index';
import {
  analyzeItem,
  type InstructionState,
  intakeRows,
  newItem,
  populationText,
  quantityText,
  ruleSummary,
} from './prescription-model';

const YEAR = 365.25;
const DOC = 'drug.rf.amoxicillin.instruction';

function rule(partial: Partial<DoseRule>): DoseRule {
  return { k: 0, s: 0, a: 0, b: 10, ...partial };
}

function resolved(partial: Partial<DoseRule>, quote: string): ResolvedRule {
  return {
    rule: rule(partial),
    quote,
    context: null,
    sectionTitle: 'Способ применения и дозы',
    anchor: null,
  };
}

const adultRule = resolved(
  { d0: 250, d1: 500, f0: 3, f1: 3, p0: Math.round(18 * YEAR), g: 1, u: 0 },
  'Взрослые: 250-500 мг 3 раза в сутки',
);
const childRule = resolved(
  {
    d0: 250,
    f0: 3,
    f1: 3,
    p0: Math.round(5 * YEAR),
    p1: Math.round(13 * YEAR),
    w0: 190,
    w1: 400,
    or: 1,
    g: 2,
    u: 0,
  },
  'Дети от 5 до 13 лет и/или массой тела от 19 кг до 40 кг: 250 мг 3 раза в сутки',
);

function instruction(rules: readonly ResolvedRule[]): ResolvedInstruction {
  return {
    documentId: DOC,
    tradeName: 'Амоксициллин',
    dosageForm: 'таблетки',
    info: null,
    rules,
    divisible: false,
    origin: 'index',
    sections: [],
  };
}

const index = createDoseIndex(
  parseDoseRuleIndex({
    schemaVersion: 1,
    basis: { esklpEdition: 'test', modules: [] },
    modules: ['module.test'],
    forms: ['таблетки'],
    cards: [
      {
        s: 'amoxicillin',
        n: 'Амоксициллин',
        r: [
          [0, '250 мг', 0, [20]],
          [0, '500 мг', 0, [10, 20]],
        ],
        l: 'Amoxicillinum',
        t: [],
        a: ['J01CA04'],
        x: null,
        e: 1,
      },
    ],
    documents: {
      [DOC]: {
        c: [0],
        m: 0,
        t: 'Амоксициллин',
        k: 0,
        s: 0,
        f: 'таблетки',
        v: 0,
        sec: [['x', 'abcdef01']],
        rules: [adultRule.rule, childRule.rule],
      },
    },
  }),
);

function analyze(
  patient: Parameters<typeof analyzeItem>[1]['patient'],
  state: InstructionState | undefined,
  item = newItem('1', 'amoxicillin', 'Амоксициллин'),
) {
  return analyzeItem(item, { index, patient, instructionOf: () => state });
}

describe('analysing one drug of the prescription', () => {
  it('asks for a drug first', () => {
    const analysis = analyzeItem(newItem('1', 'unknown', 'x'), {
      index,
      patient: {},
      instructionOf: () => undefined,
    });
    expect(analysis.state).toBe('pick-drug');
  });

  it('offers the download when the instruction is not installed', () => {
    const analysis = analyze({ weightKg: 20, group: 'child' }, 'missing');
    expect(analysis.state).toBe('not-installed');
    expect(analysis.options).toHaveLength(0);
  });

  it('computes a child of 20 kg from the rule that fits by weight and quotes its sentence', () => {
    const item = {
      ...newItem('1', 'amoxicillin', 'Амоксициллин'),
      form: 'таблетки',
      strength: '250 мг',
      days: 7,
    };
    const analysis = analyze(
      { weightKg: 20, group: 'child' },
      instruction([adultRule, childRule]),
      item,
    );
    expect(analysis.state).toBe('ready');
    expect(analysis.options.map((option) => option.resolved.quote)).toEqual([childRule.quote]);
    expect(analysis.plan?.status).toBe('ok');
    expect(analysis.plan?.single).toBe(250);
    expect(analysis.plan?.intakes).toBe(3);
    expect(analysis.plan?.units).toMatchObject({ kind: 'piece', count: 1 });
    expect(quantityText(analysis)).toContain('21');
    expect(intakeRows(analysis).map((row) => row.label)).toEqual([
      'На приём',
      'Приёмов',
      'В сутки',
    ]);
    expect(analysis.rp).toContain('Tab. Amoxicillini 0,25 N 21');
    expect(analysis.signa).toContain('3 раза в день');
  });

  it('never offers an adult sentence to a child, nor a child sentence to an adult', () => {
    const child = analyze(
      { ageDays: Math.round(6 * YEAR), weightKg: 20 },
      instruction([adultRule, childRule]),
    );
    expect(child.options.some((option) => option.resolved.quote === adultRule.quote)).toBe(false);
    const adult = analyze(
      { ageDays: Math.round(40 * YEAR), weightKg: 80 },
      instruction([adultRule, childRule]),
    );
    expect(adult.options.map((option) => option.resolved.quote)).toEqual([adultRule.quote]);
  });

  it('shows no dose and no invented one when the instruction states none for the patient', () => {
    const analysis = analyze(
      { ageDays: Math.round(1 * YEAR), weightKg: 9 },
      instruction([adultRule, childRule]),
    );
    expect(analysis.options).toHaveLength(0);
    expect(analysis.chosen).toBeNull();
    expect(analysis.plan).toBeNull();
    expect(analysis.rp).toBe('');
  });

  it('keeps a condition rule as a quote, never as a dose', () => {
    const renal = resolved(
      { d0: 100, c: 1, p0: Math.round(18 * YEAR), g: 1, u: 0, f0: 1, f1: 1 },
      'При почечной недостаточности: 100 мг 1 раз в сутки',
    );
    const analysis = analyze(
      { ageDays: Math.round(40 * YEAR), weightKg: 80 },
      instruction([renal]),
    );
    expect(analysis.options).toHaveLength(0);
    expect(analysis.restricted.map((entry) => entry.quote)).toEqual([renal.quote]);
  });
});

describe('words for a rule', () => {
  it('summarizes a dose per kilogram and names the population', () => {
    expect(ruleSummary(rule({ d0: 10, d1: 15, pk: 1, u: 0, f0: 2, f1: 3 }))).toContain(
      '10–15 мг/кг',
    );
    expect(populationText(childRule.rule)).not.toBeNull();
    expect(populationText(rule({ d0: 1 }))).toBeNull();
  });
});
