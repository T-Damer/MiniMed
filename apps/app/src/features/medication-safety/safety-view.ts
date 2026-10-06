/**
 * What the search card for pregnancy, lactation and child-age questions shows (SAFE1). Pure: the
 * component passes in the index, the installed instructions it has read and the parsed question;
 * the same view feeds the screen, so the card can never say more than the text it quotes.
 *
 * The card never answers «можно» or «нельзя»: it quotes the instruction's sentences with their
 * section, and for an age typed by the doctor it adds one clearly labelled calculated comparison
 * between that age and the bounds the instruction names.
 */
import type { MedicalDocument } from '@localmed/contracts';

import { displayDrugName } from '@/features/medications/drug-screen';
import {
  type InstructionSourceInfo,
  instructionSourceInfo,
} from '@/features/medications/instruction-source';
import { AGE_CATEGORIES, formatAgeDays, formatWeightTenths } from './age-limits';
import { dosageFormLabels } from './dosage-forms';
import { TOPIC_LACTATION, TOPIC_PREGNANCY, topicMatches } from './pregnancy-words';
import {
  type AgeSentence,
  ageSentences,
  flagsForms,
  flagsOrigin,
  flagsTopic,
  type IndexedLimit,
  LIMIT_AGE_BELOW,
  LIMIT_AGE_FROM,
  LIMIT_AGE_RANGE,
  LIMIT_CATEGORY,
  LIMIT_WEIGHT_BELOW,
  LIMIT_WEIGHT_FROM,
  LIMIT_WEIGHT_RANGE,
  ORIGIN_CAUTION,
  ORIGIN_CONTRAINDICATIONS,
  ORIGIN_DOSAGE,
  ORIGIN_INDICATIONS,
  ORIGIN_OTHER,
  ORIGIN_PREGNANCY_SECTION,
  ORIGIN_SPECIAL,
  pregnancySentences,
  type SafetyDocument,
  type SafetyIndex,
  type SafetySentence,
} from './safety-index';
import type { SafetyIntent, TypedAge } from './safety-query';
import { type QuoteRequest, resolveSafetyQuotes, type SafetyQuote } from './safety-quotes';

export type DocumentState = 'loading' | 'missing' | { readonly document: MedicalDocument };

/** The drug a question was resolved to. */
export interface SafetyCandidate {
  /** ЕСКЛП МНН card slug. */
  readonly slug: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  readonly label: string;
  /** The instruction of the very product the doctor typed, when the search found it. */
  readonly ownDocumentId: string | null;
}

export type IntentState = 'loading' | 'ready' | 'not-installed' | 'no-instruction';

export interface CalcLine {
  /** «Рассчитано: 3 года — меньше нижней границы 12 лет». */
  readonly text: string;
  readonly relation: 'below' | 'equal' | 'above' | 'inside' | 'spans';
}

export interface QuoteView extends SafetyQuote {
  /** The index flags of the sentence: topic, origin and dosage forms. */
  readonly flags: number;
  readonly originLabel: string;
  /** Dosage forms the sentence names. */
  readonly forms: readonly string[];
  /** The age limits found in the sentence, in the instruction's words. */
  readonly limitWords: readonly string[];
  readonly weightLimits: readonly string[];
  readonly categories: readonly string[];
  readonly calc: readonly CalcLine[];
  /** The sentence names a trimester. */
  readonly namesTrimester: boolean;
}

export interface QuoteGroup {
  readonly id: 'section' | 'warnings' | 'other' | 'restrictions' | 'dosage';
  readonly title: string;
  readonly quotes: readonly QuoteView[];
  /** Sentences found but not shown. */
  readonly hidden: number;
}

export interface SourceView {
  readonly documentId: string;
  readonly moduleId: string | null;
  readonly tradeName: string | null;
  readonly dosageForm: string | null;
  readonly info: InstructionSourceInfo | null;
  /** True when this is the instruction of the product the doctor typed. */
  readonly own: boolean;
  /** The label that this is one of the instructions of the substance (ADR-0023). */
  readonly substanceNote: string | null;
  /** Instructions of the substance that were considered. */
  readonly checkedInstructions: number;
}

