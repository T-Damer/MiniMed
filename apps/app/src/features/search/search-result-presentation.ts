import type { SearchResult, TextRange } from '@localmed/contracts';
import { TECHNICAL_SECTION_TITLES } from '@/features/library/document-display';

/** How a technical section is named in a result line. */
const TECHNICAL_SECTION_LABELS: Readonly<Record<string, string>> = {
  'Сведения о документе': 'О документе',
  'Сведения МКБ-10': 'МКБ-10',
  'Классификационный контекст': 'Раздел МКБ',
  'Ограничение покрытия': 'О материале',
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

function snippetEdits(text: string): readonly SnippetEdit[] {
  const edits: SnippetEdit[] = [];
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
  if (!isTechnicalResult(result)) {
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
