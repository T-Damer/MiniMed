/**
 * The optional DDInter severity labels of the interaction tool (INT2). The labels come from the
 * module `minimed.reference.ddinter-severity.ru` (built by `tools/ingest/.../ddinter_severity.py`):
 * one level per pair of ЕСКЛП substances, no text of DDInter. Pure rules live here; the module is
 * read through `interaction-severity-load.ts`.
 *
 * Rules (owner decisions of 2026-10-06):
 * - a label is shown only on a pair that already has at least one quotable instruction sentence,
 *   never alone;
 * - the label names its source («по DDInter») and says that it is not from the instruction;
 * - DDInter's own vocabulary only: Major / Moderate / Minor / Unknown, as labels, never as advice.
 */
import type { MedicalDocument } from '@localmed/contracts';

export const SEVERITY_MODULE_ID = 'minimed.reference.ddinter-severity.ru';
export const SEVERITY_DOCUMENT_PREFIX = 'ddinter.severity.';
export const SEVERITY_MANIFEST_DOCUMENT_ID = `${SEVERITY_DOCUMENT_PREFIX}manifest`;
export const SEVERITY_SITE_URL = 'https://ddinter2.scbdd.com/';
export const SEVERITY_LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';

export type SeverityLevel = 'major' | 'moderate' | 'minor' | 'unknown';

/** The one-character code of the pack (`LEVEL_CODES` of the preparer) → level. */
const LEVEL_OF_CODE: Readonly<Record<string, SeverityLevel>> = {
  '3': 'major',
  '2': 'moderate',
  '1': 'minor',
  '0': 'unknown',
};

const LEVEL_WORDS: Readonly<Record<SeverityLevel, string>> = {
  major: 'Серьёзное',
  moderate: 'Умеренное',
  minor: 'Слабое',
  unknown: 'Степень не определена',
};

/** Higher is more severe. */
export const SEVERITY_RANK: Readonly<Record<SeverityLevel, number>> = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  major: 3,
};

export const SEVERITY_SOURCE_NOTE =
  'Оценка из международной базы DDInter (английские данные), а не из инструкции: в инструкциях степень риска может быть описана иначе.';

/** Where the pair of two cards is stored: the document of the smaller slug lists the larger one. */
export function severityDocumentId(
  first: string,
  second: string,
): { readonly documentId: string; readonly partner: string } {
  const [small, large] = first < second ? [first, second] : [second, first];
  return { documentId: `${SEVERITY_DOCUMENT_PREFIX}${small}`, partner: large };
}

/** `<partner slug> TAB <code>` lines → partner → level. Unknown codes and bad lines are skipped. */
export function parseSeverityText(text: string): ReadonlyMap<string, SeverityLevel> {
  const partners = new Map<string, SeverityLevel>();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const level = LEVEL_OF_CODE[line.slice(tab + 1).trim()];
    if (level) partners.set(line.slice(0, tab), level);
  }
  return partners;
}

/** The text of a severity document: its chunks in reading order. */
export function severityDocumentText(document: MedicalDocument): string {
  return document.sections
    .toSorted((left, right) => left.orderIndex - right.orderIndex)
    .flatMap((section) =>
      section.chunks
        .toSorted((left, right) => left.orderIndex - right.orderIndex)
        .map((chunk) => chunk.originalText),
    )
    .join('\n');
}

export interface SeverityProvenance {
  readonly source: string;
  readonly retrievedOn: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly siteUrl: string;
  readonly labelledPairs: number;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Source, licence and date of the installed module, from its manifest document; null if absent. */
export function readSeverityProvenance(document: MedicalDocument): SeverityProvenance | null {
  const metadata = document.metadata;
  const source = text(metadata['source']);
  const retrievedOn = text(metadata['retrievedOn']);
  const license = text(metadata['license']);
  if (!source || !retrievedOn || !license) return null;
  const pairs = metadata['labelledPairs'];
  return {
    source,
    retrievedOn,
    license: license.replace('CC-BY-NC-SA-4.0', 'CC BY-NC-SA 4.0'),
    licenseUrl: text(metadata['licenseUrl']) ?? SEVERITY_LICENSE_URL,
    siteUrl: text(metadata['sourceUrl']) ?? SEVERITY_SITE_URL,
    labelledPairs: typeof pairs === 'number' ? pairs : 0,
  };
}

export interface PairSeverity {
  readonly level: SeverityLevel;
  /** «Серьёзное по DDInter». */
  readonly label: string;
  readonly note: string;
}

export function severityLabelText(level: SeverityLevel): string {
  return `${LEVEL_WORDS[level]} по DDInter`;
}

/** What the tool can say about severity: nothing while the module is not installed. */
export interface SeverityLookup {
  readonly provenance: SeverityProvenance;
  /** Null when DDInter lists no level for the pair (or its document is not read yet). */
  readonly levelOf: (first: string, second: string) => SeverityLevel | null;
}

/**
 * The label of one pair, or null. A label needs a level for the pair AND at least one instruction
 * sentence that can be quoted now; a pair without a quotable source gets no label at all.
 */
export function pairSeverity(
  lookup: SeverityLookup | null,
  pair: { readonly firstId: string; readonly secondId: string; readonly quotable: number },
): PairSeverity | null {
  if (!lookup || pair.quotable <= 0) return null;
  const level = lookup.levelOf(pair.firstId, pair.secondId);
  if (!level) return null;
  return { level, label: severityLabelText(level), note: SEVERITY_SOURCE_NOTE };
}

export function severityAttribution(provenance: SeverityProvenance): string {
  return `Метки степени риска: ${provenance.source} (${provenance.siteUrl}), лицензия ${provenance.license}, файлы получены ${provenance.retrievedOn}. Использование некоммерческое.`;
}
