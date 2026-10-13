/**
 * What a prescription turns into (RX1): the text of the «Рецепт» modal, and the values of the
 * official blanks 107-1/у and 148-1/у-88 (the forms engine prints them). Pure.
 *
 * The blank rules come from the form schema itself: paragraph 15 of appendix 3 of order 1094н
 * allows one name on a 107-1/у for the antipsychotics, anxiolytics, hypnotics and antidepressants
 * (ATC N05A, N05B, N05C, N06A) that are not under quantitative accounting, and up to three names
 * otherwise; a 148-1/у-88 holds one name. The registry does not say which drugs are under
 * quantitative accounting, so the blank is the doctor's choice and this module only enforces the
 * count.
 */
import type { FormSchema } from '@localmed/contracts';

import type { FormValues } from '@/features/forms/form-values';
import { ADULT_AGE_DAYS } from './dose-population';

/** ATC groups of paragraph 15: one name per 107-1/у. */
export const SINGLE_NAME_ATC_PREFIXES: readonly string[] = ['N05A', 'N05B', 'N05C', 'N06A'];

export const FORM_107_ID = 'ru.minzdrav.1094n.107-1u';
export const FORM_148_ID = 'ru.minzdrav.1094n.148-1u-88';
export const NAMES_PER_107 = 3;

export interface PrescribedLine {
  readonly id: string;
  /** «Tab. Amoxicillini 0,5 N 21». */
  readonly rp: string;
  /** «Внутрь по 1 таблетке 3 раза в день в течение 7 дней.» */
  readonly signa: string;
  /** ATC codes of the substance. */
  readonly atcCodes: readonly string[];
}

export function isSingleNameAtc(codes: readonly string[]): boolean {
  return codes.some((code) => SINGLE_NAME_ATC_PREFIXES.some((prefix) => code.startsWith(prefix)));
}

/** The lines of the prescription cut into blanks: a blank holds up to three names, one for N05A… */
export function splitIntoBlanks(
  lines: readonly PrescribedLine[],
  formId: string,
): readonly (readonly PrescribedLine[])[] {
  if (formId === FORM_148_ID) return lines.map((line) => [line]);
  const blanks: PrescribedLine[][] = [];
  let current: PrescribedLine[] = [];
  const flush = (): void => {
    if (current.length > 0) blanks.push(current);
    current = [];
  };
  for (const line of lines) {
    if (isSingleNameAtc(line.atcCodes)) {
      flush();
      blanks.push([line]);
      continue;
    }
    if (current.length >= NAMES_PER_107) flush();
    current.push(line);
  }
  flush();
  return blanks;
}

/** The text of one Rp block of the blank: the Latin line and the sign. */
export function prescriptionBlock(line: Pick<PrescribedLine, 'rp' | 'signa'>): string {
  const sign = line.signa.trim();
  return sign === '' ? line.rp : `${line.rp}\nD.S. ${sign}`;
}

export interface BlankPatient {
  readonly ageDays: number | null;
}

/** Values of one blank, on top of what the forms engine prefilled from the patient and the doctor. */
export function blankValues(
  schema: FormSchema,
  prefilled: FormValues,
  lines: readonly PrescribedLine[],
  patient: BlankPatient,
): FormValues {
  const values: Record<string, FormValues[string]> = { ...prefilled };
  if (patient.ageDays !== null && schema.fields.some((field) => field.id === 'recipeKind')) {
    values['recipeKind'] = patient.ageDays < ADULT_AGE_DAYS ? 'child' : 'adult';
  }
  if (schema.id === FORM_148_ID) {
    const [line] = lines;
    if (line) values['prescription'] = prescriptionBlock(line);
    return values;
  }
  lines.slice(0, NAMES_PER_107).forEach((line, index) => {
    values[`prescription${index + 1}`] = prescriptionBlock(line);
  });
  return values;
}

export interface RecipeHeader {
  readonly date: string;
  /** «Иванов И.И., 6 лет, 20 кг»; null when nothing is known. */
  readonly patient: string | null;
}

/** The text of the «Рецепт» modal: ready to copy, share or print. */
export function recipeText(header: RecipeHeader, lines: readonly PrescribedLine[]): string {
  const rows: string[] = [`Рецепт · ${header.date}`];
  if (header.patient) rows.push(`Пациент: ${header.patient}`);
  lines.forEach((line, index) => {
    rows.push('');
    rows.push(`${index + 1}. Rp.: ${line.rp}`);
    if (line.signa.trim() !== '') rows.push(`   D.S. ${line.signa.trim()}`);
  });
  return rows.join('\n');
}

/** «13.10.2026»: the date on the recipe, in the doctor's local time. */
export function recipeDate(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()}`;
}
