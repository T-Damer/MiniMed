import type { SearchDocumentDescriptor } from '@localmed/contracts';
import { normalizeSurfaceText, transliterateLatinName } from '@localmed/search-lexical';

/**
 * Source names a doctor types («Красота и медицина», «Аллмед», «Минздрав», «МКБ-11», «клинические
 * рекомендации»). A source name is rarely part of the indexed text, so a text search for it finds
 * unrelated documents. The names are derived at query time from the metadata the documents already
 * carry (the publisher of a catalogue record, the label of a snapshot, the issuer of an act) and
 * from the collections the caller declares (a document type with its reader-facing name); nothing
 * here lists a source by hand. Pure over a list of document descriptors.
 */

export interface SourceCollection {
  /** Stable id of the collection, e.g. the document type it is. */
  readonly id: string;
  /** The collection's name as a reader knows it («Клинические рекомендации», «МКБ-10»). */
  readonly label: string;
  readonly matches: (document: SearchDocumentDescriptor) => boolean;
}

export interface SourceName {
  readonly id: string;
  /** The name to show: the metadata value or the collection's label. */
  readonly label: string;
  /** Alias phrases as normalized word lists; the full name first. */
  readonly phrases: readonly (readonly string[])[];
  readonly documentIds: readonly string[];
}

export interface SourceCatalog {
  readonly sources: readonly SourceName[];
  /**
   * True when the normalized words (joined by a space) are the title of a document: a typed title
   * is never a source name. The titles are normalized on the first call only.
   */
  readonly isTitle: (words: string) => boolean;
}

/** A query read as «a source name» plus the text to look for inside that source. */
export interface SourceNameIntent {
  /** Stable id of the single source named, or the ids of several joined by «+». */
  readonly id: string;
  readonly label: string;
  /** What is left of the query once the source name is taken out; empty for a bare name. */
  readonly remainder: string;
  readonly sources: readonly SourceName[];
  readonly documentIds: ReadonlySet<string>;
}

/** A source smaller than this is not offered by name: a label shared by a few records is no source. */
export const MIN_SOURCE_DOCUMENTS = 3;
/** Longer metadata values («multiple general medical/nutrition web sources, …») are descriptions. */
const MAX_LABEL_WORDS = 6;
const MIN_ALIAS_LETTERS = 3;
/** A name this long may stand in the middle of a query; a shorter one only opens or closes it. */
const MIN_MIDDLE_LETTERS = 5;
/** The closing words of a label that do not tell it from others. */
const GENERIC_TAIL: ReadonlySet<string> = new Set([
  'snapshot',
  'справочно',
  'россии',
  'россия',
  'российской',
  'российская',
  'федерации',
  'федерация',
  'рф',
]);
/** Words that join a source name to the rest of a query («пневмония в Красота и медицина»). */
const CONNECTORS: ReadonlySet<string> = new Set([
  'по',
  'о',
  'об',
  'про',
  'при',
  'для',
  'в',
  'во',
  'на',
  'из',
  'от',
  'у',
]);
const TOKEN = /[\p{L}\p{N}]+/gu;

function wordsOf(value: string): readonly string[] {
  return [...value.matchAll(TOKEN)].map((match) => normalizeSurfaceText(match[0]));
}

function trimTail(words: readonly string[]): readonly string[] {
  let end = words.length;
  while (end > 0 && GENERIC_TAIL.has(words[end - 1] ?? '')) end -= 1;
  return words.slice(0, end);
}

function letterCount(words: readonly string[]): number {
  return words.join('').replace(/[^a-zа-я]/gu, '').length;
}

/** «Красота и медицина» → «ким»: the first letter of every word. */
function initialism(words: readonly string[]): string {
  return words.map((word) => word.charAt(0)).join('');
}

