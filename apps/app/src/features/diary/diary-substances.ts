/**
 * Substance use the doctor can ask a patient to mark in the care diary, declared as data (owner
 * 2026-11-03: «отмечать зависимости»). A catalog entry names the diary field its daily amount lives
 * in, the unit with its Russian forms, an icon and the most one day can hold. The use checkpoint
 * (`kind: 'use'`) points at these fields; the doctor's editor, the patient's sheet, the charts and
 * the day texts all read this list, and none of them branches on one substance.
 */
import type { AppGlyphName } from '@/components/AppGlyph';
import type { DiaryField, DiaryValue } from '@/features/diary/diary-model';

/** Checkpoint kind of the patient's «Употребление» row. */
export const USE_CHECKPOINT_KIND = 'use' as const;
/** One section per diary: its checkpoint id never changes, so earlier answers keep resolving. */
export const USE_CHECKPOINT_ID = 'use';
/** Craving 0–10 asked once a day beside the amounts. */
export const USE_CRAVING_FIELD = 'craving';
/** What the patient took without a prescription, in a few words. */
export const USE_WHAT_FIELD = 'u-what';
/** The default time of the row: evening, when the day can be summed up. */
export const USE_DEFAULT_TIME = '21:00';

/** «порция», «порции», «порций». */
export type PluralForms = readonly [one: string, few: string, many: string];

export interface DiarySubstance {
  /** Short key inside the catalog and the doctor's editor. */
  readonly id: string;
  /** Diary field with the daily amount: a `count` field, `[a-z][a-z0-9-]{0,23}`. */
  readonly field: string;
  /** What the patient reads on the row and the doctor on the chart. */
  readonly label: string;
  /** The word in the day texts: «алкоголь 2 порции». */
  readonly short: string;
  /** What is counted, in the three Russian forms. */
  readonly unit: PluralForms;
  /** One fact under the row; absent when the label is enough. */
  readonly hint?: string;
  readonly glyph: AppGlyphName;
  /** The most one day can hold; the stepper and the field stop here. */
  readonly max: number;
  /** The patient may say what exactly it was (a text field `u-what`). */
  readonly asksWhat?: true;
}

const TIMES: PluralForms = ['раз', 'раза', 'раз'];

export const SUBSTANCES: readonly DiarySubstance[] = [
  {
    id: 'alcohol',
    field: 'u-alcohol',
    label: 'Алкоголь',
    short: 'алкоголь',
    unit: ['порция', 'порции', 'порций'],
    hint: 'Порция — около 10 г спирта: 330 мл пива 5 %, 100 мл вина или 30 мл крепкого.',
    glyph: 'wine',
    max: 30,
  },
  {
    id: 'nicotine',
    field: 'u-nicotine',
    label: 'Никотин',
    short: 'никотин',
    unit: ['сигарета', 'сигареты', 'сигарет'],
    glyph: 'cigarette',
    max: 80,
  },
  {
    id: 'cannabis',
    field: 'u-cannabis',
    label: 'Каннабис',
    short: 'каннабис',
    unit: TIMES,
    glyph: 'leaf',
    max: 30,
  },
  {
    id: 'opioids',
    field: 'u-opioids',
    label: 'Опиоиды',
    short: 'опиоиды',
    unit: TIMES,
    glyph: 'flask',
    max: 20,
  },
  {
    id: 'stimulants',
    field: 'u-stimulants',
    label: 'Стимуляторы',
    short: 'стимуляторы',
    unit: TIMES,
    glyph: 'lightning',
    max: 20,
  },
  {
    id: 'sedatives',
    field: 'u-sedatives',
    label: 'Снотворные и успокоительные без назначения',
    short: 'снотворные',
    unit: ['таблетка', 'таблетки', 'таблеток'],
    glyph: 'pill',
    max: 30,
  },
  {
    id: 'other',
    field: 'u-other',
    label: 'Препараты без назначения',
    short: 'препараты',
    unit: TIMES,
    glyph: 'question',
    max: 30,
    asksWhat: true,
  },
];

export function substanceById(id: string): DiarySubstance | undefined {
  return SUBSTANCES.find((substance) => substance.id === id);
}

