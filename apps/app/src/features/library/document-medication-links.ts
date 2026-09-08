import type { MedicalDocumentSummary } from '@localmed/contracts';
import { isSameDocumentFamily } from '@localmed/core';
import { documentMarkdownTables } from '@/features/library/document-markdown-tables';
import {
  type DocumentTableBlock,
  documentRenderBlockSearchText,
} from '@/features/library/document-rich-block-data';

export type DocumentInlineLinkKind = 'document' | 'medication' | 'recommendation';

export interface DocumentLinkPreview {
  readonly title: string;
  readonly definition: string;
  readonly source?: {
    readonly label: string;
    readonly documentId: string;
    readonly anchor?: string;
  };
}

export interface DocumentLinkPhrase {
  readonly phrase: string;
  readonly documentId: string;
  readonly kind: DocumentInlineLinkKind;
  readonly title?: string;
  readonly preview?: DocumentLinkPreview;
}

export interface DocumentLinkAlternative {
  readonly documentId: string;
  readonly title: string;
  readonly preview?: DocumentLinkPreview;
}

export type MedicationLinkPhrase = DocumentLinkPhrase;

export type DocumentTextBlock =
  | { readonly kind: 'table'; readonly text: string; readonly table: DocumentTableBlock }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullet'; readonly text: string }
  | { readonly kind: 'ordered'; readonly text: string; readonly ordinal: number }
  | { readonly kind: 'image'; readonly alt: string; readonly source: string };

export type LinkedTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'link';
      readonly value: string;
      readonly documentId: string;
      readonly linkKind: DocumentInlineLinkKind;
      readonly preview?: DocumentLinkPreview;
      readonly alternatives?: readonly DocumentLinkAlternative[];
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

function implicitListStarts(lines: readonly { readonly text: string }[]): ReadonlySet<number> {
  const starts = new Set<number>();
  for (let index = 1; index < lines.length; index += 1) {
    if (!/[：:]$/u.test(lines[index - 1]?.text ?? '')) continue;
    let end = index;
    while (
      end < lines.length &&
      /^[\p{Ll}]/u.test(lines[end]?.text ?? '') &&
      /[.;]$/u.test(lines[end]?.text ?? '')
    ) {
      end += 1;
    }
    if (end - index >= 2 && /\.$/u.test(lines[end - 1]?.text ?? '')) {
      for (let item = index; item < end; item += 1) starts.add(item);
    }
  }
  return starts;
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е').trim();
}

