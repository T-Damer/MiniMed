/**
 * The one Russian number formatter for sizes and measurements: a decimal comma, never a point
 * («1,4 МБ», not «1.4 МБ»), and a real minus sign for negative values («−0,7»).
 */
const MINUS = '−';
const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** «8,5», «0,7», «−0,7»; a value that rounds to zero loses its sign. */
export function formatDecimal(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '';
  const text = Math.abs(value).toFixed(digits).replace('.', ',');
  const rounded = Number(text.replace(',', '.'));
  return value < 0 && rounded !== 0 ? `${MINUS}${text}` : text;
}

/** «−0,7 %», «12,5 %»: a percentage with a decimal comma and a space before the sign. */
export function formatPercentValue(value: number, digits = 1): string {
  return `${formatDecimal(value, digits)} %`;
}

/**
 * «512 КБ», «8,5 МБ», «286 МБ», «1,4 ГБ»: a size for any label. Binary units like the rest of the
 * app's sizes; megabytes keep a decimal below 10, gigabytes always one.
 */
export function formatByteSize(bytes: number): string {
  if (bytes >= GIB) return `${formatDecimal(bytes / GIB, 1)} ГБ`;
  if (bytes >= MIB) {
    const megabytes = bytes / MIB;
    return Math.round(megabytes * 10) / 10 >= 10
      ? `${Math.round(megabytes)} МБ`
      : `${formatDecimal(megabytes, 1)} МБ`;
  }
  return `${Math.max(1, Math.round(bytes / KIB))} КБ`;
}
