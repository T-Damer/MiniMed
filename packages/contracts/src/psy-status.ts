import { z } from 'zod';

/**
 * Psychiatric status (PSY1): a structured mental, somatic and pharmacological status built from a
 * fixed catalog of phrases (a friend's offline «Конструктор психиатрического статуса», see
 * `packages/core/src/psy-status/NOTICE.md`). The doctor picks phrases section by section, may write
 * their own, marks each section's status, and the text is generated from what is picked.
 *
 * A conversation transcript can propose phrases. Every proposal carries the transcript words it
 * stands on, located by line and offsets exactly like a SCRIBE1 visit-note quote, so the doctor
 * can see why a phrase was proposed before accepting it; an accepted entry keeps those quotes.
 */

export const PSY_STATUS_SCHEMA_VERSION = 1 as const;

export const PSY_STATUS_MODULES = ['mental', 'somatic', 'pharma'] as const;
export const PsyStatusModuleIdSchema = z.enum(PSY_STATUS_MODULES);
export type PsyStatusModuleId = z.infer<typeof PsyStatusModuleIdSchema>;

/** Who the statement comes from: the doctor's observation, the patient's words, the records. */
export const PSY_STATUS_EVIDENCE = ['observed', 'reported', 'documented', 'custom'] as const;
export const PsyStatusEvidenceSchema = z.enum(PSY_STATUS_EVIDENCE);
export type PsyStatusEvidence = z.infer<typeof PsyStatusEvidenceSchema>;

export const PSY_STATUS_ASSESSMENTS = [
  'not-assessed',
  'confirmed',
  'deviation',
  'insufficient',
  'refused',
] as const;
export const PsyStatusAssessmentSchema = z.enum(PSY_STATUS_ASSESSMENTS);
export type PsyStatusAssessment = z.infer<typeof PsyStatusAssessmentSchema>;

export const PSY_STATUS_DETAIL_LEVELS = ['brief', 'standard', 'detailed'] as const;
export const PsyStatusDetailSchema = z.enum(PSY_STATUS_DETAIL_LEVELS);
export type PsyStatusDetail = z.infer<typeof PsyStatusDetailSchema>;

/**
 * Transcript words a value stands on. Same shape as SCRIBE1's `VisitNoteQuote` with
 * `source: 'transcript'`: lines and UTF-16 offsets index the transcript lines exactly as stored
 * (`end` exclusive), and `text` is the transcript's own wording of that span.
 */
export const PsyStatusQuoteSchema = z
  .object({
    source: z.literal('transcript'),
    startLine: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .strict()
  .refine(
    (quote) =>
      quote.endLine > quote.startLine ||
      (quote.endLine === quote.startLine && quote.end > quote.start),
    { message: 'A quote must end after it starts.' },
  );
export type PsyStatusQuote = z.infer<typeof PsyStatusQuoteSchema>;

/**
 * How a transcript supports a phrase: the words were said (`statement`), the topic was said with a
 * denial (`denial`), or a question on the topic got «да» / «нет» on the next line (`answer`).
 */
export const PsyStatusCueKindSchema = z.enum(['statement', 'denial', 'answer']);
export type PsyStatusCueKind = z.infer<typeof PsyStatusCueKindSchema>;

/** One phrase of the status as the doctor has it now. */
export const PsyStatusEntrySchema = z
  .object({
    id: z.string().min(1),
    moduleId: PsyStatusModuleIdSchema,
    sectionId: z.string().min(1),
    /** Catalog phrase code; absent for the doctor's own wording. */
    code: z.string().min(1).optional(),
    text: z.string().min(1).max(5_000),
    evidence: PsyStatusEvidenceSchema,
    origin: z.enum(['manual', 'transcript']),
    /** The transcript words behind an entry that came from the conversation. */
    quotes: z.array(PsyStatusQuoteSchema),
  })
  .strict();
export type PsyStatusEntry = z.infer<typeof PsyStatusEntrySchema>;

/** A phrase the transcript proposes; it becomes an entry only when the doctor accepts it. */
export const PsyStatusSuggestionSchema = z
  .object({
    code: z.string().min(1),
    moduleId: PsyStatusModuleIdSchema,
    sectionId: z.string().min(1),
    kind: PsyStatusCueKindSchema,
    quotes: z.array(PsyStatusQuoteSchema).min(1),
  })
  .strict();
export type PsyStatusSuggestion = z.infer<typeof PsyStatusSuggestionSchema>;

/** Section status keys are `<moduleId>.<sectionId>`. */
export const PsyStatusDocumentSchema = z
  .object({
    schemaVersion: z.literal(PSY_STATUS_SCHEMA_VERSION),
    entries: z.array(PsyStatusEntrySchema).max(2_000),
    assessments: z.record(z.string(), PsyStatusAssessmentSchema),
    detail: PsyStatusDetailSchema,
    /** Suggestions the doctor turned down, by phrase code, so they do not come back. */
    dismissed: z.array(z.string()),
  })
  .strict();
export type PsyStatusDocument = z.infer<typeof PsyStatusDocumentSchema>;
