/**
 * What the app knows about an official ГРЛС instruction document, read from its stored metadata
 * only: the kind of document, the edition label, the source and fetch date, and how the text was
 * obtained (native text layer or OCR). Nothing here is inferred from the text.
 */

export type InstructionKind = 'ohlp' | 'national-instruction' | 'leaflet' | 'unknown';

const KIND_LABELS: Readonly<Record<InstructionKind, string>> = {
  leaflet: 'Листок-вкладыш (для пациента)',
  'national-instruction': 'Инструкция по медицинскому применению',
  ohlp: 'ОХЛП (общая характеристика лекарственного препарата)',
  unknown: 'Инструкция ГРЛС',
};

/** A professional text outranks the patient leaflet when one registration has several documents. */
const KIND_RANK: Readonly<Record<InstructionKind, number>> = {
  ohlp: 0,
  'national-instruction': 1,
  unknown: 2,
  leaflet: 3,
};

type Metadata = Readonly<Record<string, unknown>> | undefined;

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
  const byKind =
    KIND_RANK[instructionKindOf(candidate.metadata)] -
    KIND_RANK[instructionKindOf(current.metadata)];
  if (byKind !== 0) return byKind < 0;
  const candidateFetched = text(candidate.metadata?.['fetchedAt']) ?? '';
  const currentFetched = text(current.metadata?.['fetchedAt']) ?? '';
  if (candidateFetched !== currentFetched) return candidateFetched > currentFetched;
  return candidate.id < current.id;
}

/** Registration number → instruction document id, from the documents the core lists. */
export function instructionIndexFromDocuments(
  documents: readonly IndexedSummary[],
): ReadonlyMap<string, string> {
  const chosen = new Map<string, { readonly id: string; readonly metadata: Metadata }>();
  for (const document of documents) {
    if (document.sourceType !== 'official_drug_instruction') continue;
    for (const registration of instructionRegistrations(document.metadata)) {
      const candidate = { id: document.id, metadata: document.metadata };
      const current = chosen.get(registration);
      if (!current || isPreferred(candidate, current)) chosen.set(registration, candidate);
    }
  }
  return new Map([...chosen].map(([registration, entry]) => [registration, entry.id]));
}

export type InstructionTextQuality = 'native' | 'ocr' | 'ocr-low';

export interface InstructionSourceInfo {
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

/** The source block of an instruction document; null for any other document. */
export function instructionSourceInfo(
  document: { readonly sourceType: string; readonly metadata: Metadata } | undefined,
): InstructionSourceInfo | null {
  if (document?.sourceType !== 'official_drug_instruction') return null;
  const kind = instructionKindOf(document.metadata);
  const quality = instructionTextQuality(document.metadata);
  const url = text(document.metadata?.['officialSourceUrl']);
  return {
    kind,
    kindLabel: instructionKindLabel(kind),
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
