import type { MedicalDocumentSummary, SearchResult, TextRange } from '@localmed/contracts';
import { isIcd11Document } from '@/features/icd11/icd11-document';
import {
  CLEANED_SECTION_TITLES,
  TECHNICAL_SECTION_TITLES,
} from '@/features/library/document-display';
import { documentVersionLabel } from '@/features/library/document-version-label';
import {
  instructionSourceInfo,
  instructionSourceQualifier,
} from '@/features/medications/instruction-source';
import {
  presentFormStrengths,
  presentRegistryLine,
  substanceWords,
} from '@/features/search/registry-values';
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

const SMNN_CODE = String.raw`\d{2}\.\d{2}\.\d{2}\.\d{3}-\d{6}-\d-\d{5}-\d{13}`;

/**
 * Registry identifiers a drug card's builder wrote into its text: the code of the dosage form
 * («smnnCode: 21.20.10.194-…») and the machine status of the record («Статус записи ЕСКЛП: active»).
 * Nobody reads them, in a result card or in the reader, so they go wherever the text is shown.
 */
const IDENTIFIER_CLAUSES: readonly RegExp[] = [
  new RegExp(`;\\s*s?mnnCode:\\s*${SMNN_CODE}`, 'gu'),
  new RegExp(`\\s*s?mnnCode:\\s*${SMNN_CODE}\\.?`, 'gu'),
  /\s*Статус записи ЕСКЛП: [^\n]*?(?:\.(?=\s|$)|$)/gu,
  // The source's own number of a guideline («654_2»): an identifier, not an edition.
  /\s*Официальный идентификатор: [^\n]*?(?:\.(?=\s|$)|$)/gu,
];

/** A text without the registry identifiers (see {@link IDENTIFIER_CLAUSES}); unchanged when it has none. */
export function dropRegistryIdentifiers(text: string): string {
  let result = text;
  for (const pattern of IDENTIFIER_CLAUSES) result = result.replace(pattern, '');
  return result;
}

/** Catalogue field names in reader words. */
const RENAMED_LABELS: readonly (readonly [string, string])[] = [
  ['Объявленные алиасы:', 'Другие названия:'],
  ['Возрастные категории:', 'Возраст:'],
];

/** The catalogue lists specialties by their slugs («psychiatry, child-psychiatry»). */
const SPECIALTY_SLUGS =
  /(?<=Специальности: )[a-z0-9]+(?:-[a-z0-9]+)*(?:, [a-z0-9]+(?:-[a-z0-9]+)*)*(?=\.|$)/gmu;

/** Any trade-name line of a drug card's generated text: «- ТН: …» up to the end of its line. */
const TRADE_LINE = /(^|\n)- ТН: (?<rest>[^\n]*)/gu;
/** A pointer's compact trade-name line: «Аспинат; форма/дозировка: ТАБЛЕТКИ (500 мг)». */
const POINTER_REST = /^(?<name>[^;]+?); форма\/дозировка: (?<compact>.*)$/u;
/** The long form of that line, as an installed module writes it: «Колдакт. Регистрация: ЛП-1. …». */
const MODULE_REST = /^[^.]+?\.\s+(?:Регистрация|СМНН):/u;
/** A pointer's identity line: «Стандартизированное МНН: РОЗУВАСТАТИН.». */
const SUBSTANCE_IDENTITY = /Стандартизированное МНН: (?<name>[^\n]+?)\.(?=\s|$)/gu;

/**
 * The generated registry text of a drug card in reader words: trade-name lines as «Аспинат —
 * Таблетки, 500 мг» joined by « · » (the text is shown as one paragraph), the identity line as
 * «Действующее вещество: розувастатин.», a dosage the registry does not state left out. A name
 * stays where it was, so a highlight on a trade name survives; the text is generated by the
 * catalogue builder, never the source's own prose.
 */
function registryTextEdits(text: string): readonly SnippetEdit[] {
  const edits: SnippetEdit[] = [];
  for (const match of text.matchAll(TRADE_LINE)) {
    const separator = match[1] ?? '';
    const rest = match.groups?.['rest'] ?? '';
    const lineStart = match.index + separator.length;
    const restStart = lineStart + '- ТН: '.length;
    const prefix: SnippetEdit = {
      start: match.index,
      end: restStart,
      replacement: separator === '' ? '' : ' · ',
    };
    const pointer = POINTER_REST.exec(rest);
    if (pointer) {
      const name = pointer.groups?.['name'] ?? '';
      const details = presentFormStrengths(pointer.groups?.['compact'] ?? '');
      edits.push(prefix, {
        start: restStart + name.length,
        end: restStart + rest.length,
        replacement: details === '' ? '' : ` — ${details}`,
      });
    } else if (MODULE_REST.test(rest)) {
      const presented = presentRegistryLine(`- ТН: ${rest}`);
      edits.push(
        presented === null
          ? prefix
          : {
              start: match.index,
              end: restStart + rest.length,
              replacement: `${separator === '' ? '' : ' · '}${presented.replace(/^\s*[-*]\s+/u, '')}`,
            },
      );
    } else {
      edits.push(prefix);
    }
  }
  for (const match of text.matchAll(SUBSTANCE_IDENTITY)) {
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: `Действующее вещество: ${substanceWords(match.groups?.['name'] ?? '')}.`,
    });
  }
  return edits;
}

