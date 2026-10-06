import { normalizeIcd10Lookalikes } from '@localmed/search-lexical';

import { ICD10_CHAPTER_HOME_ICD11, icd10ChapterOf } from '@/features/icd11/icd10-chapters';
import { ICD11_DOCUMENT_PREFIX } from '@/features/icd11/icd11-document';
import { pluralRu } from '@/i18n/labels';

/**
 * WHO's ICD-10 → ICD-11 mapping tables as a bundled asset (`icd10-icd11-map.json`, built by
 * `scripts/build-icd10-icd11-map.ts`). The rows are WHO's: nothing is translated or merged, an ICD-11
 * title WHO has no Russian text for stays English and is marked. The labels below are derived
 * deterministically from those rows and say nothing about clinical meaning.
 */

/** A target: an index into `targets`, or that index with the postcoordinated cluster WHO gives. */
export type Icd10Icd11Ref = number | readonly [number, string];

/** `[entity id, ICD-11 code («» for a block), title, flags, ICD-11 chapter]`. */
export type Icd10Icd11TargetRow = readonly [string, string, string, number, string];

const FLAG_ENGLISH_TITLE = 1;
const FLAG_BLOCK = 2;
const FLAG_NO_CARD = 4;

export interface Icd10Icd11Data {
  readonly citation: string;
  readonly release: string;
  readonly tables: { readonly one: string; readonly multiple: string };
  readonly chapters: Readonly<Record<string, string>>;
  readonly parts: Readonly<Record<string, readonly [string, number]>>;
  readonly targets: readonly Icd10Icd11TargetRow[];
  /** The «одна категория» table: one target per ICD-10 code. */
  readonly one: Readonly<Record<string, Icd10Icd11Ref>>;
  /** The «несколько категорий» table, only for codes where it says more than `one` does. */
  readonly multiple: Readonly<Record<string, readonly Icd10Icd11Ref[]>>;
}

export interface Icd11ClusterPart {
  readonly code: string;
  readonly title: string;
  readonly titleLanguage: 'ru' | 'en';
}

export interface Icd11Target {
  /** ICD-11 code; null when WHO's row names a block, which has no code. */
  readonly code: string | null;
  /** Code with extension codes, «1A00&XN8P1», when WHO maps to a postcoordinated cluster. */
  readonly cluster: string | null;
  /** The cluster's codes after the stem, with WHO's titles. */
  readonly clusterParts: readonly Icd11ClusterPart[];
  readonly title: string;
  /** `en` when the Russian version of the classification has no title for it. */
  readonly titleLanguage: 'ru' | 'en';
  readonly kind: 'category' | 'block';
  /** ICD-11 chapter number as WHO writes it («08», «X»). */
  readonly chapter: string;
  readonly chapterTitle: string;
  /** Card of the ICD-11 module; null when WHO's tabulation lists no card for this block. */
  readonly documentId: string | null;
}

export type Icd10Icd11LabelId =
  | 'single'
  | 'split'
  | 'merged'
  | 'cluster'
  | 'other-chapter'
  | 'tables-differ';

export interface Icd10Icd11Label {
  readonly id: Icd10Icd11LabelId;
  readonly text: string;
  readonly hint: string;
}

export interface Icd10Icd11Result {
  readonly icd10Code: string;
  /** Roman numeral of the code's ICD-10 chapter. */
  readonly icd10Chapter: string;
  readonly release: string;
  /** The citation line WHO's licence asks to keep next to the tables. */
  readonly citation: string;
  /** What the «одна категория» table says; null when it has no row for the code. */
  readonly oneCategory: Icd11Target | null;
  /** What the «несколько категорий» table says (always at least one rubric). */
  readonly multipleCategories: readonly Icd11Target[];
  /** The two tables give the same single answer, so they are shown as one. */
  readonly tablesAgree: boolean;
  /** The «одна категория» answer is not among the «несколько категорий» ones. */
  readonly tablesConflict: boolean;
  /** Distinct targets of both tables, the «одна категория» one first. */
  readonly all: readonly Icd11Target[];
  /** Other ICD-10 codes that WHO's tables map to the same ICD-11 target, in code order. */
  readonly mergedWith: readonly string[];
  readonly labels: readonly Icd10Icd11Label[];
}

const CATEGORY_CODE = /^[A-Z]\d{2}(?:\.\d+)?$/u;

/**
 * «G40.9» for «g40.9», «Г40.9» typed with Cyrillic lookalikes or a dagger/asterisk; null for a range
 * («G40-G47»), a block, or anything that is not a single ICD-10 category.
 */
