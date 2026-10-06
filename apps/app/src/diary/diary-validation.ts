/**
 * Checks of what the patient typed, worded for someone who does not know what «вне диапазона»
 * means. `parseDiaryEntry` stays the authority on what may be stored; these checks run first so
 * the message sits next to the field that needs fixing.
 */
import type { DiaryField, DiaryInvitation } from '@/features/diary/diary-model';

/** Integer units where a decimal separator would only invite mistakes. */
const WHOLE_NUMBER_UNITS = new Set(['мм рт. ст.', 'уд/мин', '/мин', 'г', 'мл', 'мл или г', '%']);

/** The on-screen keyboard for a number field: digits only where decimals make no sense. */
export function inputModeFor(field: DiaryField): 'numeric' | 'decimal' {
  if (field.type === 'count') return 'numeric';
  if (field.step !== undefined) return Number.isInteger(field.step) ? 'numeric' : 'decimal';
  const wholeBounds =
    (field.min === undefined || Number.isInteger(field.min)) &&
    (field.max === undefined || Number.isInteger(field.max));
  return wholeBounds && field.unit !== undefined && WHOLE_NUMBER_UNITS.has(field.unit)
    ? 'numeric'
    : 'decimal';
}

function formatBound(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** «от 50 до 300», shown under the field; undefined when the doctor set no limits. */
export function rangeHint(field: DiaryField): string | undefined {
  if (field.type !== 'number' && field.type !== 'count') return undefined;
  if (field.min !== undefined && field.max !== undefined) {
    return `от ${formatBound(field.min)} до ${formatBound(field.max)}`;
  }
  if (field.min !== undefined) return `не меньше ${formatBound(field.min)}`;
  if (field.max !== undefined) return `не больше ${formatBound(field.max)}`;
  return undefined;
}

const NUMBER_PATTERN = /^-?\d+([.,]\d+)?$/u;

/** What a typed number means: spaces are ignored, the comma is a decimal point. */
export function parseTypedNumber(text: string): number | undefined {
  const compact = text.replaceAll(/\s+/gu, '');
  if (!NUMBER_PATTERN.test(compact)) return undefined;
  return Number(compact.replace(',', '.'));
}

/** The message for one number field, or undefined when the text is acceptable. */
export function numberProblem(field: DiaryField, text: string): string | undefined {
  const typed = text.trim();
  if (!typed) return field.required ? 'Заполните это поле.' : undefined;
  const value = parseTypedNumber(typed);
  if (value === undefined) return 'Введите число цифрами, например 120.';
  const unit = field.unit && field.type === 'number' ? ` ${field.unit}` : '';
  if (field.type === 'count' && !Number.isInteger(value)) return 'Нужно целое число.';
  const sentence = (text: string): string => (text.endsWith('.') ? text : `${text}.`);
  if (field.min !== undefined && value < field.min) {
    return field.max === undefined
      ? sentence(`Число не меньше ${formatBound(field.min)}${unit}`)
      : `${sentence(`Допустимо от ${formatBound(field.min)} до ${formatBound(field.max)}${unit}`)} Проверьте цифры.`;
  }
  if (field.max !== undefined && value > field.max) {
    return field.min === undefined
      ? sentence(`Число не больше ${formatBound(field.max)}${unit}`)
      : `${sentence(`Допустимо от ${formatBound(field.min)} до ${formatBound(field.max)}${unit}`)} Проверьте, нет ли лишней цифры.`;
  }
  return undefined;
}

/**
 * Problems of every number field, keyed by field id. `texts` holds the raw text of each number
 * field. A field that must stay below another one (lower pressure below upper) is checked only
 * when both are valid.
 */
export function numberProblems(
  invitation: DiaryInvitation,
  texts: Readonly<Record<string, string>>,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const field of invitation.fields) {
    if (field.type !== 'number' && field.type !== 'count') continue;
    const problem = numberProblem(field, texts[field.id] ?? '');
    if (problem) problems[field.id] = problem;
  }
  for (const field of invitation.fields) {
    if (!field.lessThan || problems[field.id] || problems[field.lessThan]) continue;
    const own = parseTypedNumber(texts[field.id] ?? '');
    const other = parseTypedNumber(texts[field.lessThan] ?? '');
    if (own === undefined || other === undefined || own < other) continue;
    const target = invitation.fields.find((candidate) => candidate.id === field.lessThan);
    problems[field.id] =
      `«${field.label}» должно быть меньше, чем «${target?.label ?? ''}». Проверьте, не перепутаны ли числа.`;
  }
  return problems;
}
