import { AVAILABLE_CALCULATORS } from '@/features/calculators/calculator-registry';

export type CalculatorTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'calculator'; readonly value: string; readonly slug: string };

interface CalculatorPhrase {
  readonly phrase: string;
  readonly normalizedPhrase: string;
  readonly slug: string;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const CALCULATOR_PHRASES: readonly CalculatorPhrase[] = AVAILABLE_CALCULATORS.flatMap(
  (calculator) =>
    [calculator.title, calculator.shortTitle, ...calculator.aliases]
      .filter((phrase) => phrase.trim().length >= 3)
      .map((phrase) => ({
        phrase,
        normalizedPhrase: normalize(phrase),
        slug: calculator.slug,
      })),
)
  .filter(
    (candidate, index, values) =>
      values.findIndex(
        (other) =>
          other.normalizedPhrase === candidate.normalizedPhrase && other.slug === candidate.slug,
      ) === index,
  )
  .toSorted((left, right) => right.phrase.length - left.phrase.length);

function findPhraseIndex(text: string, phrase: string): number {
  const pattern = new RegExp(`(?:^|[^0-9a-zа-я])(${escapeRegExp(phrase)})(?![0-9a-zа-я])`, 'iu');
  const match = pattern.exec(text);
  const matchedPhrase = match?.[1];
  if (!match || !matchedPhrase) return -1;
  return match.index + match[0].length - matchedPhrase.length;
}

export function segmentTextWithCalculatorLinks(text: string): readonly CalculatorTextSegment[] {
  if (!text) return [{ kind: 'text', value: text }];
  const normalizedText = normalize(text);
  const segments: CalculatorTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let best: { readonly start: number; readonly end: number; readonly slug: string } | undefined;
    for (const phrase of CALCULATOR_PHRASES) {
      const relativeStart = findPhraseIndex(normalizedText.slice(cursor), phrase.normalizedPhrase);
      if (relativeStart < 0) continue;
      const start = cursor + relativeStart;
      const end = start + phrase.phrase.length;
      if (!best || start < best.start || (start === best.start && end > best.end)) {
        best = { start, end, slug: phrase.slug };
      }
    }
    if (!best) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }
    if (best.start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, best.start) });
    segments.push({
      kind: 'calculator',
      value: text.slice(best.start, best.end),
      slug: best.slug,
    });
    cursor = best.end;
  }

  return segments;
}

export function openCalculator(slug: string): void {
  window.location.hash = `#/calculators/${encodeURIComponent(slug)}`;
}
