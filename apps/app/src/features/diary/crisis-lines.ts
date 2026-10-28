/**
 * A help line the doctor wrote («Дежурный психиатр: +7 (495) 123-45-67») as text with its phone
 * numbers marked, so the crisis screen can make every number a call button.
 */
export type CrisisLinePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'phone'; readonly text: string; readonly href: string };

/** A run of digits, spaces, brackets and dashes, optionally after «+», with 3–15 digits. */
const PHONE = /\+?\d[\d\s()-]*\d/gu;

export function crisisLineParts(line: string): CrisisLinePart[] {
  const parts: CrisisLinePart[] = [];
  let last = 0;
  for (const match of line.matchAll(PHONE)) {
    const text = match[0];
    const digits = text.replace(/\D/gu, '');
    if (digits.length < 3 || digits.length > 15) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: line.slice(last, start) });
    parts.push({ kind: 'phone', text, href: `tel:${text.startsWith('+') ? '+' : ''}${digits}` });
    last = start + text.length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}
