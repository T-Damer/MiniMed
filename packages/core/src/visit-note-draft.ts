import {
  VISIT_NOTE_FIELDS,
  VISIT_NOTE_OMISSION_CATEGORIES,
  VISIT_NOTE_SCHEMA_VERSION,
  type VisitNoteDraft,
  type VisitNoteField,
  type VisitNoteFieldId,
  type VisitNoteOmission,
  type VisitNoteOmissionCategory,
  type VisitNoteQuote,
  type VisitNoteRejection,
} from '@localmed/contracts';
import { type LineLocation, locateLines } from './visit-note-lines';
import {
  containsQuoteWords,
  indexQuoteSource,
  locateQuote,
  type QuoteLocation,
  type QuoteSourceIndex,
  quoteWords,
} from './visit-note-quotes';
import { findRemoteExamFindings } from './visit-note-remote-exam';

/**
 * Turns an untrusted proposal (a local model's JSON, already parsed) into a visit-note draft whose
 * every quote is located in the sources (SCRIBE1). Nothing the proposer says about where a quote
 * comes from is trusted: the text decides, transcript first, then the earlier record. The proposal
 * shape, all of it optional:
 *
 *   { fields: { complaints: { text, quotes: [string] } | [{ text, quote } | { text, line }], … },
 *     omissions: [{ category, field, quote, suggestion }] }
 *
 * A field given as items keeps only the items whose own quote is located, so no statement of it is
 * left without one; an item may cite numbered source lines instead (`line`: a number or up to three,
 * see `locateLines`), and several items may cite the same lines; a field given as one text is `unsupported` when none of its quotes is found.
 * Omissions must quote today's conversation: the earlier record is not news to the note.
 */
export interface VisitNoteSources {
  /** Conversation transcript lines as stored. */
  readonly transcript: readonly string[];
  /** The patient's earlier record the doctor supplied (a previous protocol, a discharge letter). */
  readonly priorRecord?: readonly string[];
  /** Video or phone visit: hands-on examination findings are listed. */
  readonly remote: boolean;
}

export const VISIT_NOTE_LIMITS = {
  quotesPerField: 3,
  itemsPerField: 8,
  itemChars: 400,
  omissions: 6,
  fieldChars: 4_000,
  suggestionChars: 600,
  suggestionMinChars: 4,
} as const;

const FIELD_SET: ReadonlySet<unknown> = new Set(VISIT_NOTE_FIELDS);
const CATEGORY_SET: ReadonlySet<unknown> = new Set(VISIT_NOTE_OMISSION_CATEGORIES);

/** What a proposal may hold; every value is still unchecked. */
interface ProposalShape {
  readonly fields?: unknown;
  readonly omissions?: unknown;
}
interface FieldProposal {
  readonly text?: unknown;
  readonly quotes?: unknown;
}
interface ItemProposal {
  readonly text?: unknown;
  readonly quote?: unknown;
  readonly line?: unknown;
}
interface OmissionProposal {
  readonly category?: unknown;
  readonly field?: unknown;
  readonly quote?: unknown;
  readonly suggestion?: unknown;
}

type Rejected = Extract<QuoteLocation, { ok: false }>['code'];
const LOCATION_PRIORITY: readonly Rejected[] = [
  'quote-negated',
  'quote-not-found',
  'quote-too-short',
];

export function buildVisitNoteDraft(proposal: unknown, sources: VisitNoteSources): VisitNoteDraft {
  const transcript = indexQuoteSource('transcript', sources.transcript);
  const indexes = sources.priorRecord?.length
    ? [transcript, indexQuoteSource('prior-record', sources.priorRecord)]
    : [transcript];
  const rejected: VisitNoteRejection[] = [];
  const record = asObject<ProposalShape>(proposal);
  const proposedFields = asObject<Record<string, unknown>>(record?.fields);
  for (const key of Object.keys(proposedFields ?? {})) {
    if (!FIELD_SET.has(key)) rejected.push({ item: 'field-quote', code: 'unknown-field' });
  }

  const fields = VISIT_NOTE_FIELDS.map((field) => {
    const proposed = proposedFields?.[field];
    return Array.isArray(proposed)
      ? buildItemField(field, proposed, indexes, sources, rejected)
      : buildField(field, asObject<FieldProposal>(proposed), indexes, rejected);
  });
  const noteText = fields.map((field) => field.text).join('\n');
  const omissions = buildOmissions(record?.omissions, transcript, noteText, rejected);
  const examination = fields.find((field) => field.field === 'examination')?.text ?? '';
  return {
    schemaVersion: VISIT_NOTE_SCHEMA_VERSION,
    remote: sources.remote,
    fields,
    omissions,
    remoteExamFindings: sources.remote ? findRemoteExamFindings(examination) : [],
    rejected,
  };
}

