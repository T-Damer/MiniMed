import type { DoseRule } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';
import type { ResolvedInstruction, ResolvedRule } from './dose-document';
import { createDoseIndex, parseDoseRuleIndex } from './dose-index';
import {
  analyzeItem,
  type InstructionState,
  indicationLabel,
  intakeRows,
  newItem,
  populationText,
  productTie,
  quantityText,
  registryForms,
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
    computable: true,
    quote,
    context: null,
    indication: null,
    severalRegimens: false,
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

/* ------------------------------------------------------------------------------------------ */
/* RX4: the findings of the independent audit                                                  */
/* ------------------------------------------------------------------------------------------ */

const ADULT = { ageDays: Math.round(40 * YEAR), weightKg: 70 };

function indexWith(options: {
  readonly forms: readonly string[];
  readonly rows: readonly (readonly [number, string, number, readonly number[]])[];
  readonly ps?: readonly (readonly [number, string])[];
  readonly rules: readonly DoseRule[];
  readonly form?: string;
}) {
  return createDoseIndex(
    parseDoseRuleIndex({
      schemaVersion: 1,
      basis: { esklpEdition: 'test', modules: [] },
      modules: ['module.test'],
      forms: options.forms,
      cards: [
        {
          s: 'drug',
          n: 'Препарат',
          r: options.rows.map(([form, strength, unit, packs]) => [
            form,
            strength,
            unit,
            [...packs],
          ]),
          t: [],
          a: [],
          x: null,
          e: 1,
        },
      ],
      documents: {
        [DOC]: {
          c: [0],
          m: 0,
          t: 'Препарат',
          k: 0,
          s: 0,
          f: options.form ?? options.forms[0] ?? null,
          v: 0,
          ...(options.ps ? { ps: options.ps.map(([form, strength]) => [form, strength]) } : {}),
          sec: [['x', 'abcdef01']],
          rules: [...options.rules],
        },
      },
    }),
  );
}

function resolvedIn(
  partial: Partial<DoseRule>,
  quote: string,
  extra: Partial<ResolvedRule> = {},
): ResolvedRule {
  return { ...resolved(partial, quote), ...extra };
}

describe('caps are compared only when the gate lets them compute (RX3 audit)', () => {
  const dose = resolved(
    { d0: 500, f0: 3, f1: 3, p0: Math.round(18 * YEAR), g: 1, u: 0 },
    'Взрослым по 500 мг 3 раза в сутки.',
  );
  const trustedCap = resolved(
    { k: 1, d1: 4000, bs: 1, p0: Math.round(18 * YEAR), g: 1, u: 0 },
    'Максимальная суточная доза для взрослых – 4000 мг.',
  );
  const rejectedCap = resolvedIn(
    { k: 1, d1: 1000, bs: 1, p0: Math.round(18 * YEAR), g: 1, u: 0 },
    'Максимальная суточная доза для подростков – 1000 мг.',
    { computable: false },
  );

  it('compares the trusted cap, quotes the rejected one', () => {
    const analysis = analyze(ADULT, instruction([dose, trustedCap, rejectedCap]));
    expect(analysis.caps.map((cap) => cap.resolved.quote)).toEqual([trustedCap.quote]);
    expect(analysis.quoted.map((entry) => entry.quote)).toEqual([rejectedCap.quote]);
  });

  it('never compares a cap given as a range', () => {
    const range = resolved(
      { k: 1, u: 1, d0: 50, d1: 70, bs: 0, p0: Math.round(18 * YEAR), g: 1 },
      'Максимальная разовая доза – от 50 до 70 мл.',
    );
    const analysis = analyze(ADULT, instruction([dose, range]));
    expect(analysis.caps).toHaveLength(0);
  });
});

describe('the release switch for computed doses (RX4)', () => {
  const rules = instruction([adultRule, childRule]);

  it('is on by default', () => {
    const analysis = analyze(ADULT, rules);
    expect(analysis.numbersOff).toBe(false);
    expect(analysis.options).toHaveLength(1);
  });

  it('turns every number off at once: the sentences are quoted, forms and the recipe stay', () => {
    const item = {
      ...newItem('1', 'amoxicillin', 'Амоксициллин'),
      form: 'таблетки',
      strength: '500 мг',
      days: 7,
    };
    const analysis = analyzeItem(item, {
      index,
      patient: ADULT,
      instructionOf: () => rules,
      settings: { computedDoses: false },
    });
    expect(analysis.numbersOff).toBe(true);
    expect(analysis.state).toBe('ready');
    expect(analysis.options).toHaveLength(0);
    expect(analysis.chosen).toBeNull();
    expect(analysis.plan).toBeNull();
    expect(analysis.caps).toHaveLength(0);
    expect(analysis.quantity).toBeNull();
    expect(intakeRows(analysis)).toEqual([]);
    expect(analysis.quoted.map((entry) => entry.quote)).toEqual([adultRule.quote]);
    // The registry choices and the instruction behind them are still there.
    expect(analysis.forms.map((entry) => entry.form)).toEqual(['таблетки']);
    expect(analysis.instruction?.documentId).toBe(DOC);
    expect(analysis.rp).toContain('Tab. Amoxicillini 0,5');
  });
});

describe('the instruction’s own product (RX3 audit: one count for every registry strength)', () => {
  const pieces = resolved(
    { u: 7, d0: 2, q0: 2, qu: 0, f0: 2, f1: 2, p0: Math.round(18 * YEAR), g: 1 },
    'Взрослым – по 2 таблетки 2 раза в день.',
  );
  const forms = ['таблетки'];
  const rows: [number, string, number, number[]][] = [
    [0, '200 мг+500 мг', 0, [20]],
    [0, '400 мг+200 мг', 0, [20]],
    [0, '400 мг+325 мг', 0, [20]],
  ];
  const withPs = indexWith({ forms, rows, ps: [[0, '400 мг+325 мг']], rules: [pieces.rule] });

  function plan(strength: string) {
    const item = { ...newItem('1', 'drug', 'Препарат'), form: 'таблетки', strength, days: 5 };
    return analyzeItem(item, {
      index: withPs,
      patient: ADULT,
      instructionOf: () => instruction([pieces]),
    });
  }

  it('shows the instruction’s count for the strength of its own registration', () => {
    const analysis = plan('400 мг+325 мг');
    expect(analysis.plan?.status).toBe('ok');
    expect(analysis.plan?.units).toMatchObject({ count: 2, kind: 'piece' });
    expect(intakeRows(analysis)[0]?.value).toBe('2 таблетки');
  });

  it('shows no count for another strength of the card, and says why', () => {
    for (const other of ['200 мг+500 мг', '400 мг+200 мг']) {
      const analysis = plan(other);
      expect(analysis.plan?.status, other).toBe('strength-mismatch');
      expect(intakeRows(analysis), other).toEqual([]);
      expect(analysis.quantity, other).toBeNull();
      expect(analysis.signa, other).toBe('');
    }
  });

  it('ties by what the strength says, not by how the registry spells it', () => {
    const forms2 = registryForms(withPs.asset.cards[0] as never, withPs.asset.forms);
    expect(productTie(withPs, DOC, forms2, 'таблетки', '325 мг+400 мг')).toBe(true);
    expect(productTie(withPs, DOC, forms2, 'таблетки, покрытые оболочкой', '400 мг+325 мг')).toBe(
      true,
    );
    expect(productTie(withPs, DOC, forms2, 'таблетки', '200 мг+500 мг')).toBe(false);
    expect(productTie(withPs, DOC, forms2, 'таблетки', null)).toBeNull();
    const percent = indexWith({
      forms: ['капли глазные'],
      rows: [[0, '0.5 мг/мл', 1, [5]]],
      ps: [[0, '0.05 %']],
      rules: [],
    });
    const dropForms = registryForms(percent.asset.cards[0] as never, percent.asset.forms);
    expect(productTie(percent, DOC, dropForms, 'капли глазные', '0.5 мг/мл')).toBe(true);
  });

  it('takes the card’s only strength of the form for the instruction’s when it has no registration of its own', () => {
    const single = indexWith({ forms, rows: [[0, '500 мг', 0, [10]]], rules: [pieces.rule] });
    const known = registryForms(single.asset.cards[0] as never, single.asset.forms);
    expect(productTie(single, DOC, known, 'таблетки', '500 мг')).toBe(true);
    const many = indexWith({ forms, rows, rules: [pieces.rule] });
    const unknown = registryForms(many.asset.cards[0] as never, many.asset.forms);
    expect(productTie(many, DOC, unknown, 'таблетки', '400 мг+325 мг')).toBe(false);
  });
});

describe('what the instruction counts is shown as the instruction names it (RX3 audit)', () => {
  const syrupIndex = indexWith({
    forms: ['сироп'],
    rows: [[0, 'НЕ УКАЗАНО', 1, [100]]],
    ps: [[0, 'НЕ УКАЗАНО']],
    rules: [],
    form: 'сироп',
  });
  const spoon = resolved(
    { u: 7, d0: 1, q0: 1, qu: 10, f0: 3, f1: 3, p0: Math.round(18 * YEAR), g: 1 },
    'Взрослым – по 1 столовой ложке 3 раза в день.',
  );

  it('says «1 столовая ложка» in the rows and in the sign, never «1 шт.»', () => {
    const item = {
      ...newItem('1', 'drug', 'Препарат'),
      form: 'сироп',
      strength: 'НЕ УКАЗАНО',
      days: 5,
    };
    const analysis = analyzeItem(item, {
      index: syrupIndex,
      patient: ADULT,
      instructionOf: () => instruction([spoon]),
    });
    expect(intakeRows(analysis)[0]?.value).toBe('1 столовая ложка');
    expect(analysis.signa).toBe('Внутрь по 1 столовой ложке 3 раза в день в течение 5 дней.');
    expect(analysis.signa).not.toContain('шт.');
  });

  it('keeps the volume the instruction gives beside the spoon', () => {
    const teaspoon = resolved(
      { u: 1, d0: 2.5, q0: 0.5, qu: 8, f0: 2, f1: 3, p1: Math.round(3 * YEAR), g: 2 },
      'Детям от 2 до 3 лет – по ½ чайной ложки (2,5 мл) сиропа 2-3 раза в день.',
    );
    const item = {
      ...newItem('1', 'drug', 'Препарат'),
      form: 'сироп',
      strength: 'НЕ УКАЗАНО',
      days: 5,
    };
    const analysis = analyzeItem(item, {
      index: syrupIndex,
      patient: { ageDays: Math.round(2.5 * YEAR), weightKg: 13 },
      instructionOf: () => instruction([teaspoon]),
    });
    expect(intakeRows(analysis)[0]?.value).toBe('1/2 чайной ложки · 2,5 мл');
    expect(analysis.signa).toContain('по 1/2 чайной ложки (2,5 мл)');
  });
});

describe('a rounding beyond the tolerance is shown as a dose without a count (RX3 audit)', () => {
  const tabletIndex = indexWith({
    forms: ['таблетки'],
    rows: [[0, '5 мг', 0, [30]]],
    ps: [[0, '5 мг']],
    rules: [],
  });
  const fixed = resolved(
    { u: 0, d0: 2.5, f0: 1, f1: 1, p0: Math.round(6 * YEAR), p1: Math.round(12 * YEAR), g: 2 },
    'Детям от 6 до 12 лет – 2,5 мг 1 раз в сутки.',
  );

  it('keeps the dose in milligrams, says why, and computes no quantity', () => {
    const item = {
      ...newItem('1', 'drug', 'Препарат'),
      form: 'таблетки',
      strength: '5 мг',
      days: 7,
    };
    const analysis = analyzeItem(item, {
      index: tabletIndex,
      patient: { ageDays: Math.round(8 * YEAR), weightKg: 26 },
      instructionOf: () => instruction([fixed]),
    });
    expect(analysis.plan?.status).toBe('ok');
    expect(analysis.plan?.units).toBeNull();
    const rows = intakeRows(analysis);
    expect(rows[0]).toMatchObject({ label: 'На приём', value: '2,5 мг' });
    expect(rows[0]?.note).toContain('отличается от расчётной больше чем на 10 %');
    expect(analysis.quantity).toBeNull();
    expect(analysis.signa).toBe('Внутрь по 2,5 мг 1 раз в день в течение 7 дней.');
  });
});

describe('a regimen of one indication is never the general dose (RX3 audit: 21 %)', () => {
  const general = resolved(
    { d0: 500, f0: 2, f1: 2, p0: Math.round(18 * YEAR), g: 1, u: 0 },
    'Взрослым по 500 мг 2 раза в сутки.',
  );
  const amoebiasis = resolvedIn(
    { d0: 2000, f0: 1, f1: 1, p0: Math.round(18 * YEAR), g: 1, u: 0, i: [0, 5] },
    'При кишечном амебиазе взрослым по 2 г 1 раз в сутки.',
    { indication: 'При кишечном амебиазе' },
  );
  const several = resolvedIn(
    { d0: 100, f0: 3, f1: 3, p0: Math.round(18 * YEAR), g: 1, u: 0, sv: 1 },
    'Взрослым по 100 мг 3 раза в сутки.',
    { severalRegimens: true },
  );

  it('offers the general sentence first, whatever the order in the instruction', () => {
    const analysis = analyze(ADULT, instruction([amoebiasis, several, general]));
    expect(analysis.options.map((option) => option.resolved.quote)).toEqual([
      general.quote,
      amoebiasis.quote,
      several.quote,
    ]);
    expect(analysis.chosen?.bound).toBe(false);
    expect(indicationLabel(analysis.chosen as never)).toBeNull();
  });

  it('shows the indication with the number when only a bound sentence exists', () => {
    const analysis = analyze(ADULT, instruction([amoebiasis]));
    expect(analysis.chosen?.indication).toBe('При кишечном амебиазе');
    expect(analysis.chosen?.bound).toBe(true);
    expect(indicationLabel(analysis.chosen as never)).toBe('При кишечном амебиазе');
    const lone = analyze(ADULT, instruction([several]));
    expect(indicationLabel(lone.chosen as never)).toBe('один из режимов в инструкции');
  });
});
