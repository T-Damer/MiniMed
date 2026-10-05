/**
 * What the app knows about an official instruction document, read from its stored metadata only:
 * the source class (ГРЛС file or a holder's own site), the kind of document, the edition label, the
 * source and fetch date, how the text was matched to the registration and how it was obtained
 * (native text layer or OCR). Nothing here is inferred from the text.
 */

export type InstructionKind = 'ohlp' | 'national-instruction' | 'leaflet' | 'unknown';

/** Where the document comes from: a file of the ГРЛС, or the holder's own site (M1, ADR-0023). */
export type InstructionSourceClass = 'grls' | 'manufacturer-site';

/** How a manufacturer-site document was tied to the registration, strongest first. */
export type InstructionMatchLevel = 'text-number' | 'page-number' | 'label-unique';

const KIND_LABELS: Readonly<Record<InstructionKind, string>> = {
  leaflet: 'Листок-вкладыш (для пациента)',
  'national-instruction': 'Инструкция по медицинскому применению',
  ohlp: 'ОХЛП (общая характеристика лекарственного препарата)',
  unknown: 'Инструкция ГРЛС',
};

/** A professional text outranks the patient leaflet when one registration has several documents. */
const SOURCE_RANK: Readonly<Record<InstructionSourceClass, number>> = {
  grls: 0,
  'manufacturer-site': 1,
};

const KIND_RANK: Readonly<Record<InstructionKind, number>> = {
  ohlp: 0,
  'national-instruction': 1,
  unknown: 2,
  leaflet: 3,
};

type Metadata = Readonly<Record<string, unknown>> | undefined;

export function instructionSourceClassOf(metadata: Metadata): InstructionSourceClass {
  return metadata?.['sourceClass'] === 'manufacturer-site' ? 'manufacturer-site' : 'grls';
}

function matchLevelOf(value: unknown): InstructionMatchLevel | null {
  return value === 'text-number' || value === 'page-number' || value === 'label-unique'
    ? value
    : null;
}

/**
 * The match level of a manufacturer-site document for one registration: the entry of
 * `registrationMatches` for that number, else the weakest level the document records.
 */
export function instructionMatchLevel(
  metadata: Metadata,
  registrationNumber?: string,
): InstructionMatchLevel | null {
  const matches = metadata?.['registrationMatches'];
  if (registrationNumber && Array.isArray(matches)) {
    for (const item of matches as readonly unknown[]) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Readonly<Record<string, unknown>>;
      if (record['registrationNumber'] === registrationNumber) {
        const level = matchLevelOf(record['matchLevel']);
        if (level) return level;
      }
    }
  }
  return matchLevelOf(metadata?.['matchLevel']);
}

const MATCH_NOTES: Readonly<Record<InstructionMatchLevel, string>> = {
  'text-number':
    'Сопоставлено с препаратом по номеру регистрации, напечатанному в самом документе.',
  'page-number':
    'Сопоставлено с препаратом по номеру регистрации на странице препарата сайта производителя.',
  'label-unique':
    'Сопоставлено по названию, форме и держателю регистрации: номер регистрации в документе не напечатан.',
};

