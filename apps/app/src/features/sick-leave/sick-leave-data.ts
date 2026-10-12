import { normalizeIcd10Code } from '@/features/icd11/icd10-icd11-map';

/**
 * The letter «Ориентировочные сроки временной нетрудоспособности …» (Минздрав РФ № 2510/9362-34,
 * ФСС РФ № 02-08/10-1977П, 21.08.2000) as a lazy asset (`sick-leave-periods.json`, built by
 * `scripts/build-sick-leave-periods.ts`). Rows keep the letter's wording; nothing is recalculated.
 */

/** `[features, period text, footnote indexes]`; an empty period makes the row a sub-heading. */
export type SickLeavePeriodRow = readonly [string, string, readonly number[]];

/**
 * `[code as used for matching, title, block index, group index (-1: none), period rows, title footnote
 * indexes, code as printed when it differs («F18.1»), else «»]`.
 */
export type SickLeaveEntryRow = readonly [
  string,
  string,
  number,
  number,
  readonly SickLeavePeriodRow[],
  readonly number[],
  string,
];

export interface SickLeaveData {
  readonly source: {
    readonly title: string;
    readonly reference: string;
    readonly date: string;
  };
  readonly notes: { readonly advisory: string; readonly deviation: string };
  readonly footnotes: readonly string[];
  readonly groups: readonly string[];
  /** `[range, title, footnote indexes]`. */
  readonly blocks: readonly (readonly [string, string, readonly number[]])[];
  readonly entries: readonly SickLeaveEntryRow[];
}

export interface SickLeavePeriod {
  readonly features: string;
  readonly period: string;
  readonly footnotes: readonly string[];
}

export interface SickLeaveEntry {
  readonly code: string;
  readonly title: string;
  /** Sub-heading the letter files the row under («Туберкулез легких, подтвержденный …»). */
  readonly group: string | null;
  readonly blockRange: string;
  readonly periods: readonly SickLeavePeriod[];
  readonly footnotes: readonly string[];
}