export interface AgeSummaryLine extends CalcLine {
  readonly words: string;
  readonly sectionLabel: string;
}

export interface IntentView {
  readonly intent: SafetyIntent;
  readonly title: string;
  readonly state: IntentState;
  readonly source: SourceView | null;
  readonly groups: readonly QuoteGroup[];
  /** The instruction was read and holds no sentence on the topic. */
  readonly nothingSaid: boolean;
  readonly changed: number;
  /** The module to offer when the instruction is not installed. */
  readonly moduleToInstall: string | null;
  /** Calculated comparison lines for the restriction sections, when an age was typed. */
  readonly ageSummary: readonly AgeSummaryLine[];
  /** The substance's other indexed instructions (other dosage forms), to switch to. */
  readonly alternatives: readonly InstructionChoice[];
}

export interface InstructionChoice {
  readonly documentId: string;
  /** «таблетки · Ципрофлоксацин-Акос»: the form and the trade name. */
  readonly label: string;
}

export const INTENT_TITLES: Readonly<Record<SafetyIntent, string>> = {
  pregnancy: 'Беременность',
  lactation: 'Грудное вскармливание',
  age: 'Дети и возраст',
};

/** ADR-0023: the text read is one manufacturer's instruction chosen for the substance. */
export const SUBSTANCE_INSTRUCTION_NOTE =
  'Это инструкция одного из препаратов с этим веществом. Тексты инструкций других производителей могут отличаться.';
export const NOTHING_SAID_TEXT = 'В инструкции об этом не сказано';
export const CARD_NOTICE =
  'Предложения из официальных инструкций, без изменений. Приложение не отвечает «можно» или «нельзя»: решение за врачом, по полному тексту инструкции.';
export const CALC_NOTICE =
  'Строки «Рассчитано» — расчёт приложения по числам из текста, а не вывод инструкции.';

const ORIGIN_LABELS: Readonly<Record<number, string>> = {
  [ORIGIN_PREGNANCY_SECTION]: 'Беременность и грудное вскармливание',
  [ORIGIN_CONTRAINDICATIONS]: 'Противопоказания',
  [ORIGIN_CAUTION]: 'С осторожностью',
  [ORIGIN_SPECIAL]: 'Особые указания',
  [ORIGIN_DOSAGE]: 'Способ применения и дозы',
  [ORIGIN_OTHER]: 'Другие разделы',
  [ORIGIN_INDICATIONS]: 'Показания к применению',
};

const CATEGORY_LABELS: readonly string[] = [
  'новорождённые',
  'недоношенные',
  'грудной возраст',
  'дети, возраст не указан',
];

const MAX_QUOTES_PER_GROUP = 8;
const TRIMESTER_WORD = /триместр/iu;
/** Sections whose age limits are restrictions or cautions, not a dosing group. */
const RESTRICTION_ORIGINS = new Set([ORIGIN_CONTRAINDICATIONS, ORIGIN_CAUTION, ORIGIN_SPECIAL]);

function topicBit(intent: SafetyIntent): number {
  return intent === 'lactation' ? TOPIC_LACTATION : TOPIC_PREGNANCY;
}

/** Whether an indexed instruction has anything on the topic. */
export function hasIntentContent(document: SafetyDocument, intent: SafetyIntent): boolean {
  if (intent === 'age') return document.ag.length > 0;
  const bit = topicBit(intent);
  return document.pl.some((entry) => (flagsTopic(entry[3] ?? 0) & bit) !== 0);
}

/**
 * The instructions to try for a question, best first: the product the doctor typed, then the
 * substance's instructions that have something on the topic, then the rest.
 */
