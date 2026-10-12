/**
 * Parser of the Минздрав РФ / ФСС letter of 21.08.2000 № 2510/9362-34, 02-08/10-1977П «Ориентировочные
 * сроки временной нетрудоспособности при наиболее распространенных заболеваниях и травмах (в
 * соответствии с МКБ-10)». The letter is published as 16 monospace box-drawing tables; this module
 * reads them without any I/O so the build script and its tests share it.
 *
 * Nothing is interpreted clinically: a row keeps the letter's code, title, features and period text.
 * Only line wrapping is undone (hyphenated line ends, footnote markers moved into `notes`).
 */

/** Footnote texts of the letter are deduplicated; `notes` fields hold indexes into this list. */
export interface LetterPeriod {
  /** «Фаза распада», «Без осложнения»; empty when the row has none. */
  readonly features: string;
  /** The letter's period text: «9 - 11», «4 - 5 мес.», «35 - 50, МСЭ»; empty when the cell is empty. */
  readonly period: string;
  /** Footnote numbers (per table) found next to the features or the period. */
  readonly notes: readonly number[];
}

export interface LetterEntry {
  readonly code: string;
  /** The code exactly as printed, when `code` differs from it (spaces removed does not count). */
  readonly printedCode: string | null;
  /** Номер строки по форме № 16-ВН, as printed («03, 04»). */
  readonly formLines: string;
  readonly title: string;
  /** Title of the sub-heading row (a single ICD-10 code with its own title) this row sits under. */
  readonly group: string | null;
  readonly periods: readonly LetterPeriod[];
  readonly titleNotes: readonly number[];
  /** Index into `blocks`. */
  readonly block: number;
  /** Table number of the letter (1–16). */
  readonly table: number;
}

export interface LetterBlock {
  /** «A00-A09», as the letter prints the block heading. */
  readonly range: string;
  readonly title: string;
  readonly notes: readonly number[];
  readonly table: number;
}

export interface LetterTable {
  readonly number: number;
  /** Roman numeral of the ICD-10 class the letter names in the table title. */
  readonly classRoman: string;
  readonly title: string;
  /** Footnote number → text. */
  readonly footnotes: Readonly<Record<number, string>>;
}

export interface ParsedLetter {
  readonly tables: readonly LetterTable[];
  readonly blocks: readonly LetterBlock[];
  readonly entries: readonly LetterEntry[];
  /** General paragraphs before Table 1, exactly as printed. */
  readonly preamble: readonly string[];
  /** Problems the parser could not resolve silently; empty for a clean read. */
  readonly warnings: readonly string[];
}

const BLOCK_RANGE = /^[A-Z]\d{2}-[A-Z]\d{2}$/u;
const NOTE_MARKER = /\s*<(\d)>\s*,?/gu;
const CYRILLIC_TO_LATIN: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Т: 'T',
  Х: 'X',
};

/** Compound prefixes that never occur whole inside a line of the letter but are compounds. */
const EXTRA_COMPOUND_PREFIXES: readonly string[] = [
  'обсессивно-',
  'височно-',
  'сердечно-',
  'ладонно-',
  'весенне-',
  'запястно-',
  'двух-',
];

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&amp;': '&',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&(?:lt|gt|quot|nbsp|amp);|&#39;/gu, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * Plain lines of the letter's page: the `<pre>` blocks (the tables) verbatim, every other block of
 * markup as one line. The page chrome before the letter's heading and after the letter is dropped.
 */
export function letterLinesFromHtml(html: string): string[] {
  const start = html.indexOf('<h1');
  const end = html.indexOf('Другие документы по теме');
  if (start < 0 || end < 0 || end < start) throw new Error('letter boundaries not found');
  const region = html.slice(start, end);
  const lines: string[] = [];
  let buffer = '';
  const flush = (): void => {
    for (const piece of decodeEntities(buffer).split('\n')) {
      const text = piece.replace(/\s+/gu, ' ').trim();
      if (text) lines.push(text);
    }
    buffer = '';
  };
  const token = /<pre[^>]*>([\s\S]*?)<\/pre>|<(\/?)(p|div|h\d|br|li|tr)\b[^>]*>|<[^>]+>/giu;
  let last = 0;
  for (const match of region.matchAll(token)) {
    buffer += region.slice(last, match.index);
    last = match.index + match[0].length;
    if (match[1] !== undefined) {
      flush();
      for (const row of decodeEntities(match[1]).split('\n')) {
        if (row.trim()) lines.push(row.replace(/\s+$/u, ''));
      }
    } else if (match[3] !== undefined) {
      flush();
    }
  }
  buffer += region.slice(last);
  flush();
  return lines;
}

