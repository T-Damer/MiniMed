/**
 * Primary-source verification (2026-10-13) of: Lille model, SLICC/ACR damage index, RECIST 1.1,
 * NAFLD fibrosis score, SLEDAI-2K, carboplatin (Calvert) dose and MELD-Na.
 *
 * Every expectation is a published constant, a row of a published table, or a hand-computed value
 * whose arithmetic is shown in the comment above it. Sources actually read:
 *  - SLEDAI-2K: Gladman, Ibañez, Urowitz, J Rheumatol 2002;29:288-91, full text (jrheum.org PDF),
 *    Table 2 (data collection form); Cook 2000 abstract (PMID 10955329); Russian SLE clinical
 *    recommendations (КР 484_2) appendix Г1.
 *  - SLICC/ACR DI: the SLICC/ACR Damage Index form and glossary as reproduced by the NIH PhenX
 *    Toolkit protocol 171001; Russian SLE clinical recommendations (КР 484_2) appendix Г3. Gladman
 *    1996 (PMID 8607884) itself is not open access.
 *  - RECIST 1.1: Eisenhauer 2009, Eur J Cancer 45:228-247, full text (EORTC site PDF), section 4.3
 *    and Table 1.
 *  - Lille: Louvet 2007 abstract (PMID 17518367: AUROC, 0.45 cut-off, survival 25% versus 85%);
 *    equation with units from four open reproductions (Aliment Pharmacol Ther 2014 PMC4015369,
 *    Biomark Res 2015 PMC4509754, World J Gastroenterol 2014 PMC4081674, Frontline Gastroenterol
 *    2020 PMC7043083). The paper's full text (Hepatology, Wiley) answered 403.
 *  - NFS: Angulo 2007 abstract (PMID 17393509: cut-offs −1.455 and 0.676, NPV/PPV); equation with
 *    units reproduced in PMC13077465, PMC13274791, PMC12821135; Russian КР 748_2 cut-offs. The
 *    paper's full text answered 403.
 *  - Carboplatin: Calvert 1989 abstract (PMID 2681557: dose = AUC × (GFR + 25), AUC 5 and 7);
 *    cap of 125 mL/min and doses of 900 / 750 / 600 mg for AUC 6 / 5 / 4 from the NRG Oncology
 *    paper PMC10330633 (NCI/CTEP letter of October 2010; GOG/NCCN 2011).
 *  - MELD-Na: Kim 2021 full text (PMC8608337: OPTN formula with 137 and bounds 125–137, applied
 *    when MELD > 11); Kim 2008 full text (PMC4374557: the published equation uses 140 and
 *    0.025, bounds 125–140 and 6–40); OPTN 2016 policy 9.1.D as reproduced in a clinical-trial
 *    protocol appendix.
 */
import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const MODULE_FILE = 'content/tool-modules/rheum-gi-onco-uro.json';
const SCHEMAS = loadToolModuleCalculatorSchemas([MODULE_FILE]);

type Inputs = Record<string, number>;

function get(values: Inputs, key: string): number {
  const value = values[key];
  if (value === undefined) throw new Error(`Missing input ${key}`);
  return value;
}

function schemaOf(id: string) {
  const schema = SCHEMAS.find((candidate) => candidate.id === `minimed.calculator.${id}`);
  if (!schema) throw new Error(`Missing calculator ${id}`);
  return schema;
}

function run(id: string, inputs: Inputs) {
  const result = evaluateCalculatorSchema(schemaOf(id), inputs);
  if (!result.ok) throw new Error(`${id}: ${result.error}`);
  const numbers = new Map<string, number>();
  const texts = new Map<string, string>();
  for (const output of result.outputs) {
    if (output.kind === 'number') numbers.set(output.id, output.value);
    else if (output.kind === 'text') texts.set(output.id, output.text);
  }
  return {
    numbers,
    texts,
    trace: new Map(result.trace.map((entry) => [entry.id, entry.value] as const)),
    verdict: result.evaluation.verdict,
    interpretation: result.warnings.find((warning) => warning.code === 'interpretation')?.message,
  };
}

function num(id: string, inputs: Inputs, stepId: string): number {
  const result = run(id, inputs);
  const value = result.numbers.get(stepId) ?? result.trace.get(stepId);
  if (typeof value !== 'number') throw new Error(`${id}: ${stepId} is not numeric`);
  return value;
}

