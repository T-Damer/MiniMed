import type { DoseRule } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  bodySurfaceArea,
  checkCaps,
  type IntakeInput,
  type ProductChoice,
  planIntake,
  planQuantity,
  ROUNDING_TOLERANCE_PERCENT,
} from './dose-compute';
import { ADULT_AGE_DAYS, matchPopulation } from './dose-population';

const YEAR = 365.25;
const MG = 0; // DOSE_UNITS index of mg
const ML = 1;

function rule(partial: Partial<DoseRule>): DoseRule {
  return { k: 0, s: 0, a: 0, b: 10, u: MG, ...partial };
}

const tablets500: ProductChoice = {
  form: 'таблетки',
  strength: '500 мг',
  packs: [10, 16, 20, 21],
  packUnit: 'piece',
};
const suspension: ProductChoice = {
  form: 'порошок для приготовления суспензии для приема внутрь',
  strength: '250 мг/5 мл',
  packs: [100],
  packUnit: 'ml',
};

function input(partial: Partial<IntakeInput> & Pick<IntakeInput, 'rule'>): IntakeInput {
  return { patient: {}, product: null, divisible: false, ...partial };
}

describe('who a rule is for', () => {
  const child = rule({
    p0: Math.round(5 * YEAR),
    p1: Math.round(13 * YEAR),
    w0: 190,
    w1: 400,
    g: 2,
    or: 1,
  });
  it('fits a child of 20 kg by weight when the age is not known', () => {
    expect(matchPopulation(child, { group: 'child', weightKg: 20 }).fit).toBe('yes');
  });
  it('asks for the age when only the age bounds decide', () => {
    const byAge = rule({ p0: Math.round(5 * YEAR), p1: Math.round(13 * YEAR), g: 2 });
    const match = matchPopulation(byAge, { group: 'child', weightKg: 20 });
    expect(match.fit).toBe('maybe');
    expect(match.missing).toEqual(['age']);
  });
  it('does not fit an adult', () => {
    expect(matchPopulation(child, { ageDays: 30 * Math.round(YEAR), weightKg: 80 }).fit).toBe('no');
  });
  it('computes a rule without a population only for an adult', () => {
    const unstated = rule({});
    expect(matchPopulation(unstated, { ageDays: ADULT_AGE_DAYS + 10 })).toMatchObject({
      fit: 'yes',
      unstated: true,
    });
    expect(matchPopulation(unstated, { ageDays: 5 * Math.round(YEAR) }).fit).toBe('no');
    expect(matchPopulation(unstated, {}).fit).toBe('maybe');
  });
  it('marks a patient whose age is in the year of a bound', () => {
    const match = matchPopulation(child, { ageDays: Math.round(5.5 * YEAR), weightKg: 20 });
    expect(match.boundary).toBe(true);
  });
  it('takes a child of 15 kg with no age for the rule «дети до 18 лет»', () => {
    const children = rule({ p1: ADULT_AGE_DAYS - 1, g: 2, d0: 10, d1: 15, pk: 1 });
    expect(matchPopulation(children, { weightKg: 15 }).fit).toBe('yes');
    expect(matchPopulation(children, { weightKg: 70 }).fit).toBe('no');
    expect(matchPopulation(children, { weightKg: 40 }).fit).toBe('maybe');
  });
  it('never offers a condition rule as a dose', () => {
    expect(matchPopulation(rule({ c: 1 }), { ageDays: ADULT_AGE_DAYS + 1 }).conditional).toBe(true);
  });
});

