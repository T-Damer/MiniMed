import type { MedicalDocumentSummary, SearchResult, TextRange } from '@localmed/contracts';
import { isIcd11Document } from '@/features/icd11/icd11-document';
import {
  CLEANED_SECTION_TITLES,
  TECHNICAL_SECTION_TITLES,
} from '@/features/library/document-display';
import { instructionSourceInfo } from '@/features/medications/instruction-source';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { specialtyLabel } from '@/i18n/labels';

/** How a technical section is named in a result line. */
const TECHNICAL_SECTION_LABELS: Readonly<Record<string, string>> = {
  'Сведения о документе': 'О документе',
  'Сведения МКБ-10': 'МКБ-10',
  'Классификационный контекст': 'Раздел МКБ',
  'Ограничение покрытия': 'О материале',
  'Указатель препарата': 'О препарате',
};

export function isTechnicalResult(result: Pick<SearchResult, 'sectionPath'>): boolean {
  const last = result.sectionPath.at(-1);
  return last !== undefined && TECHNICAL_SECTION_TITLES.has(last);
}

/** The document's own text first, its technical card last; otherwise the core's order. */
export function orderResultsForDisplay<T extends Pick<SearchResult, 'sectionPath'>>(
  results: readonly T[],
): readonly T[] {
  const own = results.filter((result) => !isTechnicalResult(result));
  return own.length === results.length || own.length === 0
    ? results
    : [...own, ...results.filter(isTechnicalResult)];
}

export function displaySectionPath(sectionPath: readonly string[]): readonly string[] {
  return sectionPath.map((segment) => TECHNICAL_SECTION_LABELS[segment] ?? segment);
}

interface SnippetEdit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/**
 * Clauses of a pointer's «Сведения о документе» that say nothing to a reader: the title again,
 * catalogue identifiers, empty fields and where the full text is stored. Each runs to its full
 * stop (or the end of the snippet, which may be cut).
 */
const DROPPED_CLAUSES: readonly RegExp[] = [
  /Название: [^\n]*?(?:\.(?=\s|$)|$)\s*/gu,
  /Официальный идентификатор: [^\n]*?(?:\.(?=\s|$)|$)\s*/gu,
  /[А-ЯЁ][а-яё -]*: не указан[оаы]?(?: в каталоге)?\.\s*/gu,
  /Полные данные находятся[^\n]*?(?:\.(?=\s|$)|$)\s*/gu,
  /Редакция заменена: [^\n]*?(?:\.(?=\s|$)|$)\s*/gu,
  /Заменяет редакции: [^\n]*?(?:\.(?=\s|$)|$)\s*/gu,
  // Where the catalogue copied the record from; the reader shows it in small print.
  /\s*Источник: [^;\n]*; https?:\/\/\S+/gu,
  // A snippet cut inside the title clause starts with its tail: «…взрослых и детей. Другие…».
  /^…[^:\n]*?\.\s+(?=[А-ЯЁ][а-яё -]*:)/gu,
];

/** Catalogue field names in reader words. */
const RENAMED_LABELS: readonly (readonly [string, string])[] = [
  ['Объявленные алиасы:', 'Другие названия:'],
  ['Возрастные категории:', 'Возраст:'],
];

/** The catalogue lists specialties by their slugs («psychiatry, child-psychiatry»). */
const SPECIALTY_SLUGS =
  /(?<=Специальности: )[a-z0-9]+(?:-[a-z0-9]+)*(?:, [a-z0-9]+(?:-[a-z0-9]+)*)*(?=\.|$)/gmu;

function snippetEdits(text: string): readonly SnippetEdit[] {
  const edits: SnippetEdit[] = [];
  for (const match of text.matchAll(SPECIALTY_SLUGS)) {
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: match[0]
        .split(', ')
        .map((slug) => specialtyLabel(slug))
        .join(', '),
    });
  }
  for (const pattern of DROPPED_CLAUSES) {
    for (const match of text.matchAll(pattern)) {
      edits.push({ start: match.index, end: match.index + match[0].length, replacement: '' });
    }
  }
  for (const [label, replacement] of RENAMED_LABELS) {
    let from = text.indexOf(label);
    while (from >= 0) {
      edits.push({ start: from, end: from + label.length, replacement });
      from = text.indexOf(label, from + label.length);
    }
  }
  // Overlapping edits keep the earlier, longer one.
  const sorted = edits.toSorted((left, right) => left.start - right.start || right.end - left.end);
  const kept: SnippetEdit[] = [];
  for (const edit of sorted) {
    const previous = kept.at(-1);
    if (previous && edit.start < previous.end) continue;
    kept.push(edit);
  }
  return kept;
}

/**
 * A pointer's technical snippet in reader words, with its highlights moved along. Text outside the
 * edited clauses is kept as it is; highlights inside a dropped or renamed span are dropped.
 */
export function presentResultSnippet(
  result: Pick<SearchResult, 'snippet' | 'highlightedRanges' | 'sectionPath'>,
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  const presented = presentCleanedSnippet(result);
  return tidySnippetStart(presented.text, presented.ranges);
}

/** A snippet cut out of a longer text starts with «…» and a word: the first word is the cut one. */
const LEADING_CUT = /^…\s*[\p{L}\p{N}]*\s?/u;