export function planDocuments(
  index: SafetyIndex,
  candidate: SafetyCandidate,
  intent: SafetyIntent,
  selected: string | null = null,
): readonly string[] {
  // An instruction the doctor picked is read, or its download is offered; nothing else stands in.
  if (selected && index.asset.documents[selected]) return [selected];
  const own = candidate.ownDocumentId;
  const ofCard = index.documentsOfCard.get(candidate.card) ?? [];
  const withContent = ofCard.filter((id) => {
    const document = index.asset.documents[id];
    return document !== undefined && hasIntentContent(document, intent);
  });
  const ordered = [...withContent, ...ofCard.filter((id) => !withContent.includes(id))];
  if (own && index.asset.documents[own]) return [own, ...ordered.filter((id) => id !== own)];
  return ordered;
}

/* ------------------------------------------------------------------------------------------ */
/* Calculated comparison                                                                       */
/* ------------------------------------------------------------------------------------------ */

type Relation = 'below' | 'above' | 'equal' | 'spans';

function relationTo(age: TypedAge, threshold: number): Relation {
  const lower = age.kind === 'upTo' ? 0 : age.days;
  const upper = age.days;
  if (upper < threshold) return 'below';
  if (lower > threshold) return 'above';
  if (lower === upper) return 'equal';
  return 'spans';
}

function ageLabel(age: TypedAge): string {
  return age.kind === 'upTo' ? `возраст до ${formatAgeDays(age.days, 'genitive')}` : age.text;
}