function buildField(
  field: VisitNoteFieldId,
  proposed: FieldProposal | undefined,
  indexes: readonly QuoteSourceIndex[],
  rejected: VisitNoteRejection[],
): VisitNoteField {
  const text = clippedText(proposed?.text, VISIT_NOTE_LIMITS.fieldChars);
  if (!text) return { field, text, status: 'empty', quotes: [] };
  const quotes: VisitNoteQuote[] = [];
  for (const candidate of Array.isArray(proposed?.quotes) ? proposed.quotes : []) {
    if (typeof candidate !== 'string') {
      rejected.push({ item: 'field-quote', field, code: 'not-an-object' });
      continue;
    }
    const location = locateInAny(indexes, candidate);
    if (!location.ok) {
      rejected.push({ item: 'field-quote', field, code: location.code });
      continue;
    }
    if (quotes.some((quote) => sameSpan(quote, location.quote))) {
      rejected.push({ item: 'field-quote', field, code: 'duplicate-quote' });
      continue;
    }
    if (quotes.length >= VISIT_NOTE_LIMITS.quotesPerField) {
      rejected.push({ item: 'field-quote', field, code: 'too-many' });
      continue;
    }
    quotes.push(location.quote);
  }
  return { field, text, status: quotes.length > 0 ? 'supported' : 'unsupported', quotes };
}

function buildItemField(
  field: VisitNoteFieldId,
  proposed: readonly unknown[],
  indexes: readonly QuoteSourceIndex[],
  sources: VisitNoteSources,
  rejected: VisitNoteRejection[],
): VisitNoteField {
  const texts: string[] = [];
  const wordings = new Set<string>();
  const quotes: VisitNoteQuote[] = [];
  for (const candidate of proposed) {
    const item = asObject<ItemProposal>(candidate);
    const quoted = typeof item?.quote === 'string';
    if (!item || (!quoted && item.line === undefined)) {
      rejected.push({ item: 'field-quote', field, code: 'not-an-object' });
      continue;
    }
    const text = clippedText(item.text, VISIT_NOTE_LIMITS.itemChars);
    if (text.length < VISIT_NOTE_LIMITS.suggestionMinChars) {
      rejected.push({ item: 'field-quote', field, code: 'missing-text' });
      continue;
    }
    const location: QuoteLocation | LineLocation = quoted
      ? locateInAny(indexes, item.quote as string)
      : locateLines(sources, item.line, text);
    if (!location.ok) {
      rejected.push({ item: 'field-quote', field, code: location.code });
      continue;
    }
    const wording = quoteWords(text).text;
    if (wordings.has(wording)) {
      rejected.push({ item: 'field-quote', field, code: 'duplicate-item' });
      continue;
    }
    // Cited lines often carry several findings («хрипов нет, тоны ритмичные»): one item each.
    if (quoted && quotes.some((quote) => sameSpan(quote, location.quote))) {
      rejected.push({ item: 'field-quote', field, code: 'duplicate-quote' });
      continue;
    }
    if (texts.length >= VISIT_NOTE_LIMITS.itemsPerField) {
      rejected.push({ item: 'field-quote', field, code: 'too-many' });
      continue;
    }
    texts.push(text);
    wordings.add(wording);
    quotes.push(location.quote);
  }
  if (texts.length === 0) return { field, text: '', status: 'empty', quotes: [] };
  return { field, text: texts.join('\n'), status: 'supported', quotes };
}

function buildOmissions(
  proposed: unknown,
  transcript: QuoteSourceIndex,
  noteText: string,
  rejected: VisitNoteRejection[],
): VisitNoteOmission[] {
  const omissions: VisitNoteOmission[] = [];
  for (const candidate of Array.isArray(proposed) ? proposed : []) {
    const item = asObject<OmissionProposal>(candidate);
    if (!item) {
      rejected.push({ item: 'omission', code: 'not-an-object' });
      continue;
    }
    if (!FIELD_SET.has(item.field)) {
      rejected.push({ item: 'omission', code: 'unknown-field' });
      continue;
    }
    const fieldId = item.field as VisitNoteFieldId;
    const location = typeof item.quote === 'string' ? locateQuote(transcript, item.quote) : null;
    if (!location?.ok) {
      rejected.push({ item: 'omission', field: fieldId, code: location?.code ?? 'not-an-object' });
      continue;
    }
    const suggestion = clippedText(item.suggestion, VISIT_NOTE_LIMITS.suggestionChars);
    if (suggestion.length < VISIT_NOTE_LIMITS.suggestionMinChars) {
      rejected.push({ item: 'omission', field: fieldId, code: 'missing-suggestion' });
      continue;
    }
    if (containsQuoteWords(noteText, suggestion)) {
      rejected.push({ item: 'omission', field: fieldId, code: 'already-in-note' });
      continue;
    }
    if (omissions.length >= VISIT_NOTE_LIMITS.omissions) {
      rejected.push({ item: 'omission', field: fieldId, code: 'too-many' });
      continue;
    }
    const category = CATEGORY_SET.has(item.category)
      ? (item.category as VisitNoteOmissionCategory)
      : 'other';
    omissions.push({ category, field: fieldId, quote: location.quote, suggestion });
  }
  return omissions;
}

/** Transcript first; when no source has it, the most telling reason is reported. */
function locateInAny(indexes: readonly QuoteSourceIndex[], quote: string): QuoteLocation {
  const failures: Rejected[] = [];
  for (const index of indexes) {
    const location = locateQuote(index, quote);
    if (location.ok) return location;
    failures.push(location.code);
  }
  const code =
    LOCATION_PRIORITY.find((candidate) => failures.includes(candidate)) ?? 'quote-not-found';
  return { ok: false, code };
}

function sameSpan(left: VisitNoteQuote, right: VisitNoteQuote): boolean {
  return (
    left.source === right.source &&
    left.startLine === right.startLine &&
    left.start === right.start &&
    left.endLine === right.endLine &&
    left.end === right.end
  );
}

function clippedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit).trim() : '';
}

function asObject<T extends object>(value: unknown): T | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as T)
    : undefined;
}
