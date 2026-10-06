/**
 * Builds the ICD-10 → ICD-11 asset of the ICD-10 cards from WHO's own release files, which
 * `bun run content:fetch:icd11` keeps under `data/raw/icd11/<release>/`: the two 10 → 11 mapping
 * tables (one category / several categories) and the Russian simple tabulation (titles, chapters).
 * Output: `apps/app/src/features/icd11/icd10-icd11-map.json`. WHO's rows are kept as published —
 * nothing is translated or merged; an ICD-11 title WHO has no Russian text for stays English.
 *
 *   bun scripts/build-icd10-icd11-map.ts [raw directory]
 *
 * The default raw directory is the main checkout's, because `data/` is not part of a worktree.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

import { icd10ChapterOf } from '../apps/app/src/features/icd11/icd10-chapters';

const DEFAULT_RAW_DIRECTORY = '/Users/d/Projects/Personal/MiniMed/data/raw/icd11/2026-01';
const OUTPUT = 'apps/app/src/features/icd11/icd10-icd11-map.json';
const TABULATION_ZIP = 'SimpleTabulation-ICD-11-MMS-ru.zip';
const TABULATION_MEMBER = 'SimpleTabulation-ICD-11-MMS-ru.txt';
const MAPPING_ZIP = 'mapping.zip';
const TABLE_ONE = '10To11MapToOneCategory.txt';
const TABLE_MULTIPLE = '10To11MapToMultipleCategories.txt';
const LINEARIZATION_BASE = 'http://id.who.int/icd/release/11/mms/';
const CATEGORY_CODE = /^[A-Z]\d{2}(?:\.\d+)?$/u;
/**
 * Flag bits of a target: the title is WHO's English one; the target is a block without a code; the
 * tabulation (hence the ICD-11 module) has no card for it, only the mapping table names it.
 */
const FLAG_ENGLISH_TITLE = 1;
const FLAG_BLOCK = 2;
const FLAG_NO_CARD = 4;
const TABULATION_COLUMNS = [
  'Foundation URI',
  'Linearization URI',
  'Code',
  'BlockId',
  'TitleEN',
  'Title',
  'ClassKind',
  'DepthInKind',
  'IsResidual',
  'ChapterNo',
  'BrowserLink',
  'isLeaf',
  'Primary tabulation',
  'Grouping1',
  'Grouping2',
  'Grouping3',
  'Grouping4',
  'Grouping5',
  'CodingNote',
  'Parent',
] as const;

interface Entity {
  readonly entityId: string;
  readonly code: string;
  readonly titleEn: string;
  readonly titleRu: string;
  readonly kind: string;
  readonly chapter: string;
}

interface MappingRow {
  readonly code: string;
  readonly chapter10: string;
  readonly entityId: string | null;
  readonly icd11Code: string;
  readonly kind11: string;
  readonly title11: string;
  readonly chapter11: string;
}

type Ref = number | readonly [number, string];