function snippetEdits(
  text: string,
  cleaned: boolean,
  registryWords: boolean,
): readonly SnippetEdit[] {
  const edits: SnippetEdit[] = registryWords ? [...registryTextEdits(text)] : [];
  for (const pattern of IDENTIFIER_CLAUSES) {
    for (const match of text.matchAll(pattern)) {
      edits.push({ start: match.index, end: match.index + match[0].length, replacement: '' });
    }
  }
  if (cleaned) {
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
  options: { readonly registryWords?: boolean } = {},
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  const presented = presentCleanedSnippet(result, options.registryWords ?? true);
  const started = tidySnippetStart(presented.text, presented.ranges);
  return tidySnippetEnd(started.text, started.ranges);
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

/**
 * The end of a snippet cut by the core: «…на пе…» ends in the middle of a word. The stub is dropped
 * and the mark stays after the last whole word; a highlight that reached into the stub is shortened
 * to the kept text, one that lay wholly in it is dropped.
 */
export function tidySnippetEnd(
  text: string,
  ranges: readonly TextRange[],
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  if (!/[\p{L}\p{N}]…$/u.test(text)) return { text, ranges };
  const body = text.slice(0, -1);
  const boundary = body.search(/\s\S*$/u);
  if (boundary <= 0) return { text, ranges };
  const kept = body.slice(0, boundary).trimEnd();
  if (kept === '') return { text, ranges };
  return {
    text: `${kept}…`,
    ranges: ranges
      .filter((range) => range.start < kept.length)
      .map((range) => ({ start: range.start, end: Math.min(range.end, kept.length) })),
  };
}

function presentCleanedSnippet(
  result: Pick<SearchResult, 'snippet' | 'highlightedRanges' | 'sectionPath'>,
  registryWords: boolean,
): { readonly text: string; readonly ranges: readonly TextRange[] } {
  const last = result.sectionPath.at(-1);
  const cleaned = last !== undefined && CLEANED_SECTION_TITLES.has(last);
  const source = result.snippet;
  const edits = snippetEdits(source, cleaned, registryWords);
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
  // The overlay keeps the catalogue's own words: the reader links the names in them.
  const presented = presentResultSnippet(
    { snippet: text, highlightedRanges: [], sectionPath },
    { registryWords: false },
  ).text;
  const tidy = presented
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  return tidy.length > 0 ? tidy : text;
}

/**
 * What tells one card from another of the same title: the publisher and registration of an
 * instruction, the edition of a recommendation («ред. 3» for «359_3»; a source's internal
 * identifier is never shown, `documentVersionLabel`). Shown only on cards whose title repeats.
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
    const parts = [instructionSourceQualifier(instruction), instruction.edition].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(' · ') : instruction.kindLabel;
  }
  return documentVersionLabel(document.versionLabel);
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

/**
 * A title for a card header: a trailing «[НАБОР]» marker moves out of the title into `meta` (the
 * header shows it as a small note), and a «+» between active substances may break the line.
 */
export function splitResultTitle(title: string): {
  readonly title: string;
  readonly meta: string | undefined;
} {
  const tidy = tidyResultTitle(title);
  const match = /\s*\[([^\]]{1,24})\]$/u.exec(tidy);
  if (!match || match.index === 0) return { title: tidy, meta: undefined };
  const marker = match[1] ?? '';
  const meta = marker.charAt(0).toLocaleUpperCase('ru') + marker.slice(1).toLocaleLowerCase('ru');
  return { title: tidy.slice(0, match.index).trimEnd(), meta };
}

/** A «+» between active substances is where a long title prefers to break its line. */
export function softBreakPluses(title: string): string {
  return title.replace(/\+(?=\S)/gu, '+\u200B');
}

/** A title as written by a person: «( Очаговая пневмония )» loses the space inside its brackets. */
export function tidyResultTitle(title: string): string {
  return title
    .replace(/([([«])\s+/gu, '$1')
    .replace(/\s+([)\]»])/gu, '$1')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}
