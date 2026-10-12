/**
 * Builds the sick-leave asset of the ICD-10 cards from the Минздрав РФ / ФСС РФ letter of 21.08.2000
 * № 2510/9362-34, 02-08/10-1977П «Ориентировочные сроки временной нетрудоспособности при наиболее
 * распространенных заболеваниях и травмах (в соответствии с МКБ-10)».
 *
 * Input: the raw page kept under `data/raw/sick-leave-periods-2000/` (see its SOURCE.json). Output:
 * `apps/app/src/features/sick-leave/sick-leave-periods.json`. Rows are the letter's: code, title,
 * features and period text. The only edits are listed in CODE_CORRECTIONS and printed by the script.
 *
 *   bun scripts/build-sick-leave-periods.ts [raw directory]
 *
 * The default raw directory is the main checkout's, because `data/` is not part of a worktree.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  codeInRange,
  type LetterEntry,
  type ParsedLetter,
  parseLetterHtml,
} from './lib/sick-leave-letter';

const DEFAULT_RAW_DIRECTORY = '/Users/d/Projects/Personal/MiniMed/data/raw/sick-leave-periods-2000';
const OUTPUT = 'apps/app/src/features/sick-leave/sick-leave-periods.json';
const EXPECTED_TABLES = 16;
const REFERENCE =
  'Письмо Минздрава России от 21.08.2000 № 2510/9362-34 и ФСС России № 02-08/10-1977П';

/**
 * Codes the letter prints wrongly, fixed where the table block, the title and the neighbouring rows
 * leave no doubt. The printed code stays in the asset (`printedCode`) and in the research note.
 */
const CODE_CORRECTIONS: readonly {
  readonly table: number;
  readonly printed: string;
  readonly code: string;
  readonly reason: string;
}[] = [
  {
    table: 1,
    printed: 'F18.1',
    code: 'A18.1',
    reason:
      'tuberculosis of the genitourinary organs inside block A15-A19, between A18.0 and A18.2',
  },
];

/**
 * Rows whose box-drawing layout puts a feature and its period on different lines, so the generic
 * reading cannot pair them. Each fix is checked against the text the parser produced, so a changed
 * source stops the build instead of being patched silently; the report lists them.
 */
const LAYOUT_FIXES: readonly {
  readonly table: number;
  readonly code: string;
  readonly parsedTitle: string;
  readonly title: string;
  readonly periods: readonly { features: string; period: string; notes: readonly number[] }[];
  readonly reason: string;
}[] = [
  {
    table: 11,
    code: 'K35.0',
    parsedTitle: 'Аппендицит острый с: прободением перитонитом',
    title: 'Аппендицит острый с:',
    periods: [
      { features: 'прободением', period: '26 - 30', notes: [] },
      { features: 'перитонитом', period: '30 - 40', notes: [] },
    ],
    reason: 'the features stand in the title cell, on the lines of their periods',
  },
  {
    table: 16,
    code: 'T22.3',
    parsedTitle:
      'Термический ожог области плечевого пояса и верхней конечности, за исключением запястья и кисти, третьей степени',
    title:
      'Термический ожог области плечевого пояса и верхней конечности, за исключением запястья и кисти, третьей степени',
    periods: [
      { features: 'Без осложнения', period: '40 - 80', notes: [2] },
      { features: 'С осложнением', period: '60 - 100', notes: [2] },
    ],
    reason:
      'the footnote mark <2> takes the line of «С осложнением», so its period starts a line lower',
  },
];

/** Rows the letter itself files outside the range of their block heading (kept as printed). */
const OUT_OF_BLOCK_BY_DESIGN = new Set(['F10-F19']);

const CODE_SHAPE = /^(?:[A-Z]\d{2}(?:\.\d){0,2}|[A-Z]\d{2}\.-|[A-Z]\d{2}-[A-Z]\d{2})$/u;
const PERIOD_SHAPE =
  /^\d+(?:,\d)?(?: - \d+(?:,\d)?)?(?: мес\.)?(?:,? (?:возможно )?МСЭ)?(?: \*)?$/u;