/**
 * The start of a snippet cut out of the middle of a text. The core marks some cuts with «…» in the
 * middle of a word («…орных отделов»); an unmarked cut simply begins with a lower-case word. The
 * first word after the mark is dropped (it may be a stub), and an unmarked lower-case start gets
 * the mark, so a card never opens in the middle of a sentence as if it began there. Highlights
 * move with the text; a highlighted first word stays.
 */
export function tidySnippetStart(
  text: string,
  ranges: readonly TextRange[],
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  if (text.startsWith('…')) {
    const cut = LEADING_CUT.exec(text)?.[0] ?? '…';
    if (cut.length > 1 && !ranges.some((range) => range.start < cut.length)) {
      const rest = text.slice(cut.length);
      if (rest.trim() !== '') {
        const shift = cut.length - 1;
        return {
          text: `…${rest}`,
          ranges: ranges.map((range) => ({ start: range.start - shift, end: range.end - shift })),
        };
      }
    }
    return { text, ranges };
  }
  if (/^\p{Ll}/u.test(text)) {
    return {
      text: `…${text}`,
      ranges: ranges.map((range) => ({ start: range.start + 1, end: range.end + 1 })),
    };
  }
  return { text, ranges };
}

function presentCleanedSnippet(
  result: Pick<SearchResult, 'snippet' | 'highlightedRanges' | 'sectionPath'>,
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  const last = result.sectionPath.at(-1);
  if (last === undefined || !CLEANED_SECTION_TITLES.has(last)) {
    return { text: result.snippet, ranges: result.highlightedRanges };
  }
  const source = result.snippet;
  const edits = snippetEdits(source);
  if (edits.length === 0) return { text: source, ranges: result.highlightedRanges };
  let text = '';
  let cursor = 0;
  // Shift of every original offset at or after an edit's end.
  const shifts: { readonly at: number; readonly start: number; readonly delta: number }[] = [];
  let delta = 0;
  for (const edit of edits) {
    text += source.slice(cursor, edit.start) + edit.replacement;
    delta += edit.replacement.length - (edit.end - edit.start);
    shifts.push({ at: edit.end, start: edit.start, delta });
    cursor = edit.end;
  }
  text += source.slice(cursor);
  const map = (offset: number): number => {
    let shift = 0;
    for (const entry of shifts) if (offset >= entry.at) shift = entry.delta;
    return offset + shift;
  };
  const ranges = result.highlightedRanges.filter(
    (range) => !edits.some((edit) => range.start < edit.end && range.end > edit.start),
  );
  const trimmedStart = text.length - text.trimStart().length;
  const trimmed = text.trim();
  return {
    text: trimmed,
    ranges: ranges
      .map((range) => ({
        start: map(range.start) - trimmedStart,
        end: map(range.end) - trimmedStart,
      }))
      .filter(
        (range) => range.start >= 0 && range.end <= trimmed.length && range.end > range.start,
      ),
  };
}

/** What the source overlay says it is looking into, by the kind of document that holds the text. */
export function sourceContextKicker(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata'>,
): string {
  if (isIcd11Document(document)) return 'В классификации МКБ-11';
  switch (searchResultDocumentKind(document)) {
    case 'medication':
      return document.sourceType === 'official_drug_instruction'
        ? 'В инструкции к препарату'
        : 'В справочнике по препаратам';
    case 'clinical-recommendation':
      return 'В клинических рекомендациях';
    case 'legal':
      return 'В нормативном акте';
    case 'calculator':
      return 'В описании калькулятора';
    case 'assessment':
      return 'В описании опросника';
    case 'reference':
      return document.sourceType === 'rls_mkb_reference' ? 'В справочнике МКБ-10' : 'В справочнике';
  }
}

/**
 * A source fragment's text for the overlay: a technical card's catalogue labels, empty fields and
 * storage notes dropped as in a result line, the document's own text untouched. Never empty when
 * the source text is not.
 */
export function presentSourceChunkText(text: string, sectionPath: readonly string[]): string {
  const presented = presentResultSnippet({
    snippet: text,
    highlightedRanges: [],
    sectionPath,
  }).text;
  const tidy = presented
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return tidy.length > 0 ? tidy : text;
}

/**
 * What tells one card from another of the same title: the publisher and registration of an
 * instruction, the edition of a recommendation. Shown only on cards whose title repeats.
 */
export function resultQualifier(
  document: Pick<MedicalDocumentSummary, 'sourceType' | 'metadata' | 'versionLabel'> | undefined,
): string | undefined {
  if (!document) return undefined;
  const instruction = instructionSourceInfo({
    sourceType: document.sourceType,
    metadata: document.metadata,
  });
  if (instruction) {
    const parts = [instruction.publisher, instruction.edition].filter((part): part is string =>
      Boolean(part),
    );
    return parts.length > 0 ? parts.join(' · ') : instruction.kindLabel;
  }
  const version = document.versionLabel?.trim();
  return version ? version : undefined;
}

/** Titles that more than one card carries; those cards get a qualifier. */
export function repeatedResultTitles(titles: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const title of titles) {
    if (seen.has(title)) repeated.add(title);
    seen.add(title);
  }
  return repeated;
}

/** A title as written by a person: «( Очаговая пневмония )» loses the space inside its brackets. */
export function tidyResultTitle(title: string): string {
  return title
    .replace(/([([«])\s+/gu, '$1')
    .replace(/\s+([)\]»])/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}
