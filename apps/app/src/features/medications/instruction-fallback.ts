/**
 * Same-substance instruction fallback (ADR-0023), the app side.
 *
 * The matching is build-time data: `substance-fallback.json`, made by
 * `tools/ingest/scripts/build_substance_fallback.py`, lists for a registration without an own
 * instruction document the ranked donors — other registrations of the same ЕСКЛП МНН card whose
 * documents may stand in for it. This module validates that asset, resolves a donor to an installed
 * document and words the label. It never matches anything itself: no similarity, no cross-МНН
 * lookup, no merging of texts.
 */
import { displayDrugName, displayStrength } from '@/features/medications/drug-screen';
import type {
  InstructionFallbackSource,
  MedicationProduct,
} from '@/features/medications/medication-record';

export const FALLBACK_SCHEMA_VERSION = 1;

/** Flags of a level-2 donor, as the builder writes them (`substance_fallback.py`). */
export const FALLBACK_FLAG_STRENGTH_DIFFERS = 1;
export const FALLBACK_FLAG_STRENGTH_UNKNOWN = 2;
export const FALLBACK_FLAG_FORM_DIFFERS = 4;
const FALLBACK_FLAGS_MASK = 7;

export interface FallbackDonor {
  readonly registrationNumber: string;
  readonly flags: number;
}

export interface FallbackGroup {
  readonly level: 1 | 2;
  readonly donors: readonly FallbackDonor[];
}

export interface SubstanceFallbackAsset {
  readonly esklpEdition: string | null;
  readonly grlsRegistryEdition: string | null;
  /** Registration number → its donors. Only registrations without an own text are listed. */
  readonly registrations: ReadonlyMap<string, FallbackGroup>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDonor(value: unknown, level: 1 | 2): FallbackDonor {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Substance fallback: a donor is not [registration, flags]');
  }
  const [registrationNumber, flags] = value as readonly unknown[];
  if (typeof registrationNumber !== 'string' || registrationNumber.length === 0) {
    throw new Error('Substance fallback: a donor has no registration number');
  }
  if (
    typeof flags !== 'number' ||
    !Number.isInteger(flags) ||
    flags < 0 ||
    flags > FALLBACK_FLAGS_MASK
  ) {
    throw new Error(`Substance fallback: ${registrationNumber} has invalid flags`);
  }
  // Level 1 never carries a difference; level 2 always carries at least one.
  if ((level === 1) !== (flags === 0)) {
    throw new Error(`Substance fallback: ${registrationNumber} flags contradict its level`);
  }
  return { registrationNumber, flags };
}

function parseGroup(value: unknown): FallbackGroup {
  if (!isRecord(value)) throw new Error('Substance fallback: a group is not an object');
  const { level, donors } = value;
  if (level !== 1 && level !== 2) throw new Error('Substance fallback: a group has no level');
  if (!Array.isArray(donors) || donors.length === 0) {
    throw new Error('Substance fallback: a group has no donors');
  }
  return {
    level,
    donors: (donors as readonly unknown[]).map((donor) => parseDonor(donor, level)),
  };
}

/** Checks the asset's shape once; a malformed asset is an error, never an empty fallback. */
export function parseSubstanceFallbackAsset(value: unknown): SubstanceFallbackAsset {
  if (!isRecord(value)) throw new Error('Substance fallback: not an object');
  if (value['schemaVersion'] !== FALLBACK_SCHEMA_VERSION) {
    throw new Error('Substance fallback: unsupported schema version');
  }
  const { basis, groups, registrations } = value;
  if (!isRecord(basis)) throw new Error('Substance fallback: basis is missing');
  if (!Array.isArray(groups)) throw new Error('Substance fallback: groups are missing');
  if (!isRecord(registrations)) throw new Error('Substance fallback: registrations are missing');
  const parsedGroups = (groups as readonly unknown[]).map(parseGroup);
  const entries = new Map<string, FallbackGroup>();
  for (const [registrationNumber, index] of Object.entries(registrations)) {
    const group = typeof index === 'number' ? parsedGroups[index] : undefined;
    if (!group) {
      throw new Error(`Substance fallback: ${registrationNumber} points at an unknown group`);
    }
    entries.set(registrationNumber, group);
  }
  const edition = (key: string): string | null =>
    typeof basis[key] === 'string' ? basis[key] : null;
  return {
    esklpEdition: edition('esklpEdition'),
    grlsRegistryEdition: edition('grlsRegistryEdition'),
    registrations: entries,
  };
}

