import type { MedicalDocument } from '@localmed/contracts';

import type { SickLeaveEntry, SickLeaveResult } from '@/features/sick-leave/sick-leave-data';
import { pluralRu } from '@/i18n/labels';

/** Text and selection rules of the sick-leave panel of an ICD-10 card; the component only renders. */

function stringValues(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  const items: readonly unknown[] = value;
  return items.filter((item): item is string => typeof item === 'string');
}

function isClinicalRecommendation(document: Pick<MedicalDocument, 'metadata' | 'sourceType'>) {
  return (
    document.metadata?.['catalogFamily'] === 'clinical' ||
    document.sourceType === 'clinical_recommendation' ||
    document.sourceType === 'clinical_recommendation_summary'
  );
}

/**
 * The diagnoses the panel answers for: an ICD-10 card's own `mkbCode`, and the `icd10Codes` of a
 * clinical recommendation. Codes another document merely mentions (a drug's indications, a TNM
 * site list) are not a diagnosis of that document, so they get no sick-leave rows.
 */
export function sickLeaveDocumentCodes(
  document: Pick<MedicalDocument, 'metadata' | 'sourceType'>,
): readonly string[] {
  const metadata: Readonly<Record<string, unknown>> = document.metadata ?? {};
  return [
    ...stringValues(metadata['mkbCode']),
    ...(isClinicalRecommendation(document) ? stringValues(metadata['icd10Codes']) : []),
  ];
}

/** How many diagnoses of one card get rows (a clinical recommendation can carry dozens of codes). */
export const MAX_ENTRIES = 12;

export const HELP_TITLE = 'Как читать сроки';

export interface ParsedPeriod {
  readonly from: number;
  readonly to: number;
  readonly unit: 'days' | 'months';
  /** The letter marks the period with «МСЭ» or «возможно МСЭ» (a referral is considered). */
  readonly referral: boolean;
  readonly referralPossible: boolean;
}

const PERIOD = /^(\d+(?:,\d)?)(?: - (\d+(?:,\d)?))?( мес\.)?(?:,? (возможно )?МСЭ)?$/u;
const HAS_REFERRAL = /МСЭ$/u;

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

/** «9 - 11» → days 9–11; «4 - 5 мес.» → months; «35 - 50, МСЭ» keeps the referral mark. */
export function parsePeriod(text: string): ParsedPeriod | null {
  const match = PERIOD.exec(text.trim());
  if (!match) return null;
  const from = toNumber(match[1] ?? '');
  const to = match[2] === undefined ? from : toNumber(match[2]);
  return {
    from,
    to,
    unit: match[3] === undefined ? 'days' : 'months',
    referral: HAS_REFERRAL.test(text),
    referralPossible: match[4] !== undefined,
  };
}

function numberText(value: number): string {
  return String(value).replace('.', ',');
}

/** «дней» agrees with the last number of a range: «1–3 дня», «5–10 дней», «21 день». */
function dayWord(value: number): string {
  if (!Number.isInteger(value)) return 'дня';
  return pluralRu(value, 'день', 'дня', 'дней');
}

/** «9–11 дней», «4–5 мес.», «35–50 дней, МСЭ»; text the pattern does not know is returned as printed. */
export function formatPeriod(text: string): string {
  const parsed = parsePeriod(text);
  if (!parsed) return text;
  const range =
    parsed.from === parsed.to
      ? numberText(parsed.from)
      : `${numberText(parsed.from)}–${numberText(parsed.to)}`;
  const unit = parsed.unit === 'months' ? 'мес.' : dayWord(parsed.to);
  const referral = parsed.referral ? (parsed.referralPossible ? ', возможно МСЭ' : ', МСЭ') : '';
  return `${range} ${unit}${referral}`;
}

/** The span covered by all periods of one unit in `entries`; null when there are none. */
export function periodSpan(
  entries: readonly SickLeaveEntry[],
): { readonly from: number; readonly to: number; readonly unit: 'days' | 'months' } | null {
  const parsed = entries.flatMap((entry) =>
    entry.periods.flatMap((row) => parsePeriod(row.period) ?? []),
  );
  const unit = parsed.find((item) => item.unit === 'days')?.unit ?? parsed[0]?.unit;
  if (!unit) return null;
  const same = parsed.filter((item) => item.unit === unit);
  return {
    from: Math.min(...same.map((item) => item.from)),
    to: Math.max(...same.map((item) => item.to)),
    unit,
  };
}

/** «9–11 дней» for the header of the compact row: the span of the card's rows. */
export function spanText(span: NonNullable<ReturnType<typeof periodSpan>>): string {
  const range =
    span.from === span.to
      ? numberText(span.from)
      : `${numberText(span.from)}–${numberText(span.to)}`;
  return `${range} ${span.unit === 'months' ? 'мес.' : dayWord(span.to)}`;
}

/** Distinct entries of all codes of a card, in the letter's order, with how many were cut. */
export function shownEntries(results: readonly SickLeaveResult[]): {
  readonly entries: readonly SickLeaveEntry[];
  readonly rest: number;
} {
  const seen = new Set<string>();
  const unique: SickLeaveEntry[] = [];
  for (const result of results) {
    for (const entry of result.entries) {
      const key = `${entry.code}|${entry.title}|${entry.periods.map((row) => row.features + row.period).join(';')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(entry);
    }
  }
  return { entries: unique.slice(0, MAX_ENTRIES), rest: Math.max(0, unique.length - MAX_ENTRIES) };
}

/** Header of the compact row: the span for a card with one diagnosis, the count for several. */
export function headerText(entries: readonly SickLeaveEntry[], rest: number): string {
  const total = entries.length + rest;
  const span = total === 1 ? periodSpan(entries) : null;
  if (span) return `Больничный: ${spanText(span)}`;
  return `Больничный: сроки для ${String(total)} ${pluralRu(total, 'диагноза', 'диагнозов', 'диагнозов')}`;
}

export function moreEntriesText(count: number): string {
  return `и ещё ${String(count)}`;
}

export interface EntryFootnotes {
  /** Distinct footnote texts of the entry in order of first use. */
  readonly texts: readonly string[];
  /** «1», «1,2» for the entry's title and for each period row; «» when a row has none. */
  readonly titleMark: string;
  readonly rowMarks: readonly string[];
}

/** Numbers the letter's footnotes within one entry so the rows can carry a small superscript. */
export function entryFootnotes(entry: SickLeaveEntry): EntryFootnotes {
  const texts: string[] = [];
  const mark = (notes: readonly string[]): string =>
    notes
      .map((text) => {
        const known = texts.indexOf(text);
        if (known >= 0) return known + 1;
        texts.push(text);
        return texts.length;
      })
      .join(',');
  const titleMark = mark(entry.footnotes);
  return { texts, titleMark, rowMarks: entry.periods.map((row) => mark(row.footnotes)) };
}
