import type { MedicalCore, MedicalDocument } from '@localmed/contracts';

import type { ComparisonIndex } from '@/features/drug-comparison/comparison-index';
import {
  extractQuoteBlock,
  type QuoteRowSpec,
} from '@/features/drug-comparison/comparison-sections';
import {
  type AtcNameCatalog,
  atcPrefixes,
  normalizeAtcCode,
} from '@/features/medications/atc-code';
import { displayDrugName, drugNameKey } from '@/features/medications/drug-screen';
import {
  parseEsklpMedicationProducts,
  parseMedicationProduct,
} from '@/features/medications/medication-record';

/**
 * The short card a drug name in a text opens (owner 2026-10-07): the substance, its trade names,
 * the registry's group and ATC code, and one quoted line of what it does — then «Открыть» for the
 * whole card. Pure over documents the app already holds and the two lazy assets (the drug
 * comparison index and the NSI ATC names); nothing here paraphrases a source: the effect line is
 * the instruction's own first sentences, cut at a sentence or word boundary.
 */
export interface MedicationLinkSummary {
  /** The substance (or the trade name of a single-product document), ready for display. */
  readonly title: string;
  /** The active substance under a trade name; null when `title` is the substance. */
  readonly substance: string | null;
  /** Trade names (generics) shown, in registry order, without repeats. */
  readonly tradeNames: readonly string[];
  /** Trade names left out of `tradeNames`. */
  readonly moreTradeNames: number;
  /** The registry's pharmacotherapeutic groups, as worded there (sentence case). */
  readonly groups: readonly string[];
  readonly atc: { readonly code: string; readonly name: string | null } | null;
  readonly effect: MedicationLinkEffect | null;
  /** One short provenance line: «ЕСКЛП, 28.08.2026 · инструкция». */
  readonly sourceLine: string;
}

export interface MedicationLinkEffect {
  /** «Действие» (pharmacodynamics) or «Показания» when the instruction has no pharmacology text. */
  readonly label: string;
  readonly text: string;
}

const TRADE_NAMES_SHOWN = 5;
const GROUPS_SHOWN = 1;
const EFFECT_MAX_LENGTH = 240;
const ESKLP_MNN_PREFIX = 'esklp.mnn.';
/** Instructions tried for the effect line; the rest of a card's documents are not installed. */
const INSTRUCTION_ATTEMPTS = 4;

const EFFECT_ROWS: readonly (QuoteRowSpec & { readonly label: string })[] = [
  {
    id: 'pharmacodynamics',
    title: 'Фармакодинамика',
    label: 'Действие',
    type: 'pharmacology',
    titlePattern: /фармакодинамик/iu,
  },
  {
    id: 'pharmacology',
    title: 'Фармакологические свойства',
    label: 'Действие',
    type: 'pharmacology',
    titlePattern: /фармакологическ\p{L}*\s+(?:свойств|действ)/iu,
  },
  { id: 'indications', title: 'Показания', label: 'Показания', type: 'indications' },
];