export function instructionMatchNote(level: InstructionMatchLevel | null): string | null {
  return level ? MATCH_NOTES[level] : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function instructionKindOf(metadata: Metadata): InstructionKind {
  const kind = metadata?.['documentKind'];
  return kind === 'ohlp' || kind === 'national-instruction' || kind === 'leaflet'
    ? kind
    : 'unknown';
}

export function instructionKindLabel(kind: InstructionKind): string {
  return KIND_LABELS[kind];
}

/** Every registration number the document serves (the same PDF can carry several). */
export function instructionRegistrations(metadata: Metadata): readonly string[] {
  const numbers = new Set<string>();
  const primary = text(metadata?.['registrationNumber']);
  if (primary) numbers.add(primary);
  for (const key of ['requestedRegistrationNumbers', 'registrationNumbers']) {
    const list = metadata?.[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const value = text(item);
      if (value) numbers.add(value);
    }
  }
  return [...numbers];
}

interface IndexedSummary {
  readonly id: string;
  readonly sourceType: string;
  readonly metadata?: Metadata;
}

function isPreferred(
  candidate: { readonly id: string; readonly metadata: Metadata },
  current: { readonly id: string; readonly metadata: Metadata },
): boolean {
  // A ГРЛС file outranks a holder's own site for the same registration.
  const bySource =
    SOURCE_RANK[instructionSourceClassOf(candidate.metadata)] -
    SOURCE_RANK[instructionSourceClassOf(current.metadata)];
  if (bySource !== 0) return bySource < 0;
  const byKind =
    KIND_RANK[instructionKindOf(candidate.metadata)] -
    KIND_RANK[instructionKindOf(current.metadata)];
  if (byKind !== 0) return byKind < 0;
  const candidateFetched = text(candidate.metadata?.['fetchedAt']) ?? '';
  const currentFetched = text(current.metadata?.['fetchedAt']) ?? '';
  if (candidateFetched !== currentFetched) return candidateFetched > currentFetched;
  return candidate.id < current.id;
}

function chooseInstructions(
  documents: readonly IndexedSummary[],
): ReadonlyMap<string, { readonly id: string; readonly metadata: Metadata }> {
  const chosen = new Map<string, { readonly id: string; readonly metadata: Metadata }>();
  for (const document of documents) {
    if (document.sourceType !== 'official_drug_instruction') continue;
    for (const registration of instructionRegistrations(document.metadata)) {
      const candidate = { id: document.id, metadata: document.metadata };
      const current = chosen.get(registration);
      if (!current || isPreferred(candidate, current)) chosen.set(registration, candidate);
    }
  }
  return chosen;
}

/** Registration number → instruction document id, from the documents the core lists. */
export function instructionIndexFromDocuments(
  documents: readonly IndexedSummary[],
): ReadonlyMap<string, string> {
  return new Map(
    [...chooseInstructions(documents)].map(([registration, entry]) => [registration, entry.id]),
  );
}

/** Registration number → where the document the index chose for it comes from. */
export function instructionSourceClassIndex(
  documents: readonly IndexedSummary[],
): ReadonlyMap<string, InstructionSourceClass> {
  return new Map(
    [...chooseInstructions(documents)].map(([registration, entry]) => [
      registration,
      instructionSourceClassOf(entry.metadata),
    ]),
  );
}

export type InstructionTextQuality = 'native' | 'ocr' | 'ocr-low';

export interface InstructionSourceInfo {
  readonly sourceClass: InstructionSourceClass;
  /** The holder named by a manufacturer-site document. */
  readonly publisher: string | null;
  /** How a manufacturer-site document was matched to the registration; null for a ГРЛС file. */
  readonly matchLevel: InstructionMatchLevel | null;
  readonly matchNote: string | null;
  readonly kind: InstructionKind;
  readonly kindLabel: string;
  /** «Изм. № 0, ЛП-008472, 2022», as the registry labels the edition. */
  readonly edition: string | null;
  readonly sourceUrl: string | null;
  /** When the PDF was fetched, `дд.мм.гггг`. */
  readonly fetchedOn: string | null;
  readonly quality: InstructionTextQuality;
  /** Why the text may differ from the printed instruction; null for a native text layer. */
  readonly qualityNote: string | null;
}

/** OCR text with more unknown words than this is flagged as low quality. */
export const LOW_QUALITY_UNKNOWN_WORD_RATIO = 0.1;
/** Share of low-confidence OCR characters that flags the same. */
export const LOW_QUALITY_OCR_RATIO = 0.2;

/** `2026-07-30T07:56:33Z` → `30.07.2026`; null when the value is not an ISO date. */
export function formatFetchDate(value: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value ?? '');
  return match ? `${match[3] ?? ''}.${match[2] ?? ''}.${match[1] ?? ''}` : null;
}

export function instructionTextQuality(metadata: Metadata): InstructionTextQuality {
  if (metadata?.['ocr'] !== true) return 'native';
  const unknownWords = number(metadata['unknownWordRatio']) ?? 0;
  const lowConfidence = number(metadata['ocrLowConfidenceRatio']) ?? 0;
  return unknownWords > LOW_QUALITY_UNKNOWN_WORD_RATIO || lowConfidence > LOW_QUALITY_OCR_RATIO
    ? 'ocr-low'
    : 'ocr';
}

const QUALITY_NOTES: Readonly<Record<InstructionTextQuality, string | null>> = {
  native: null,
  ocr: 'Текст получен распознаванием скана (OCR): возможны ошибки, сверяйтесь с оригиналом ГРЛС.',
  'ocr-low':
    'Скан распознан с низким качеством (OCR): в тексте вероятны искажения слов и цифр, дозировки проверяйте по оригиналу ГРЛС.',
};

/**
 * The source block of an instruction document; null for any other document.
 * `registrationNumber` is the product the text is shown for: it selects that registration's match.
 */
export function instructionSourceInfo(
  document: { readonly sourceType: string; readonly metadata: Metadata } | undefined,
  registrationNumber?: string,
): InstructionSourceInfo | null {
  if (document?.sourceType !== 'official_drug_instruction') return null;
  const kind = instructionKindOf(document.metadata);
  const quality = instructionTextQuality(document.metadata);
  const url = text(document.metadata?.['officialSourceUrl']);
  const sourceClass = instructionSourceClassOf(document.metadata);
  const matchLevel =
    sourceClass === 'manufacturer-site'
      ? instructionMatchLevel(document.metadata, registrationNumber)
      : null;
  return {
    sourceClass,
    publisher: sourceClass === 'manufacturer-site' ? text(document.metadata?.['publisher']) : null,
    matchLevel,
    matchNote: instructionMatchNote(matchLevel),
    kind,
    kindLabel:
      sourceClass === 'manufacturer-site' && kind === 'unknown'
        ? 'Инструкция производителя'
        : instructionKindLabel(kind),
    edition: text(document.metadata?.['instructionLabel']),
    sourceUrl: url && /^https:\/\//u.test(url) ? url : null,
    fetchedOn: formatFetchDate(text(document.metadata?.['fetchedAt'])),
    quality,
    qualityNote: QUALITY_NOTES[quality],
  };
}

/** `minimed.medications.<group>.ru` → the module of that group's official instructions. */
export function instructionModuleIdForSubstanceModule(substanceModuleId: string): string | null {
  const match = /^minimed\.medications\.([a-z-]+)\.ru$/u.exec(substanceModuleId);
  const group = match?.[1];
  return group && group !== 'instructions' ? `minimed.medications.instructions.${group}.ru` : null;
}
