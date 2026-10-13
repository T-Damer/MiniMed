/**
 * Which dose rules a patient stands under (RX1). Pure: the rule holds the population words and the
 * age / weight bounds as the instruction printed them; the patient holds what the doctor knows. A
 * rule is offered for computing only when the patient surely fits it; one that might fit once an age
 * or a weight is entered is listed with what is missing; a rule whose sentence names no population is
 * computed for adults only. Nothing here decides which dose is right.
 */
import {
  COND_DIALYSIS,
  COND_HEPATIC,
  COND_RENAL,
  type DoseRule,
  GROUP_ADULT,
} from '@localmed/contracts';

export const DAYS_PER_YEAR = 365.25;
export const ADULT_AGE_DAYS = Math.round(18 * DAYS_PER_YEAR);
const MAX_AGE_DAYS = Math.round(120 * DAYS_PER_YEAR);
const MIN_WEIGHT_TENTHS = 5;
const MAX_WEIGHT_TENTHS = 3000;

/** What the doctor knows about the patient. */
export interface PatientFacts {
  /** Age in days when known. */
  readonly ageDays?: number;
  /** Age group when the age itself is not known («ребёнок 20 кг»). */
  readonly group?: 'adult' | 'child';
  readonly weightKg?: number;
  readonly heightCm?: number;
  readonly pregnant?: boolean;
  readonly lactating?: boolean;
}

export type Fit = 'yes' | 'no' | 'maybe';

export interface PopulationMatch {
  /** `yes`: computable for this patient; `maybe`: depends on a missing age or weight; `no`. */
  readonly fit: Fit;
  /** The rule names no population at all, and the patient is an adult. */
  readonly unstated: boolean;
  /** The rule is restricted to a condition (renal, hepatic, dialysis): quoted, never computed. */
  readonly conditional: boolean;
  /** What to enter to settle a `maybe`. */
  readonly missing: readonly ('age' | 'weight')[];
  /** The patient's age is within the year of an age bound of the rule. */
  readonly boundary: boolean;
}

interface Range {
  readonly lo: number;
  readonly hi: number;
}

/** Up to this body mass a patient with no age is taken for a child, from this one for an adult. */
export const ASSUMED_CHILD_MAX_KG = 30;
export const ASSUMED_ADULT_MIN_KG = 50;

/**
 * The group a patient is matched as when the age is not known: the one the doctor named, else, from
 * the body mass alone, a child up to 30 kg and an adult from 50 kg. A mass in between settles
 * nothing. The screen says when the group was assumed.
 */
export function assumedGroup(patient: PatientFacts): 'adult' | 'child' | null {
  if (patient.ageDays !== undefined) return null;
  if (patient.group !== undefined) return patient.group;
  if (patient.weightKg === undefined) return null;
  if (patient.weightKg <= ASSUMED_CHILD_MAX_KG) return 'child';
  if (patient.weightKg >= ASSUMED_ADULT_MIN_KG) return 'adult';
  return null;
}

function patientAgeRange(patient: PatientFacts): Range {
  if (patient.ageDays !== undefined) return { lo: patient.ageDays, hi: patient.ageDays };
  const group = assumedGroup(patient);
  // Two days short of 18 years: the parser ends a «дети» rule one day before them (exclusive bound).
  if (group === 'child') return { lo: 0, hi: ADULT_AGE_DAYS - 2 };
  if (group === 'adult') return { lo: ADULT_AGE_DAYS, hi: MAX_AGE_DAYS };
  return { lo: 0, hi: MAX_AGE_DAYS };
}

function patientWeightRange(patient: PatientFacts): Range {
  if (patient.weightKg !== undefined) {
    const tenths = Math.round(patient.weightKg * 10);
    return { lo: tenths, hi: tenths };
  }
  return { lo: MIN_WEIGHT_TENTHS, hi: MAX_WEIGHT_TENTHS };
}

function fitRange(
  patient: Range,
  lower: number | undefined,
  upper: number | undefined,
  upperExclusive = false,
): Fit {
  const lo = lower ?? Number.NEGATIVE_INFINITY;
  const hi = upper ?? Number.POSITIVE_INFINITY;
  if (patient.hi < lo || (upperExclusive ? patient.lo >= hi : patient.lo > hi)) return 'no';
  if (patient.lo >= lo && (upperExclusive ? patient.hi < hi : patient.hi <= hi)) return 'yes';
  return 'maybe';
}

function inSameYear(ageDays: number, bound: number | undefined): boolean {
  if (bound === undefined || bound < DAYS_PER_YEAR) return false;
  return Math.floor(ageDays / DAYS_PER_YEAR) === Math.round(bound / DAYS_PER_YEAR);
}

export function matchPopulation(rule: DoseRule, patient: PatientFacts): PopulationMatch {
  const conditional = ((rule.c ?? 0) & (COND_RENAL | COND_HEPATIC | COND_DIALYSIS)) !== 0;
  const hasAge = rule.p0 !== undefined || rule.p1 !== undefined;
  const hasWeight = rule.w0 !== undefined || rule.w1 !== undefined;
  const states = hasAge || hasWeight || (rule.g ?? 0) !== 0;
  const age = patientAgeRange(patient);
  if (!states) {
    // A dose per kilogram that names no population is most often a child's: never computed for an adult.
    if (rule.pk !== undefined) {
      return { fit: 'no', unstated: true, conditional, missing: [], boundary: false };
    }
    const adult = age.lo >= ADULT_AGE_DAYS;
    const mightBeAdult = age.hi >= ADULT_AGE_DAYS;
    return {
      fit: adult ? 'yes' : mightBeAdult ? 'maybe' : 'no',
      unstated: true,
      conditional,
      missing: adult || !mightBeAdult ? [] : ['age'],
      boundary: false,
    };
  }
  // «от 6 до 12 лет» ends at the twelfth birthday: a child of 12 belongs to «старше 12 лет», not to both.
  const ageFit = hasAge ? fitRange(age, rule.p0, rule.p1, true) : null;
  const weightFit = hasWeight ? fitRange(patientWeightRange(patient), rule.w0, rule.w1) : null;
  // A group word without any number («Взрослые», «Дети») still restricts the age.
  const groupFit =
    !hasAge && !hasWeight && (rule.g ?? 0) !== 0
      ? fitRange(age, (rule.g ?? 0) & GROUP_ADULT ? ADULT_AGE_DAYS : undefined, undefined)
      : null;
  const fits = [ageFit, weightFit, groupFit].filter((item): item is Fit => item !== null);
  let fit: Fit;
  if (rule.or && ageFit !== null && weightFit !== null) {
    fit = fits.includes('yes') ? 'yes' : fits.includes('maybe') ? 'maybe' : 'no';
  } else if (fits.includes('no')) fit = 'no';
  else if (fits.includes('maybe')) fit = 'maybe';
  else fit = 'yes';
  const missing: ('age' | 'weight')[] = [];
  if (fit === 'maybe') {
    if (ageFit === 'maybe') missing.push('age');
    if (weightFit === 'maybe') missing.push('weight');
  }
  const boundary =
    patient.ageDays !== undefined &&
    (inSameYear(patient.ageDays, rule.p0) || inSameYear(patient.ageDays, rule.p1));
  return { fit, unstated: false, conditional, missing, boundary };
}

/** Whether a rule that names its population describes a child (or only children). */
export function isPediatricRule(rule: DoseRule): boolean {
  return rule.p1 !== undefined && rule.p1 < ADULT_AGE_DAYS + 1;
}