/** One calculated comparison between the typed age and the bounds of an age limit. */
export function compareAge(age: TypedAge, limit: IndexedLimit): CalcLine | null {
  const prefix = `Рассчитано: ${ageLabel(age)} — `;
  if (limit.code === LIMIT_AGE_BELOW) {
    const bound = formatAgeDays(limit.upper, 'genitive');
    const relation = relationTo(age, limit.upper);
    if (relation === 'below') return { text: `${prefix}меньше верхней границы ${bound}`, relation };
    if (relation === 'equal') {
      return {
        text: `${prefix}совпадает с границей ${bound}: смотрите формулировку в предложении`,
        relation,
      };
    }
    if (relation === 'above') return { text: `${prefix}больше верхней границы ${bound}`, relation };
    return { text: `${prefix}включает значения и меньше, и больше границы ${bound}`, relation };
  }
  if (limit.code === LIMIT_AGE_FROM) {
    const bound = formatAgeDays(limit.lower, 'genitive');
    const relation = relationTo(age, limit.lower);
    if (relation === 'below') return { text: `${prefix}меньше нижней границы ${bound}`, relation };
    if (relation === 'equal') {
      return {
        text: `${prefix}совпадает с границей ${bound}: смотрите формулировку в предложении`,
        relation,
      };
    }
    if (relation === 'above') return { text: `${prefix}не ниже нижней границы ${bound}`, relation };
    return { text: `${prefix}включает значения и меньше, и больше границы ${bound}`, relation };
  }
  if (limit.code === LIMIT_AGE_RANGE) {
    const low = formatAgeDays(limit.lower, 'genitive');
    const high = formatAgeDays(limit.upper, 'genitive');
    const range = `диапазона от ${low} до ${high}`;
    const againstLow = relationTo(age, limit.lower);
    const againstHigh = relationTo(age, limit.upper);
    if (againstLow === 'below') {
      return { text: `${prefix}меньше нижней границы ${range}`, relation: 'below' };
    }
    if (againstHigh === 'above') {
      return { text: `${prefix}больше верхней границы ${range}`, relation: 'above' };
    }
    const inside =
      (againstLow === 'above' || againstLow === 'equal') &&
      (againstHigh === 'below' || againstHigh === 'equal');
    return inside
      ? { text: `${prefix}внутри ${range}`, relation: 'inside' }
      : { text: `${prefix}частично внутри ${range}`, relation: 'spans' };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Views                                                                                       */
/* ------------------------------------------------------------------------------------------ */

function sourceView(
  index: SafetyIndex,
  candidate: SafetyCandidate,
  documentId: string,
  loaded: MedicalDocument | null,
  checked: number,
): SourceView {
  const asset = index.asset.documents[documentId];
  const own = candidate.ownDocumentId === documentId;
  return {
    documentId,
    moduleId: asset ? (index.asset.modules[asset.m] ?? null) : null,
    tradeName: asset?.t ?? null,
    dosageForm: asset?.f ?? null,
    info: loaded ? instructionSourceInfo(loaded) : null,
    own,
    substanceNote: own ? null : SUBSTANCE_INSTRUCTION_NOTE,
    checkedInstructions: checked,
  };
}

/** «Инструкция препарата «Нурофен» · таблетки · национальная инструкция · Изм. № 0 · ГРЛС». */
export function sourceLine(source: SourceView): string {
  const parts: string[] = [];
  if (source.tradeName) parts.push(`инструкция препарата «${displayDrugName(source.tradeName)}»`);
  if (source.dosageForm) parts.push(source.dosageForm.toLocaleLowerCase('ru-RU'));
  if (source.info) {
    parts.push(source.info.kindLabel);
    if (source.info.edition) parts.push(source.info.edition);
    parts.push(source.info.publisher ? `сайт производителя: ${source.info.publisher}` : 'ГРЛС');
    if (source.info.fetchedOn) parts.push(`получена ${source.info.fetchedOn}`);
  }
  const text = parts.join(' · ');
  return text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
}

function weightText(limit: IndexedLimit): string {
  if (limit.code === LIMIT_WEIGHT_BELOW) return `менее ${formatWeightTenths(limit.upper)}`;
  if (limit.code === LIMIT_WEIGHT_FROM) return `от ${formatWeightTenths(limit.lower)}`;
  return `от ${formatWeightTenths(limit.lower)} до ${formatWeightTenths(limit.upper)}`;
}

interface Raw {
  readonly sentence: SafetySentence | AgeSentence;
  readonly request: QuoteRequest;
  readonly limits: readonly IndexedLimit[];
}

function pregnancyRaw(sentence: SafetySentence): Raw {
  return {
    sentence,
    limits: [],
    request: {
      section: sentence.section,
      start: sentence.start,
      end: sentence.end,
      flags: sentence.flags,
      hits: (text) => topicMatches(text).map((match) => [match.start, match.end] as const),
    },
  };
}

function ageRaw(sentence: AgeSentence): Raw {
  const ranges = sentence.limits.map(
    (limit) => [limit.matchStart - sentence.start, limit.matchEnd - sentence.start] as const,
  );
  return {
    sentence,
    limits: sentence.limits,
    request: {
      section: sentence.section,
      start: sentence.start,
      end: sentence.end,
      flags: sentence.flags,
      hits: () => ranges,
    },
  };
}

function resolveRaws(
  loaded: MedicalDocument,
  raws: readonly Raw[],
  age: TypedAge | null,
): { quotes: readonly QuoteView[]; changed: number } {
  const resolved = resolveSafetyQuotes(
    loaded,
    raws.map((raw) => raw.request),
  );
  const quotes = resolved.quotes.map((quote): QuoteView => {
    const limits = raws[quote.sourceIndex]?.limits ?? [];
    // The hit ranges of an age sentence are its limits, in the same order.
    const textOf = (limit: IndexedLimit): string => quote.hitTexts[limits.indexOf(limit)] ?? '';
    const ageLimits = limits.filter((limit) => limit.code <= LIMIT_AGE_RANGE);
    return {
      ...quote,
      originLabel: ORIGIN_LABELS[flagsOrigin(quote.flags)] ?? '',
      forms: dosageFormLabels(flagsForms(quote.flags)),
      limitWords: ageLimits.map(textOf),
      weightLimits: limits
        .filter((limit) => limit.code >= LIMIT_WEIGHT_BELOW && limit.code <= LIMIT_WEIGHT_RANGE)
        .map(weightText),
      categories: limits
        .filter((limit) => limit.code === LIMIT_CATEGORY)
        .map((limit) => CATEGORY_LABELS[limit.lower] ?? ''),
      calc: age
        ? ageLimits.flatMap((limit) => {
            const line = compareAge(age, limit);
            return line ? [line] : [];
          })
        : [],
      namesTrimester: TRIMESTER_WORD.test(quote.fullText),
    };
  });
  void AGE_CATEGORIES;
  return { quotes, changed: resolved.changed };
}

function group(
  id: QuoteGroup['id'],
  title: string,
  quotes: readonly QuoteView[],
  limit = MAX_QUOTES_PER_GROUP,
): QuoteGroup | null {
  if (quotes.length === 0) return null;
  return { id, title, quotes: quotes.slice(0, limit), hidden: Math.max(0, quotes.length - limit) };
}

function pregnancyGroups(
  index: SafetyIndex,
  documentId: string,
  loaded: MedicalDocument,
  intent: 'pregnancy' | 'lactation',
  trimester: number | null,
): { groups: readonly QuoteGroup[]; changed: number } {
  const bit = topicBit(intent);
  const sentences = pregnancySentences(index, documentId).filter(
    (sentence) => (flagsTopic(sentence.flags) & bit) !== 0,
  );
  const { quotes, changed } = resolveRaws(loaded, sentences.map(pregnancyRaw), null);
  // With a trimester asked about, the sentences that name trimesters come first.
  const ordered =
    trimester === null
      ? quotes
      : [
          ...quotes.filter((quote) => quote.namesTrimester),
          ...quotes.filter((quote) => !quote.namesTrimester),
        ];
  const byOrigin = (origins: ReadonlySet<number>): readonly QuoteView[] =>
    ordered.filter((quote) => origins.has(flagsOrigin(quote.flags)));
  const groups = [
    group(
      'section',
      loaded.sections.find((section) => section.sectionType === 'pregnancy')?.title ||
        'Применение при беременности и в период грудного вскармливания',
      byOrigin(new Set([ORIGIN_PREGNANCY_SECTION])),
    ),
    group(
      'warnings',
      'Противопоказания и «С осторожностью»',
      byOrigin(new Set([ORIGIN_CONTRAINDICATIONS, ORIGIN_CAUTION])),
    ),
    group(
      'other',
      'Упоминания в других разделах',
      byOrigin(new Set([ORIGIN_SPECIAL, ORIGIN_DOSAGE, ORIGIN_OTHER])),
      MAX_QUOTES_PER_GROUP,
    ),
  ].filter((entry): entry is QuoteGroup => entry !== null);
  return { groups, changed };
}

function ageGroups(
  index: SafetyIndex,
  documentId: string,
  loaded: MedicalDocument,
  age: TypedAge | null,
): { groups: readonly QuoteGroup[]; changed: number; summary: readonly AgeSummaryLine[] } {
  const sentences = ageSentences(index, documentId);
  const { quotes, changed } = resolveRaws(loaded, sentences.map(ageRaw), age);
  const byOrigin = (origins: ReadonlySet<number>): readonly QuoteView[] =>
    quotes.filter((quote) => origins.has(flagsOrigin(quote.flags)));
  const restrictions = byOrigin(RESTRICTION_ORIGINS);
  const groups = [
    group('restrictions', 'Противопоказания, «С осторожностью», «Особые указания»', restrictions),
    group('dosage', 'Способ применения и дозы', byOrigin(new Set([ORIGIN_DOSAGE]))),
    group(
      'other',
      'Показания и другие разделы',
      byOrigin(new Set([ORIGIN_INDICATIONS, ORIGIN_OTHER])),
    ),
  ].filter((entry): entry is QuoteGroup => entry !== null);
  const seen = new Set<string>();
  const summary = restrictions
    .flatMap((quote) =>
      quote.calc.map(
        (line, position): AgeSummaryLine => ({
          ...line,
          words: quote.limitWords[position] ?? '',
          sectionLabel: quote.originLabel,
        }),
      ),
    )
    .filter((line) => {
      const key = `${line.text}|${line.words}|${line.sectionLabel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { groups, changed, summary };
}

/** The instructions of the card the doctor can switch between, best first. */
export function alternativesOf(
  index: SafetyIndex,
  candidate: SafetyCandidate,
): readonly InstructionChoice[] {
  const ids = index.documentsOfCard.get(candidate.card) ?? [];
  if (ids.length < 2) return [];
  return ids.map((documentId) => {
    const document = index.asset.documents[documentId];
    const form = document?.f?.toLocaleLowerCase('ru-RU') ?? 'форма не указана';
    const name = document?.t ? displayDrugName(document.t) : '';
    return { documentId, label: name ? `${form} · ${name}` : form };
  });
}

export interface IntentViewInput {
  readonly selectedDocumentId?: string | null;
  readonly index: SafetyIndex;
  readonly candidate: SafetyCandidate;
  readonly intent: SafetyIntent;
  readonly age: TypedAge | null;
  readonly trimester: number | null;
  readonly documents: ReadonlyMap<string, DocumentState>;
}

/** The block of the card for one question. */
export function intentView(input: IntentViewInput): IntentView {
  const { index, candidate, intent, documents } = input;
  const plan = planDocuments(index, candidate, intent, input.selectedDocumentId ?? null);
  const empty = {
    intent,
    title: INTENT_TITLES[intent],
    groups: [] as readonly QuoteGroup[],
    nothingSaid: false,
    changed: 0,
    moduleToInstall: null,
    ageSummary: [] as readonly AgeSummaryLine[],
    alternatives: alternativesOf(index, candidate),
  };
  const first = plan[0];
  if (!first) return { ...empty, state: 'no-instruction', source: null };
  // The first instruction of the plan that is installed; one still being read holds the card back.
  let chosen: { id: string; document: MedicalDocument } | null = null;
  let pending = false;
  for (const id of plan) {
    const state = documents.get(id);
    if (state === undefined || state === 'loading') {
      pending = true;
      break;
    }
    if (state !== 'missing') {
      chosen = { id, document: state.document };
      break;
    }
  }
  if (!chosen) {
    const source = sourceView(index, candidate, first, null, plan.length);
    return pending
      ? { ...empty, state: 'loading', source }
      : { ...empty, state: 'not-installed', source, moduleToInstall: source.moduleId };
  }
  const source = sourceView(index, candidate, chosen.id, chosen.document, plan.length);
  if (intent === 'age') {
    const { groups, changed, summary } = ageGroups(index, chosen.id, chosen.document, input.age);
    return {
      ...empty,
      state: 'ready',
      source,
      groups,
      changed,
      nothingSaid: groups.length === 0 && changed === 0,
      ageSummary: summary,
    };
  }
  const { groups, changed } = pregnancyGroups(
    index,
    chosen.id,
    chosen.document,
    intent,
    input.trimester,
  );
  return {
    ...empty,
    state: 'ready',
    source,
    groups,
    changed,
    nothingSaid: groups.length === 0 && changed === 0,
  };
}

/** The ids of the instructions the card needs read next: the first one not known to be missing. */
export function documentsToRead(
  index: SafetyIndex,
  candidate: SafetyCandidate,
  intents: readonly SafetyIntent[],
  documents: ReadonlyMap<string, DocumentState>,
  selected: string | null = null,
): readonly string[] {
  const wanted = new Set<string>();
  for (const intent of intents) {
    for (const id of planDocuments(index, candidate, intent, selected)) {
      const state = documents.get(id);
      if (state === undefined) {
        wanted.add(id);
        break;
      }
      if (state !== 'missing') break;
    }
  }
  return [...wanted];
}
