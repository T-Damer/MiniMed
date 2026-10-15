import { unitForQuantity } from '@/features/calculators/countable-unit';
import { pluralRu } from '@/i18n/labels';

/**
 * How a result value reads on screen, in print and in a shared text. The value and its unit come
 * from the tool schema; this only chooses the way a doctor says them. It never looks at a tool id.
 */

const NUMBER_FORMAT_CACHE = new Map<number, Intl.NumberFormat>();

function numberFormat(precision: number): Intl.NumberFormat {
  const cached = NUMBER_FORMAT_CACHE.get(precision);
  if (cached) return cached;
  const format = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  });
  NUMBER_FORMAT_CACHE.set(precision, format);
  return format;
}

export function formatCalculatorNumber(value: number, precision: number): string {
  return numberFormat(precision).format(value);
}

/** Below this many months an age stays in months, as paediatricians write it. */
const MONTHS_ONLY_BELOW = 24;

/** 40 months → «3 года 4 мес»; undefined when the number should stay as it is. */
function monthsAsAge(months: number): string | undefined {
  if (!Number.isFinite(months) || months < MONTHS_ONLY_BELOW) return undefined;
  const whole = Math.round(months);
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  const yearsText = `${years} ${pluralRu(years, 'год', 'года', 'лет')}`;
  return rest === 0 ? yearsText : `${yearsText} ${rest} мес`;
}

/** A z-score has no unit of its own: the label already says «z-score». */
function isZScoreLabel(label: string | undefined): boolean {
  return label !== undefined && /z-?score|z-?балл/iu.test(label);
}

/** The unit as written to the reader; an empty string when the value stands alone. */
export function displayCalculatorUnit(unit: string, label?: string): string {
  const trimmed = unit.trim();
  if (trimmed === 'SD') return isZScoreLabel(label) ? '' : 'ст. откл.';
  return trimmed;
}

/** «Возраст · 40 мес» reads «3 года 4 мес»; «BMI» reads «ИМТ». */
export function displayCalculatorLabel(label: string): string {
  return label.replace(/\bBMI\b/gu, 'ИМТ');
}

/** The value with its unit: «0,61 м²», «3 года 4 мес», «−1,2» (a z-score). */
export function formatCalculatorQuantity(
  value: number,
  precision: number,
  unit: string,
  label?: string,
): string {
  if (unit.trim() === 'мес') {
    const age = monthsAsAge(value);
    if (age) return age;
  }
  const shown = unitForQuantity(value, precision, displayCalculatorUnit(unit, label));
  const number = formatCalculatorNumber(value, precision);
  return shown ? `${number} ${shown}` : number;
}

/** A share of 0–100 as the app writes every percentage: «83,3 %» (decimal comma, a space before the sign). */
export function formatPercent(percent: number): string {
  return formatCalculatorQuantity(percent, 1, '%');
}