export function normalizeIcd10Code(value: string): string | null {
  const compact = normalizeIcd10Lookalikes(value.replace(/\s+/gu, ''))
    .replace(/[†*‡]+$/u, '')
    .toUpperCase();
  return CATEGORY_CODE.test(compact) ? compact : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shape check of the bundled asset; the build script verifies its content row by row. */
export function parseIcd10Icd11Data(value: unknown): Icd10Icd11Data {
  if (
    !isRecord(value) ||
    typeof value['citation'] !== 'string' ||
    typeof value['release'] !== 'string' ||
    !isRecord(value['tables']) ||
    typeof value['tables']['one'] !== 'string' ||
    typeof value['tables']['multiple'] !== 'string' ||
    !isRecord(value['chapters']) ||
    !isRecord(value['parts']) ||
    !Array.isArray(value['targets']) ||
    !isRecord(value['one']) ||
    !isRecord(value['multiple'])
  )
    throw new Error('ICD-10 → ICD-11 asset has an unexpected shape');
  return value as unknown as Icd10Icd11Data;
}

function target(data: Icd10Icd11Data, ref: Icd10Icd11Ref): Icd11Target {
  const index = typeof ref === 'number' ? ref : ref[0];
  const cluster = typeof ref === 'number' ? null : ref[1];
  const row = data.targets[index];
  if (!row) throw new Error(`ICD-10 → ICD-11 asset has no target ${String(index)}`);
  const [entityId, code, title, flags, chapter] = row;
  const stem = cluster?.split(/[&/]/u)[0];
  return {
    code: code || null,
    cluster,
    clusterParts: (cluster?.split(/[&/]/u) ?? [])
      .filter((part) => part !== stem)
      .map((part) => {
        const known = data.parts[part];
        return {
          code: part,
          title: known?.[0] ?? '',
          titleLanguage: known && (known[1] & FLAG_ENGLISH_TITLE) !== 0 ? 'en' : 'ru',
        };
      }),
    title,
    titleLanguage: (flags & FLAG_ENGLISH_TITLE) !== 0 ? 'en' : 'ru',
    kind: (flags & FLAG_BLOCK) !== 0 ? 'block' : 'category',
    chapter,
    chapterTitle: data.chapters[chapter] ?? '',
    documentId:
      (flags & FLAG_NO_CARD) !== 0
        ? null
        : `${ICD11_DOCUMENT_PREFIX}${entityId.replaceAll('/', '.')}`,
  };
}

function refKey(ref: Icd10Icd11Ref): string {
  return typeof ref === 'number' ? String(ref) : `${String(ref[0])}|${ref[1]}`;
}

/** The refs of the «несколько категорий» table for a code, whose rows repeat `one` unless stored. */
function multipleRefs(data: Icd10Icd11Data, code: string): readonly Icd10Icd11Ref[] {
  const stored = data.multiple[code];
  if (stored) return stored;
  const single = data.one[code];
  return single === undefined ? [] : [single];
}

const reverseIndexes = new WeakMap<Icd10Icd11Data, ReadonlyMap<string, readonly string[]>>();

/** Target → ICD-10 codes whose WHO rows (either table) name it, in code order. */
function reverseIndex(data: Icd10Icd11Data): ReadonlyMap<string, readonly string[]> {
  const cached = reverseIndexes.get(data);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const code of [
    ...new Set([...Object.keys(data.one), ...Object.keys(data.multiple)]),
  ].sort()) {
    const refs = [
      ...(data.one[code] === undefined ? [] : [data.one[code]]),
      ...multipleRefs(data, code),
    ];
    for (const key of new Set(refs.map((ref) => refKey(ref)))) {
      const list = index.get(key);
      if (list) list.push(code);
      else index.set(key, [code]);
    }
  }
  reverseIndexes.set(data, index);
  return index;
}