function sentenceCase(value: string): string {
  const text = value.trim();
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

function unique(values: readonly string[], key: (value: string) => string): readonly string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function groupKey(value: string): string {
  return drugNameKey(value)
    .replace(/[\p{P}\s]+/gu, ' ')
    .trim();
}

/** «Витамины» is dropped when «Витамины. Аскорбиновая кислота» is listed too: the longer says more. */
function withoutPrefixGroups(groups: readonly string[]): readonly string[] {
  const keys = groups.map(groupKey);
  return groups.filter((_group, index) => {
    const key = keys[index] ?? '';
    return !keys.some((other, otherIndex) => otherIndex !== index && other.startsWith(`${key} `));
  });
}

/**
 * The first sentences of a quoted section that fit in `limit` characters. A first sentence longer
 * than that is cut at a word boundary with «…». Whitespace is collapsed; words are not changed.
 */
export function leadingSentences(text: string, limit = EFFECT_MAX_LENGTH): string {
  const plain = text.replace(/\s+/gu, ' ').trim();
  if (plain.length <= limit) return plain;
  const sentences = plain.split(/(?<=[.!?])\s+(?=[«"(]?[А-ЯЁA-Z])/u);
  let result = '';
  for (const sentence of sentences) {
    const next = result ? `${result} ${sentence}` : sentence;
    if (next.length > limit) break;
    result = next;
  }
  if (result) return result;
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–—-]+$/u, '')}…`;
}

/** The effect line of an instruction: pharmacodynamics first, indications when there is none. */
export function instructionEffect(document: MedicalDocument): MedicationLinkEffect | null {
  for (const row of EFFECT_ROWS) {
    const block = extractQuoteBlock(document, row);
    // A heading that only repeats its title («Фармакологические свойства») carries no text.
    const text = block?.text.replace(/^фармакодинамика[\s.:–—-]*/iu, '').trim();
    if (text && text.length > 12) return { label: row.label, text: leadingSentences(text) };
  }
  return null;
}

/** Trade names a core pointer lists in its own lines («- ТН: Бензонал; форма/дозировка: …»). */
export function pointerTradeNames(document: MedicalDocument): readonly string[] {
  const names = document.sections.flatMap((section) =>
    section.chunks.flatMap((chunk) =>
      [...chunk.originalText.matchAll(/ТН:\s*([^;\n]+)/gu)].flatMap((match) => {
        const name = match[1]?.replace(/[.\s]+$/u, '').trim();
        return name ? [name] : [];
      }),
    ),
  );
  return names;
}

function metadataString(document: MedicalDocument, key: string): string | null {
  const value = document.metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataStrings(document: MedicalDocument, key: string): readonly string[] {
  const value = document.metadata[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

/** `esklp.mnn.<slug>` behind a document: itself, a pointer's target or a product's substance card. */
export function substanceCardSlug(document: MedicalDocument): string | null {
  const product = parseMedicationProduct(document, null);
  const candidates = [
    document.id,
    metadataString(document, 'targetDocumentId'),
    product?.mnnDocumentId,
    product?.linkedMnnDocumentId,
  ];
  const id = candidates.find((value) => value?.startsWith(ESKLP_MNN_PREFIX));
  return id ? id.slice(ESKLP_MNN_PREFIX.length) : null;
}

function atcOf(
  codes: readonly string[],
  names: AtcNameCatalog | null,
): MedicationLinkSummary['atc'] {
  for (const raw of codes) {
    const code = normalizeAtcCode(raw);
    if (!code) continue;
    const name =
      atcPrefixes(code.code)
        .filter((prefix) => prefix.level <= 4)
        .map((prefix) => names?.names[prefix.code]?.trim())
        .findLast((value) => !!value) ?? null;
    return { code: code.code, name: name ? sentenceCase(name) : null };
  }
  return null;
}

function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}` : value;
}

export interface MedicationLinkSummaryInput {
  /** The document the link names: a ЕСКЛП card, a core pointer to one, or a product document. */
  readonly document: MedicalDocument;
  readonly index: ComparisonIndex | null;
  readonly atcNames: AtcNameCatalog | null;
  /** An installed instruction of the substance, for the effect line. */
  readonly instruction: MedicalDocument | null;
}

export function buildMedicationLinkSummary(
  input: MedicationLinkSummaryInput,
): MedicationLinkSummary {
  const { document, index } = input;
  const slug = substanceCardSlug(document);
  const cardIndex = slug ? index?.cardBySlug.get(slug) : undefined;
  const card = cardIndex === undefined ? undefined : index?.asset.cards[cardIndex];

  const product = parseMedicationProduct(document, null);
  const esklpProducts = product ? [] : parseEsklpMedicationProducts(document);
  const indexTradeNames =
    cardIndex === undefined
      ? []
      : (index?.documentsOfCard.get(cardIndex) ?? []).flatMap((id) => {
          const name = index?.asset.documents[id]?.t;
          return name ? [name] : [];
        });
  const tradeNames = unique(
    (product
      ? []
      : esklpProducts.length > 0
        ? esklpProducts.map((item) => item.tradeName)
        : [...pointerTradeNames(document), ...indexTradeNames]
    ).map(displayDrugName),
    drugNameKey,
  );

  const substanceName =
    metadataString(document, 'standardizedInn') ??
    product?.inn ??
    card?.n ??
    document.title.split('—')[0]?.trim() ??
    document.title;
  const groups = withoutPrefixGroups(
    unique(
      [
        ...(product?.pharmacotherapeuticGroups ?? []),
        ...esklpProducts.flatMap((item) => item.pharmacotherapeuticGroups),
        ...(card?.g ?? []),
      ].map(sentenceCase),
      drugNameKey,
    ),
  ).slice(0, GROUPS_SHOWN);
  const atc = atcOf([...metadataStrings(document, 'atcCodes'), ...(card?.a ?? [])], input.atcNames);
  const effect = input.instruction ? instructionEffect(input.instruction) : null;

  const registry =
    product?.sourceKind === 'allmed' ? 'Allmed' : product?.sourceKind === 'grls' ? 'ГРЛС' : 'ЕСКЛП';
  const edition = document.versionLabel ? displayDate(document.versionLabel) : null;
  return {
    title: displayDrugName(product ? product.tradeName : substanceName),
    substance: product ? displayDrugName(product.inn) : null,
    tradeNames: tradeNames.slice(0, TRADE_NAMES_SHOWN),
    moreTradeNames: Math.max(0, tradeNames.length - TRADE_NAMES_SHOWN),
    groups,
    atc,
    effect,
    sourceLine: [edition ? `${registry}, ${edition}` : registry, effect ? 'инструкция' : null]
      .filter(Boolean)
      .join(' · '),
  };
}

/** Lazy assets the summary reads; injected so tests and the component share one loader. */
export interface MedicationLinkSummaryAssets {
  readonly comparisonIndex: () => Promise<ComparisonIndex>;
  readonly atcNames: () => Promise<AtcNameCatalog>;
}

/**
 * Reads what the summary needs: the linked document, the full ЕСКЛП card behind a pointer when its
 * module is installed, and the first installed instruction of the substance. A missing asset only
 * drops its lines; a missing linked document is an error for the caller to show.
 */
export async function loadMedicationLinkSummary(
  core: Pick<MedicalCore, 'getDocument'>,
  documentId: string,
  assets: MedicationLinkSummaryAssets,
): Promise<MedicationLinkSummary> {
  const linked = await core.getDocument(documentId);
  if (!linked.ok) throw new Error(linked.error.message);
  const target = metadataString(linked.value, 'targetDocumentId');
  const installed = target ? await core.getDocument(target) : null;
  const document = installed?.ok ? installed.value : linked.value;

  const [index, atcNames] = await Promise.all([
    assets.comparisonIndex().catch((cause: unknown) => {
      console.error('Не удалось загрузить индекс препаратов для подсказки.', cause);
      return null;
    }),
    assets.atcNames().catch((cause: unknown) => {
      console.error('Не удалось загрузить названия групп АТХ.', cause);
      return null;
    }),
  ]);

  const slug = substanceCardSlug(document);
  const cardIndex = slug ? index?.cardBySlug.get(slug) : undefined;
  const ownInstruction = parseMedicationProduct(document, null)?.instructionDocumentId;
  const candidates = [
    ...(ownInstruction ? [ownInstruction] : []),
    ...(cardIndex === undefined ? [] : (index?.documentsOfCard.get(cardIndex) ?? [])),
  ].slice(0, INSTRUCTION_ATTEMPTS);
  let instruction: MedicalDocument | null = null;
  for (const id of candidates) {
    const result = await core.getDocument(id);
    if (result.ok) {
      if (!instructionEffect(result.value)) continue;
      instruction = result.value;
      break;
    }
    // Not found: that instruction's module is not installed; try the next one.
    if (result.error.code !== 'CONTENT_NOT_FOUND') {
      console.error('Не удалось прочитать инструкцию для подсказки.', result.error.code);
    }
  }
  return buildMedicationLinkSummary({ document, index, atcNames, instruction });
}