function normalizedKey(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

/** The donor's presentation closest to the product's: same form and strength, else the first. */
function closestPresentation(
  variants: readonly MedicationProduct[],
  product: MedicationProduct,
): MedicationProduct['presentations'][number] | undefined {
  const wanted = product.presentations[0];
  const all = variants.flatMap((variant) => variant.presentations);
  return (
    all.find(
      (item) =>
        !!wanted &&
        normalizedKey(item.dosageForm) === normalizedKey(wanted.dosageForm) &&
        normalizedKey(item.strength ?? '') === normalizedKey(wanted.strength ?? ''),
    ) ?? all[0]
  );
}

/**
 * The fallback of one product, or null: the product is not an ЕСКЛП registration, has a text of its
 * own, the asset lists no donor for it, or no listed donor both belongs to the product's МНН card
 * and has an installed document. The donors are walked in the asset's ranking.
 */
export function resolveInstructionFallback(input: {
  readonly product: MedicationProduct;
  readonly cardProducts: readonly MedicationProduct[];
  readonly asset: SubstanceFallbackAsset;
  readonly instructionIndex: ReadonlyMap<string, string>;
}): { readonly documentId: string; readonly source: InstructionFallbackSource } | null {
  const { product, cardProducts, asset, instructionIndex } = input;
  if (product.sourceKind !== 'esklp' || product.instructionDocumentId || !product.mnnDocumentId) {
    return null;
  }
  const group = asset.registrations.get(product.registrationNumber);
  if (!group) return null;
  for (const donor of group.donors) {
    const documentId = instructionIndex.get(donor.registrationNumber);
    if (!documentId) continue;
    // Never across an МНН: the donor must be a registration of this very card.
    const variants = cardProducts.filter(
      (candidate) =>
        candidate.registrationNumber === donor.registrationNumber &&
        candidate.sourceKind === 'esklp' &&
        candidate.mnnDocumentId === product.mnnDocumentId,
    );
    const first = variants[0];
    if (!first) continue;
    const presentation = closestPresentation(variants, product);
    return {
      documentId,
      source: {
        level: group.level,
        flags: donor.flags,
        registrationNumber: donor.registrationNumber,
        tradeName: first.tradeName,
        holder: first.holder,
        dosageForm: presentation?.dosageForm ?? null,
        strength: presentation?.strength ?? null,
      },
    };
  }
  return null;
}

/**
 * The product with its fallback applied. Idempotent: a product that carries a fallback from an
 * earlier session (history state) is re-resolved against the documents that are installed now, so a
 * donor that is gone stops applying and an own text that has arrived replaces it.
 */
export function productWithInstructionFallback(input: {
  readonly product: MedicationProduct;
  readonly cardProducts: readonly MedicationProduct[];
  readonly asset: SubstanceFallbackAsset;
  readonly instructionIndex: ReadonlyMap<string, string>;
}): MedicationProduct {
  const { product, instructionIndex } = input;
  if (product.sourceKind !== 'esklp') return product;
  const own = instructionIndex.get(product.registrationNumber) ?? null;
  const { instructionFallback: staleFallback, ...rest } = product;
  const base: MedicationProduct = own
    ? { ...rest, instructionDocumentId: own }
    : staleFallback
      ? { ...rest, instructionDocumentId: null }
      : product;
  const found = resolveInstructionFallback({ ...input, product: base });
  if (!found) return base;
  return { ...base, instructionDocumentId: found.documentId, instructionFallback: found.source };
}

/** Whether two products show the same text in the «Инструкция» tab, from the same source. */
export function sameInstructionSlot(left: MedicationProduct, right: MedicationProduct): boolean {
  return (
    left.instructionDocumentId === right.instructionDocumentId &&
    left.instructionSourceClass === right.instructionSourceClass &&
    left.instructionFallback?.registrationNumber ===
      right.instructionFallback?.registrationNumber &&
    left.instructionFallback?.level === right.instructionFallback?.level &&
    left.instructionFallback?.flags === right.instructionFallback?.flags
  );
}

/** An asset that lists nothing: used when the real one could not be loaded. */
export const EMPTY_SUBSTANCE_FALLBACK: SubstanceFallbackAsset = {
  esklpEdition: null,
  grlsRegistryEdition: null,
  registrations: new Map(),
};

/** Every product of a card with its fallback applied. */
export function applyInstructionFallbacks(
  products: readonly MedicationProduct[],
  asset: SubstanceFallbackAsset,
  instructionIndex: ReadonlyMap<string, string>,
): readonly MedicationProduct[] {
  return products.map((product) =>
    productWithInstructionFallback({ product, cardProducts: products, asset, instructionIndex }),
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Wording                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const FALLBACK_LABEL = 'Инструкция другого производителя: то же вещество, форма и дозировка';

const FALLBACK_NOT_OWN_NOTE =
  'Это не инструкция выбранного препарата: у него в установленных базах собственного текста нет. Тексты не объединяются и не изменены.';

export interface FallbackNotice {
  readonly label: string;
  /** What differs from the product; empty at level 1. */
  readonly warnings: readonly string[];
  /** «Источник: Цискан · ЛП-… · форма · дозировка», the donor's facts. */
  readonly sourceFacts: readonly { readonly term: string; readonly value: string }[];
  readonly note: string;
}

/** The registry writes forms in capitals; «ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ» reads as a sentence. */
function formText(form: string | null): string | null {
  const text = form?.trim().toLocaleLowerCase('ru-RU');
  return text ? text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1) : null;
}

export function fallbackWarnings(flags: number): readonly string[] {
  const warnings: string[] = [];
  if (flags & FALLBACK_FLAG_STRENGTH_DIFFERS) {
    warnings.push('Дозировка отличается: проверьте дозы по своему препарату');
  }
  if (flags & FALLBACK_FLAG_STRENGTH_UNKNOWN) {
    warnings.push('Дозировка в реестре не указана: проверьте дозы по своему препарату');
  }
  if (flags & FALLBACK_FLAG_FORM_DIFFERS) {
    warnings.push(
      'Лекарственная форма отличается: проверьте дозы и способ применения по своему препарату',
    );
  }
  return warnings;
}

/** The notice above a fallback text: label, warnings and the donor product, as plain data. */
export function fallbackNotice(source: InstructionFallbackSource): FallbackNotice {
  const facts: { term: string; value: string }[] = [
    { term: 'Препарат-источник', value: displayDrugName(source.tradeName) },
    { term: 'Регистрация', value: source.registrationNumber },
  ];
  if (source.holder) facts.push({ term: 'Держатель', value: source.holder });
  const form = [
    formText(source.dosageForm),
    source.strength ? displayStrength(source.strength) : null,
  ]
    .filter((part) => part)
    .join(' · ');
  if (form) facts.push({ term: 'Форма и дозировка', value: form });
  return {
    label: FALLBACK_LABEL,
    warnings: source.level === 1 ? [] : fallbackWarnings(source.flags),
    sourceFacts: facts,
    note: FALLBACK_NOT_OWN_NOTE,
  };
}