export interface SickLeaveResult {
  /** The ICD-10 code of the card the entries were found for. */
  readonly code: string;
  readonly entries: readonly SickLeaveEntry[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shape check of the bundled asset; the build script verifies its content row by row. */
export function parseSickLeaveData(value: unknown): SickLeaveData {
  if (
    !isRecord(value) ||
    !isRecord(value['source']) ||
    typeof value['source']['reference'] !== 'string' ||
    typeof value['source']['title'] !== 'string' ||
    typeof value['source']['date'] !== 'string' ||
    !isRecord(value['notes']) ||
    typeof value['notes']['advisory'] !== 'string' ||
    typeof value['notes']['deviation'] !== 'string' ||
    !Array.isArray(value['footnotes']) ||
    !Array.isArray(value['groups']) ||
    !Array.isArray(value['blocks']) ||
    !Array.isArray(value['entries'])
  )
    throw new Error('Sick-leave asset has an unexpected shape');
  for (const entry of value['entries'] as unknown[]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 7 ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'string' ||
      typeof entry[2] !== 'number' ||
      typeof entry[3] !== 'number' ||
      !Array.isArray(entry[4])
    )
      throw new Error('Sick-leave asset has a malformed entry');
  }
  return value as unknown as SickLeaveData;
}

type CodeKind = 'range' | 'wildcard' | 'category' | 'exact';

interface IndexedEntry {
  readonly index: number;
  readonly kind: CodeKind;
  /** The part of the code a card code has to share a prefix with. */
  readonly base: string;
  /** For a range: first and last three-character category. */
  readonly low: string;
  readonly high: string;
}

const RANGE_CODE = /^([A-Z]\d{2})-([A-Z]\d{2})$/u;

/** «S02.0.0» (closed fracture) and «M42.1.2» carry a last digit the ICD-10 code itself does not. */
function indexEntry(code: string, index: number): IndexedEntry {
  const range = RANGE_CODE.exec(code);
  if (range) return { index, kind: 'range', base: code, low: range[1] ?? '', high: range[2] ?? '' };
  if (code.endsWith('.-'))
    return { index, kind: 'wildcard', base: code.slice(0, 3), low: '', high: '' };
  if (code.length === 3) return { index, kind: 'category', base: code, low: '', high: '' };
  const segments = code.split('.');
  const base = segments.length > 2 ? segments.slice(0, 2).join('.') : code;
  return { index, kind: 'exact', base, low: '', high: '' };
}

const indexCache = new WeakMap<SickLeaveData, ReadonlyMap<string, readonly IndexedEntry[]>>();

/** Entries by the three-character category they can match; a range is listed under each category. */
function indexOf(data: SickLeaveData): ReadonlyMap<string, readonly IndexedEntry[]> {
  const cached = indexCache.get(data);
  if (cached) return cached;
  const map = new Map<string, IndexedEntry[]>();
  const put = (category: string, item: IndexedEntry): void => {
    const list = map.get(category) ?? [];
    list.push(item);
    map.set(category, list);
  };
  data.entries.forEach((row, index) => {
    const item = indexEntry(row[0], index);
    if (item.kind !== 'range') {
      put(item.base.slice(0, 3), item);
      return;
    }
    // «F04-F06» → F04, F05, F06; the letter's ranges stay inside one letter.
    const letter = item.low.slice(0, 1);
    for (let number = Number(item.low.slice(1)); number <= Number(item.high.slice(1)); number += 1)
      put(`${letter}${String(number).padStart(2, '0')}`, item);
  });
  indexCache.set(data, map);
  return map;
}

function matches(item: IndexedEntry, code: string): boolean {
  switch (item.kind) {
    case 'range':
    case 'wildcard':
    case 'category':
      return true;
    case 'exact':
      // The card is the entry's code or a more exact one, or the card is the category above it.
      return code.startsWith(item.base) || item.base.startsWith(code);
  }
}

function toEntry(data: SickLeaveData, row: SickLeaveEntryRow): SickLeaveEntry {
  const note = (indexes: readonly number[]): string[] =>
    indexes.flatMap((index) => data.footnotes[index] ?? []);
  return {
    code: row[0],
    title: row[1],
    group: data.groups[row[3]] ?? null,
    blockRange: data.blocks[row[2]]?.[0] ?? '',
    periods: row[4].map(([features, period, notes]) => ({
      features,
      period,
      footnotes: note(notes),
    })),
    footnotes: note(row[5]),
  };
}

/** The letter's rows for one ICD-10 code (exact, by `X.-`, by a range or below a category card). */
export function sickLeaveForCode(data: SickLeaveData, value: string): SickLeaveResult | null {
  const code = normalizeIcd10Code(value);
  if (code === null) return null;
  const candidates = indexOf(data).get(code.slice(0, 3)) ?? [];
  const entries = candidates
    .filter((item) => matches(item, code))
    .map((item) => data.entries[item.index])
    .filter((row): row is SickLeaveEntryRow => row !== undefined)
    .map((row) => toEntry(data, row));
  return entries.length === 0 ? null : { code, entries };
}

let dataPromise: Promise<SickLeaveData> | null = null;

/** The asset is a separate chunk read on first use. */
export function loadSickLeaveData(): Promise<SickLeaveData> {
  dataPromise ??= import('@/features/sick-leave/sick-leave-periods.json?raw').then((module) =>
    parseSickLeaveData(JSON.parse(module.default)),
  );
  return dataPromise;
}

/** Results for every distinct code of a card, in the order of the codes; codes without rows drop out. */
export async function sickLeaveForCodes(codes: readonly string[]): Promise<SickLeaveResult[]> {
  const normalized = [...new Set(codes.flatMap((code) => normalizeIcd10Code(code) ?? []))];
  if (normalized.length === 0) return [];
  const data = await loadSickLeaveData();
  return normalized.flatMap((code) => sickLeaveForCode(data, code) ?? []);
}

/** The asset with the results for a card's codes, so a panel needs one load; null for no code. */
export async function sickLeaveForCard(
  codes: readonly string[],
): Promise<{ readonly letter: SickLeaveData; readonly results: SickLeaveResult[] } | null> {
  const normalized = [...new Set(codes.flatMap((code) => normalizeIcd10Code(code) ?? []))];
  if (normalized.length === 0) return null;
  const letter = await loadSickLeaveData();
  return {
    letter,
    results: normalized.flatMap((code) => sickLeaveForCode(letter, code) ?? []),
  };
}