export function substanceByField(field: string): DiarySubstance | undefined {
  return SUBSTANCES.find((substance) => substance.field === field);
}

/** The Russian form of a counted word after a number. */
export function pluralForm(count: number, forms: PluralForms): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** The amount with its unit in the right form: «2 порции», «5 сигарет». */
export function amountText(substance: DiarySubstance, count: number): string {
  return `${count} ${pluralForm(count, substance.unit)}`;
}

/** The diary field of one substance's daily amount. */
export function substanceField(substance: DiarySubstance): DiaryField {
  return {
    id: substance.field,
    type: 'count',
    label: substance.label,
    unit: substance.unit[2],
    min: 0,
    max: substance.max,
  };
}

/** Craving as the patient rates it: 0 none, 10 the strongest. */
export const CRAVING_FIELD: DiaryField = {
  id: USE_CRAVING_FIELD,
  type: 'number',
  label: 'Тяга',
  unit: 'из 10',
  min: 0,
  max: 10,
  step: 1,
};

export const WHAT_FIELD: DiaryField = {
  id: USE_WHAT_FIELD,
  type: 'text',
  label: 'Что именно',
};

/**
 * The fields and the checkpoint field ids for the substances the doctor chose (catalog order, so a
 * re-issue keeps them stable), with «что именно» when one of them asks for it and the craving
 * score when wanted.
 */
export function substanceFieldSet(
  chosen: readonly string[],
  craving: boolean,
): { readonly fields: readonly DiaryField[]; readonly ids: readonly string[] } {
  const substances = SUBSTANCES.filter((substance) => chosen.includes(substance.id));
  const fields: DiaryField[] = substances.map(substanceField);
  if (substances.some((substance) => substance.asksWhat)) fields.push(WHAT_FIELD);
  if (craving) fields.push(CRAVING_FIELD);
  return { fields, ids: fields.map((field) => field.id) };
}

/** The substances (catalog ids) a use checkpoint asks about, from its field ids. */
export function substancesOf(fieldIds: readonly string[]): readonly string[] {
  return SUBSTANCES.filter((substance) => fieldIds.includes(substance.field)).map(
    (substance) => substance.id,
  );
}

function whatText(values: Readonly<Record<string, DiaryValue>>): string {
  const what = values[USE_WHAT_FIELD];
  if (typeof what !== 'string') return '';
  const line = what.replaceAll('\n', ' ').trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

/**
 * One line for a day's use answers: «не было», «алкоголь 2 порции, никотин 5 сигарет · тяга 6».
 * Empty when the entry holds none of these fields.
 */
export function substanceSummary(values: Readonly<Record<string, DiaryValue>>): string {
  let asked = false;
  const used: string[] = [];
  for (const substance of SUBSTANCES) {
    const amount = values[substance.field];
    if (typeof amount !== 'number') continue;
    asked = true;
    if (amount <= 0) continue;
    const what = substance.asksWhat ? whatText(values) : '';
    used.push(`${substance.short} ${amountText(substance, amount)}${what ? ` (${what})` : ''}`);
  }
  const craving = values[USE_CRAVING_FIELD];
  const parts = [
    asked ? used.join(', ') || 'не было' : '',
    typeof craving === 'number' ? `тяга ${craving}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/**
 * How bad a day of use looks on the same 0–10 scale as wellbeing (low is bad), for the calendar's
 * red tint: any use is a 3, a strong craving counts down from 10. Undefined when the entry holds
 * neither, so a day that was never asked adds nothing.
 */
export function substanceDayScore(
  values: Readonly<Record<string, DiaryValue>>,
): number | undefined {
  const amounts = SUBSTANCES.flatMap((substance) => {
    const amount = values[substance.field];
    return typeof amount === 'number' ? [amount] : [];
  });
  const craving = values[USE_CRAVING_FIELD];
  if (!amounts.length && typeof craving !== 'number') return undefined;
  const scores = [
    ...(amounts.some((amount) => amount > 0) ? [3] : []),
    ...(typeof craving === 'number' ? [10 - craving] : []),
  ];
  return scores.length ? Math.min(...scores) : 10;
}