/** The phrases a source label can be typed as, the whole label first. */
export function labelPhrases(label: string): readonly (readonly string[])[] {
  const groups = [...label.matchAll(/\(([^)]*)\)/gu)].map((match) => match[1] ?? '');
  const outside = label.replace(/\([^)]*\)/gu, ' ');
  const candidates = [outside, ...groups].map((value) => trimTail(wordsOf(value)));
  const phrases: (readonly string[])[] = [];
  const seen = new Set<string>();
  const add = (phrase: readonly string[]): void => {
    const key = phrase.join(' ');
    if (phrase.length === 0 || letterCount(phrase) < MIN_ALIAS_LETTERS || seen.has(key)) return;
    seen.add(key);
    phrases.push(phrase);
  };
  for (const words of candidates) {
    add(words);
    if (words.length >= 3) add([initialism(words)]);
    const [first, second] = words;
    // «Allmed» typed in Cyrillic.
    if (words.length === 1 && first && /^[a-z]+$/u.test(first)) {
      for (const reading of transliterateLatinName(first)) add([reading]);
    }
    // «Министерство здравоохранения …» is «Минздрав»: «мин» and the start of the next word.
    if (first === 'министерство' && second) {
      for (let length = 3; length <= 6 && length < second.length; length += 1) {
        add([`мин${second.slice(0, length)}`]);
      }
    }
  }
  return phrases;
}

/** Two typed words are the same name word: equal, or inflections of one stem. */
function wordsAlike(typed: string, name: string): boolean {
  if (typed === name) return true;
  if (typed.length < 5 || name.length < 5) return false;
  if (!/^[а-я]+$/u.test(typed) || !/^[а-я]+$/u.test(name)) return false;
  const stem = Math.max(4, Math.min(typed.length, name.length) - 2);
  return typed.slice(0, stem) === name.slice(0, stem);
}

function phraseAt(typed: readonly string[], phrase: readonly string[], from: number): boolean {
  return phrase.every((word, index) => {
    const candidate = typed[from + index];
    return candidate !== undefined && wordsAlike(candidate, word);
  });
}

/** A source's name for the screen: «Allmed snapshot» is «Allmed», «МКБ-11 (ВОЗ), справочно» keeps «МКБ-11 (ВОЗ)». */
function displayLabel(label: string): string {
  return label.replace(/(?:,?\s+(?:snapshot|справочно))+$/iu, '').trim() || label;
}

function metadataText(document: SearchDocumentDescriptor, key: string): string | undefined {
  const value = document.metadata?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

const PUBLISHER_KEYS = ['publisher', 'sourceLabel', 'issuer'] as const;

/**
 * The sources of a document list: one per distinct publisher / snapshot label / issuer, one per
 * declared collection. Sources with too few documents, or with a label that is a description, are
 * left out.
 */
export function buildSourceCatalog(
  documents: readonly SearchDocumentDescriptor[],
  collections: readonly SourceCollection[] = [],
): SourceCatalog {
  const members = new Map<string, { label: string; ids: string[] }>();
  const add = (id: string, label: string, documentId: string): void => {
    const entry = members.get(id) ?? { label, ids: [] };
    if (entry.ids.at(-1) !== documentId) entry.ids.push(documentId);
    members.set(id, entry);
  };
  // The same few labels repeat on thousands of documents.
  const publisherIds = new Map<string, string>();
  for (const document of documents) {
    for (const key of PUBLISHER_KEYS) {
      const label = metadataText(document, key);
      if (!label) continue;
      let id = publisherIds.get(label);
      if (id === undefined) {
        id = `publisher:${wordsOf(label).join(' ')}`;
        publisherIds.set(label, id);
      }
      add(id, label, document.id);
    }
    for (const collection of collections) {
      if (collection.matches(document)) {
        add(`collection:${collection.id}`, collection.label, document.id);
      }
    }
  }
  const sources: SourceName[] = [];
  for (const [id, entry] of members) {
    if (entry.ids.length < MIN_SOURCE_DOCUMENTS) continue;
    if (trimTail(wordsOf(entry.label.replace(/\([^)]*\)/gu, ' '))).length > MAX_LABEL_WORDS) {
      continue;
    }
    const phrases = labelPhrases(entry.label);
    if (phrases.length === 0) continue;
    sources.push({ id, label: displayLabel(entry.label), phrases, documentIds: entry.ids });
  }
  let titles: ReadonlySet<string> | undefined;
  return {
    sources,
    isTitle: (words) => {
      titles ??= new Set(
        documents.flatMap((document) => [
          wordsOf(document.title).join(' '),
          ...(document.shortTitle ? [wordsOf(document.shortTitle).join(' ')] : []),
        ]),
      );
      return titles.has(words);
    },
  };
}

