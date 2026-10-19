import { pluralRu } from '@/i18n/labels';

/**
 * The herbal book («Травник») as the app reads it: the `herbal` block a chapter of the module
 * `minimed.reference.herbal` carries in its document metadata (`tools/ingest/.../herbal_prepare.py`).
 * The block is untrusted pack data, so every field is checked here and a malformed one is dropped.
 */

export const HERBAL_MODULE_ID = 'minimed.reference.herbal';
export const HERBAL_PLATES_MODULE_ID = 'minimed.reference.herbal.plates';
export const HERBAL_SOURCE_TYPE = 'herbal_monograph';
export const HERBAL_COLLECTION = 'herbal';

/** A value with the source sentence it was read from (shown on tap). */
export interface QuotedValue {
  readonly value: string;
  readonly quote: string;
}

export interface HerbalBrew {
  readonly kind: string | null;
  readonly herb: QuotedValue | null;
  readonly water: QuotedValue | null;
  readonly heat: QuotedValue | null;
  readonly steep: QuotedValue | null;
  readonly times: QuotedValue | null;
  readonly dose: QuotedValue | null;
  readonly course: QuotedValue | null;
}

export type EmaDocumentKind = 'monograph' | 'public-statement' | 'assessment-report' | 'summary';

export interface EmaQuote {
  readonly doc: EmaDocumentKind;
  readonly page: number;
  readonly quote: string;
}

export interface EmaDose {
  readonly preparationRu: string;
  readonly amount: string | null;
  readonly unit: string | null;
  readonly waterMl: string | null;
  readonly timesPerDay: string | null;
  readonly populationRu: string;
}

export interface EmaFact extends EmaQuote {
  readonly kind: string;
  readonly ru: string;
  readonly dose: EmaDose | null;
  /** The longest use in days a `duration` fact allows, read from its quote. */
  readonly maxDays: number | null;
}

export interface EmaConstituent extends EmaQuote {
  readonly compoundRu: string;
  readonly classRu: string | null;
  readonly effectRu: string;
  readonly evidence: string;
}

export interface HerbalEma {
  readonly page: string;
  readonly extracted: boolean;
  readonly draft: boolean;
  readonly useType: string | null;
  readonly documents: Readonly<Partial<Record<EmaDocumentKind, string>>>;
  readonly facts: readonly EmaFact[];
  readonly constituents: readonly EmaConstituent[];
}

export interface HerbalPlate {
  readonly asset: string;
  readonly book: string;
  readonly credit: string;
  readonly commonsPage: string | null;
}

/**
 * A species found among the raw material, with its distinguishing text: named by the ГФ article
 * (`gf`) or by a pharmacognosy teaching manual (`manual`, cited by its own `sourceLabel`).
 */
export interface HerbalLookalike {
  readonly name: string;
  readonly text: string;
  readonly source: 'gf' | 'manual';
  readonly sourceLabel: string | null;
  readonly poisonous: boolean;
}

/** A manual's line on how the genuine herb differs from its admixtures. */
export interface HerbalLookalikeKey {
  readonly text: string;
  readonly sourceLabel: string;
}

/** Where the chapter's «Как узнать» comes from (the ГФ raw-material article) and its look-alikes. */
export interface HerbalIdentification {
  readonly sourceLabel: string;
  readonly url: string | null;
  readonly lookalikes: readonly HerbalLookalike[];
  readonly key: HerbalLookalikeKey | null;
}

export interface HerbalChapter {
  readonly documentId: string;
  readonly title: string;
  readonly latin: string;
  readonly family: string;
  readonly partRu: string;
  readonly actions: readonly string[];
  readonly brew: HerbalBrew;
  readonly thumbnail: string | null;
  readonly plate: HerbalPlate | null;
  readonly ema: HerbalEma | null;
  readonly identification: HerbalIdentification | null;
  readonly grlsOcr: boolean;
  readonly hasGrls: boolean;
}