interface Manifest {
  readonly release: string;
  readonly licence: string;
  readonly files: readonly { readonly name: string; readonly sha256: string }[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function member(zipPath: string, name: string): Promise<Uint8Array> {
  const file = (await JSZip.loadAsync(readFileSync(zipPath))).file(name);
  if (!file) throw new Error(`${zipPath} has no ${name}`);
  return file.async('uint8array');
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/u, '');
}

function quoted(value: string, label: string): string {
  if (!value) return '';
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"'))
    throw new Error(`${label}: title is not a quoted field`);
  return value.slice(1, -1).replaceAll('""', '"');
}

/** WHO prefixes a title with one dash per depth level. */
function cleanTitle(value: string, label: string): string {
  return quoted(value, label)
    .replace(/^(?:- )+/u, '')
    .trim();
}

/** WHO's CRLF tab file; a coding note may itself contain line breaks (the Python preparer does the same). */
function parseTabulation(text: string): Entity[] {
  const lines = text.split('\r\n');
  const header = (lines[0] ?? '').split('\t');
  if (TABULATION_COLUMNS.some((name, index) => header[index] !== name))
    throw new Error(`Unexpected tabulation columns: ${header.join('|')}`);
  const entities: Entity[] = [];
  let buffer: string | null = null;
  let start = 0;
  for (const [index, line] of lines.slice(1).entries()) {
    const number = index + 2;
    if (buffer === null) {
      if (!line) continue;
      buffer = line;
      start = number;
    } else {
      buffer = `${buffer}\n${line}`;
    }
    if (buffer.split('\t').length - 1 < TABULATION_COLUMNS.length - 1) continue;
    const fields = buffer.split('\t');
    buffer = null;
    if (fields.length !== TABULATION_COLUMNS.length)
      throw new Error(`Tabulation line ${String(start)}: unexpected field count`);
    const uri = fields[1] ?? '';
    if (!uri.startsWith(LINEARIZATION_BASE))
      throw new Error(`Tabulation line ${String(start)}: unexpected URI ${uri}`);
    const label = `tabulation line ${String(start)}`;
    entities.push({
      entityId: uri.slice(LINEARIZATION_BASE.length),
      code: fields[2] ?? '',
      titleEn: cleanTitle(fields[4] ?? '', label),
      titleRu: cleanTitle(fields[5] ?? '', label),
      kind: fields[6] ?? '',
      chapter: fields[9] ?? '',
    });
  }
  if (buffer !== null) throw new Error(`Tabulation: unterminated record at line ${String(start)}`);
  return entities;
}

function column(header: readonly string[], ...names: string[]): number {
  const lowered = header.map((cell) => cell.trim().toLowerCase());
  for (const name of names) {
    const found = lowered.indexOf(name.toLowerCase());
    if (found >= 0) return found;
  }
  throw new Error(`Mapping table has none of the columns ${names.join(', ')}: ${header.join('|')}`);
}

/** The category rows of a 10 → 11 table: WHO's «category» ICD-10 class kind with an «A00.0» code. */
function parseMapping(text: string, table: string): MappingRow[] {
  const [headerLine, ...lines] = text.replace(/^﻿/u, '').split('\n');
  const header = (headerLine ?? '').replace(/\r$/u, '').split('\t');
  const kind10 = column(header, '10ClassKind');
  const code10 = column(header, 'icd10Code');
  const chapter10 = column(header, 'icd10Chapter');
  const uri = column(header, 'Linearization (release) URI', 'Linearization (releaseURI)');
  const code11 = column(header, 'icd11Code');
  const kind11 = column(header, '11ClassKind');
  const title11 = column(header, 'icd11Title');
  const chapter11 = column(header, 'icd11Chapter');
  const rows: MappingRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.replace(/\r$/u, '').split('\t');
    if (cells[kind10] !== 'category') continue;
    const code = cells[code10] ?? '';
    if (!CATEGORY_CODE.test(code)) throw new Error(`${table}: unexpected ICD-10 code ${code}`);
    const target = cells[uri] ?? '';
    const marker = target.indexOf('/mms/');
    rows.push({
      code,
      chapter10: cells[chapter10] ?? '',
      entityId: marker < 0 ? null : target.slice(marker + '/mms/'.length),
      icd11Code: cells[code11] ?? '',
      kind11: cells[kind11] ?? '',
      title11: cells[title11] ?? '',
      chapter11: cells[chapter11] ?? '',
    });
  }
  return rows;
}

function codeOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const rawDirectory = process.argv[2] ?? DEFAULT_RAW_DIRECTORY;
const manifest = JSON.parse(readFileSync(join(rawDirectory, 'MANIFEST.json'), 'utf8')) as Manifest;
const recorded = new Map(manifest.files.map((file) => [file.name, file.sha256]));
for (const name of [TABULATION_ZIP, MAPPING_ZIP]) {
  if (recorded.get(name) !== sha256(readFileSync(join(rawDirectory, name))))
    throw new Error(`${name}: SHA-256 differs from the manifest`);
}

const entities = parseTabulation(
  decode(await member(join(rawDirectory, TABULATION_ZIP), TABULATION_MEMBER)),
);
const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
if (byId.size !== entities.length) throw new Error('Duplicate linearization URI in the tabulation');
const byCode = new Map(entities.filter((entity) => entity.code).map((e) => [e.code, e]));

const mappingZip = join(rawDirectory, MAPPING_ZIP);
const oneRows = parseMapping(decode(await member(mappingZip, TABLE_ONE)), TABLE_ONE);
const multipleRows = parseMapping(decode(await member(mappingZip, TABLE_MULTIPLE)), TABLE_MULTIPLE);

