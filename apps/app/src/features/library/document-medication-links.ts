import type { MedicalDocumentSummary } from '@localmed/contracts';

export interface DocumentLinkPhrase {
  readonly phrase: string;
  readonly documentId: string;
}

export type MedicationLinkPhrase = DocumentLinkPhrase;

export type DocumentTextBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullet'; readonly text: string }
  | { readonly kind: 'ordered'; readonly text: string; readonly ordinal: number };

export type LinkedTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly documentId: string };

function sourceSpanLeft(sourceSpans: unknown, index: number): number | undefined {
  if (!Array.isArray(sourceSpans)) return undefined;
  const span = sourceSpans[index];
  if (!span || typeof span !== 'object') return undefined;
  const bbox = (span as { readonly bbox?: unknown }).bbox;
  if (!Array.isArray(bbox) || typeof bbox[0] !== 'number') return undefined;
  return bbox[0];
}

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

export function parseDocumentText(
  value: string,
  sourceSpans?: unknown,
): readonly DocumentTextBlock[] {
  const blocks: DocumentTextBlock[] = [];
  const lines = value.split(/\r?\n(?:\s*\r?\n)+/u).flatMap((line, sourceIndex) =>
    line
      .trim()
      .replace(/\s*([•▪◦●○])\s*/gu, '\n$1 ')
      .split('\n')
      .map((text) => ({ sourceIndex, text: text.trim() })),
  );
  let activeListIndent: number | undefined;
  let previousSourceIndex: number | undefined;

  for (const line of lines) {
    if (!line.text) continue;
    const bullet = /^[•▪◦●○*+-]\s+(.+)$/u.exec(line.text);
    if (bullet?.[1]) {
      blocks.push({ kind: 'bullet', text: bullet[1] });
      activeListIndent = sourceSpanLeft(sourceSpans, line.sourceIndex);
      previousSourceIndex = line.sourceIndex;
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.+)$/u.exec(line.text);
    if (ordered?.[1] && ordered[2]) {
      blocks.push({ kind: 'ordered', ordinal: Number(ordered[1]), text: ordered[2] });
      activeListIndent = sourceSpanLeft(sourceSpans, line.sourceIndex);
      previousSourceIndex = line.sourceIndex;
      continue;
    }
    const previous = blocks.at(-1);
    const currentLeft = sourceSpanLeft(sourceSpans, line.sourceIndex);
    const continuesList =
      (previous?.kind === 'bullet' || previous?.kind === 'ordered') &&
      (activeListIndent === undefined ||
        currentLeft === undefined ||
        currentLeft > activeListIndent + 4);
    if (continuesList) {
      blocks[blocks.length - 1] = { ...previous, text: `${previous.text} ${line.text}` };
    } else if (
      previous?.kind === 'paragraph' &&
      !/[.!?;:]$/u.test(previous.text) &&
      currentLeft !== undefined &&
      previousSourceIndex !== undefined &&
      Math.abs(currentLeft - (sourceSpanLeft(sourceSpans, previousSourceIndex) ?? currentLeft)) < 4
    ) {
      blocks[blocks.length - 1] = { ...previous, text: `${previous.text} ${line.text}` };
    } else {
      blocks.push({ kind: 'paragraph', text: line.text });
      activeListIndent = undefined;
    }
    previousSourceIndex = line.sourceIndex;
  }
  return blocks;
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

export function buildDocumentLinkPhrases(
  documents: readonly MedicalDocumentSummary[],
  currentDocumentId?: string,
): readonly DocumentLinkPhrase[] {
  const linkableSourceTypes = new Set([
    'official_registry_summary',
    'clinical_recommendation_summary',
    'regulatory_act',
    'medical_reference',
    'rls_mkb_reference',
  ]);
  const phrases: DocumentLinkPhrase[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    if (document.id === currentDocumentId || !linkableSourceTypes.has(document.sourceType))
      continue;
    const title = document.title
      .replace(/^клинические рекомендации\s*[—:.-]\s*/iu, '')
      .replace(/\s*\([^)]*\)\s*$/u, '')
      .trim();
    const candidates = [
      document.shortTitle?.trim() ?? '',
      title.split('—')[0]?.trim() ?? '',
    ].filter((value) => value.length >= 5);
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
  links: readonly DocumentLinkPhrase[],
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
