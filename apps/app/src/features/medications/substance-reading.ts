/**
 * What a drug card reads as its body (owner 2026-10-20: «doctors don't need registrations; they need
 * forms, doses, usage, analogs and generics»). The ЕСКЛП card is a registry dump — every package,
 * price and barcode of every registration, 144 screens for propranolol — so its registry sections
 * never form the body: the body is an official instruction or a reference text, and the forms are
 * one line under the name.
 * The registrations stay reachable, compactly, under «⋯» → «Информация».
 */
import type { MedicalDocument } from '@localmed/contracts';

import {
  displayDrugName,
  displayStrength,
  drugNameKey,
  isEsklpSubstanceDocument,
} from '@/features/medications/drug-screen';
import type { MedicationProduct } from '@/features/medications/medication-record';

/** ЕСКЛП card sections that are registry data, not clinical content. */
const REGISTRY_SECTION_TITLES: ReadonlySet<string> = new Set([
  'Торговые наименования',
  // The registry's raw form list («ТАБЛЕТКИ, 10.0мг»); the card's «Формы:» line says it readably.
  'Формы и дозировки',
  'Сведения о стандартизированном МНН',
  // The builder's disclaimer about the registry; the owner wants no such notes anywhere.
  'Ограничения данных',
]);

export function isRegistrySectionTitle(title: string): boolean {
  return REGISTRY_SECTION_TITLES.has(title.trim());
}

/**
 * The ЕСКЛП card without its registry sections, for the reader's body. Any other document is
 * returned as it is (same object), so callers can compare identities.
 */
export function withoutRegistrySections(document: MedicalDocument): MedicalDocument {
  if (!isEsklpSubstanceDocument(document)) return document;
  const sections = document.sections.filter((section) => !isRegistrySectionTitle(section.title));
  return sections.length === document.sections.length ? document : { ...document, sections };
}

const EVERYDAY_FORM = /таблетк|капсул/iu;
const CHILDREN_FORM = /дет|педиатр/iu;

function isEverydayForm(product: MedicationProduct): boolean {
  return product.presentations.some((presentation) => EVERYDAY_FORM.test(presentation.dosageForm));
}

function isForChildren(product: MedicationProduct): boolean {
  return (
    CHILDREN_FORM.test(product.tradeName) ||
    product.presentations.some((presentation) => CHILDREN_FORM.test(presentation.dosageForm))
  );
}

function ownInstruction(product: MedicationProduct): boolean {
  return product.instructionDocumentId !== null && !product.instructionFallback;
}

/**
 * The trade name whose official instruction the substance card shows: its own text before another
 * registration's, a ГРЛС file before a holder's site, tablets or capsules before other forms, an
 * adult form before a children's one, the trade name that is the substance's own name
 * («Пропранолол») before brand names, then the registration with the most presentations, then the
 * registration number. Null when no registration of the card has an instruction installed.
 */
export function representativeInstructionProduct(
  products: readonly MedicationProduct[],
  substanceName: string,
): MedicationProduct | null {
  const substance = drugNameKey(substanceName);
  const withText = products.filter((product) => product.instructionDocumentId !== null);
  const ranked = withText.toSorted(
    (left, right) =>
      Number(ownInstruction(right)) - Number(ownInstruction(left)) ||
      Number(left.instructionSourceClass === 'manufacturer-site') -
        Number(right.instructionSourceClass === 'manufacturer-site') ||
      // The everyday form first: tablets or capsules for adults, not children's suppositories.
      Number(isEverydayForm(right)) - Number(isEverydayForm(left)) ||
      Number(isForChildren(left)) - Number(isForChildren(right)) ||
      Number(drugNameKey(right.tradeName) === substance) -
        Number(drugNameKey(left.tradeName) === substance) ||
      right.presentations.length - left.presentations.length ||
      left.registrationNumber.localeCompare(right.registrationNumber, 'ru'),
  );
  return ranked[0] ?? null;
}

export interface RegistrationRow {
  readonly key: string;
  /** «Анаприлин» */
  readonly name: string;
  /** «таблетки 10 мг, 40 мг» */
  readonly forms: string;
  /** Holder or manufacturer, as the registry writes it. */
  readonly holder: string | null;
  readonly registrationNumber: string;
}

function formsText(product: MedicationProduct): string {
  const byForm = new Map<string, Set<string>>();
  for (const presentation of product.presentations) {
    const form = presentation.dosageForm.trim().toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
    if (!form) continue;
    const strengths = byForm.get(form) ?? new Set<string>();
    const strength = displayStrength(presentation.strength ?? '');
    if (strength) strengths.add(strength);
    byForm.set(form, strengths);
  }
  return [...byForm.entries()]
    .map(([form, strengths]) => [form, [...strengths].join(', ')].filter(Boolean).join(' '))
    .join('; ');
}

/**
 * The registrations of a substance card as one short line each — name, forms, holder, number —
 * for «Информация». Packages, prices and barcodes are left out; a registration listed several times
 * (one entry per package) appears once.
 */
export function registrationRows(
  products: readonly MedicationProduct[],
): readonly RegistrationRow[] {
  const rows = new Map<string, RegistrationRow>();
  for (const product of products) {
    const key = `${drugNameKey(product.tradeName)}\u001f${product.registrationNumber}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      key,
      name: displayDrugName(product.tradeName),
      forms: formsText(product),
      holder: product.holder ?? product.manufacturer,
      registrationNumber: product.registrationNumber,
    });
  }
  return [...rows.values()].toSorted(
    (left, right) =>
      left.name.localeCompare(right.name, 'ru') ||
      left.registrationNumber.localeCompare(right.registrationNumber, 'ru'),
  );
}