describe('the single dose', () => {
  it('multiplies a dose per kilogram by the weight and rounds to a suspension', () => {
    const plan = planIntake(
      input({
        rule: rule({ d0: 10, d1: 15, pk: 1, f0: 3, f1: 3 }),
        patient: { weightKg: 20 },
        product: suspension,
      }),
    );
    expect(plan.status).toBe('ok');
    expect(plan.singleMin).toBe(200);
    expect(plan.singleMax).toBe(300);
    expect(plan.units).toMatchObject({ kind: 'ml', count: 4, amount: 200 });
    expect(plan.intakes).toBe(3);
    expect(plan.actualDaily).toBe(600);
  });

  it('asks for the weight and never guesses it', () => {
    expect(planIntake(input({ rule: rule({ d0: 10, pk: 1, f0: 3 }) })).status).toBe('needs-weight');
  });

  it('asks for the number of intakes of a daily dose that states none', () => {
    const plan = planIntake(
      input({ rule: rule({ d0: 50, d1: 90, pk: 1, bs: 1 }), patient: { weightKg: 20 } }),
    );
    expect(plan.status).toBe('needs-intakes');
    const chosen = planIntake(
      input({
        rule: rule({ d0: 50, d1: 90, pk: 1, bs: 1 }),
        patient: { weightKg: 20 },
        intakesPerDay: 2,
        product: suspension,
      }),
    );
    expect(chosen.single).toBe(500);
    expect(chosen.units).toMatchObject({ kind: 'ml', count: 10 });
  });

  it('splits a daily dose by the stated number of intakes', () => {
    const plan = planIntake(
      input({ rule: rule({ d0: 1500, bs: 1, f0: 3, f1: 3 }), product: tablets500 }),
    );
    expect(plan.single).toBe(500);
    expect(plan.units).toMatchObject({ count: 1, kind: 'piece' });
  });

  it("uses the instruction's own count of pieces when the strength is the one it names", () => {
    const plan = planIntake(
      input({
        rule: rule({ d0: 500, d1: 1000, q0: 1, q1: 2, pm: 500, f0: 3 }),
        product: tablets500,
      }),
    );
    expect(plan.units).toMatchObject({ count: 1, fromInstruction: true, amount: 500 });
    const upper = planIntake(
      input({
        rule: rule({ d0: 500, d1: 1000, q0: 1, q1: 2, pm: 500, f0: 3 }),
        product: tablets500,
        position: 'max',
      }),
    );
    expect(upper.units?.count).toBe(2);
  });

  it('rounds a mass to a whole tablet, or to a half when the instruction allows dividing', () => {
    const base = rule({ d0: 750, f0: 2 });
    expect(
      planIntake(input({ rule: base, product: tablets500, divisible: true })).units,
    ).toMatchObject({
      count: 1.5,
      amount: 750,
      deviationPercent: 0,
    });
    // 520 mg is 4 % off a whole 500 mg tablet: within the tolerance, shown with its deviation.
    expect(
      planIntake(input({ rule: rule({ d0: 520, f0: 2 }), product: tablets500 })).units,
    ).toMatchObject({ count: 1, amount: 500, deviationPercent: -3.846 });
  });

  it('refuses a rounding beyond 10 % and shows the dose without a count (RX3 audit: +100 … +300 %)', () => {
    // 750 mg on whole 500 mg tablets would be 2 tablets: +33 %.
    const wholeOnly = planIntake(
      input({ rule: rule({ d0: 750, f0: 2 }), product: tablets500, divisible: false }),
    );
    expect(wholeOnly.status).toBe('ok');
    expect(wholeOnly.units).toBeNull();
    expect(wholeOnly.single).toBe(750);
    expect(wholeOnly.actualSingle).toBe(750);
    expect(wholeOnly.refusedRounding).toEqual({ amount: 1000, deviationPercent: 33.333 });
    expect(wholeOnly.notes).toContain('rounding-refused');
    expect(ROUNDING_TOLERANCE_PERCENT).toBe(10);
    // The audit's desloratadine child dose: 2.5 mg wanted, a 5 mg tablet is +100 %.
    const desloratadine = planIntake(
      input({
        rule: rule({ d0: 2.5, f0: 1 }),
        product: { ...tablets500, strength: '5 мг' },
      }),
    );
    expect(desloratadine.units).toBeNull();
    expect(desloratadine.refusedRounding?.deviationPercent).toBe(100);
    // Trimebutine: 25 mg wanted on a 200 mg tablet is +700 % of a whole tablet.
    const trimebutine = planIntake(
      input({
        rule: rule({ d0: 25, f0: 3 }),
        product: { ...tablets500, strength: '200 мг' },
        divisible: true,
      }),
    );
    expect(trimebutine.units).toBeNull();
    expect(trimebutine.refusedRounding?.deviationPercent).toBe(300);
    // A suspension volume that cannot be measured to within the tolerance is refused too.
    const tiny = planIntake(
      input({
        rule: rule({ d0: 3, f0: 1 }),
        product: { ...suspension, strength: '1000 мг/мл' },
      }),
    );
    expect(tiny.units).toBeNull();
  });

  it('ties the counts of the instruction to the strength of its own product (RX3 audit: 200+500 / 400+325 …)', () => {
    // «по 2 таблетки» with no strength in the sentence: valid for the instruction's own strength only.
    const pieces = rule({ u: 7, d0: 2, q0: 2, qu: 0, f0: 2 });
    const own = planIntake(
      input({
        rule: pieces,
        product: { ...tablets500, strength: '400 мг+325 мг' },
        productTied: true,
      }),
    );
    expect(own.units).toMatchObject({ kind: 'piece', count: 2, fromInstruction: true });
    const other = planIntake(
      input({
        rule: pieces,
        product: { ...tablets500, strength: '200 мг+500 мг' },
        productTied: false,
      }),
    );
    expect(other.status).toBe('strength-mismatch');
    expect(other.units).toBeNull();
    expect(other.single).toBeNull();
    // No product chosen: nothing to tie, the instruction's own count is shown as before.
    expect(planIntake(input({ rule: pieces })).units).toMatchObject({ count: 2 });
  });

  it('recomputes a count from milligrams for another strength, and drops it when the rule is in pieces or millilitres', () => {
    // «по 1 таблетке (500 мг)»: the instruction states its strength.
    const withStrength = rule({ d0: 500, q0: 1, qu: 0, pm: 500, f0: 3 });
    const sameProduct = planIntake(
      input({ rule: withStrength, product: tablets500, productTied: true }),
    );
    expect(sameProduct.units).toMatchObject({ count: 1, fromInstruction: true });
    const other = planIntake(
      input({
        rule: withStrength,
        product: { ...tablets500, strength: '250 мг' },
        productTied: false,
      }),
    );
    expect(other.status).toBe('ok');
    expect(other.units).toMatchObject({ count: 2, amount: 500, fromInstruction: false });
    // A volume printed by the instruction («по 5 мл») belongs to its own concentration.
    const millilitres = rule({ u: ML, d0: 5, f0: 2 });
    expect(
      planIntake(input({ rule: millilitres, product: suspension, productTied: false })).status,
    ).toBe('strength-mismatch');
    expect(
      planIntake(input({ rule: millilitres, product: suspension, productTied: true })).status,
    ).toBe('ok');
    // Drops count the same way.
    const drops = rule({ u: 5, d0: 8, f0: 3 });
    expect(planIntake(input({ rule: drops, product: suspension, productTied: false })).status).toBe(
      'strength-mismatch',
    );
  });

  it('refuses to read a combination strength as a mass', () => {
    const plan = planIntake(
      input({
        rule: rule({ d0: 500, f0: 2 }),
        product: { ...tablets500, strength: '500 мг + 125 мг' },
      }),
    );
    expect(plan.units).toBeNull();
    expect(plan.single).toBe(500);
  });

  it('turns a frequency per week into intakes a day', () => {
    const plan = planIntake(input({ rule: rule({ d0: 15, f0: 2, f1: 2, fp: 7 }) }));
    expect(plan.intakes).toBeCloseTo(2 / 7, 5);
    expect(plan.periodDays).toBe(7);
  });

  it('uses body surface area for a dose per square metre', () => {
    const plan = planIntake(
      input({ rule: rule({ d0: 15, pk: 2, f0: 3 }), patient: { weightKg: 25, heightCm: 120 } }),
    );
    expect(plan.single).toBeCloseTo(15 * bodySurfaceArea(120, 25), 2);
    expect(
      planIntake(input({ rule: rule({ d0: 15, pk: 2, f0: 3 }), patient: { weightKg: 25 } })).status,
    ).toBe('needs-bsa');
  });
});

