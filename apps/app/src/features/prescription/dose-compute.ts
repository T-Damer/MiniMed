/**
 * Arithmetic of a prescription (RX1): from one dose rule, the patient's weight and the chosen
 * product to a single dose, the number of intakes, the units per intake, the total quantity and the
 * packages. Pure and deterministic. It never invents a number: a missing weight, a missing frequency
 * or a strength it cannot read is reported as `status`, and every figure comes from the rule's own
 * numbers, the patient's data or the registry row.
 */
import {
  DOSE_UNITS,
  type DoseRule,
  type DoseUnit,
  type PackUnit,
  PIECE_KINDS,
  type PieceKind,
} from '@localmed/contracts';

import { matchPopulation, type PatientFacts } from './dose-population';
import { formKind, isTablet, parseStrength } from './product-strength';

export interface ProductChoice {
  /** Dosage form as the registry writes it. */
  readonly form: string;
  /** Strength as the registry writes it. */
  readonly strength: string;
  readonly packs: readonly number[];
  readonly packUnit: PackUnit;
}

export type PlanStatus =
  | 'ok'
  | 'needs-weight'
  | 'needs-bsa'
  | 'needs-intakes'
  | 'unsupported'
  /** The instruction counts pieces or millilitres of its own product; the chosen strength is another. */
  | 'strength-mismatch';

/**
 * Rounding a dose to what the product offers (whole or half tablets, steps of a millilitre) may move
 * it by this many percent at most. Beyond it no count of pieces or millilitres is shown: the dose
 * stays a mass and the instruction's sentence stays next to it.
 */
export const ROUNDING_TOLERANCE_PERCENT = 10;

export interface UnitsPlan {
  /** Pieces, millilitres, drops or doses per intake after rounding to what the product allows. */
  readonly count: number;
  readonly kind: 'piece' | 'ml' | 'drop' | 'dose';
  /** What a counted piece is when the instruction names it (a spoon, an ampoule); the dosage form's own piece otherwise. */
  readonly piece: PieceKind | null;
  readonly step: number;
  /** Amount of the substance in that many units, when the strength is known. */
  readonly amount: number | null;
  /** The rounded amount against the wanted single dose, in percent; null when not comparable. */
  readonly deviationPercent: number | null;
  /** The count is the instruction's own («по 1 таблетке»), not a rounding of a mass. */
  readonly fromInstruction: boolean;
}

export interface IntakePlan {
  readonly status: PlanStatus;
  readonly unit: DoseUnit;
  /** The single dose the rule allows, in `unit`, from the lower to the upper end. */
  readonly singleMin: number | null;
  readonly singleMax: number | null;
  /** The single dose chosen (before rounding to the product). */
  readonly single: number | null;
  /** Intakes a day: the allowed range and the chosen number. */
  readonly intakesMin: number | null;
  readonly intakesMax: number | null;
  readonly intakes: number | null;
  /** Days between intakes when the rule counts intakes per longer period. */
  readonly periodDays: number;
  readonly units: UnitsPlan | null;
  /** Single dose actually taken after rounding (`units.amount`) or the chosen dose. */
  readonly actualSingle: number | null;
  readonly actualDaily: number | null;
  /** The nearest amount the product offers when it was too far from the dose to be used (see `ROUNDING_TOLERANCE_PERCENT`). */
  readonly refusedRounding: { readonly amount: number; readonly deviationPercent: number } | null;
  readonly notes: readonly string[];
}

export interface IntakeInput {
  readonly rule: DoseRule;
  readonly patient: PatientFacts;
  readonly product: ProductChoice | null;
  /** The instruction says a tablet may be divided. */
  readonly divisible: boolean;
  /** Which end of the rule's range to start from; the lower end unless the rule says «до X». */
  readonly position?: 'min' | 'max';
  /** Intakes a day chosen by the doctor, when the rule gives none or gives a range. */
  readonly intakesPerDay?: number;
  /** Single dose chosen by the doctor, in the rule's unit. */
  readonly singleOverride?: number;
  /**
   * The chosen product is one of the instruction's own (its registrations carry this form and
   * strength): the counts the instruction prints are valid for it. `false`: another strength, the
   * counts are not; `null`/absent: no product chosen or not known.
   */
  readonly productTied?: boolean | null;
}