function isTableLine(line: string): boolean {
  return /^[┌├└│]/u.test(line);
}

/** A cell's lines → text, with the letter's line-end hyphens undone. */
function joinWrapped(lines: readonly string[], compounds: ReadonlySet<string>): string {
  let text = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!text) {
      text = line;
    } else if (/(?:\s|\d)-$/u.test(text)) {
      text = `${text} ${line}`;
    } else if (/\p{L}-$/u.test(text)) {
      const nextWord = line.split(/[\s,;:)]/u)[0] ?? '';
      const lastWord = text.split(/[\s(]/u).pop() ?? '';
      const compound = `${lastWord}${nextWord}`.toLowerCase();
      text =
        compounds.has(compound) || compounds.has(lastWord.toLowerCase()) || /^\p{Lu}/u.test(line)
          ? `${text}${line}`
          : `${text.slice(0, -1)}${line}`;
    } else {
      text = `${text} ${line}`;
    }
  }
  return text.replace(/\s+/gu, ' ').trim();
}

/** Hyphenated words that occur inside a line (never at its end): real compounds. */
export function inlineCompounds(lines: readonly string[]): Set<string> {
  const compounds = new Set<string>();
  for (const line of lines) {
    if (!isTableLine(line)) continue;
    for (const cell of line.split('│')) {
      for (const match of cell.matchAll(/(\p{L}+-\p{L}+)(?=[\s,;)]|$)/gu)) {
        const word = match[1]?.toLowerCase() ?? '';
        compounds.add(word);
        // A line-end «пузырно-» is a compound when «пузырно-кишечный» occurs whole elsewhere.
        const prefix = word.slice(0, word.indexOf('-') + 1);
        if (prefix.length >= 6) compounds.add(prefix);
      }
    }
  }
  for (const prefix of EXTRA_COMPOUND_PREFIXES) compounds.add(prefix);
  return compounds;
}

/**
 * The code as the letter prints it, made syntactically uniform: no spaces, Latin letters instead of
 * Cyrillic look-alikes, no trailing dot («I63.»), a range closed with its letter («F10-19» → «F10-F19»).
 */
function cleanCode(printed: string): string {
  const compact = [...printed.replace(/\s+/gu, '')]
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join('');
  const range = /^([A-Z])(\d{2})-(\d{2})$/u.exec(compact);
  if (range) return `${range[1] ?? ''}${range[2] ?? ''}-${range[1] ?? ''}${range[3] ?? ''}`;
  return compact.replace(/\.$/u, '');
}

/** True when the three-character category of `code` lies inside the block range. */
export function codeInRange(code: string, range: string): boolean {
  const [low = '', high = low] = range.split('-');
  const category = code.slice(0, 3);
  return category >= low.slice(0, 3) && category <= high.slice(0, 3);
}

function stripNotes(text: string): { readonly text: string; readonly notes: number[] } {
  const notes: number[] = [];
  const cleaned = text.replace(NOTE_MARKER, (_, digit: string) => {
    notes.push(Number(digit));
    return ' ';
  });
  return { text: cleaned.replace(/\s+/gu, ' ').trim(), notes };
}

function columnBoundaries(border: string): number[] {
  const boundaries: number[] = [];
  [...border].forEach((char, index) => {
    if (char === '┌' || char === '┬' || char === '┐') boundaries.push(index);
  });
  return boundaries;
}

/** Cells of one text line, split on its own `│` marks (a widened cell shifts the later columns). */
function cellsOf(line: string): string[] {
  const parts = line.split('│');
  return parts.slice(1, parts.length - 1);
}

interface RowBlock {
  readonly lines: readonly string[];
  readonly merged: boolean;
}