describe('caps of the instruction', () => {
  const caps: DoseRule[] = [
    rule({ k: 1, d1: 4000, bs: 1 }),
    rule({ k: 1, d1: 60, pk: 1, bs: 1, p1: Math.round(12 * YEAR), g: 2 }),
    rule({ k: 1, d1: 1200, bs: 1, c: 1 }),
  ];
  it('flags a daily dose above the cap that fits the patient and ignores condition caps', () => {
    const adult = { ageDays: ADULT_AGE_DAYS + 5 };
    const within = planIntake(input({ rule: rule({ d0: 1000, f0: 3 }), product: tablets500 }));
    const ok = checkCaps(caps, within, adult, null);
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ scope: 'daily', limit: 4000, actual: 3000, exceeded: false });
    const over = planIntake(input({ rule: rule({ d0: 1500, f0: 3 }), product: tablets500 }));
    expect(checkCaps(caps, over, adult, null)[0]).toMatchObject({ actual: 4500, exceeded: true });
  });
  it('compares only the caps the gate trusts and never a range', () => {
    const plan = planIntake(input({ rule: rule({ d0: 1500, f0: 3 }), product: tablets500 }));
    const adult = { ageDays: ADULT_AGE_DAYS + 5 };
    // The gate trusts no cap: nothing is compared (a rejected cap is quoted, not compared).
    expect(checkCaps(caps, plan, adult, null, () => false)).toHaveLength(0);
    expect(checkCaps(caps, plan, adult, null, (_, at) => at === 0)).toHaveLength(1);
    // A cap written as a range («от 50 до 70 мл») keeps both ends and is no single cap.
    const range = rule({ k: 1, u: ML, d0: 50, d1: 70, bs: 0 });
    expect(checkCaps([range], plan, adult, null)).toHaveLength(0);
  });
  it('scales a cap per kilogram by the weight of a child', () => {
    const plan = planIntake(
      input({
        rule: rule({ d0: 300, f0: 3 }),
        patient: { ageDays: Math.round(6 * YEAR), weightKg: 20 },
      }),
    );
    const checks = checkCaps(caps, plan, { ageDays: Math.round(6 * YEAR), weightKg: 20 }, null);
    expect(checks[0]).toMatchObject({ limit: 1200, actual: 900, exceeded: false });
  });
});