/** A parent or child category shares its target by construction; that is not a merge. */
function isRelatedCode(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

function labels(input: {
  readonly oneCategory: Icd11Target | null;
  readonly multiple: readonly Icd11Target[];
  readonly tablesAgree: boolean;
  readonly tablesConflict: boolean;
  readonly mergedWith: readonly string[];
  readonly icd10Chapter: string;
  readonly all: readonly Icd11Target[];
}): readonly Icd10Icd11Label[] {
  const result: Icd10Icd11Label[] = [];
  const clustered = input.all.some((item) => item.cluster !== null);
  if (input.multiple.length > 1) {
    const count = input.multiple.length;
    result.push({
      id: 'split',
      text: `разделено на ${String(count)} ${pluralRu(count, 'рубрику', 'рубрики', 'рубрик')}`,
      hint: 'Таблица ВОЗ «несколько категорий» относит этот код МКБ-10 к нескольким рубрикам МКБ-11.',
    });
  } else if (input.tablesAgree && !clustered) {
    result.push({
      id: 'single',
      text: 'одна рубрика',
      hint: 'Обе таблицы ВОЗ относят этот код МКБ-10 к одной рубрике МКБ-11.',
    });
  }
  if (input.tablesConflict) {
    result.push({
      id: 'tables-differ',
      text: 'таблицы ВОЗ различаются',
      hint: 'Таблицы «одна категория» и «несколько категорий» указывают для этого кода разные рубрики МКБ-11.',
    });
  }
  if (clustered) {
    result.push({
      id: 'cluster',
      text: 'кластер с уточняющими кодами',
      hint: 'ВОЗ соотносит код с рубрикой МКБ-11 вместе с уточняющими (расширяющими) кодами.',
    });
  }
  if (input.mergedWith.length > 0) {
    result.push({
      id: 'merged',
      text: 'объединено с другими кодами МКБ-10',
      hint: 'Таблицы ВОЗ относят к этой же рубрике МКБ-11 и другие коды МКБ-10.',
    });
  }
  const home = ICD10_CHAPTER_HOME_ICD11[input.icd10Chapter] ?? [];
  if (input.all.some((item) => !home.includes(item.chapter))) {
    result.push({
      id: 'other-chapter',
      text: 'другая глава',
      hint: 'Рубрика МКБ-11 находится в главе, которая не соответствует по теме главе МКБ-10 этого кода.',
    });
  }
  return result;
}

/** What WHO's tables say about one ICD-10 code; null for an unknown code, range or block. */
export function icd10ToIcd11(data: Icd10Icd11Data, value: string): Icd10Icd11Result | null {
  const code = normalizeIcd10Code(value);
  if (code === null) return null;
  const one = data.one[code];
  const multipleList = multipleRefs(data, code);
  if (one === undefined && multipleList.length === 0) return null;
  const icd10Chapter = icd10ChapterOf(code);
  if (icd10Chapter === null) return null;
  const oneCategory = one === undefined ? null : target(data, one);
  const multipleCategories = multipleList.map((ref) => target(data, ref));
  const tablesAgree =
    one !== undefined &&
    multipleList.length === 1 &&
    refKey(multipleList[0] as Icd10Icd11Ref) === refKey(one);
  const tablesConflict =
    one !== undefined && !multipleList.some((ref) => refKey(ref) === refKey(one));
  const distinctRefs = [...(one === undefined ? [] : [one]), ...multipleList].filter(
    (ref, position, refs) => refs.findIndex((other) => refKey(other) === refKey(ref)) === position,
  );
  const all = distinctRefs.map((ref) => target(data, ref));
  const reverse = reverseIndex(data);
  const mergedWith = [
    ...new Set(
      distinctRefs.flatMap((ref) =>
        (reverse.get(refKey(ref)) ?? []).filter((other) => !isRelatedCode(code, other)),
      ),
    ),
  ].sort();
  return {
    icd10Code: code,
    icd10Chapter,
    release: data.release,
    citation: data.citation,
    oneCategory,
    multipleCategories,
    tablesAgree,
    tablesConflict,
    all,
    mergedWith,
    labels: labels({
      oneCategory,
      multiple: multipleCategories,
      tablesAgree,
      tablesConflict,
      mergedWith,
      icd10Chapter,
      all,
    }),
  };
}

let dataPromise: Promise<Icd10Icd11Data> | null = null;

/** The asset is ~1 MB: it is fetched with the first ICD-10 card that asks and parsed once. */
export function loadIcd10Icd11Data(): Promise<Icd10Icd11Data> {
  dataPromise ??= import('@/features/icd11/icd10-icd11-map.json?raw').then((module) =>
    parseIcd10Icd11Data(JSON.parse(module.default)),
  );
  dataPromise.catch(() => {
    dataPromise = null;
  });
  return dataPromise;
}

/** WHO's ICD-11 counterpart of an ICD-10 code (see {@link icd10ToIcd11}); loads the asset on first use. */
export async function icd11ForIcd10(code: string): Promise<Icd10Icd11Result | null> {
  if (normalizeIcd10Code(code) === null) return null;
  return icd10ToIcd11(await loadIcd10Icd11Data(), code);
}

/** The codes of a document that WHO's tables know, de-duplicated, in the order given. */
export async function icd11ForIcd10Codes(
  codes: readonly string[],
): Promise<readonly Icd10Icd11Result[]> {
  const normalized = [...new Set(codes.flatMap((code) => normalizeIcd10Code(code) ?? []))];
  if (normalized.length === 0) return [];
  const data = await loadIcd10Icd11Data();
  return normalized.flatMap((code) => icd10ToIcd11(data, code) ?? []);
}