export function unitOfRule(rule: DoseRule): DoseUnit {
  return DOSE_UNITS[rule.u ?? 0] ?? 'mg';
}

/** Body surface area, Mosteller. */
export function bodySurfaceArea(heightCm: number, weightKg: number): number {
  return Math.sqrt((heightCm * weightKg) / 3600);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clean(value: number): number {
  return Math.round(value * 1000) / 1000;
}

const SAME_STRENGTH_TOLERANCE = 0.01;

type Rounded =
  | { readonly kind: 'units'; readonly units: UnitsPlan }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly amount: number; readonly deviationPercent: number }
  | { readonly kind: 'mismatch' };

function pieceKindOf(rule: DoseRule): PieceKind | null {
  return rule.qu === undefined ? null : (PIECE_KINDS[rule.qu] ?? null);
}

function roundToProduct(
  single: number,
  unit: DoseUnit,
  rule: DoseRule,
  product: ProductChoice | null,
  divisible: boolean,
  position: 'min' | 'max',
  tied: boolean | null,
): Rounded {
  const strength = product ? parseStrength(product.strength) : null;
  const kind = product ? formKind(product.form) : 'other';
  const piece = pieceKindOf(rule);
  // A count the instruction prints («по 2 таблетки», «5 мл», «20 капель») is a count of the product the
  // instruction is written for. On another strength only a dose in mass survives (recomputed below).
  const otherStrength = product !== null && tied === false;
  const own = (units: UnitsPlan): Rounded => ({ kind: 'units', units });
  // The instruction counts pieces («по 1–2 таблетки») and its piece is the product's piece.
  if (rule.q0 !== undefined) {
    const wanted = position === 'max' && rule.q1 !== undefined ? rule.q1 : rule.q0;
    const sameStrength =
      strength?.kind === 'solid' && rule.pm !== undefined
        ? Math.abs(strength.amount - rule.pm) <= SAME_STRENGTH_TOLERANCE * rule.pm
        : false;
    const recompute = rule.pm !== undefined && strength !== null && !sameStrength;
    if (!recompute) {
      if (!sameStrength && otherStrength) return { kind: 'mismatch' };
      const amount = strength?.kind === 'solid' ? wanted * strength.amount : null;
      return own({
        count: clean(wanted),
        kind: unit === 'drop' ? 'drop' : 'piece',
        piece,
        step: 1,
        amount: amount === null ? null : clean(amount),
        deviationPercent:
          amount === null || single <= 0 ? null : clean(((amount - single) / single) * 100),
        fromInstruction: true,
      });
    }
  }
  if (unit === 'piece') {
    if (otherStrength) return { kind: 'mismatch' };
    const wanted = single;
    const amount = strength?.kind === 'solid' ? wanted * strength.amount : null;
    return own({
      count: clean(wanted),
      kind: 'piece',
      piece,
      step: 1,
      amount: amount === null ? null : clean(amount),
      deviationPercent: null,
      fromInstruction: true,
    });
  }
  if (unit === 'drop' || unit === 'dose') {
    if (otherStrength) return { kind: 'mismatch' };
    return own({
      count: clean(single),
      kind: unit,
      piece: null,
      step: 1,
      amount: null,
      deviationPercent: null,
      fromInstruction: true,
    });
  }
  if (!strength || strength.unit !== unit) {
    // A volume the instruction prints («по 5 мл») is a volume of its own product's concentration.
    if (unit === 'ml' && otherStrength) return { kind: 'mismatch' };
    return { kind: 'none' };
  }
  const refuse = (amount: number): Rounded | null => {
    const deviation = single > 0 ? ((amount - single) / single) * 100 : 0;
    return Math.abs(deviation) > ROUNDING_TOLERANCE_PERCENT
      ? { kind: 'refused', amount: clean(amount), deviationPercent: clean(deviation) }
      : null;
  };
  if (strength.kind === 'liquid') {
    const ml = single / strength.perMl;
    const step = ml >= 2 ? 0.5 : 0.1;
    const count = Math.max(step, roundTo(ml, step));
    const amount = count * strength.perMl;
    const refused = refuse(amount);
    if (refused) return refused;
    return own({
      count: clean(count),
      kind: 'ml',
      piece: null,
      step,
      amount: clean(amount),
      deviationPercent: single > 0 ? clean(((amount - single) / single) * 100) : null,
      fromInstruction: false,
    });
  }
  const halves = divisible && isTablet(product?.form ?? '') && kind === 'solid';
  const step = halves ? 0.5 : 1;
  const count = Math.max(step, roundTo(single / strength.amount, step));
  const amount = count * strength.amount;
  const refused = refuse(amount);
  if (refused) return refused;
  return own({
    count: clean(count),
    kind: 'piece',
    piece: null,
    step,
    amount: clean(amount),
    deviationPercent: single > 0 ? clean(((amount - single) / single) * 100) : null,
    fromInstruction: false,
  });
}

