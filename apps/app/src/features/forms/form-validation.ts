import type { FormField, FormSchema } from '@localmed/contracts';

import {
  type FormValue,
  type FormValues,
  fillableFields,
  isFilled,
} from '@/features/forms/form-values';

const ICD10_SHAPE = /^[A-Z]\d{2}(?:\.\d{1,2})?$/u;

export interface FormValidationOptions {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly today: string;
  /**
   * Looks a code up in the МКБ data when it is installed: `true` known, `false` unknown,
   * `undefined` when there is nothing to check against (the module is not on the device).
   */
  readonly icdKnown?: (code: string) => boolean | undefined;
}

export interface FormValidation {
  /** Message per field id for a value that is present but wrong. */
  readonly invalid: Readonly<Record<string, string>>;
  /** Required fields that are still empty, in schema order. */
  readonly missing: readonly string[];
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** A message when a filled value breaks the schema; `undefined` for an empty or valid value. */
export function fieldError(
  field: FormField,
  value: FormValue | undefined,
  options: FormValidationOptions,
): string | undefined {
  if (!isFilled(value)) return undefined;
  if (field.type === 'date') {
    const text = value as string;
    if (!isCalendarDate(text)) return 'Некорректная дата.';
    if (field.notAfter === 'today' && text > options.today) return 'Дата не может быть в будущем.';
    return undefined;
  }
  if (field.type === 'choice') {
    const known = new Set(field.options?.map((option) => option.value));
    const picked = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
    if (picked.some((item) => !known.has(item))) return 'Значение вне списка порядка заполнения.';
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return `Не более ${field.maxLength} символов.`;
  }
  if (field.type === 'icd10') {
    if (!ICD10_SHAPE.test(text)) return field.patternMessage ?? 'Код МКБ-10 в формате J45.0.';
    if (options.icdKnown?.(text) === false) return 'Такого кода нет в МКБ.';
    return undefined;
  }
  if (field.pattern !== undefined && !new RegExp(field.pattern, 'u').test(text)) {
    return field.patternMessage ?? 'Неверный формат.';
  }
  return undefined;
}

export function validateForm(
  schema: FormSchema,
  values: FormValues,
  options: FormValidationOptions,
): FormValidation {
  const invalid: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of fillableFields(schema)) {
    const value = values[field.id];
    const error = fieldError(field, value, options);
    if (error) invalid[field.id] = error;
    if (field.required && !isFilled(value)) missing.push(field.id);
  }
  return { invalid, missing };
}
