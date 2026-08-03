import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import { installAssessmentIds } from '@/features/assessments/assessment-packs';

export type AssessmentTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'assessment'; readonly value: string; readonly slug: string };

interface AssessmentPhrase {
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

const ASSESSMENT_PHRASES: readonly AssessmentPhrase[] = ASSESSMENT_CATALOG.flatMap((assessment) =>
  [assessment.title, assessment.shortTitle, ...assessment.aliases]
    .filter((phrase) => phrase.trim().length >= 4)
    .map((phrase) => ({
      phrase,
      normalizedPhrase: normalize(phrase),
      slug: assessment.slug,
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

export function segmentTextWithAssessmentLinks(text: string): readonly AssessmentTextSegment[] {
  if (!text) return [{ kind: 'text', value: text }];
  const normalizedText = normalize(text);
  const segments: AssessmentTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let best: { readonly start: number; readonly end: number; readonly slug: string } | undefined;
    for (const phrase of ASSESSMENT_PHRASES) {
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
    if (best.start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, best.start) });
    }
    segments.push({
      kind: 'assessment',
      value: text.slice(best.start, best.end),
      slug: best.slug,
    });
    cursor = best.end;
  }

  return segments;
}

export function ensureAssessmentAvailable(slug: string): void {
  const definition = ASSESSMENT_CATALOG.find((assessment) => assessment.slug === slug);
  if (definition) installAssessmentIds([definition.id], ASSESSMENT_CATALOG);
}

export function openAssessment(slug: string): void {
  ensureAssessmentAvailable(slug);
  window.location.hash = `#/assessments/${encodeURIComponent(slug)}`;
}
