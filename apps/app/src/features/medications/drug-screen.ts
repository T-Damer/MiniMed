/**
 * The drug document screen as data: header, quick links, ATC codes and the section index. Pure
 * functions over documents and products that the app already holds; nothing here invents a link or
 * a name, and nothing renders. The components in `DrugScreen*.tsx` only draw this model.
 */
import type { MedicalDocument, MedicalDocumentSummary, MedicalSection } from '@localmed/contracts';

import { type AtcLevel, atcGroupChain, normalizeAtcCode } from '@/features/medications/atc-code';
import {
  instructionIndexFromDocuments,
  instructionSourceClassIndex,
} from '@/features/medications/instruction-source';
import type {
  MedicationProduct,
  TradeNameSupplement,
} from '@/features/medications/medication-record';
import {
  countryMarkText,
  formatTradeNameWithCountry,
  type MfgCountryCatalog,
  manufacturingBasis,
  manufacturingBasisTitle,
  manufacturingCountries,
} from '@/features/medications/mfg-country';

type SourceRecord = Readonly<Record<string, unknown>>;

function recordValue(value: unknown): SourceRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as SourceRecord)
    : null;
}

function recordList(value: unknown): readonly SourceRecord[] {
  return Array.isArray(value)
    ? (value as readonly unknown[]).flatMap((item) => {
        const record = recordValue(item);
        return record ? [record] : [];
      })
    : [];
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sourceField(document: Pick<MedicalDocument, 'metadata'>, key: string): unknown {
  return (document.metadata as SourceRecord)[key];
}

/** Case- and spacing-insensitive identity of a name. */
export function drugNameKey(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

const ROMAN_NUMERAL = /^[IVXLC]+$/u;

/**
 * ЕСКЛП writes trade names and substances in capitals («АКТИТРОПИЛ»). A name that is entirely in
 * capitals reads as «Актитропил»; a name with any lower-case letter is already written by its source
 * and stays as it is. Roman numerals («фактор VIII») keep their capitals.
 */
export function displayDrugName(name: string): string {
  const text = name.trim().replace(/\s+/gu, ' ');
  if (!text) return text;
  if (text !== text.toLocaleUpperCase('ru-RU') || text === text.toLocaleLowerCase('ru-RU')) {
    return text;
  }
  const lowered = text
    .split(' ')
    .map((word) => (ROMAN_NUMERAL.test(word) ? word : word.toLocaleLowerCase('ru-RU')))
    .join(' ');
  return lowered.charAt(0).toLocaleUpperCase('ru-RU') + lowered.slice(1);
}

function sentenceCase(value: string): string {
  const text = value.trim();
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

/** «50.0 мг» → «50 мг»: the registry prints whole numbers with a decimal point. */
export function displayStrength(strength: string): string {
  return strength
    .trim()
    .replace(/(\d+)\.0+(?=\D|$)/gu, '$1')
    .replace(/\s+/gu, ' ');
}

const LONG_FORM_LENGTH = 70;

function presentationLabel(
  presentation: MedicationProduct['presentations'][number] | undefined,
): string | null {
  const form = presentation?.dosageForm.trim();
  // Reference summaries put a whole packaging paragraph into the form field.
  if (!presentation || !form || form.length > LONG_FORM_LENGTH || form.includes('\n')) return null;
  const strength = presentation.strength ? displayStrength(presentation.strength) : null;
  const text = [sentenceCase(form.toLocaleLowerCase('ru-RU')), strength]
    .filter(Boolean)
    .join(' · ');
  return text || null;
}

/**
 * Registration number → instruction document, from the catalog's document summaries. A PDF that
 * serves several registrations is indexed under each; when a registration has several documents
 * the professional text (ОХЛП, instruction) outranks the patient leaflet.
 */
export function instructionIndexFromSummaries(
  summaries: readonly Pick<MedicalDocumentSummary, 'id' | 'sourceType' | 'metadata'>[],
): ReadonlyMap<string, string> {
  return instructionIndexFromDocuments(summaries);
}

/** Registration number → whether the indexed document is a ГРЛС file or a holder's own text. */
export function instructionSourceClassIndexFromSummaries(
  summaries: readonly Pick<MedicalDocumentSummary, 'id' | 'sourceType' | 'metadata'>[],
): ReturnType<typeof instructionSourceClassIndex> {
  return instructionSourceClassIndex(summaries);
}

export function isEsklpSubstanceDocument(document: Pick<MedicalDocument, 'metadata'>): boolean {
  return sourceField(document, 'contentMode') === 'esklp-mnn';
}

/* ------------------------------------------------------------------------------------------ */
/* ATC codes                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface DrugAtcCode {
  /** Normalised Latin code. */
  readonly code: string;
  readonly level: AtcLevel;
  /** The code as the source wrote it, when normalising changed it. */
  readonly sourceCode: string | null;
  /** The ЕСКЛП «pharmacotherapeutic group» text of the node that carries this code. */
  readonly groupText: string | null;
  /** The node's substance name, ready for display. */
  readonly substanceName: string | null;
  /** The ЕСКЛП edition the code comes from, e.g. `28.08.2026`. */
  readonly edition: string | null;
}

/** `2026-08-28` → `28.08.2026`; anything else is shown as the source gave it. */
export function formatSourceEdition(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return match ? `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}` : value;
}

/**
 * The ATC codes of a drug. For a trade name these are the codes of its own substance nodes (the
 * strengths and forms it is registered in); for the substance card, all of its nodes. Codes appear
 * once, in code order; the registry's «~» (no code assigned) is dropped.
 */
export function drugAtcCodes(
  source: Pick<MedicalDocument, 'metadata'> | undefined,
  product: Pick<MedicationProduct, 'smnnCodes'> | undefined,
): readonly DrugAtcCode[] {
  if (!source) return [];
  const edition = formatSourceEdition(textValue(sourceField(source, 'sourceEdition')));
  const allNodes = recordList(sourceField(source, 'smnnNodes'));
  const own =
    product && product.smnnCodes.length > 0
      ? allNodes.filter((node) => product.smnnCodes.includes(textValue(node['smnnCode']) ?? ''))
      : [];
  const nodes = own.length > 0 ? own : allNodes;
  const codes = new Map<string, DrugAtcCode>();
  const add = (rawCode: string, groupText: string | null, substance: string | null): void => {
    const normalized = normalizeAtcCode(rawCode);
    if (!normalized || codes.has(normalized.code)) return;
    codes.set(normalized.code, {
      code: normalized.code,
      level: normalized.level,
      sourceCode: normalized.corrected ? rawCode : null,
      groupText,
      substanceName: substance ? displayDrugName(substance) : null,
      edition,
    });
  };
  for (const node of nodes) {
    const raw = textValue(node['atcCode']);
    if (raw)
      add(raw, textValue(node['pharmacotherapeuticGroup']), textValue(node['standardizedInn']));
  }
  if (codes.size === 0 && allNodes.length === 0) {
    const substance = textValue(sourceField(source, 'standardizedInn'));
    const listed: unknown = sourceField(source, 'atcCodes');
    for (const raw of Array.isArray(listed) ? (listed as readonly unknown[]) : []) {
      const text = textValue(raw);
      if (text) add(text, null, substance);
    }
  }
  return [...codes.values()].toSorted((left, right) => left.code.localeCompare(right.code, 'en'));
}

/* ------------------------------------------------------------------------------------------ */
/* Quick links                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface DrugGroupLink {
  readonly key: string;
  /** The most specific entry of the group text, capitalised. */
  readonly label: string;
  /** The whole group text, for the tooltip. */
  readonly title: string;
  /** What the medication catalog is searched for. */
  readonly query: string;
}

/** Group texts → links; a «;» chain is shown by its most specific entry. Order of first mention. */
export function drugGroupLinks(groupTexts: readonly string[]): readonly DrugGroupLink[] {
  const links = new Map<string, DrugGroupLink>();
  for (const text of groupTexts) {
    const chain = atcGroupChain(text);
    const last = chain.at(-1);
    if (!last) continue;
    const label = sentenceCase(last);
    const key = drugNameKey(label);
    if (!links.has(key))
      links.set(key, { key, label, title: sentenceCase(chain.join(' → ')), query: last });
  }
  return [...links.values()];
}

export type DrugSubstanceTarget =
  /** The opened document is the substance's own card: switch it from the trade name to the card. */
  | { readonly kind: 'substance-card' }
  /** The substance has its own document. */
  | { readonly kind: 'document'; readonly documentId: string };

export interface DrugSubstanceLink {
  readonly label: string;
  readonly target: DrugSubstanceTarget;
}

export interface DrugRelatedProduct {
  readonly key: string;
  /** The trade name alone, ready for display. */
  readonly name: string;
  /** Where this entry's registrations are made; null when the registry does not say. */
  readonly country: string | null;
  /** Says which registry fact `country` rests on. */
  readonly countryTitle: string | undefined;
  /** «Ибупрофен (Индия)»: what a screen reader and a list entry read. */
  readonly label: string;
  /** The registration of this trade name that opens: same form and strength as the current one if any. */
  readonly product: MedicationProduct;
}

function sameForm(left: MedicationProduct, right: MedicationProduct): boolean {
  const leftPresentation = left.presentations[0];
  const rightPresentation = right.presentations[0];
  return (
    !!leftPresentation &&
    !!rightPresentation &&
    drugNameKey(leftPresentation.dosageForm) === drugNameKey(rightPresentation.dosageForm)
  );
}

function sameStrength(left: MedicationProduct, right: MedicationProduct): boolean {
  const leftStrength = left.presentations[0]?.strength;
  const rightStrength = right.presentations[0]?.strength;
  return (
    !!leftStrength &&
    !!rightStrength &&
    drugNameKey(displayStrength(leftStrength)) === drugNameKey(displayStrength(rightStrength))
  );
}

/**
 * Other trade names of the same substance, one entry per trade name and manufacturing country, so
 * «Ибупрофен (Индия)» and «Ибупрофен (Россия)» are two entries. Each opens the registration closest
 * to the current one (same form and strength, then same form), so an analogue of a 50 mg tablet is
 * a tablet. Names in the current form come first; the rest by label. Without a current product (the
 * substance card) every entry is listed. Without a country catalog (not loaded yet) the entries are
 * per trade name alone.
 */
export function drugRelatedProducts(
  products: readonly MedicationProduct[],
  current: MedicationProduct | undefined,
  mfgCountries?: MfgCountryCatalog,
): readonly DrugRelatedProduct[] {
  const keyOf = (name: string, country: string | null): string =>
    `${drugNameKey(name)}\u001f${country ?? ''}`;
  const countriesOf = (product: MedicationProduct): readonly (string | null)[] => {
    const countries = manufacturingCountries(mfgCountries, product.registrationNumber);
    return countries.length > 0 ? countries : [null];
  };
  const currentKeys = new Set(
    current ? countriesOf(current).map((country) => keyOf(current.tradeName, country)) : [],
  );
  const groups = new Map<string, { country: string | null; products: MedicationProduct[] }>();
  for (const product of products) {
    if (!drugNameKey(product.tradeName)) continue;
    for (const country of countriesOf(product)) {
      const key = keyOf(product.tradeName, country);
      if (currentKeys.has(key)) continue;
      const group = groups.get(key) ?? { country, products: [] };
      group.products.push(product);
      groups.set(key, group);
    }
  }
  const entries = [...groups.entries()].flatMap(([key, group]) => {
    const ordered = group.products.toSorted(
      (left, right) =>
        left.registrationNumber.localeCompare(right.registrationNumber, 'ru') ||
        drugNameKey(left.presentations[0]?.strength ?? '').localeCompare(
          drugNameKey(right.presentations[0]?.strength ?? ''),
          'ru',
        ),
    );
    const product =
      (current && ordered.find((item) => sameForm(item, current) && sameStrength(item, current))) ||
      (current && ordered.find((item) => sameForm(item, current))) ||
      ordered[0];
    if (!product) return [];
    const name = displayDrugName(ordered[0]?.tradeName ?? key);
    return [
      {
        key,
        name,
        country: group.country,
        countryTitle: group.country
          ? manufacturingBasisTitle(manufacturingBasis(mfgCountries, product.registrationNumber))
          : undefined,
        label: formatTradeNameWithCountry(name, group.country),
        product,
        inCurrentForm: !!current && sameForm(product, current),
      },
    ];
  });
  return entries
    .toSorted(
      (left, right) =>
        Number(right.inCurrentForm) - Number(left.inCurrentForm) ||
        left.label.localeCompare(right.label, 'ru'),
    )
    .map(({ inCurrentForm: _inCurrentForm, ...entry }) => entry);
}

/* ------------------------------------------------------------------------------------------ */
/* The screen model                                                                            */
/* ------------------------------------------------------------------------------------------ */

export interface DrugHeaderModel {
  readonly kind: 'product' | 'substance';
  /** The small line above the title. */
  readonly kicker: string;
  readonly title: string;
  readonly latinName: string | null;
  /** Where the trade name's product is made, for a trade name only; never set for a substance. */
  readonly country: string | null;
  /** Says which registry fact `country` rests on. */
  readonly countryTitle: string | undefined;
  /** Form and strength, manufacturer: short facts under the name. */
  readonly meta: readonly string[];
  /** Packaging photo reference (a `img/preparations/…` path), when the product has one. */
  readonly imageReference: string | null;
  /** The form and strength are already in `meta`, so the card need not list them again. */
  readonly formInMeta: boolean;
}

/** Trade names shown on the substance card before «Показать ещё N». */
export const DRUG_ACCORDION_VISIBLE = 2;

export interface DrugQuickLinksModel {
  readonly substance: DrugSubstanceLink | null;
  readonly groups: readonly DrugGroupLink[];
  /** «Аналоги» next to a trade name, «Торговые наименования» on the substance card. */
  readonly relatedTitle: string;
  /**
   * The substance card lists every trade name and country, which can be hundreds: it shows
   * `DRUG_ACCORDION_VISIBLE` of them and folds the rest. A trade name's own analogue row does not.
   */
  readonly relatedAccordion: boolean;
  readonly related: readonly DrugRelatedProduct[];
  readonly atc: readonly DrugAtcCode[];
}

export interface DrugScreenModel {
  readonly header: DrugHeaderModel;
  readonly links: DrugQuickLinksModel;
}

export interface DrugScreenInput {
  /** The substance document (ЕСКЛП card) that holds the registry data, when there is one. */
  readonly source: MedicalDocument | undefined;
  /** The document the reader shows; differs from `source` while the instruction is open. */
  readonly document: MedicalDocument;
  /** The trade name the card was opened on; none on the substance card. */
  readonly product: MedicationProduct | undefined;
  /** Every registration of `source`, parsed. */
  readonly sourceProducts: readonly MedicationProduct[];
  readonly supplements: readonly TradeNameSupplement[];
  /** The title of a document the app lists, for links to a substance card. */
  readonly documentTitle: (documentId: string) => string | undefined;
  /** Manufacturing countries by registration number, once the lazy asset has loaded. */
  readonly mfgCountries?: MfgCountryCatalog | undefined;
}

const UNKNOWN_LATIN_NAME = 'не указано';

function latinNameOf(
  product: MedicationProduct | undefined,
  supplements: readonly TradeNameSupplement[],
): string | null {
  if (!product) return null;
  const candidate =
    product.sourceKind === 'allmed'
      ? product.inn
      : supplements.find(
          (supplement) =>
            drugNameKey(supplement.product.tradeName) === drugNameKey(product.tradeName),
        )?.product.inn;
  const name = candidate?.trim();
  if (!name || drugNameKey(name) === UNKNOWN_LATIN_NAME) return null;
  // Only a Latin spelling is a Latin name; a Russian one is the title again.
  return /[A-Za-z]/u.test(name) && drugNameKey(name) !== drugNameKey(product.tradeName)
    ? name
    : null;
}

function imageReferenceOf(
  product: MedicationProduct | undefined,
  supplements: readonly TradeNameSupplement[],
): string | null {
  if (!product) return null;
  if (product.imageReference) return product.imageReference;
  return (
    supplements.find(
      (supplement) =>
        drugNameKey(supplement.product.tradeName) === drugNameKey(product.tradeName) &&
        supplement.product.imageReference,
    )?.product.imageReference ?? null
  );
}

function substanceGroupTexts(source: MedicalDocument | undefined): readonly string[] {
  if (!source) return [];
  return recordList(sourceField(source, 'smnnNodes')).flatMap((node) => {
    const text = textValue(node['pharmacotherapeuticGroup']);
    return text ? [text] : [];
  });
}

function substanceTitle(source: MedicalDocument | undefined, document: MedicalDocument): string {
  const standardized = source ? textValue(sourceField(source, 'standardizedInn')) : null;
  return displayDrugName(
    standardized ?? (source ?? document).title.split('—')[0] ?? document.title,
  );
}

function substanceLinkOf(
  input: DrugScreenInput,
  product: MedicationProduct | undefined,
): DrugSubstanceLink | null {
  if (!product) return null;
  const substanceId = product.mnnDocumentId ?? product.linkedMnnDocumentId;
  if (!substanceId) return null;
  if (input.source?.id === substanceId) {
    return { label: displayDrugName(product.inn), target: { kind: 'substance-card' } };
  }
  const title = input.documentTitle(substanceId);
  return title
    ? { label: displayDrugName(title), target: { kind: 'document', documentId: substanceId } }
    : null;
}

/** What the share action sends: the name, the short facts and the address of the screen. */
export function drugShareText(
  header: Pick<DrugHeaderModel, 'title' | 'latinName' | 'meta'> & {
    readonly country?: string | null;
  },
  pageUrl: string,
): string {
  return [
    formatTradeNameWithCountry(header.title, header.country),
    header.latinName,
    header.meta.join(' · '),
    pageUrl,
  ]
    .filter((line) => line)
    .join('\n');
}

/**
 * The model of a drug screen, or null when the document is not a drug: a trade name is on screen
 * (`product`) or the document is a substance card from ЕСКЛП.
 */
export function buildDrugScreen(input: DrugScreenInput): DrugScreenModel | null {
  const { product, source } = input;
  const substanceCard = !!source && isEsklpSubstanceDocument(source);
  if (!product && !substanceCard) return null;

  const title = product
    ? displayDrugName(product.tradeName)
    : substanceTitle(source, input.document);
  const latinName = latinNameOf(product, input.supplements);
  const countries = product
    ? manufacturingCountries(input.mfgCountries, product.registrationNumber)
    : [];
  const manufacturer = product ? (product.manufacturer ?? product.holder) : null;
  const form = product ? presentationLabel(product.presentations[0]) : null;
  const meta = [form, manufacturer].flatMap((item) => (item ? [item] : []));
  const groupTexts = product
    ? product.pharmacotherapeuticGroups.length > 0
      ? product.pharmacotherapeuticGroups
      : substanceGroupTexts(source)
    : substanceGroupTexts(source);
  const atcSource = source && substanceCard ? source : undefined;

  return {
    header: {
      kind: product ? 'product' : 'substance',
      kicker: product ? 'Препарат' : 'Действующее вещество',
      title,
      latinName,
      country: countryMarkText(countries),
      countryTitle: product
        ? manufacturingBasisTitle(
            manufacturingBasis(input.mfgCountries, product.registrationNumber),
          )
        : undefined,
      meta,
      imageReference: imageReferenceOf(product, input.supplements),
      formInMeta: form !== null && (product?.presentations.length ?? 0) === 1,
    },
    links: {
      substance: substanceLinkOf(input, product),
      groups: drugGroupLinks(groupTexts),
      relatedTitle: product ? 'Аналоги (дженерики, синонимы)' : 'Торговые наименования',
      relatedAccordion: !product,
      related: drugRelatedProducts(input.sourceProducts, product, input.mfgCountries),
      atc: drugAtcCodes(atcSource, product),
    },
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Section index                                                                               */
/* ------------------------------------------------------------------------------------------ */

export interface DrugSectionIndexItem {
  readonly anchor: string;
  readonly label: string;
  readonly number: string;
}

const SECTION_LABEL_LENGTH = 36;

/** Top-level sections as a short row of jump links; a document with one section needs none. */
export function drugSectionIndex(
  sections: readonly Pick<MedicalSection, 'anchor' | 'title' | 'depth'>[],
): readonly DrugSectionIndexItem[] {
  if (sections.length === 0) return [];
  const topDepth = Math.min(...sections.map((section) => section.depth));
  const top = sections.filter((section) => section.depth === topDepth);
  if (top.length < 2) return [];
  return top.map((section, index) => {
    const title = section.title.trim().replace(/\s+/gu, ' ');
    return {
      anchor: section.anchor,
      label:
        title.length > SECTION_LABEL_LENGTH
          ? `${title.slice(0, SECTION_LABEL_LENGTH - 1)}…`
          : title,
      number: String(index + 1).padStart(2, '0'),
    };
  });
}