describe('quantity and packages', () => {
  it('multiplies the units by the intakes and the days and picks the pack with least surplus', () => {
    const plan = planIntake(input({ rule: rule({ d0: 500, f0: 3 }), product: tablets500 }));
    const quantity = planQuantity(plan, 7, tablets500);
    expect(quantity).toMatchObject({ intakes: 21, totalUnits: 21, unitKind: 'piece' });
    expect(quantity?.best).toEqual({ size: 21, packages: 1, surplus: 0 });
  });
  it('rounds the packages up', () => {
    const plan = planIntake(input({ rule: rule({ d0: 500, f0: 3 }), product: tablets500 }));
    expect(planQuantity(plan, 10, { ...tablets500, packs: [20] })?.best).toEqual({
      size: 20,
      packages: 2,
      surplus: 10,
    });
  });
  it('counts millilitres of a suspension against the bottle volume', () => {
    const plan = planIntake(
      input({
        rule: rule({ d0: 10, d1: 15, pk: 1, f0: 3 }),
        patient: { weightKg: 20 },
        product: suspension,
      }),
    );
    const quantity = planQuantity(plan, 7, suspension);
    expect(quantity).toMatchObject({ totalUnits: 84, unitKind: 'ml' });
    expect(quantity?.best).toEqual({ size: 100, packages: 1, surplus: 16 });
  });
  it('has no packages for a unit the registry counts otherwise', () => {
    const plan = planIntake(input({ rule: rule({ u: ML, d0: 5, f0: 3 }) }));
    expect(planQuantity(plan, 7, null)).toBeNull();
  });
  it('needs the length of the course', () => {
    const plan = planIntake(input({ rule: rule({ d0: 500, f0: 3 }), product: tablets500 }));
    expect(planQuantity(plan, 0, tablets500)).toBeNull();
  });
});