// --- targets: every ICD-11 entity a row points at, numbered in code order -------------------------
// A few WHO rows point at ICD-11 blocks the simple tabulation does not list: the mapping row is the
// only source of their title (English) and chapter, and there is no ICD-11 card to open.
const noCard = new Map<string, Entity>();
for (const row of [...oneRows, ...multipleRows]) {
  if (row.entityId === null || byId.has(row.entityId)) continue;
  if (row.kind11 !== 'block' || row.icd11Code)
    throw new Error(`${row.code}: ${row.entityId} is not in the tabulation and is not a block`);
  const known = noCard.get(row.entityId);
  if (known && (known.titleEn !== row.title11 || known.chapter !== row.chapter11))
    throw new Error(`${row.entityId} is described in two ways by the mapping tables`);
  noCard.set(row.entityId, {
    entityId: row.entityId,
    code: '',
    titleEn: row.title11,
    titleRu: '',
    kind: 'block',
    chapter: row.chapter11,
  });
}
const targetEntities = new Map([...byId, ...noCard]);
const targetIds = new Set<string>();
for (const row of [...oneRows, ...multipleRows])
  if (row.entityId !== null) targetIds.add(row.entityId);
const sortedTargets = [...targetIds]
  .map((id) => targetEntities.get(id) as Entity)
  .sort((a, b) => codeOrder(a.code || `~${a.entityId}`, b.code || `~${b.entityId}`));
const targetIndex = new Map(sortedTargets.map((entity, index) => [entity.entityId, index]));

function toRef(row: MappingRow): Ref | null {
  if (row.entityId === null) return null;
  const index = targetIndex.get(row.entityId) as number;
  const entity = targetEntities.get(row.entityId) as Entity;
  const clustered = /[&/]/u.test(row.icd11Code);
  if (clustered) {
    const stem = row.icd11Code.split(/[&/]/u)[0] ?? '';
    if (!entity.code || stem !== entity.code)
      throw new Error(`${row.code}: cluster ${row.icd11Code} does not start with ${entity.code}`);
    return [index, row.icd11Code];
  }
  if (entity.kind === 'category' && row.icd11Code !== entity.code)
    throw new Error(`${row.code}: ${row.icd11Code} differs from the target's code ${entity.code}`);
  if (entity.kind !== 'category' && row.icd11Code)
    throw new Error(`${row.code}: block target with the code ${row.icd11Code}`);
  return index;
}

function refKey(ref: Ref): string {
  return typeof ref === 'number' ? String(ref) : `${String(ref[0])}|${ref[1]}`;
}

// --- per-code rows --------------------------------------------------------------------------------
const one = new Map<string, Ref>();
const multiple = new Map<string, Ref[]>();
const chapters10 = new Map<string, string>();
for (const row of oneRows) {
  chapters10.set(row.code, row.chapter10);
  const ref = toRef(row);
  if (ref === null) continue;
  if (one.has(row.code)) throw new Error(`${row.code} appears twice in ${TABLE_ONE}`);
  one.set(row.code, ref);
}
for (const row of multipleRows) {
  chapters10.set(row.code, row.chapter10);
  const ref = toRef(row);
  if (ref === null) continue;
  const list = multiple.get(row.code) ?? [];
  if (list.some((existing) => refKey(existing) === refKey(ref)))
    throw new Error(`${row.code} lists ${refKey(ref)} twice in ${TABLE_MULTIPLE}`);
  list.push(ref);
  multiple.set(row.code, list);
}

// The app derives the ICD-10 chapter from the code; WHO's own column must agree for every row.
const chapterMismatches = [...chapters10].filter(
  ([code, chapter]) => icd10ChapterOf(code) !== chapter,
);
if (chapterMismatches.length > 0)
  throw new Error(
    `ICD-10 chapter ranges disagree with WHO for ${chapterMismatches
      .slice(0, 5)
      .map(([code, chapter]) => `${code} (${chapter})`)
      .join(', ')}`,
  );

// `multiple` repeats the one-category answer for most codes; only a different answer is stored.
const multipleOnly: Record<string, Ref[]> = {};
for (const code of [...new Set([...one.keys(), ...multiple.keys()])].sort(codeOrder)) {
  const own = one.get(code);
  const list = multiple.get(code);
  if (!list) continue;
  const same = own !== undefined && list.length === 1 && refKey(list[0] as Ref) === refKey(own);
  if (!same) multipleOnly[code] = list;
}

