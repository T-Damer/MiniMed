import { z } from 'zod';

/**
 * Visit-note draft (SCRIBE1): a protocol of one consultation proposed from its conversation
 * transcript. Whoever proposes the text (a local model, later perhaps a rule set), every field and
 * every possible omission must stand on a verbatim quote from the transcript or from the patient's
 * earlier record; the core finds each quote itself and keeps where it is. A field item may cite
 * numbered source lines instead; its quote is then those lines as stored. A quote that is not in the
 * source is rejected, so a field the model invented stays visibly «unsupported» instead of reading
 * like a fact. The transcript itself is never replaced: the draft only points into it.
 */

export const VISIT_NOTE_SCHEMA_VERSION = 1 as const;

export const VISIT_NOTE_FIELDS = [
  'complaints',
  'anamnesisMorbi',
  'anamnesisVitae',
  'allergies',
  'examination',
  'diagnoses',
  'medications',
  'plan',
] as const;
export const VisitNoteFieldIdSchema = z.enum(VISIT_NOTE_FIELDS);
export type VisitNoteFieldId = z.infer<typeof VisitNoteFieldIdSchema>;

/** Where a quote was found: today's conversation, or the earlier record the doctor supplied. */
export const VisitNoteQuoteSourceSchema = z.enum(['transcript', 'prior-record']);
export type VisitNoteQuoteSource = z.infer<typeof VisitNoteQuoteSourceSchema>;

/**
 * A located quote. Lines and offsets index the source lines exactly as given (UTF-16 offsets,
 * `end` exclusive); a quote may run over several transcript lines, because speech segments split
 * sentences. `text` is the source's own wording of that span, not the proposer's.
 */
export const VisitNoteQuoteSchema = z
  .object({
    source: VisitNoteQuoteSourceSchema,
    startLine: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .refine(
    (quote) =>
      quote.endLine > quote.startLine ||
      (quote.endLine === quote.startLine && quote.end > quote.start),
    { message: 'A quote must end after it starts.' },
  );
export type VisitNoteQuote = z.infer<typeof VisitNoteQuoteSchema>;

/** `empty`: no text; `supported`: at least one located quote; `unsupported`: text without one. */
export const VisitNoteFieldStatusSchema = z.enum(['empty', 'supported', 'unsupported']);
export type VisitNoteFieldStatus = z.infer<typeof VisitNoteFieldStatusSchema>;

export const VisitNoteFieldSchema = z.object({
  field: VisitNoteFieldIdSchema,
  text: z.string(),
  status: VisitNoteFieldStatusSchema,
  quotes: z.array(VisitNoteQuoteSchema),
});
export type VisitNoteField = z.infer<typeof VisitNoteFieldSchema>;

export const VISIT_NOTE_OMISSION_CATEGORIES = [
  'allergy',
  'medication',
  'diagnosis',
  'timing',
  'other',
] as const;
export const VisitNoteOmissionCategorySchema = z.enum(VISIT_NOTE_OMISSION_CATEGORIES);
export type VisitNoteOmissionCategory = z.infer<typeof VisitNoteOmissionCategorySchema>;

/** Something said in the conversation that the note does not carry yet. */
export const VisitNoteOmissionSchema = z.object({
  category: VisitNoteOmissionCategorySchema,
  field: VisitNoteFieldIdSchema,
  quote: VisitNoteQuoteSchema,
  suggestion: z.string().min(1),
});
export type VisitNoteOmission = z.infer<typeof VisitNoteOmissionSchema>;

/**
 * Findings that need hands or a stethoscope; in a note of a video or phone visit they cannot have
 * been obtained. Ids are declared with their patterns in the core (`REMOTE_EXAM_FINDINGS`).
 */
export const RemoteExamFindingSchema = z.object({
  kind: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  text: z.string().min(1),
});
export type RemoteExamFinding = z.infer<typeof RemoteExamFindingSchema>;

export const VISIT_NOTE_REJECTION_CODES = [
  'not-an-object',
  'unknown-field',
  'missing-text',
  'quote-too-short',
  'quote-not-found',
  'quote-negated',
  'line-not-found',
  'line-unrelated',
  'duplicate-quote',
  'duplicate-item',
  'too-many',
  'missing-suggestion',
  'already-in-note',
] as const;
export const VisitNoteRejectionCodeSchema = z.enum(VISIT_NOTE_REJECTION_CODES);
export type VisitNoteRejectionCode = z.infer<typeof VisitNoteRejectionCodeSchema>;

/** What was dropped from the proposal and why; it carries no proposed text. */
export const VisitNoteRejectionSchema = z.object({
  item: z.enum(['field-quote', 'omission']),
  field: VisitNoteFieldIdSchema.optional(),
  code: VisitNoteRejectionCodeSchema,
});
export type VisitNoteRejection = z.infer<typeof VisitNoteRejectionSchema>;

export const VisitNoteDraftSchema = z.object({
  schemaVersion: z.literal(VISIT_NOTE_SCHEMA_VERSION),
  remote: z.boolean(),
  fields: z.array(VisitNoteFieldSchema).length(VISIT_NOTE_FIELDS.length),
  omissions: z.array(VisitNoteOmissionSchema),
  remoteExamFindings: z.array(RemoteExamFindingSchema),
  rejected: z.array(VisitNoteRejectionSchema),
});
export type VisitNoteDraft = z.infer<typeof VisitNoteDraftSchema>;