interface SourceFile {
  readonly title: string;
  readonly number: string;
  readonly date: string;
  readonly url: string;
  readonly fetched_at: string;
  readonly sha256: string;
  readonly file: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function correctedCode(entry: LetterEntry): { readonly code: string; readonly printed: string } {
  const fix = CODE_CORRECTIONS.find(
    (item) => item.table === entry.table && item.printed === entry.code,
  );
  if (!fix) return { code: entry.code, printed: entry.printedCode ?? '' };
  return { code: fix.code, printed: entry.printedCode ?? entry.code };
}

function validate(letter: ParsedLetter, entries: readonly { readonly code: string }[]): void {
  if (letter.tables.length !== EXPECTED_TABLES) fail(`${String(letter.tables.length)} tables`);
  if (letter.warnings.length > 0) fail(`parser warnings:\n${letter.warnings.join('\n')}`);
  for (const [index, entry] of letter.entries.entries()) {
    const code = entries[index]?.code ?? '';
    if (!CODE_SHAPE.test(code)) fail(`unexpected code «${code}» (${entry.title})`);
    const block = letter.blocks[entry.block];
    if (!block) fail(`${code} has no block`);
    const category = code.includes('-') && !code.endsWith('.-') ? (code.split('-')[0] ?? '') : code;
    if (!codeInRange(category, block.range) && !OUT_OF_BLOCK_BY_DESIGN.has(code))
      fail(`${code} «${entry.title}» lies outside its block ${block.range}`);
    if (entry.periods.length === 0) fail(`${code} has no periods`);
    if (!entry.periods.some((item) => item.period !== '')) fail(`${code} has no period value`);
    for (const item of entry.periods) {
      if (item.period !== '' && !PERIOD_SHAPE.test(item.period))
        fail(`${code}: unexpected period «${item.period}»`);
    }
  }
}

function sentence(paragraph: string, start: string): string {
  const index = paragraph.indexOf(start);
  if (index < 0) fail(`sentence «${start}» not found`);
  return paragraph.slice(index);
}

const rawDirectory = process.argv[2] ?? DEFAULT_RAW_DIRECTORY;
const source = JSON.parse(readFileSync(join(rawDirectory, 'SOURCE.json'), 'utf8')) as SourceFile;
const html = readFileSync(join(rawDirectory, source.file), 'utf8');
const sha256 = createHash('sha256').update(html).digest('hex');
if (sha256 !== source.sha256) fail(`${source.file} does not match SOURCE.json (${sha256})`);

const letter = parseLetterHtml(html);

const corrected = letter.entries.map(correctedCode);
validate(letter, corrected);

// The paragraph that says the periods are recommendations and when a deviation needs a review.
const advisoryParagraph = letter.preamble.find((line) =>
  line.includes('носят рекомендательный характер'),
);
if (!advisoryParagraph) fail('advisory paragraph not found');
const advisory = sentence(advisoryParagraph, 'Ориентировочные сроки временной утраты').split(
  ' Однако ',
)[0];
const deviation = `Однако ${advisoryParagraph.split(' Однако ')[1] ?? fail('deviation sentence missing')}`;
if (!advisory?.endsWith('характер.')) fail('advisory sentence changed');

// Footnotes are per table in the letter; the asset keeps each distinct text once.
const footnotes: string[] = [];
const footnoteIndex = (table: number, number: number): number => {
  const text = letter.tables.find((item) => item.number === table)?.footnotes[number];
  if (!text) fail(`table ${String(table)} has no footnote <${String(number)}>`);
  const known = footnotes.indexOf(text);
  if (known >= 0) return known;
  footnotes.push(text);
  return footnotes.length - 1;
};
const noteList = (table: number, numbers: readonly number[]): number[] =>
  numbers.map((number) => footnoteIndex(table, number));

const groups: string[] = [];
const groupIndex = (group: string | null): number => {
  if (group === null) return -1;
  const known = groups.indexOf(group);
  if (known >= 0) return known;
  groups.push(group);
  return groups.length - 1;
};

const MISSING_FOOTNOTE_MARK = / ?\*$/u;
const unexplainedMarks: string[] = [];

const appliedFixes = new Set<number>();
const entries = letter.entries.map((entry, index) => {
  const { code, printed } = corrected[index] ?? fail('corrections out of step');
  const fixIndex = LAYOUT_FIXES.findIndex(
    (item) => item.table === entry.table && item.code === code && item.parsedTitle === entry.title,
  );
  const fix = LAYOUT_FIXES[fixIndex];
  if (fix) appliedFixes.add(fixIndex);
  const periods = fix
    ? fix.periods.map((item) => [item.features, item.period, noteList(entry.table, item.notes)])
    : entry.periods.map((item) => {
        let period = item.period;
        if (MISSING_FOOTNOTE_MARK.test(period)) {
          period = period.replace(MISSING_FOOTNOTE_MARK, '');
          unexplainedMarks.push(code);
        }
        return [item.features, period, noteList(entry.table, item.notes)];
      });
  return [
    code,
    fix ? fix.title : entry.title,
    entry.block,
    groupIndex(entry.group),
    periods,
    noteList(entry.table, entry.titleNotes),
    printed,
  ];
});
if (appliedFixes.size !== LAYOUT_FIXES.length)
  fail('a layout fix no longer matches the parsed letter; check LAYOUT_FIXES');

const asset = {
  source: {
    title: source.title,
    reference: REFERENCE,
    date: source.date,
    sha256,
    fetchedAt: source.fetched_at,
    mirror: source.url,
  },
  notes: { advisory, deviation },
  footnotes,
  groups,
  blocks: letter.blocks.map((block) => [
    block.range,
    block.title,
    noteList(block.table, block.notes),
  ]),
  entries,
};

writeFileSync(OUTPUT, `${JSON.stringify(asset)}\n`);
const periodCount = letter.entries.reduce((sum, entry) => sum + entry.periods.length, 0);
console.log(
  `${OUTPUT}: ${String(entries.length)} entries, ${String(letter.blocks.length)} blocks, ${String(periodCount)} period rows, ` +
    `${String(footnotes.length)} footnotes, ${String(JSON.stringify(asset).length)} chars`,
);
for (const fix of LAYOUT_FIXES)
  console.log(`layout fix ${fix.code} (table ${String(fix.table)}): ${fix.reason}`);
for (const fix of CODE_CORRECTIONS)
  console.log(`corrected ${fix.printed} -> ${fix.code}: ${fix.reason}`);
if (unexplainedMarks.length > 0)
  console.log(
    `dropped an unexplained «*» after the period of: ${[...new Set(unexplainedMarks)].join(', ')}`,
  );
