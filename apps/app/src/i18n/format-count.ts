const THIN_SPACE = ' ';

/**
 * «9 084», «31 806»: a whole number grouped in thousands by thin non-breaking spaces. Unlike
 * `toLocaleString('ru-RU')`, four-digit numbers are grouped too, so «1 из 9 084» and «31 806» read
 * alike everywhere a counter is shown.
 */
export function formatCount(value: number): string {
  const digits = String(Math.abs(Math.trunc(value)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, THIN_SPACE);
  return value < 0 ? `−${grouped}` : grouped;
}