function rowBlocks(tableLines: readonly string[], columns: number): RowBlock[] {
  const blocks: RowBlock[] = [];
  let current: string[] = [];
  const close = (): void => {
    if (current.length === 0) return;
    const counts = new Set(current.map((line) => cellsOf(line).length));
    if (counts.size !== 1) throw new Error(`mixed cell counts in a row: ${current[0] ?? ''}`);
    const count = [...counts][0];
    if (count !== columns && count !== 2) throw new Error(`unexpected cell count ${String(count)}`);
    blocks.push({ lines: current, merged: count === 2 });
    current = [];
  };
  for (const line of tableLines) {
    if (line.startsWith('│')) current.push(line);
    else close();
  }
  close();
  return blocks;
}

/** First lines of the period cell that start a new value: «9 - 11», not «мес.» or «50, МСЭ». */
function periodStarts(periodLines: readonly string[]): number[] {
  const starts: number[] = [];
  let previous = '';
  periodLines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    const continuation = /[-,]$/u.test(previous) || !/^\d/u.test(text);
    if (!continuation || previous === '') starts.push(index);
    previous = text;
  });
  return starts;
}

interface ParseState {
  entries: LetterEntry[];
  blocks: LetterBlock[];
  warnings: string[];
  group: string | null;
}

function pairsOf(
  featureColumns: readonly (readonly string[])[],
  /** Features that hold for the whole row group (Table 16's «Уровень и локализация»). */
  sharedLines: readonly string[],
  periodLines: readonly string[],
  compounds: ReadonlySet<string>,
): LetterPeriod[] {
  const height = periodLines.length;
  const featureRows = Array.from({ length: height }, (_, row) =>
    featureColumns.map((column) => (column[row] ?? '').trim()).join(''),
  );
  const starts = periodStarts(periodLines);
  const segments: { from: number; to: number }[] = [];
  if (starts.length === 0) {
    segments.push({ from: 0, to: height });
  } else {
    const first = starts[0] ?? 0;
    // Text above the first period is a heading («Обострение:») only when the period's own line has
    // features of its own; otherwise the cell is bottom-aligned and the text belongs to that period.
    const heading = first > 0 && (featureRows[first] ?? '') !== '';
    if (heading && featureRows.slice(0, first).some((line) => line !== '')) {
      segments.push({ from: 0, to: first });
    }
    starts.forEach((from, index) => {
      segments.push({ from: index === 0 && !heading ? 0 : from, to: starts[index + 1] ?? height });
    });
  }
  const pairs: LetterPeriod[] = [];
  for (const segment of segments) {
    const slice = (lines: readonly string[]): string[] => lines.slice(segment.from, segment.to);
    const own = stripNotes(
      featureColumns
        .map((column) => joinWrapped(slice(column), compounds))
        .filter((text) => text !== '')
        .join(' '),
    );
    const shared = joinWrapped(sharedLines, compounds);
    // Table 16 prints the level of the injury once for the rows under it: «Тела позвонка, со смещением».
    const features = {
      text:
        shared === '' ? own.text : own.text === '' ? shared : `${shared}, ${lowerFirst(own.text)}`,
      notes: own.notes,
    };
    const period = stripNotes(joinWrapped(slice(periodLines), compounds));
    if (
      features.text === '' &&
      period.text === '' &&
      features.notes.length + period.notes.length === 0
    )
      continue;
    pairs.push({
      features: features.text,
      period: period.text
        .replace(/\s*-\s*/gu, ' - ')
        .replace(/\s*,\s*/gu, (comma) => (comma === ',' ? ',' : ', ')),
      notes: [...new Set([...features.notes, ...period.notes])],
    });
  }
  return pairs;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function parseTable(
  table: number,
  tableLines: readonly string[],
  compounds: ReadonlySet<string>,
  state: ParseState,
): void {
  const top = tableLines[0] ?? '';
  const boundaries = columnBoundaries(top);
  const columns = boundaries.length - 1;
  if (columns < 5) throw new Error(`table ${String(table)}: ${String(columns)} columns`);
  const blocks = rowBlocks(tableLines, columns).slice(2);
  let blockIndex = state.blocks.length - 1;
  let entry: {
    code: string;
    printedCode: string | null;
    formLines: string;
    title: string;
    titleNotes: number[];
    group: string | null;
    periods: LetterPeriod[];
  } | null = null;
  const flush = (): void => {
    if (!entry) return;
    state.entries.push({ ...entry, block: blockIndex, table });
    entry = null;
  };
  for (const [position, block] of blocks.entries()) {
    const context = `table ${String(table)} row ${String(position + 3)}`;
    if (block.merged) {
      flush();
      const first = block.lines.map((line) => cellsOf(line));
      const code = cleanCode(first.map((cells) => cells[0] ?? '').join(''));
      const heading = stripNotes(
        joinWrapped(
          first.map((cells) => cells[1] ?? ''),
          compounds,
        ),
      );
      const current = state.blocks[blockIndex];
      if (BLOCK_RANGE.test(code) || !current || !codeInRange(code, current.range)) {
        state.blocks.push({ range: code, title: heading.text, notes: heading.notes, table });
        blockIndex = state.blocks.length - 1;
        state.group = null;
      } else {
        state.group = heading.text;
      }
      continue;
    }
    const rows = block.lines.map((line) => cellsOf(line));
    const column = (index: number): string[] => rows.map((cells) => cells[index] ?? '');
    const printedCode = column(0).join('').replace(/\s+/gu, '');
    const code = cleanCode(printedCode);
    const periodLines = column(columns - 1);
    // Table 16: the level column is shared by the rows under it, unless the kind column is empty and
    // the level column itself lists the rows («Полулунной», «Головчатой», …).
    const levelIsRows = columns > 5 && column(columns - 2).every((cell) => cell.trim() === '');
    const shared = columns > 5 && !levelIsRows ? column(3) : [];
    const featureColumns = [column(levelIsRows ? 3 : columns - 2)];
    const pairs = pairsOf(featureColumns, shared, periodLines, compounds);
    const title = stripNotes(joinWrapped(column(2), compounds));
    if (code !== '') {
      flush();
      entry = {
        code,
        printedCode: printedCode === code ? null : printedCode,
        formLines: joinWrapped(column(1), compounds),
        title: title.text,
        titleNotes: title.notes,
        group: state.group,
        periods: pairs,
      };
    } else if (entry) {
      if (title.text !== '') state.warnings.push(`${context}: title text in a continuation row`);
      entry.periods.push(...pairs);
    } else {
      state.warnings.push(`${context}: row before any code`);
    }
  }
  flush();
}

function parseFootnotes(lines: readonly string[]): Record<number, string> {
  const notes: Record<number, string> = {};
  for (const line of lines) {
    const match = /^<(\d)>\s*(.+)$/u.exec(line);
    if (match) notes[Number(match[1])] = (match[2] ?? '').trim();
  }
  return notes;
}

export function parseLetterLines(lines: readonly string[]): ParsedLetter {
  const compounds = inlineCompounds(lines);
  const state: ParseState = { entries: [], blocks: [], warnings: [], group: null };
  const tables: LetterTable[] = [];
  const firstTable = lines.findIndex((line) => /^Таблица 1$/u.test(line));
  if (firstTable < 0) throw new Error('Table 1 not found');
  const heading = lines.findIndex((line) =>
    line.startsWith('Экспертиза временной нетрудоспособности проводится'),
  );
  const preamble = lines.slice(heading, firstTable);
  let index = firstTable;
  while (index < lines.length) {
    const label = /^Таблица (\d+)$/u.exec(lines[index] ?? '');
    if (!label) {
      index += 1;
      continue;
    }
    const number = Number(label[1]);
    const titleLines: string[] = [];
    index += 1;
    while (index < lines.length && !isTableLine(lines[index] ?? '')) {
      titleLines.push(lines[index] ?? '');
      index += 1;
    }
    const tableLines: string[] = [];
    while (index < lines.length && isTableLine(lines[index] ?? '')) {
      tableLines.push(lines[index] ?? '');
      index += 1;
    }
    const noteLines: string[] = [];
    while (index < lines.length && !/^Таблица \d+$/u.test(lines[index] ?? '')) {
      noteLines.push(lines[index] ?? '');
      index += 1;
    }
    const title = titleLines.join(' ');
    const classRoman = /класс ([IVX]+) по МКБ-10/u.exec(title)?.[1] ?? '';
    tables.push({ number, classRoman, title, footnotes: parseFootnotes(noteLines) });
    parseTable(number, tableLines, compounds, state);
  }
  return {
    tables,
    blocks: state.blocks,
    entries: state.entries,
    preamble,
    warnings: state.warnings,
  };
}

export function parseLetterHtml(html: string): ParsedLetter {
  return parseLetterLines(letterLinesFromHtml(html));
}
