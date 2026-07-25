import type { MedicalDocumentSummary } from '@localmed/contracts';

export interface MedicationLinkPhrase {
  readonly phrase: string;
  readonly documentId: string;
}

export type LinkedTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly documentId: string };

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function findPhraseIndex(text: string, phrase: string): number {
  if (!phrase) return -1;
  const pattern = new RegExp(`(?:^|[^0-9a-zа-я])(${escapeRegExp(phrase)})(?![0-9a-zа-я])`, 'iu');
  const match = pattern.exec(text);
  const matchedPhrase = match?.[1];
  if (!match || !matchedPhrase) return -1;
  return match.index + match[0].length - matchedPhrase.length;
}

export function buildMedicationLinkPhrases(
  documents: readonly MedicalDocumentSummary[],
): readonly MedicationLinkPhrase[] {
  const phrases: MedicationLinkPhrase[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    if (document.sourceType !== 'official_registry_summary') continue;
    const candidates = [
      document.title.split('—')[0]?.trim() ?? '',
      document.shortTitle?.trim() ?? '',
    ].filter((value) => value.length >= 4);

    for (const phrase of candidates) {
      const key = normalizePhrase(phrase);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      phrases.push({ phrase, documentId: document.id });
    }
  }

  return phrases.toSorted((left, right) => right.phrase.length - left.phrase.length);
}

export function segmentTextWithMedicationLinks(
  text: string,
  links: readonly MedicationLinkPhrase[],
): readonly LinkedTextSegment[] {
  if (!text || links.length === 0) return [{ kind: 'text', value: text }];

  const normalizedText = normalizePhrase(text);
  const segments: LinkedTextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let bestMatch: {
      readonly start: number;
      readonly end: number;
      readonly documentId: string;
    } | null = null;

    for (const link of links) {
      const normalizedPhrase = normalizePhrase(link.phrase);
      const start = findPhraseIndex(normalizedText.slice(cursor), normalizedPhrase);
      if (start < 0) continue;
      const absoluteStart = cursor + start;
      const absoluteEnd = absoluteStart + link.phrase.length;
      if (
        !bestMatch ||
        absoluteStart < bestMatch.start ||
        (absoluteStart === bestMatch.start && link.phrase.length > bestMatch.end - bestMatch.start)
      ) {
        bestMatch = {
          start: absoluteStart,
          end: absoluteEnd,
          documentId: link.documentId,
        };
      }
    }

    if (!bestMatch) {
      segments.push({ kind: 'text', value: text.slice(cursor) });
      break;
    }

    if (bestMatch.start > cursor) {
      segments.push({ kind: 'text', value: text.slice(cursor, bestMatch.start) });
    }
    segments.push({
      kind: 'link',
      value: text.slice(bestMatch.start, bestMatch.end),
      documentId: bestMatch.documentId,
    });
    cursor = bestMatch.end;
  }

  return segments;
}