const EMPTY_PLAN: Omit<IntakePlan, 'status' | 'unit'> = {
  singleMin: null,
  singleMax: null,
  single: null,
  intakesMin: null,
  intakesMax: null,
  intakes: null,
  periodDays: 1,
  units: null,
  actualSingle: null,
  actualDaily: null,
  refusedRounding: null,
  notes: [],
};

/** The computation for one rule, patient and product. */
export function planIntake(input: IntakeInput): IntakePlan {
  const { rule, patient, product } = input;
  const unit = unitOfRule(rule);
  const fail = (status: PlanStatus, notes: readonly string[] = []): IntakePlan => ({
    ...EMPTY_PLAN,
    status,
    unit,
    notes,
  });
  if (rule.k !== 0 || (rule.d0 === undefined && rule.d1 === undefined)) {
    return fail('unsupported');
  }
  let factor = 1;
  if (rule.pk === 1) {
    if (patient.weightKg === undefined) return fail('needs-weight');
    factor = patient.weightKg;
  } else if (rule.pk === 2) {
    if (patient.weightKg === undefined || patient.heightCm === undefined) return fail('needs-bsa');
    factor = bodySurfaceArea(patient.heightCm, patient.weightKg);
  }
  const low = (rule.d0 ?? rule.d1 ?? 0) * factor;
  const high = (rule.d1 ?? rule.d0 ?? 0) * factor;
  const daily = rule.bs === 1;

  // Intakes a day.
  const period = rule.fp ?? 1;
  const intakesMin = rule.f0 === undefined ? null : rule.f0 / period;
  const intakesMax = rule.f1 === undefined ? intakesMin : (rule.f1 ?? rule.f0 ?? 0) / period;
  let intakes: number | null = input.intakesPerDay ?? intakesMin;
  if (period > 1 && input.intakesPerDay === undefined) intakes = intakesMin;
  if (daily && intakes === null) {
    // A daily dose without a stated number of intakes: the doctor chooses.
    return {
      ...EMPTY_PLAN,
      status: 'needs-intakes',
      unit,
      singleMin: null,
      singleMax: null,
      single: null,
      actualDaily: clean(rule.up ? high : low),
      notes: [],
    };
  }

  const position = input.position ?? (rule.up ? 'max' : 'min');
  const chosenTotal = input.singleOverride ?? (position === 'max' ? high : low);
  const perIntakeMin = daily && intakes ? low / (intakesMax ?? intakes) : low;
  const perIntakeMax = daily && intakes ? high / (intakesMin ?? intakes) : high;
  const single = daily && intakes ? chosenTotal / intakes : chosenTotal;
  const rounded = roundToProduct(
    single,
    unit,
    rule,
    product,
    input.divisible,
    position,
    input.productTied ?? null,
  );
  if (rounded.kind === 'mismatch') return fail('strength-mismatch');
  const units = rounded.kind === 'units' ? rounded.units : null;
  const actualSingle = units?.amount ?? single;
  const perDay = intakes === null ? null : intakes;
  const notes: string[] = [];
  if (rule.q0 !== undefined && rule.pm === undefined) notes.push('pieces-without-strength');
  if (rounded.kind === 'refused') notes.push('rounding-refused');
  return {
    status: 'ok',
    unit,
    singleMin: clean(perIntakeMin),
    singleMax: clean(perIntakeMax),
    single: clean(single),
    intakesMin,
    intakesMax,
    intakes: perDay,
    periodDays: period,
    units,
    actualSingle: clean(actualSingle),
    actualDaily: perDay === null ? null : clean(actualSingle * perDay),
    refusedRounding:
      rounded.kind === 'refused'
        ? { amount: rounded.amount, deviationPercent: rounded.deviationPercent }
        : null,
    notes,
  };
}