export interface HerbalGuide {
  readonly documentId: string;
  readonly title: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function quoted(value: unknown): QuotedValue | null {
  const item = record(value);
  const shown = text(item?.['value']);
  const quote = text(item?.['quote']);
  return shown && quote ? { value: shown, quote } : null;
}

const EMA_DOCUMENTS: readonly EmaDocumentKind[] = [
  'monograph',
  'public-statement',
  'assessment-report',
  'summary',
];

function emaDocument(value: unknown): EmaDocumentKind | null {
  return EMA_DOCUMENTS.find((kind) => kind === value) ?? null;
}

function emaQuote(item: UnknownRecord): EmaQuote | null {
  const doc = emaDocument(item['doc']);
  const page = item['page'];
  const quote = text(item['quote']);
  if (!doc || typeof page !== 'number' || !Number.isInteger(page) || page < 1 || !quote) {
    return null;
  }
  return { doc, page, quote };
}

function emaDose(value: unknown): EmaDose | null {
  const item = record(value);
  const preparationRu = text(item?.['preparationRu']);
  const populationRu = text(item?.['populationRu']);
  if (!item || !preparationRu || !populationRu) return null;
  return {
    preparationRu,
    populationRu,
    amount: text(item['amount']),
    unit: text(item['unit']),
    waterMl: text(item['waterMl']),
    timesPerDay: text(item['timesPerDay']),
  };
}

function emaFact(value: unknown): EmaFact | null {
  const item = record(value);
  if (!item) return null;
  const base = emaQuote(item);
  const kind = text(item['kind']);
  const ru = text(item['ru']);
  if (!base || !kind || !ru) return null;
  const maxDays = item['maxDays'];
  return {
    ...base,
    kind,
    ru,
    dose: emaDose(item['dose']),
    maxDays:
      typeof maxDays === 'number' && Number.isInteger(maxDays) && maxDays > 0 ? maxDays : null,
  };
}

function emaConstituent(value: unknown): EmaConstituent | null {
  const item = record(value);
  if (!item) return null;
  const base = emaQuote(item);
  const compoundRu = text(item['compoundRu']);
  const effectRu = text(item['effectRu']);
  const evidence = text(item['evidence']);
  if (!base || !compoundRu || !effectRu || !evidence) return null;
  return { ...base, compoundRu, effectRu, evidence, classRu: text(item['classRu']) };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

function readEma(value: unknown): HerbalEma | null {
  const item = record(value);
  const page = text(item?.['page']);
  if (!item || !page) return null;
  const documents: Partial<Record<EmaDocumentKind, string>> = {};
  let draft = false;
  for (const [kind, raw] of Object.entries(record(item['documents']) ?? {})) {
    const known = emaDocument(kind);
    const url = text(record(raw)?.['url']);
    if (!known || !url) continue;
    documents[known] = url;
  }
  const extracted = item['extracted'] === true;
  if (extracted && item['status'] !== 'reviewed') draft = true;
  return {
    page,
    extracted,
    draft,
    useType: text(item['useType']),
    documents,
    facts: list(item['facts']).map(emaFact).filter(present),
    constituents: list(item['constituents']).map(emaConstituent).filter(present),
  };
}

function readPlate(value: unknown): HerbalPlate | null {
  const item = record(value);
  const asset = text(item?.['asset']);
  const book = text(item?.['book']);
  if (!item || !asset || !/^plates\/[a-z0-9-]+\.jpg$/u.test(asset) || !book) return null;
  const credit = text(item['credit']) ?? book;
  const commonsPage = text(item['commonsPage']);
  return {
    asset,
    book,
    credit,
    commonsPage: commonsPage?.startsWith('https://commons.wikimedia.org/') ? commonsPage : null,
  };
}

function readBrew(value: unknown): HerbalBrew {
  const item = record(value) ?? {};
  return {
    kind: text(item['kind']),
    herb: quoted(item['herb']),
    water: quoted(item['water']),
    heat: quoted(item['heat']),
    steep: quoted(item['steep']),
    times: quoted(item['times']),
    dose: quoted(item['dose']),
    course: quoted(item['course']),
  };
}

interface DocumentLike {
  readonly id: string;
  readonly title: string;
  readonly sourceType: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

function readLookalike(value: unknown): HerbalLookalike | null {
  const item = record(value);
  const name = text(item?.['name']);
  const body = text(item?.['text']);
  if (!name || !body) return null;
  const source = item?.['source'] === 'manual' ? 'manual' : 'gf';
  return {
    name,
    text: body,
    source,
    sourceLabel: source === 'manual' ? (text(item?.['sourceLabel']) ?? null) : null,
    poisonous: item?.['poisonous'] === true,
  };
}

function readLookalikeKey(value: unknown): HerbalLookalikeKey | null {
  const item = record(value);
  const body = text(item?.['text']);
  const sourceLabel = text(item?.['sourceLabel']);
  return body && sourceLabel ? { text: body, sourceLabel } : null;
}

function readIdentification(value: unknown): HerbalIdentification | null {
  const item = record(value);
  const source = record(item?.['source']);
  const number = text(source?.['number']);
  if (!item || !number) return null;
  const url = text(source?.['url']);
  const edition = source?.['edition'];
  return {
    sourceLabel: `ГФ ${edition === 14 ? 'XIV' : 'XV'}, ${number}`,
    url: url?.startsWith('https://pharmacopoeia.regmed.ru/') ? url : null,
    lookalikes: list(item['lookalikes']).map(readLookalike).filter(present),
    key: readLookalikeKey(item['key']),
  };
}

/** The herbal chapter a document carries, or null for any other document. */
export function readHerbalChapter(document: DocumentLike): HerbalChapter | null {
  if (document.sourceType !== HERBAL_SOURCE_TYPE) return null;
  const herbal = record(document.metadata?.['herbal']);
  const latin = text(herbal?.['latin']);
  if (!herbal || !latin || text(herbal['plantId']) === null) return null;
  const thumbnail = text(herbal['thumbnail']);
  const grls = record(herbal['grls']);
  return {
    documentId: document.id,
    title: document.title,
    latin,
    family: text(herbal['family']) ?? '',
    partRu: text(herbal['partRu']) ?? '',
    actions: list(herbal['actions']).map(text).filter(present),
    brew: readBrew(herbal['brew']),
    thumbnail: thumbnail?.startsWith('data:image/jpeg;base64,') ? thumbnail : null,
    plate: readPlate(herbal['plate']),
    ema: readEma(herbal['ema']),
    identification: readIdentification(herbal['identification']),
    grlsOcr: grls?.['ocr'] === true,
    hasGrls: grls !== null,
  };
}

/** A general chapter of the book (the ГФ XV infusion rules), or null. */
export function readHerbalGuide(document: DocumentLike): HerbalGuide | null {
  if (document.sourceType !== HERBAL_SOURCE_TYPE) return null;
  const herbal = record(document.metadata?.['herbal']);
  return text(herbal?.['guide']) ? { documentId: document.id, title: document.title } : null;
}

export interface HerbalBook {
  readonly plants: readonly HerbalChapter[];
  readonly guides: readonly HerbalGuide[];
}

export function buildHerbalBook(documents: readonly DocumentLike[]): HerbalBook {
  const plants = documents
    .map(readHerbalChapter)
    .filter(present)
    .toSorted((left, right) => left.title.localeCompare(right.title, 'ru'));
  const guides = documents.map(readHerbalGuide).filter(present);
  return { plants, guides };
}

/** Every action label of the book, most common first (the filter chips). */
export function herbalActions(plants: readonly HerbalChapter[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const plant of plants) {
    for (const action of plant.actions) counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .map(([action]) => action);
}

const EMA_DOCUMENT_LABELS: Readonly<Record<EmaDocumentKind, string>> = {
  monograph: 'монография EMA',
  'public-statement': 'заявление EMA',
  'assessment-report': 'отчёт EMA',
  summary: 'резюме EMA',
};

export function emaSourceLabel(quote: EmaQuote): string {
  return `${EMA_DOCUMENT_LABELS[quote.doc]}, с. ${quote.page}`;
}

/** Limits shown under «Кому нельзя», in this order. */
export const LIMIT_KINDS: readonly string[] = [
  'statement',
  'contraindication',
  'age',
  'pregnancy',
  'lactation',
  'duration',
  'interaction',
  'warning',
];

const LIMIT_LABELS: Readonly<Record<string, string>> = {
  statement: 'Вывод',
  contraindication: 'Нельзя',
  age: 'Возраст',
  pregnancy: 'Беременность',
  lactation: 'Кормление',
  duration: 'Срок',
  interaction: 'Лекарства',
  warning: 'Осторожно',
  adverse: 'Побочное',
  overdose: 'Передозировка',
  indication: 'Показание',
  'use-type': 'Применение',
};

export function factLabel(kind: string): string {
  return LIMIT_LABELS[kind] ?? 'EMA';
}

export function limitFacts(ema: HerbalEma | null): readonly EmaFact[] {
  if (!ema) return [];
  return LIMIT_KINDS.flatMap((kind) => ema.facts.filter((fact) => fact.kind === kind));
}

export function factsOfKind(ema: HerbalEma | null, kind: string): readonly EmaFact[] {
  return ema ? ema.facts.filter((fact) => fact.kind === kind) : [];
}

/** «1,5–4 г на 150 мл, 3–4 раза в день» for an EMA dose. */
export function emaDoseLine(dose: EmaDose): string {
  const parts: string[] = [];
  if (dose.amount) {
    const amount = dose.amount.replaceAll('.', ',').replace(/\s*-\s*/gu, '–');
    parts.push(`${amount}${dose.unit ? ` ${dose.unit}` : ''}`);
  }
  if (dose.waterMl) parts.push(`на ${dose.waterMl} мл`);
  const line = parts.join(' ');
  const times = dose.timesPerDay ? `${dose.timesPerDay.replace(/\s*-\s*/gu, '–')} р/день` : null;
  return [line, times].filter(Boolean).join(', ');
}

const EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  clinical: 'исследования у людей',
  animal: 'опыты на животных',
  'in-vitro': 'опыты в пробирке',
  traditional: 'традиция применения',
  review: 'обзор EMA',
};

export function evidenceLabel(evidence: string): string {
  return EVIDENCE_LABELS[evidence] ?? '';
}

const USE_TYPE_LABELS: Readonly<Record<string, string>> = {
  traditional: 'Традиционное применение',
  'well-established': 'Хорошо изученное применение',
  both: 'Изученное и традиционное применение',
  'public-statement': 'EMA не дала монографии',
};

export function useTypeLabel(useType: string | null): string | null {
  return useType ? (USE_TYPE_LABELS[useType] ?? null) : null;
}

interface CatalogModuleLike {
  readonly documents: readonly { readonly documentId: string }[];
}

/** «30 растений» from the catalog's document list of the herbal module, or null when unknown. */
export function herbalPlantCountLabel(modules: readonly CatalogModuleLike[]): string | null {
  const count = modules
    .flatMap((module) => module.documents)
    .filter((document) => document.documentId.startsWith('herbal.plant.')).length;
  return count > 0 ? `${count} ${pluralRu(count, 'растение', 'растения', 'растений')}` : null;
}

/** What the plant search matches besides the names: the action labels and the EMA indications. */
export function herbalSearchValues(plant: HerbalChapter): readonly string[] {
  return [
    plant.title,
    plant.latin,
    plant.partRu,
    ...plant.actions,
    ...factsOfKind(plant.ema, 'indication').map((fact) => fact.ru),
  ];
}

/**
 * The query with each word cut to a stem the inflected forms share: «кашель» → «кашл» finds «при
 * кашле», «кашля». Words that would drop below four letters stay whole. Null when nothing changes.
 */
export function herbalQueryStem(query: string): string | null {
  const stemmed = query
    .toLocaleLowerCase('ru-RU')
    .split(/\s+/u)
    .map((word) => {
      let stem = word.replace(/[ьйаеиоуыэюя]+$/u, '');
      // A fleeting vowel before the last consonant: «кашель» → «кашл», «узелок» → «узелк».
      stem = stem.replace(/([бвгджзклмнпрстфхцчшщ])[ео]([бвгджзклмнпрстфхцчшщ])$/u, '$1$2');
      return stem.length >= 4 ? stem : word;
    })
    .join(' ');
  return stemmed === query.toLocaleLowerCase('ru-RU') ? null : stemmed;
}

const COURSE_UNIT_DAYS: readonly (readonly [RegExp, number])[] = [
  [/^дн|^сут/u, 1],
  [/^недел/u, 7],
  [/^месяц/u, 30],
];

/** The longest course of a ГРЛС course value («2–3 недели» → 21 days), or null when unread. */
export function courseMaxDays(value: string): number | null {
  const match = /(\d+)(?:\s*[–-]\s*(\d+))?\s*([а-яё]+)/iu.exec(value);
  if (!match) return null;
  const count = Number(match[2] ?? match[1]);
  const unit = COURSE_UNIT_DAYS.find(([pattern]) => pattern.test(match[3]?.toLowerCase() ?? ''));
  return unit ? count * unit[1] : null;
}

/**
 * True when the ГРЛС course is longer than the shortest use EMA allows («Курс 2–3 недели» against
 * «не дольше 1 недели»). Both sources stay as they are; the course cell only points at the conflict.
 */
export function courseLongerThanEma(chapter: HerbalChapter): boolean {
  const course = chapter.brew.course ? courseMaxDays(chapter.brew.course.value) : null;
  const limits = factsOfKind(chapter.ema, 'duration')
    .map((fact) => fact.maxDays)
    .filter((days): days is number => days !== null);
  return course !== null && limits.length > 0 && course > Math.min(...limits);
}