export function parseDocumentText(
  value: string,
  sourceSpans?: unknown,
): readonly DocumentTextBlock[] {
  const blocks: DocumentTextBlock[] = [];
  const tables = documentMarkdownTables(value);
  if (tables.length > 0) {
    let cursor = 0;
    const prose = (start: number, end: number): readonly DocumentTextBlock[] =>
      parseDocumentText(
        value.slice(start, end),
        Array.isArray(sourceSpans)
          ? sourceSpans.slice(value.slice(0, start).split(/\r?\n(?:\s*\r?\n)+/u).length - 1)
          : sourceSpans,
      );
    for (const item of tables) {
      blocks.push(...prose(cursor, item.start));
      blocks.push({
        kind: 'table',
        text: documentRenderBlockSearchText(item.table),
        table: item.table,
      });
      cursor = item.end;
    }
    blocks.push(...prose(cursor, value.length));
    return blocks;
  }
  const lines = value.split(/\r?\n(?:\s*\r?\n)+/u).flatMap((line, sourceIndex) =>
    line
      .trim()
      .replace(/\s*([•▪◦●○])\s*/gu, '\n$1 ')
      .split('\n')
      .map((text) => ({ sourceIndex, text: text.trim() })),
  );
  const implicitList = implicitListStarts(lines);
  let activeListIndent: number | undefined;
  let previousSourceIndex: number | undefined;

  for (const [lineIndex, line] of lines.entries()) {
    if (!line.text) continue;
    const image = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/u.exec(line.text);
    if (image?.[2]) {
      blocks.push({ kind: 'image', alt: image[1]?.trim() ?? '', source: image[2] });
      activeListIndent = undefined;
      previousSourceIndex = line.sourceIndex;
      continue;
    }
    const imageSource = /^\[Источник изображения\]\((https?:\/\/[^\s)]+)\)$/u.exec(line.text);
    const previousImage = blocks.at(-1);
    if (
      imageSource?.[1] &&
      previousImage?.kind === 'image' &&
      previousImage.source === imageSource[1]
    ) {
      previousSourceIndex = line.sourceIndex;
      continue;
    }
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
    if (implicitList.has(lineIndex)) {
      blocks.push({ kind: 'bullet', text: line.text });
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
  const lower = ch.toLowerCase();
  return lower === 'ё' ? 'е' : lower;
}

function foldPhrase(value: string): string {
  return normalizePhrase(value).replace(/\s+/gu, ' ');
}

const PREFIX_LENGTH = 3;

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
  readonly preview?: DocumentLinkPreview;
  readonly title: string;
  readonly exactCase?: string;
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
      title: link.title ?? link.preview?.title ?? link.phrase,
      ...(/^[\p{Lu}]{3}$/u.test(link.phrase) ? { exactCase: link.phrase } : {}),
      ...(link.preview ? { preview: link.preview } : {}),
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
            if (link.exactCase && text.slice(index, end) !== link.exactCase) continue;
            best = { end, link };
            break;
          }
        }
        if (best) {
          const folded = best.link.folded;
          const alternatives = [
            ...new Map(
              candidates
                ?.filter(
                  (link) =>
                    link.folded === folded &&
                    (!link.exactCase || text.slice(index, best.end) === link.exactCase),
                )
                .map((link): [string, DocumentLinkAlternative] => [
                  link.documentId,
                  {
                    documentId: link.documentId,
                    title: link.title,
                    ...(link.preview ? { preview: link.preview } : {}),
                  },
                ]),
            ).values(),
          ].toSorted(
            (left, right) =>
              left.title.localeCompare(right.title, 'ru') ||
              left.documentId.localeCompare(right.documentId),
          );
          if (index > cursor) {
            segments.push({ kind: 'text', value: text.slice(cursor, index) });
          }
          segments.push({
            kind: 'link',
            value: text.slice(index, best.end),
            documentId: best.link.documentId,
            linkKind: best.link.linkKind,
            ...(best.link.preview ? { preview: best.link.preview } : {}),
            ...(alternatives.length > 1 ? { alternatives } : {}),
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
  const candidatesByPhrase = new Map<string, Map<string, MedicationLinkPhrase>>();
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  for (const document of documents) {
    if (document.sourceType !== 'official_registry_summary') continue;
    const candidates = [
      document.title.split('—')[0]?.trim() ?? '',
      document.shortTitle?.trim() ?? '',
    ].filter((value) => value.length >= 4);

    for (const phrase of candidates) {
      const key = foldPhrase(phrase);
      if (!key) continue;
      const candidates = candidatesByPhrase.get(key) ?? new Map();
      if (!candidates.has(document.id)) {
        candidates.set(document.id, { phrase, documentId: document.id, kind: 'medication' });
      }
      candidatesByPhrase.set(key, candidates);
    }
  }

  return [...candidatesByPhrase.values()]
    .flatMap((candidates) =>
      [...candidates.values()].map((candidate) =>
        candidates.size > 1
          ? {
              ...candidate,
              title: documentsById.get(candidate.documentId)?.title ?? candidate.phrase,
            }
          : candidate,
      ),
    )
    .toSorted(
      (left, right) =>
        right.phrase.length - left.phrase.length || left.documentId.localeCompare(right.documentId),
    );
}

function documentPhraseCandidates(document: MedicalDocumentSummary): readonly string[] {
  const title = document.title
    .replace(/^клинические рекомендации\s*[—:.-]\s*/iu, '')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
  // Search expansions can name a symptom or a broader condition, not the target itself.
  // Only editorial navigation aliases are evidence for an inline document link.
  const value = document.metadata?.['navigationAliases'];
  const metadataPhrases = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  return [document.shortTitle?.trim() ?? '', title.split('—')[0]?.trim() ?? '', ...metadataPhrases]
    .map((value) => value.trim())
    .filter((value) => value.length >= PREFIX_LENGTH);
}

function documentLinkPreview(
  document: MedicalDocumentSummary,
  documents: ReadonlyMap<string, MedicalDocumentSummary>,
): DocumentLinkPreview | undefined {
  const value = document.metadata?.['canonicalDefinition'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const definition = (value as Record<string, unknown>)['text'];
  if (typeof definition !== 'string' || !definition.trim()) return undefined;
  const source = value as Record<string, unknown>;
  const sourceId = source['sourceDocumentId'];
  const anchor = source['sourceAnchor'];
  const section = source['sourceSectionTitle'];
  return {
    title: document.title,
    definition: definition.trim(),
    ...(typeof sourceId === 'string' && typeof anchor === 'string'
      ? {
          source: {
            label: [
              document.title,
              document.versionLabel,
              typeof section === 'string' ? section : null,
            ]
              .filter(Boolean)
              .join(' · '),
            documentId: documents.has(sourceId) ? sourceId : document.id,
            anchor,
          },
        }
      : {}),
  };
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
    'core_catalog_pointer',
  ]);
  const candidatesByPhrase = new Map<string, Map<string, DocumentLinkPhrase>>();
  const documentsById = new Map(documents.map((document) => [document.id, document]));

  for (const document of documents) {
    const pointerTarget = document.metadata?.['targetDocumentId'];
    const installedTarget =
      document.sourceType === 'core_catalog_pointer' && typeof pointerTarget === 'string'
        ? documentsById.get(pointerTarget)
        : undefined;
    const target = installedTarget ?? document;
    if (
      (currentDocumentId && isSameDocumentFamily(target.id, currentDocumentId)) ||
      !linkableSourceTypes.has(document.sourceType)
    ) {
      continue;
    }
    const preview =
      documentLinkPreview(document, documentsById) ?? documentLinkPreview(target, documentsById);
    for (const phrase of documentPhraseCandidates(document)) {
      const key = foldPhrase(phrase);
      if (!key) continue;
      const candidates = candidatesByPhrase.get(key) ?? new Map();
      const existing = candidates.get(target.id);
      if (!existing || (!existing.preview && preview)) {
        candidates.set(target.id, {
          phrase,
          documentId: target.id,
          kind:
            document.metadata?.['catalogFamily'] === 'medication'
              ? 'medication'
              : linkKindForSourceType(target.sourceType),
          ...(preview ? { preview } : {}),
        });
      }
      candidatesByPhrase.set(key, candidates);
    }
  }

  return [...candidatesByPhrase.values()]
    .flatMap((candidates) =>
      [...candidates.values()].map((candidate) =>
        candidates.size > 1
          ? {
              ...candidate,
              title: documentsById.get(candidate.documentId)?.title ?? candidate.phrase,
            }
          : candidate,
      ),
    )
    .toSorted(
      (left, right) =>
        right.phrase.length - left.phrase.length || left.documentId.localeCompare(right.documentId),
    );
}

export function segmentTextWithMedicationLinks(
  text: string,
  links: readonly DocumentLinkPhrase[],
): readonly LinkedTextSegment[] {
  return createDocumentLinkMatcher(links).segment(text);
}