/** Finds the input value at which a monotonic function crosses `target`. */
function solve(
  fn: (value: number) => number,
  target: number,
  [low, high]: readonly [number, number],
): number {
  let [lo, hi] = [low, high];
  const increasing = fn(hi) > fn(lo);
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < target === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------------------------
// SLEDAI-2K
// ---------------------------------------------------------------------------------------------
describe('SLEDAI-2K (Gladman 2002 Table 2; strata of Cook 2000)', () => {
  const id = 'sledai-2k';
  /** Weights from Table 2 of Gladman 2002, in the order of the published form. */
  const published: ReadonlyArray<readonly [string, number]> = [
    ['seizure', 8],
    ['psychosis', 8],
    ['organicBrainSyndrome', 8],
    ['visualDisturbance', 8],
    ['cranialNerve', 8],
    ['lupusHeadache', 8],
    ['cerebrovascular', 8],
    ['vasculitis', 8],
    ['arthritis', 4],
    ['myositis', 4],
    ['urinaryCasts', 4],
    ['hematuria', 4],
    ['proteinuria', 4],
    ['pyuria', 4],
    ['rash', 2],
    ['alopecia', 2],
    ['mucosalUlcers', 2],
    ['pleurisy', 2],
    ['pericarditis', 2],
    ['lowComplement', 2],
    ['antiDna', 2],
    ['fever', 1],
    ['thrombocytopenia', 1],
    ['leukopenia', 1],
  ];
  const none: Inputs = Object.fromEntries(published.map(([key]) => [key, 0]));

  it('has exactly the 24 published descriptors with weights 8 / 4 / 2 / 1 and a maximum of 105', () => {
    expect(schemaOf(id).inputs.map((input) => input.id)).toEqual(published.map(([key]) => key));
    for (const [key, weight] of published) {
      expect(num(id, { ...none, [key]: 1 }, 'sledai'), key).toBe(weight);
    }
    const all = Object.fromEntries(published.map(([key]) => [key, 1]));
    // 8 × 8 + 6 × 4 + 7 × 2 + 3 × 1 = 64 + 24 + 14 + 3
    expect(num(id, all, 'sledai')).toBe(105);
    expect(run(id, all).verdict?.rangeId).toBe('ge20');
  });

  it('uses the SLEDAI-2K definitions: ≥ 2 joints, and persistent rash, alopecia, ulcers and proteinuria count', () => {
    const tooltip = (key: string) =>
      schemaOf(id).inputs.find((input) => input.id === key)?.labelTooltip ?? '';
    expect(tooltip('arthritis')).toContain('Два и более');
    expect(tooltip('proteinuria')).toContain('сохраняющаяся');
    for (const key of ['rash', 'alopecia', 'mucosalUlcers']) {
      expect(tooltip(key), key).toContain('сохраня');
    }
    expect(tooltip('thrombocytopenia')).toContain('100×10⁹/л');
    expect(tooltip('leukopenia')).toContain('3,0×10⁹/л');
    expect(tooltip('hematuria')).toContain('5 эритроцитов');
    expect(tooltip('pyuria')).toContain('5 лейкоцитов');
    expect(tooltip('fever')).toContain('38');
  });

  it('adds a hand-computed example of active nephritis', () => {
    // casts 4 + haematuria 4 + proteinuria 4 + low complement 2 + anti-DNA 2 + rash 2 = 18
    const inputs = {
      ...none,
      urinaryCasts: 1,
      hematuria: 1,
      proteinuria: 1,
      lowComplement: 1,
      antiDna: 1,
      rash: 1,
    };
    const result = run(id, inputs);
    expect(result.numbers.get('sledai')).toBe(18);
    expect(result.verdict?.rangeId).toBe('11-19');
    expect(result.interpretation).toContain('4,74');
  });

  it('cuts the Cook 2000 strata at 0 / 1–5 / 6–10 / 11–19 / 20 with the published relative risks', () => {
    const cases: ReadonlyArray<readonly [Inputs, number, string, string | undefined]> = [
      [{}, 0, 'none', undefined],
      [{ fever: 1 }, 1, '1-5', '1,28'],
      [{ arthritis: 1, fever: 1 }, 5, '1-5', '1,28'], // 4 + 1
      [{ arthritis: 1, rash: 1 }, 6, '6-10', '2,34'], // 4 + 2
      [{ seizure: 1, rash: 1 }, 10, '6-10', '2,34'], // 8 + 2
      [{ seizure: 1, rash: 1, fever: 1 }, 11, '11-19', '4,74'], // 8 + 2 + 1
      [{ seizure: 1, psychosis: 1, rash: 1, fever: 1 }, 19, '11-19', '4,74'], // 8 + 8 + 2 + 1
      [{ seizure: 1, psychosis: 1, arthritis: 1 }, 20, 'ge20', '14,11'], // 8 + 8 + 4
    ];
    for (const [overrides, score, band, rr] of cases) {
      const result = run(id, { ...none, ...overrides });
      expect(result.numbers.get('sledai'), `score ${score}`).toBe(score);
      expect(result.verdict?.rangeId, `band at ${score}`).toBe(band);
      if (rr) expect(result.interpretation, `figure at ${score}`).toContain(rr);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SLICC/ACR damage index
// ---------------------------------------------------------------------------------------------
describe('SLICC/ACR damage index (12 systems, 41 items, maximum 47)', () => {
  const id = 'slicc-acr-damage-index';
  const schema = schemaOf(id);
  const none: Inputs = Object.fromEntries(schema.inputs.map((input) => [input.id, 0]));
  const maxOf = (key: string) =>
    Math.max(
      ...(schema.inputs.find((input) => input.id === key)?.options ?? []).map((option) =>
        Number(option.value),
      ),
    );

  it('lists the 41 published items', () => {
    expect(schema.inputs).toHaveLength(41);
  });

  it('scores 2 only where the form says "score 2 if more than once / one site"', () => {
    const doubles = schema.inputs
      .filter((input) => maxOf(input.id) === 2)
      .map((input) => input.id)
      .toSorted();
    // CVA, myocardial infarction, significant tissue loss, bowel/spleen/liver/gall-bladder
    // infarction or resection, avascular necrosis, malignancy.
    expect(doubles).toEqual(
      [
        'avascularNecrosis',
        'bowelInfarction',
        'malignancy',
        'myocardialInfarction',
        'significantTissueLoss',
        'stroke',
      ].toSorted(),
    );
    const three = schema.inputs.filter((input) => maxOf(input.id) === 3).map((input) => input.id);
    expect(three).toEqual(['esrd']);
  });

  it('adds up to 47 over the ten published organ groups', () => {
    const groups = new Map<string, number>();
    for (const input of schema.inputs) {
      const group = input.labelTooltip ?? '';
      groups.set(group, (groups.get(group) ?? 0) + maxOf(input.id));
    }
    // The renal group counts ESRD (3) instead of GFR (1) + proteinuria (1) + ESRD, per "or".
    groups.set('Почки', 3);
    expect(Object.fromEntries(groups)).toEqual({
      'Орган зрения': 2, // cataract, retinal change or optic atrophy
      'Нервная система': 6, // 1 + 1 + 2 (CVA) + 1 + 1
      Почки: 3,
      Лёгкие: 5,
      'Сердечно-сосудистая система': 6, // 1 + 2 (MI) + 1 + 1 + 1
      'Периферические сосуды': 5, // 1 + 1 + 2 (tissue loss) + 1
      'Желудочно-кишечный тракт': 6, // 2 (infarction/resection) + 1 + 1 + 1 + 1
      'Костно-мышечная система': 7, // 1 + 1 + 1 + 2 (AVN) + 1 + 1
      Кожа: 3,
      Прочее: 4, // gonadal failure 1 + diabetes 1 + malignancy 2
    });
    const everything = Object.fromEntries(
      schema.inputs.map((input) => [input.id, maxOf(input.id)]),
    );
    // 2 + 6 + 3 + 5 + 6 + 5 + 6 + 7 + 3 + 4 = 47
    expect(num(id, everything, 'damage')).toBe(47);
  });

  it('counts end-stage renal disease as 3 instead of adding it to GFR and proteinuria', () => {
    expect(num(id, { ...none, gfr: 1 }, 'damage')).toBe(1);
    expect(num(id, { ...none, gfr: 1, proteinuria: 1 }, 'damage')).toBe(2);
    expect(num(id, { ...none, esrd: 3 }, 'damage')).toBe(3);
    expect(num(id, { ...none, gfr: 1, proteinuria: 1, esrd: 3 }, 'damage')).toBe(3);
  });

  it('reproduces a hand-computed example and declares no verdict', () => {
    // cataract 1 + CVA twice 2 + proteinuria 1 + MI once 1 + osteoporosis 1 + diabetes 1
    // + malignancy at two sites 2 = 9
    const result = run(id, {
      ...none,
      cataract: 1,
      stroke: 2,
      proteinuria: 1,
      myocardialInfarction: 1,
      osteoporosis: 1,
      diabetes: 1,
      malignancy: 2,
    });
    expect(result.numbers.get('damage')).toBe(9);
    expect(result.verdict).toBeUndefined();
  });

  it('states the six-month rule', () => {
    expect(schema.limitations.join(' ')).toContain('6 месяцев');
    expect(schema.inputs.find((input) => input.id === 'seizures')?.label).toContain('6 мес');
    expect(schema.inputs.find((input) => input.id === 'proteinuria')?.label).toContain('3,5');
  });
});

// ---------------------------------------------------------------------------------------------
// RECIST 1.1
// ---------------------------------------------------------------------------------------------
describe('RECIST 1.1 (Eisenhauer 2009, section 4.3 and Table 1)', () => {
  const id = 'recist-11-response';
  const base: Inputs = {
    baselineSum: 100,
    nadirSum: 100,
    currentSum: 100,
    targetsGone: 0,
    nonTarget: 0,
    newLesions: 0,
  };
  const band = (inputs: Inputs) => run(id, inputs).verdict?.rangeId;

  it('applies PR at a decrease of at least 30% from the baseline sum', () => {
    // 100 → 70 is exactly −30%: PR; 71 is −29%: SD
    expect(band({ ...base, nadirSum: 70, currentSum: 70 })).toBe('pr');
    expect(band({ ...base, nadirSum: 71, currentSum: 71 })).toBe('sd');
    // The reference of PR is the baseline, not the nadir: 200 baseline, 150 nadir, 140 now (−30%).
    expect(
      band({
        baselineSum: 200,
        nadirSum: 140,
        currentSum: 140,
        targetsGone: 0,
        nonTarget: 0,
        newLesions: 0,
      }),
    ).toBe('pr');
  });

  it('applies PD only at +20% over the nadir AND at least +5 mm', () => {
    // nadir 40: +20% is 8 mm → 48 PD, 47 SD
    expect(band({ ...base, baselineSum: 60, nadirSum: 40, currentSum: 48 })).toBe('pd');
    expect(band({ ...base, baselineSum: 60, nadirSum: 40, currentSum: 47 })).toBe('sd');
    // nadir 20: 24 mm is +20% but only +4 mm → SD; 25 mm is +25% and +5 mm → PD
    expect(band({ ...base, baselineSum: 30, nadirSum: 20, currentSum: 24 })).toBe('sd');
    expect(band({ ...base, baselineSum: 30, nadirSum: 20, currentSum: 25 })).toBe('pd');
    // nadir 100 (the baseline is the smallest sum): +20 mm = +20% → PD, 119 → SD
    expect(band({ ...base, currentSum: 120 })).toBe('pd');
    expect(band({ ...base, currentSum: 119 })).toBe('sd');
  });

  it('measures progression from the smallest sum on study, not from the baseline', () => {
    // −40% from baseline but +20% and +10 mm from the nadir of 50
    const result = run(id, { ...base, nadirSum: 50, currentSum: 60 });
    expect(result.numbers.get('changeFromBaseline')).toBeCloseTo(-40, 6);
    expect(result.numbers.get('changeFromNadir')).toBeCloseTo(20, 6);
    expect(result.verdict?.rangeId).toBe('pd');
  });

  it('follows every row of Table 1 (target, non-target, new lesions → overall response)', () => {
    const cr = { ...base, targetsGone: 1, nadirSum: 8, currentSum: 8 }; // nodes < 10 mm may have a sum
    const pr = { ...base, nadirSum: 60, currentSum: 60 };
    const sd = base;
    const pd = { ...base, currentSum: 130 };
    const rows: ReadonlyArray<readonly [Inputs, number, number, string]> = [
      // target, non-target (0 = CR, 1 = non-CR/non-PD, 2 = not evaluated, 3 = PD), new, overall
      [cr, 0, 0, 'cr'], // CR, CR, no → CR
      [cr, 1, 0, 'pr'], // CR, non-CR/non-PD, no → PR
      [cr, 2, 0, 'pr'], // CR, not evaluated, no → PR
      [pr, 1, 0, 'pr'], // PR, non-PD or not all evaluated, no → PR
      [pr, 2, 0, 'pr'],
      [pr, 0, 0, 'pr'],
      [sd, 1, 0, 'sd'], // SD, non-PD or not all evaluated, no → SD
      [sd, 2, 0, 'sd'],
      [sd, 0, 0, 'sd'],
      [pd, 0, 0, 'pd'], // PD, any, yes or no → PD
      [pd, 1, 1, 'pd'],
      [pd, 3, 0, 'pd'],
      [cr, 3, 0, 'pd'], // any, PD, yes or no → PD
      [pr, 3, 0, 'pd'],
      [sd, 3, 0, 'pd'],
      [cr, 0, 1, 'pd'], // any, any, yes → PD
      [pr, 1, 1, 'pd'],
      [sd, 2, 1, 'pd'],
    ];
    for (const [target, nonTarget, newLesions, overall] of rows) {
      expect(
        band({ ...target, nonTarget, newLesions }),
        `${JSON.stringify([target['currentSum'], target['targetsGone'], nonTarget, newLesions])}`,
      ).toBe(overall);
    }
    expect(run(id, { ...cr, nonTarget: 0 }).texts.get('overallResponse')).toBe('Полный ответ (CR)');
    expect(run(id, { ...pr }).texts.get('overallResponse')).toBe('Частичный ответ (PR)');
    expect(run(id, { ...sd }).texts.get('overallResponse')).toBe('Стабилизация (SD)');
    expect(run(id, { ...pd }).texts.get('overallResponse')).toBe('Прогрессирование (PD)');
  });

  it('keeps the CR requirement of normal nodes (short axis < 10 mm) in the input wording', () => {
    const gone = schemaOf(id).inputs.find((input) => input.id === 'targetsGone');
    expect(gone?.labelTooltip).toContain('10 мм');
    expect(gone?.options?.some((option) => option.label.includes('<10 мм'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Lille model
// ---------------------------------------------------------------------------------------------
describe('Lille model (Louvet 2007: cut-off 0.45; 6-month survival 85% versus 25%)', () => {
  const id = 'lille-model';
  /** Equation with the units of the publication: albumin g/L, bilirubin µmol/L, PT seconds. */
  const reference = (v: Inputs) => {
    const r =
      3.19 -
      0.101 * get(v, 'age') +
      0.147 * get(v, 'albumin') +
      0.0165 * (get(v, 'bilirubinDay0') - get(v, 'bilirubinDay7')) -
      0.206 * get(v, 'renalInsufficiency') -
      0.0065 * get(v, 'bilirubinDay0') -
      0.0096 * get(v, 'prothrombinTime');
    return { r, lille: Math.exp(-r) / (1 + Math.exp(-r)) };
  };
  const responder: Inputs = {
    age: 50,
    albumin: 25,
    bilirubinDay0: 300,
    bilirubinDay7: 200,
    prothrombinTime: 20,
    renalInsufficiency: 0,
  };
  const nonResponder: Inputs = {
    age: 60,
    albumin: 20,
    bilirubinDay0: 400,
    bilirubinDay7: 450,
    prothrombinTime: 30,
    renalInsufficiency: 1,
  };

  it('reproduces a hand-computed responder', () => {
    // R = 3.19 − 5.05 + 3.675 + 0.0165·100 − 0 − 1.95 − 0.192 = 1.323
    // Lille = e^−1.323 / (1 + e^−1.323) = 0.21032
    const result = run(id, responder);
    expect(result.trace.get('linearScore')).toBeCloseTo(1.323, 9);
    expect(result.numbers.get('lille')).toBeCloseTo(0.2103196, 6);
    expect(result.numbers.get('lille')).toBeCloseTo(reference(responder).lille, 12);
    expect(result.verdict?.rangeId).toBe('responder');
    expect(result.interpretation).toContain('85%');
  });

  it('reproduces a hand-computed non-responder with renal insufficiency and rising bilirubin', () => {
    // R = 3.19 − 6.06 + 2.94 + 0.0165·(400 − 450) − 0.206 − 2.6 − 0.288 = −3.849
    // Lille = e^3.849 / (1 + e^3.849) = 0.97914
    const result = run(id, nonResponder);
    expect(result.trace.get('linearScore')).toBeCloseTo(-3.849, 9);
    expect(result.numbers.get('lille')).toBeCloseTo(0.9791432, 6);
    expect(result.verdict?.rangeId).toBe('nonresponder');
    expect(result.interpretation).toContain('25%');
  });

  it('flips from response to non-response at a Lille score of exactly 0.45 (R = ln(0.55/0.45))', () => {
    const target = Math.log(0.55 / 0.45); // 0.200671
    // Lille rises when day-7 bilirubin rises: solve for the day-7 bilirubin that gives R = target.
    const b7 = solve(
      (value) => -reference({ ...responder, bilirubinDay7: value }).r,
      -target,
      [1, 1500],
    );
    expect(reference({ ...responder, bilirubinDay7: b7 }).lille).toBeCloseTo(0.45, 9);
    expect(run(id, { ...responder, bilirubinDay7: b7 - 0.01 }).verdict?.rangeId).toBe('responder');
    expect(run(id, { ...responder, bilirubinDay7: b7 + 0.01 }).verdict?.rangeId).toBe(
      'nonresponder',
    );
  });

  it('weights each variable by the published coefficient', () => {
    const baseR = num(id, responder, 'linearScore');
    const step = (key: keyof typeof responder, delta: number) =>
      num(id, { ...responder, [key]: get(responder, key) + delta }, 'linearScore') - baseR;
    expect(step('age', 1)).toBeCloseTo(-0.101, 9);
    expect(step('albumin', 1)).toBeCloseTo(0.147, 9);
    expect(step('bilirubinDay0', 1)).toBeCloseTo(0.0165 - 0.0065, 9);
    expect(step('bilirubinDay7', 1)).toBeCloseTo(-0.0165, 9);
    expect(step('prothrombinTime', 1)).toBeCloseTo(-0.0096, 9);
    expect(step('renalInsufficiency', 1)).toBeCloseTo(-0.206, 9);
  });

  it('defines renal insufficiency as creatinine above 115 µmol/L and uses the source units', () => {
    const inputs = schemaOf(id).inputs;
    expect(inputs.find((input) => input.id === 'renalInsufficiency')?.labelTooltip).toContain(
      '115 мкмоль/л',
    );
    expect(inputs.find((input) => input.id === 'albumin')?.unit).toBe('г/л');
    expect(inputs.find((input) => input.id === 'bilirubinDay0')?.unit).toBe('мкмоль/л');
    expect(inputs.find((input) => input.id === 'prothrombinTime')?.unit).toBe('с');
  });
});

// ---------------------------------------------------------------------------------------------
// NAFLD fibrosis score
// ---------------------------------------------------------------------------------------------
describe('NAFLD fibrosis score (Angulo 2007: −1.455 and 0.676)', () => {
  const id = 'nafld-fibrosis-score';
  /** Published equation: albumin in g/dL, platelets ×10⁹/L, IFG or diabetes 1/0. */
  const reference = (v: Inputs) =>
    -1.675 +
    0.037 * get(v, 'age') +
    0.094 * get(v, 'bmi') +
    1.13 * get(v, 'hyperglycemia') +
    0.99 * (get(v, 'ast') / get(v, 'alt')) -
    0.013 * get(v, 'platelets') -
    0.66 * (get(v, 'albumin') / 10);
  const indeterminate: Inputs = {
    age: 50,
    bmi: 30,
    hyperglycemia: 1,
    ast: 40,
    alt: 50,
    platelets: 200,
    albumin: 40,
  };

  it('reproduces hand-computed examples in the three bands', () => {
    // age 50, BMI 30, diabetes, AST/ALT 0.8, platelets 200, albumin 4.0 g/dL (40 g/L):
    // −1.675 + 1.85 + 2.82 + 1.13 + 0.792 − 2.6 − 2.64 = −0.323 → between the cut-offs
    expect(num(id, indeterminate, 'nfs')).toBeCloseTo(-0.323, 9);
    expect(run(id, indeterminate).verdict?.rangeId).toBe('indeterminate');
    // age 35, BMI 22, no diabetes, AST/ALT 0.625, platelets 300, albumin 4.5 g/dL:
    // −1.675 + 1.295 + 2.068 + 0 + 0.61875 − 3.9 − 2.97 = −4.56325 → low
    const low: Inputs = {
      age: 35,
      bmi: 22,
      hyperglycemia: 0,
      ast: 25,
      alt: 40,
      platelets: 300,
      albumin: 45,
    };
    expect(num(id, low, 'nfs')).toBeCloseTo(-4.56325, 9);
    expect(run(id, low).verdict?.rangeId).toBe('low');
    expect(run(id, low).interpretation).toContain('маловероятен');
    // age 65, BMI 35, diabetes, AST/ALT 2.0, platelets 100, albumin 3.0 g/dL:
    // −1.675 + 2.405 + 3.29 + 1.13 + 1.98 − 1.3 − 1.98 = 3.85 → high
    const high: Inputs = {
      age: 65,
      bmi: 35,
      hyperglycemia: 1,
      ast: 80,
      alt: 40,
      platelets: 100,
      albumin: 30,
    };
    expect(num(id, high, 'nfs')).toBeCloseTo(3.85, 9);
    expect(run(id, high).verdict?.rangeId).toBe('high');
    expect(run(id, high).interpretation).toContain('вероятен');
  });

  it('takes albumin in g/L and converts it to the g/dL of the equation', () => {
    const grams = num(id, { ...indeterminate, albumin: 40 }, 'nfs');
    const higher = num(id, { ...indeterminate, albumin: 50 }, 'nfs');
    expect(grams - higher).toBeCloseTo(0.66, 9); // 10 g/L = 1 g/dL × 0.66
    expect(grams).toBeCloseTo(reference(indeterminate), 9);
  });

  it('weights each variable by the published coefficient', () => {
    const baseScore = num(id, indeterminate, 'nfs');
    const step = (key: keyof typeof indeterminate, delta: number) =>
      num(id, { ...indeterminate, [key]: get(indeterminate, key) + delta }, 'nfs') - baseScore;
    expect(step('age', 1)).toBeCloseTo(0.037, 9);
    expect(step('bmi', 1)).toBeCloseTo(0.094, 9);
    expect(step('platelets', 1)).toBeCloseTo(-0.013, 9);
    expect(num(id, { ...indeterminate, hyperglycemia: 0 }, 'nfs') - baseScore).toBeCloseTo(
      -1.13,
      9,
    );
    // AST/ALT 0.8 → 1.0 adds 0.99 × 0.2
    expect(num(id, { ...indeterminate, ast: 50 }, 'nfs') - baseScore).toBeCloseTo(0.99 * 0.2, 9);
  });

  it('cuts at −1.455 (below: low) and 0.676 (above: high); the edges belong to the middle band', () => {
    for (const [cut, below, above] of [
      [-1.455, 'low', 'indeterminate'],
      [0.676, 'indeterminate', 'high'],
    ] as const) {
      const platelets = solve(
        (value) => reference({ ...indeterminate, platelets: value }),
        cut,
        [5, 1000],
      );
      expect(reference({ ...indeterminate, platelets })).toBeCloseTo(cut, 9);
      // reference falls as platelets rise, so more platelets = the lower band
      expect(run(id, { ...indeterminate, platelets: platelets + 0.01 }).verdict?.rangeId).toBe(
        below,
      );
      expect(run(id, { ...indeterminate, platelets: platelets - 0.01 }).verdict?.rangeId).toBe(
        above,
      );
    }
    const when = schemaOf(id).evaluation.rules.map((rule) => rule.when);
    expect(when).toEqual(['nfs < -1.455', 'nfs <= 0.676', '1']);
  });
});

// ---------------------------------------------------------------------------------------------
// Carboplatin, Calvert formula
// ---------------------------------------------------------------------------------------------
describe('Carboplatin dose (Calvert 1989: dose = AUC × (GFR + 25); cap 125 mL/min by NCI/CTEP 2010)', () => {
  const id = 'carboplatin-calvert-dose';
  /** Cockcroft–Gault with creatinine in µmol/L (÷ 88.4 to mg/dL). */
  const crcl = (age: number, kg: number, female: boolean, umol: number) =>
    ((140 - age) * kg * (female ? 0.85 : 1)) / (72 * (umol / 88.4));

  it('reproduces a hand-computed dose without reaching the cap', () => {
    // man 60 y, 70 kg, creatinine 80 µmol/L = 0.905 mg/dL:
    // CrCl = 80 × 70 / (72 × 0.905) = 85.94 mL/min; dose = 5 × (85.94 + 25) = 554.7 mg
    const inputs = { targetAuc: 5, age: 60, weight: 70, sexFactor: 1, creatinine: 80, capGfr: 1 };
    const result = run(id, inputs);
    expect(result.trace.get('creatinineClearance')).toBeCloseTo(85.9444, 3);
    expect(result.numbers.get('gfrUsed')).toBeCloseTo(85.9444, 3);
    expect(result.numbers.get('dose')).toBeCloseTo(554.7222, 3);
    expect(result.numbers.get('dose')).toBeCloseTo(5 * (crcl(60, 70, false, 80) + 25), 9);
    expect(result.verdict).toBeUndefined();
  });

  it('applies the 125 mL/min cap, giving a maximum of AUC × 150 mg (900 / 750 / 600 for AUC 6 / 5 / 4)', () => {
    // woman 40 y, 60 kg, creatinine 50 µmol/L: CrCl = 100 × 60 × 0.85 × 88.4 / (72 × 50) = 125.23
    const woman = { age: 40, weight: 60, sexFactor: 0.85, creatinine: 50 };
    expect(crcl(40, 60, true, 50)).toBeCloseTo(125.2333, 3);
    expect(num(id, { ...woman, targetAuc: 6, capGfr: 1 }, 'dose')).toBeCloseTo(900, 9);
    expect(num(id, { ...woman, targetAuc: 6, capGfr: 0 }, 'dose')).toBeCloseTo(901.4, 3);
    // man 30 y, 90 kg, creatinine 60 µmol/L: CrCl = 202.58 → capped to 125
    const man = { age: 30, weight: 90, sexFactor: 1, creatinine: 60 };
    expect(crcl(30, 90, false, 60)).toBeCloseTo(202.5833, 3);
    for (const [auc, maximum] of [
      [6, 900],
      [5, 750],
      [4, 600],
    ] as const) {
      expect(num(id, { ...man, targetAuc: auc, capGfr: 1 }, 'dose'), `AUC ${auc}`).toBe(maximum);
    }
    expect(num(id, { ...man, targetAuc: 5, capGfr: 0 }, 'dose')).toBeCloseTo(1137.9167, 3);
    expect(num(id, { ...man, targetAuc: 5, capGfr: 1 }, 'gfrUsed')).toBe(125);
  });

  it('leaves a clearance of exactly 125 and below unchanged by the cap', () => {
    // man 40 y, 70 kg: 100 × 70 × 88.4 / (72 × c) = 125 → c = 68.7 µmol/L
    const umol = (100 * 70 * 88.4) / (72 * 125);
    const inputs = { targetAuc: 5, age: 40, weight: 70, sexFactor: 1, capGfr: 1 };
    expect(num(id, { ...inputs, creatinine: umol }, 'gfrUsed')).toBeCloseTo(125, 6);
    expect(num(id, { ...inputs, creatinine: umol * 1.1 }, 'gfrUsed')).toBeCloseTo(125 / 1.1, 6);
  });

  it('uses the Cockcroft–Gault female factor 0.85 and documents the cap as a convention', () => {
    const male = num(
      id,
      { targetAuc: 5, age: 60, weight: 70, sexFactor: 1, creatinine: 100, capGfr: 0 },
      'creatinineClearance',
    );
    const female = num(
      id,
      { targetAuc: 5, age: 60, weight: 70, sexFactor: 0.85, creatinine: 100, capGfr: 0 },
      'creatinineClearance',
    );
    expect(female / male).toBeCloseTo(0.85, 9);
    const schema = schemaOf(id);
    expect(schema.limitations.join(' ')).toContain('NCI/CTEP');
    expect(schema.limitations.join(' ')).toContain('В работе Calvert 1989 ограничения нет');
    expect(schema.inputs.find((input) => input.id === 'targetAuc')?.labelTooltip).toContain(
      '5 при монотерапии у ранее леченных и 7',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// MELD-Na
// ---------------------------------------------------------------------------------------------
describe('MELD-Na (OPTN 2016 as in Kim 2021: +1.32·(137−Na) − 0.033·MELD·(137−Na), Na 125–137, MELD > 11)', () => {
  const id = 'meld-na';
  // bilirubin 6.0 mg/dL = 102.6 µmol/L, INR 1.8, creatinine 1.0 mg/dL = 88.4 µmol/L
  const base: Inputs = {
    bilirubin: 6 * 17.1,
    inr: 1.8,
    creatinine: 88.4,
    dialysis: 0,
    sodium: 137,
  };
  const optn = (meld: number, sodium: number) => {
    const na = Math.min(Math.max(sodium, 125), 137);
    return meld > 11 ? meld + 1.32 * (137 - na) - 0.033 * meld * (137 - na) : meld;
  };

  it('reproduces a hand-computed example', () => {
    // MELD(i) = 10 × (0.957·ln 1.0 + 0.378·ln 6.0 + 1.12·ln 1.8 + 0.643)
    //         = 10 × (0 + 0.67731 + 0.65833 + 0.643) = 19.79 → 20
    expect(num(id, base, 'meldBase')).toBe(20);
    expect(num(id, base, 'meld')).toBe(20); // sodium 137: no addition
    // Na 127: 20 + 1.32 × 10 − 0.033 × 20 × 10 = 26.6 → 27
    expect(num(id, { ...base, sodium: 127 }, 'meld')).toBe(27);
    // Na 125: 20 + 1.32 × 12 − 0.033 × 20 × 12 = 27.92 → 28
    expect(num(id, { ...base, sodium: 125 }, 'meld')).toBe(28);
    expect(num(id, { ...base, sodium: 125 }, 'meld')).toBe(Math.round(optn(20, 125)));
  });

  it('bounds sodium to 125–137 and ignores values outside', () => {
    expect(num(id, { ...base, sodium: 110 }, 'meld')).toBe(
      num(id, { ...base, sodium: 125 }, 'meld'),
    );
    expect(num(id, { ...base, sodium: 150 }, 'meld')).toBe(
      num(id, { ...base, sodium: 137 }, 'meld'),
    );
    expect(num(id, { ...base, sodium: 125 }, 'sodiumUsed')).toBe(125);
    expect(num(id, { ...base, sodium: 160 }, 'sodiumUsed')).toBe(137);
  });

  it('applies the sodium term only to a MELD above 11 (11 untouched, 12 adjusted)', () => {
    // MELD 11: bilirubin 1.0, INR 1.5, creatinine 1.0 → 10 × (0.643 + 1.12·ln 1.5) = 11.0 → 11
    const eleven = { bilirubin: 17.1, inr: 1.5, creatinine: 88.4, dialysis: 0, sodium: 125 };
    expect(num(id, eleven, 'meldBase')).toBe(11);
    expect(num(id, eleven, 'meld')).toBe(11);
    // MELD 12 (INR 1.55: 10 × (0.643 + 1.12·ln 1.55) = 11.35 → 11; INR 1.65 → 12.03 → 12)
    const twelve = { ...eleven, inr: 1.65 };
    expect(num(id, twelve, 'meldBase')).toBe(12);
    // Na 125: 12 + 1.32 × 12 − 0.033 × 12 × 12 = 23.088 → 23
    expect(num(id, twelve, 'meld')).toBe(23);
  });

  it('never exceeds 40: the cap binds MELD(i) and the sodium term vanishes at 40', () => {
    const extreme = {
      bilirubin: 60 * 17.1,
      inr: 9,
      creatinine: 5 * 88.4,
      dialysis: 0,
      sodium: 125,
    };
    expect(num(id, extreme, 'meldBase')).toBe(40);
    // 40 + 1.32 × 12 − 0.033 × 40 × 12 = 40 (1.32 = 0.033 × 40)
    expect(num(id, extreme, 'meld')).toBe(40);
    for (const inr of [1, 1.5, 2, 3, 5, 9]) {
      for (const bilirubinMg of [1, 5, 20, 60]) {
        for (const sodium of [120, 125, 130, 137, 145]) {
          const meld = num(
            id,
            { bilirubin: bilirubinMg * 17.1, inr, creatinine: 3 * 88.4, dialysis: 0, sodium },
            'meld',
          );
          expect(meld).toBeLessThanOrEqual(40);
          expect(meld).toBeGreaterThanOrEqual(6);
        }
      }
    }
  });

  it('sets creatinine to 4.0 mg/dL for dialysis or a value above 4.0, and floors laboratory values at 1.0', () => {
    // creatinine 4.0: 10 × (0.957·ln 4 + 0.643) = 19.7 → 20 (bilirubin and INR at 1.0)
    const floor = { bilirubin: 10, inr: 0.8, creatinine: 60, dialysis: 0, sodium: 137 };
    expect(num(id, floor, 'meldBase')).toBe(6); // 10 × 0.643 = 6.43 → 6
    expect(num(id, { ...floor, dialysis: 1 }, 'creatinineMg')).toBe(4);
    expect(num(id, { ...floor, dialysis: 1 }, 'meldBase')).toBe(20);
    expect(num(id, { ...floor, creatinine: 400 }, 'creatinineMg')).toBe(4); // 4.52 mg/dL
    expect(num(id, { ...floor, creatinine: 400 }, 'meldBase')).toBe(20);
    expect(num(id, floor, 'bilirubinMg')).toBe(1);
    expect(num(id, floor, 'inrUsed')).toBe(1);
  });

  it('documents that the formula is the OPTN variant and not the 140/0.025 equation of Kim 2008', () => {
    const schema = schemaOf(id);
    expect(schema.formulaDisplay).toContain('OPTN 2016');
    expect(schema.limitations.join(' ')).toContain('0,025');
    expect(schema.limitations.join(' ')).toContain('140');
    expect(schema.evaluation.status).toBe('unavailable');
  });
});