// --- titles of the parts of postcoordinated clusters («1A00&XN8P1») ----------------------------------
function title(entity: Entity): [string, number] {
  return entity.titleRu ? [entity.titleRu, 0] : [entity.titleEn, FLAG_ENGLISH_TITLE];
}
const parts: Record<string, [string, number]> = {};
for (const ref of [...one.values(), ...Object.values(multipleOnly).flat()]) {
  if (typeof ref === 'number') continue;
  for (const part of ref[1].split(/[&/]/u)) {
    const entity = byCode.get(part);
    if (!entity) throw new Error(`Cluster part ${part} has no tabulation row`);
    parts[part] = title(entity);
  }
}

const targets = sortedTargets.map((entity) => {
  const [text, english] = title(entity);
  const flags =
    english |
    (entity.kind === 'category' ? 0 : FLAG_BLOCK) |
    (noCard.has(entity.entityId) ? FLAG_NO_CARD : 0);
  return [entity.entityId, entity.code, text, flags, entity.chapter];
});
const usedChapters = new Set(sortedTargets.map((entity) => entity.chapter));
const chapterTitles: Record<string, string> = {};
for (const entity of entities) {
  if (entity.kind === 'chapter' && usedChapters.has(entity.chapter)) {
    chapterTitles[entity.chapter] = entity.titleRu || entity.titleEn;
  }
}
for (const chapter of usedChapters)
  if (!(chapter in chapterTitles)) throw new Error(`ICD-11 chapter ${chapter} has no title`);

// --- report -----------------------------------------------------------------------------------------
const tabulationSha = recorded.get(TABULATION_ZIP) as string;
const mappingSha = recorded.get(MAPPING_ZIP) as string;
const asset = {
  source: 'Таблицы соответствия ВОЗ МКБ-10 ↔ МКБ-11 и русская версия МКБ-11 (MMS), ВОЗ',
  citation: `Таблицы соответствия ВОЗ МКБ-10 ↔ МКБ-11, выпуск ${manifest.release}`,
  licence: manifest.licence,
  release: manifest.release,
  files: {
    [MAPPING_ZIP]: mappingSha,
    [TABULATION_ZIP]: tabulationSha,
  },
  tables: { one: TABLE_ONE, multiple: TABLE_MULTIPLE },
};

const sortedCodes = [...one.keys()].sort(codeOrder);
const lines: string[] = ['{'];
for (const [key, value] of Object.entries(asset)) {
  lines.push(`${JSON.stringify(key)}:${JSON.stringify(value)},`);
}
lines.push(`"chapters":${JSON.stringify(chapterTitles)},`);
lines.push(`"parts":${JSON.stringify(parts)},`);
lines.push('"targets":[');
lines.push(targets.map((target) => JSON.stringify(target)).join(',\n'));
lines.push('],');
lines.push('"one":{');
lines.push(
  sortedCodes.map((code) => `${JSON.stringify(code)}:${JSON.stringify(one.get(code))}`).join(',\n'),
);
lines.push('},');
lines.push('"multiple":{');
lines.push(
  Object.entries(multipleOnly)
    .map(([code, refs]) => `${JSON.stringify(code)}:${JSON.stringify(refs)}`)
    .join(',\n'),
);
lines.push('}');
lines.push('}');
const text = `${lines.join('\n')}\n`;
JSON.parse(text);
writeFileSync(OUTPUT, text);

const clusters = [...one.values(), ...Object.values(multipleOnly).flat()].filter(
  (ref) => typeof ref !== 'number',
).length;
const answered = new Set([...one.keys(), ...multiple.keys()]);
const unanswered = [...new Set(chapters10.keys())].filter((code) => !answered.has(code));
const english = targets.filter((target) => Number(target[3]) & FLAG_ENGLISH_TITLE).length;
const blocks = targets.filter((target) => Number(target[3]) & FLAG_BLOCK).length;
console.log(
  `${OUTPUT}: ${String(answered.size)} ICD-10 codes with a target (${String(unanswered.length)} without), ` +
    `${String(targets.length)} ICD-11 targets (${String(english)} English-only titles, ` +
    `${String(blocks)} blocks, ${String(noCard.size)} without a card), ` +
    `${String(Object.keys(multipleOnly).length)} codes whose multiple-category answer differs, ` +
    `${String(clusters)} cluster rows, ${String(text.length)} chars, release ${manifest.release}`,
);
