import type { MedicalDocumentSummary } from '@localmed/contracts';
import { isSameDocumentFamily } from '@localmed/core';

export type DocumentInlineLinkKind = 'document' | 'medication' | 'recommendation';

export interface DocumentLinkPhrase {
  readonly phrase: string;
  readonly documentId: string;
  readonly kind: DocumentInlineLinkKind;
}

export type MedicationLinkPhrase = DocumentLinkPhrase;

export type DocumentTextBlock =
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullet'; readonly text: string }
  | { readonly kind: 'ordered'; readonly text: string; readonly ordinal: number };

export type LinkedTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'link';
      readonly value: string;
      readonly documentId: string;
      readonly linkKind: DocumentInlineLinkKind;
    };

function linkKindForSourceType(
  sourceType: MedicalDocumentSummary['sourceType'],
): DocumentInlineLinkKind {
  switch (sourceType) {
    case 'official_registry_summary':
      return 'medication';
    case 'clinical_recommendation_summary':
      return 'recommendation';
    case 'regulatory_act':
    case 'medical_reference':
    case 'rls_mkb_reference':
      return 'document';
    default:
      return 'document';
  }
}

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

export interface DocumentLinkMatcher {
  segment(text: string): readonly LinkedTextSegment[];
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

function isBoundaryChar(ch: string | undefined): boolean {
  return ch === undefined || !WORD_CHAR.test(ch);
}

function foldChar(ch: string): string {
  const lower = ch.toLocaleLowerCase('ru-RU');
  return lower === 'ё' ? 'е' : lower;
}

function foldPhrase(value: string): string {
  return normalizePhrase(value).replace(/\s+/gu, ' ');
}

const PREFIX_LENGTH = 4;

function foldedPrefixAt(text: string, start: number): string | null {
  if (start + PREFIX_LENGTH > text.length) return null;
  let prefix = '';
  for (let offset = 0; offset < PREFIX_LENGTH; offset += 1) {
    const ch = text[start + offset];
    if (ch === undefined) return null;
    prefix += foldChar(ch);
  }
  return prefix;
}

interface IndexedDocumentLink {
  readonly documentId: string;
  readonly linkKind: DocumentInlineLinkKind;
  readonly folded: string;
}

function matchFoldedPhraseAt(text: string, start: number, folded: string): number {
  let textIndex = start;
  let phraseIndex = 0;
  while (phraseIndex < folded.length) {
    const phraseChar = folded[phraseIndex];
    if (phraseChar === ' ') {
      const current = text[textIndex];
      if (current === undefined || !/\s/u.test(current)) return -1;
      while (textIndex < text.length && /\s/u.test(text[textIndex] ?? '')) {
        textIndex += 1;
      }
      phraseIndex += 1;
      continue;
    }
    const textChar = text[textIndex];
    if (textChar === undefined || foldChar(textChar) !== phraseChar) return -1;
    textIndex += 1;
    phraseIndex += 1;
  }
  if (!isBoundaryChar(text[textIndex])) return -1;
  return textIndex;
}

export function createDocumentLinkMatcher(
  links: readonly DocumentLinkPhrase[],
): DocumentLinkMatcher {
  const buckets = new Map<string, IndexedDocumentLink[]>();
  for (const link of links) {
    const folded = foldPhrase(link.phrase);
    if (folded.length < PREFIX_LENGTH) continue;
    const prefix = folded.slice(0, PREFIX_LENGTH);
    const bucket = buckets.get(prefix) ?? [];
    bucket.push({
      documentId: link.documentId,
      linkKind: link.kind,
      folded,
    });
    buckets.set(prefix, bucket);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => right.folded.length - left.folded.length);
  }

  return {
    segment(text: string): readonly LinkedTextSegment[] {
      if (!text || buckets.size === 0) return [{ kind: 'text', value: text }];
      const segments: LinkedTextSegment[] = [];
      let cursor = 0;
      let index = 0;
      while (index < text.length) {
        if (index > 0 && !isBoundaryChar(text[index - 1])) {
          index += 1;
          continue;
        }
        const prefix = foldedPrefixAt(text, index);
        const candidates = prefix ? buckets.get(prefix) : undefined;
        let best: { readonly end: number; readonly link: IndexedDocumentLink } | null = null;
        if (candidates) {
          for (const link of candidates) {
            const end = matchFoldedPhraseAt(text, index, link.folded);
            if (end < 0) continue;
            best = { end, link };
            break;
          }
        }
        if (best) {
          if (index > cursor) {
            segments.push({ kind: 'text', value: text.slice(cursor, index) });
          }
          segments.push({
            kind: 'link',
            value: text.slice(index, best.end),
            documentId: best.link.documentId,
            linkKind: best.link.linkKind,
          });
          cursor = best.end;
          index = best.end;
          continue;
        }
        index += 1;
      }
      if (cursor < text.length) {
        segments.push({ kind: 'text', value: text.slice(cursor) });
      }
      return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
    },
  };
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
      phrases.push({ phrase, documentId: document.id, kind: 'medication' });
    }
  }

  return phrases.toSorted((left, right) => right.phrase.length - left.phrase.length);
}

function documentPhraseCandidates(document: MedicalDocumentSummary): readonly string[] {
  const title = document.title
    .replace(/^клинические рекомендации\s*[—:.-]\s*/iu, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
  return [document.shortTitle?.trim() ?? '', title.split('—')[0]?.trim() ?? ''].filter(
    (value) => value.length >= 5,
  );
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
  const currentDocument = documents.find((document) => document.id === currentDocumentId);
  const blockedPhrases = new Set(
    (currentDocument
      ? [currentDocument.shortTitle?.trim() ?? '', currentDocument.title.trim()]
      : []
    )
      .map(normalizePhrase)
      .filter((value) => value.length > 0),
  );

  for (const document of documents) {
    if (
      (currentDocumentId && isSameDocumentFamily(document.id, currentDocumentId)) ||
      !linkableSourceTypes.has(document.sourceType)
    ) {
      continue;
    }
    for (const phrase of documentPhraseCandidates(document)) {
      const key = normalizePhrase(phrase);
      if (!key || seen.has(key) || blockedPhrases.has(key)) continue;
      seen.add(key);
      phrases.push({
        phrase,
        documentId: document.id,
        kind: linkKindForSourceType(document.sourceType),
      });
    }
  }

  return phrases.toSorted((left, right) => right.phrase.length - left.phrase.length);
}

export function segmentTextWithMedicationLinks(
  text: string,
  links: readonly DocumentLinkPhrase[],
): readonly LinkedTextSegment[] {
  return createDocumentLinkMatcher(links).segment(text);
}