interface QueryToken {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** The tokens left once connecting words at both ends are dropped, as a `[from, to)` range. */
function trimmedRange(tokens: readonly QueryToken[]): readonly [number, number] {
  let from = 0;
  let to = tokens.length;
  while (from < to && CONNECTORS.has(normalizeSurfaceText(tokens[from]?.text ?? ''))) from += 1;
  while (to > from && CONNECTORS.has(normalizeSurfaceText(tokens[to - 1]?.text ?? ''))) to -= 1;
  return [from, to];
}

/**
 * The source a query names, or undefined. The longest name wins; several
 * sources that share a name (the ministry that issued acts and the ministry that published a
 * reference) are searched together. A query that is a document's title is not read as a source.
 */
export function detectSourceNameIntent(
  query: string,
  catalog: SourceCatalog,
): SourceNameIntent | undefined {
  const tokens: readonly QueryToken[] = [...query.matchAll(TOKEN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  if (tokens.length === 0 || catalog.sources.length === 0) return undefined;
  const typed = tokens.map((token) => normalizeSurfaceText(token.text));

  const found: { length: number; at: number; rank: number; source: SourceName }[] = [];
  for (const source of catalog.sources) {
    for (const phrase of source.phrases) {
      const length = phrase.length;
      if (length > typed.length) continue;
      // A name opens or closes the query; a long one may stand in the middle («приказ минздрава 203н»).
      let at = [0, typed.length - length].find((index) => phraseAt(typed, phrase, index));
      if (at === undefined && letterCount(phrase) >= MIN_MIDDLE_LETTERS) {
        for (let index = 1; index < typed.length - length && at === undefined; index += 1) {
          if (phraseAt(typed, phrase, index)) at = index;
        }
      }
      if (at === undefined) continue;
      found.push({ length, at, rank: at === 0 ? 0 : at + length === typed.length ? 1 : 2, source });
    }
  }
  // The longest name wins; at equal length a name at the start beats one at the end, then the middle.
  const [best] = found.toSorted(
    (left, right) => right.length - left.length || left.rank - right.rank,
  );
  if (!best || catalog.isTitle(typed.join(' '))) return undefined;
  const sources = [
    ...new Set(
      found
        .filter((entry) => entry.length === best.length && entry.at === best.at)
        .map((entry) => entry.source),
    ),
  ];
  const [first] = sources;
  if (!first) return undefined;

  const named = tokens.slice(best.at, best.at + best.length);
  // The remainder is cut from the query text so numbers, codes and punctuation survive.
  const remainder = [tokens.slice(0, best.at), tokens.slice(best.at + best.length)]
    .map((part) => {
      const [from, to] = trimmedRange(part);
      const firstKept = part[from];
      const lastKept = part[to - 1];
      return firstKept && lastKept ? query.slice(firstKept.start, lastKept.end) : '';
    })
    .filter((part) => part !== '')
    .join(' ');
  return {
    id: sources.map((source) => source.id).join('+'),
    label:
      sources.length === 1
        ? first.label
        : query.slice(named[0]?.start ?? 0, named.at(-1)?.end ?? query.length),
    remainder,
    sources,
    documentIds: new Set(sources.flatMap((source) => source.documentIds)),
  };
}

let latest: { readonly signature: string; readonly catalog: SourceCatalog } | undefined;

/**
 * The catalog of a document list. The core hands out a fresh array on every call, so the catalog
 * is kept for the last list seen and rebuilt when the list's size or its first, middle or last
 * document changes (installed content changed).
 */
export function sourceCatalogOf(
  documents: readonly SearchDocumentDescriptor[],
  collections: readonly SourceCollection[],
): SourceCatalog {
  const signature = [
    documents.length,
    documents[0]?.id,
    documents[documents.length >> 1]?.id,
    documents.at(-1)?.id,
    collections.map((collection) => collection.id).join(),
  ].join('|');
  if (latest?.signature !== signature) {
    latest = { signature, catalog: buildSourceCatalog(documents, collections) };
  }
  return latest.catalog;
}