export interface CapCheck {
  readonly ruleIndex: number;
  readonly scope: 'single' | 'daily' | 'course';
  /** The limit in the rule's unit after per-kilogram scaling. */
  readonly limit: number;
  readonly unit: DoseUnit;
  readonly actual: number;
  readonly exceeded: boolean;
}

/**
 * Compares the plan with the caps of the instruction that fit the patient. A cap in another unit
 * than the plan's is not compared (it stays a quoted sentence).
 */
export function checkCaps(
  rules: readonly DoseRule[],
  plan: IntakePlan,
  patient: PatientFacts,
  days: number | null,
  /** Only a cap the confidence gate lets compute may be compared; a rejected cap is quoted, not compared. */
  trusted: (rule: DoseRule, ruleIndex: number) => boolean = () => true,
): readonly CapCheck[] {
  const checks: CapCheck[] = [];
  rules.forEach((rule, ruleIndex) => {
    if (rule.k !== 1 || rule.d1 === undefined || rule.d0 !== undefined) return;
    if (!trusted(rule, ruleIndex)) return;
    if (matchPopulation(rule, patient).fit !== 'yes') return;
    if (matchPopulation(rule, patient).conditional) return;
    const unit = unitOfRule(rule);
    let limit = rule.d1;
    if (rule.pk === 1) {
      if (patient.weightKg === undefined) return;
      limit *= patient.weightKg;
    } else if (rule.pk === 2) return;
    const scope = rule.bs === 0 ? 'single' : rule.bs === 2 ? 'course' : 'daily';
    // Pieces are compared with pieces, masses with masses.
    let single: number | null = null;
    if (unit === 'piece') single = plan.units?.kind === 'piece' ? plan.units.count : null;
    else if (unit === plan.unit) single = plan.actualSingle;
    if (single === null || plan.intakes === null) {
      if (scope !== 'single' || single === null) return;
    }
    const perDay = plan.intakes === null ? null : single * plan.intakes;
    const actual =
      scope === 'single'
        ? single
        : scope === 'daily'
          ? perDay
          : perDay === null || days === null
            ? null
            : perDay * days;
    if (actual === null) return;
    checks.push({
      ruleIndex,
      scope,
      limit: clean(limit),
      unit,
      actual: clean(actual),
      exceeded: actual > limit * (1 + 1e-9),
    });
  });
  return checks;
}

export interface PackOption {
  readonly size: number;
  readonly packages: number;
  /** Units supplied beyond what the course needs. */
  readonly surplus: number;
}

export interface QuantityPlan {
  /** Intakes over the whole course. */
  readonly intakes: number;
  /** Units (pieces, millilitres, drops) over the whole course. */
  readonly totalUnits: number;
  readonly unitKind: UnitsPlan['kind'];
  readonly options: readonly PackOption[];
  /** The option the screen starts from: the least surplus, then the fewest packages. */
  readonly best: PackOption | null;
}

export function planQuantity(
  plan: IntakePlan,
  days: number,
  product: ProductChoice | null,
): QuantityPlan | null {
  if (plan.units === null || plan.intakes === null || !(days > 0)) return null;
  const perDay = plan.intakes;
  const intakes =
    plan.periodDays > 1
      ? Math.ceil((perDay * plan.periodDays * days) / plan.periodDays)
      : Math.ceil(perDay * days - 1e-9);
  const totalUnits = clean(intakes * plan.units.count);
  let sizes: readonly number[] = [];
  if (product) {
    const unitMatches =
      (product.packUnit === 'piece' && plan.units.kind === 'piece') ||
      (product.packUnit === 'ml' && plan.units.kind === 'ml');
    if (unitMatches) sizes = product.packs;
  }
  const options = sizes
    .filter((size) => size > 0)
    .map((size): PackOption => {
      const packages = Math.max(1, Math.ceil(totalUnits / size - 1e-9));
      return { size, packages, surplus: clean(packages * size - totalUnits) };
    })
    .toSorted((a, b) => a.surplus - b.surplus || a.packages - b.packages || a.size - b.size);
  return {
    intakes,
    totalUnits,
    unitKind: plan.units.kind,
    options,
    best: options[0] ?? null,
  };
}
