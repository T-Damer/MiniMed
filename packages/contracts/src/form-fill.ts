import { z } from 'zod';

import { VisitNoteQuoteSchema } from './visit-note';

/**
 * A form filled from a conversation transcript (FORMFILL1). Any form — a questionnaire, a
 * calculator, an official blank — is described to the filler as sections of typed fields; the filler
 * (a local model under a JSON schema built from these fields, or declared word cues when no model is
 * installed) proposes a value per field together with the transcript words it rests on. A field the
 * conversation did not touch stays `null`. A proposed value never fills the form by itself: the
 * doctor accepts or turns down each one.
 *
 * Quotes have SCRIBE1's `VisitNoteQuote` shape (line + UTF-16 offsets into the transcript exactly
 * as stored, the source's own wording), so the transcript can be opened at the quoted words.
 */

export const FORM_FILL_SCHEMA_VERSION = 1 as const;

const fieldId = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/u, 'a field id is a short identifier');

export const FORM_FILL_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'choice',
  'multi-choice',
  'boolean',
] as const;
export const FormFillFieldTypeSchema = z.enum(FORM_FILL_FIELD_TYPES);
export type FormFillFieldType = z.infer<typeof FormFillFieldTypeSchema>;

/**
 * Words that propose a value without a model. A pattern is matched on the lower-cased line with
 * «ё» read as «е», from the start of a word; `~` stands for the rest of the word. How a match turns
 * into a value depends on the field type (see `packages/core/src/form-fill/cues.ts`).
 */
const CuePatternsSchema = z.array(z.string().min(1).max(200)).min(1).max(40);

export const FormFillOptionSchema = z
  .object({
    value: z.string().min(1).max(64),
    /** What the option says; the model picks options by this wording. */
    label: z.string().min(1).max(200),
    /** Words that mean this option (choice / multi-choice). */
    cues: CuePatternsSchema.optional(),
  })
  .strict();
export type FormFillOption = z.infer<typeof FormFillOptionSchema>;

export const FormFillFieldSchema = z
  .object({
    id: fieldId,
    label: z.string().min(1).max(300),
    type: FormFillFieldTypeSchema,
    /**
     * One short line for the model: synonyms, what counts. Its words also count as the field's subject
     * when cited lines are checked, so it names the topic and gives no instructions.
     */
    hint: z.string().min(1).max(300).optional(),
    options: z.array(FormFillOptionSchema).min(2).max(120).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    integer: z.boolean().optional(),
    maxLength: z.number().int().positive().max(2_000).optional(),
    /**
     * Topic words of the field: boolean — said → true, said with a denial or answered «нет» → false;
     * number — the number said in the same clause, or in the answer to a question with these words;
     * text — the rest of the sentence after the words («Диагноз: …»); choice — the topic: an option's
     * words count only when said about it (same sentence, or the reply to a question on it).
     */
    cues: CuePatternsSchema.optional(),
  })
  .strict()
  .superRefine((field, context) => {
    const choosing = field.type === 'choice' || field.type === 'multi-choice';
    if (choosing && !field.options) {
      context.addIssue({ code: 'custom', message: `${field.id} needs options` });
    }
    if (!choosing && field.options) {
      context.addIssue({ code: 'custom', message: `only choice fields take options: ${field.id}` });
    }
    if (field.options) {
      const values = new Set(field.options.map((option) => option.value));
      const labels = new Set(field.options.map((option) => option.label.toLowerCase()));
      if (values.size !== field.options.length || labels.size !== field.options.length) {
        context.addIssue({ code: 'custom', message: `${field.id} repeats an option` });
      }
    }
    if (
      field.type !== 'number' &&
      (field.minimum !== undefined || field.maximum !== undefined || field.integer)
    ) {
      context.addIssue({ code: 'custom', message: `only number fields take a range: ${field.id}` });
    }
    if (field.type !== 'text' && field.maxLength !== undefined) {
      context.addIssue({ code: 'custom', message: `only text fields take maxLength: ${field.id}` });
    }
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      context.addIssue({ code: 'custom', message: `${field.id} has an empty range` });
    }
  });
export type FormFillField = z.infer<typeof FormFillFieldSchema>;

export const FormFillSectionSchema = z
  .object({
    id: fieldId,
    title: z.string().min(1).max(200),
    fieldIds: z.array(fieldId).min(1),
  })
  .strict();
export type FormFillSection = z.infer<typeof FormFillSectionSchema>;

/** The form as the filler sees it. Every field is on exactly one section. */
export const FormFillFormSchema = z
  .object({
    schemaVersion: z.literal(FORM_FILL_SCHEMA_VERSION),
    /** The id of the form it describes (a tool id, an official form id). */
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    sections: z.array(FormFillSectionSchema).min(1),
    fields: z.array(FormFillFieldSchema).min(1).max(400),
  })
  .strict()
  .superRefine((form, context) => {
    const ids = new Set<string>();
    for (const field of form.fields) {
      if (ids.has(field.id)) {
        context.addIssue({ code: 'custom', message: `duplicate field id ${field.id}` });
      }
      ids.add(field.id);
    }
    const placed = new Set<string>();
    for (const section of form.sections) {
      for (const id of section.fieldIds) {
        if (!ids.has(id)) {
          context.addIssue({ code: 'custom', message: `section cites unknown field ${id}` });
        }
        if (placed.has(id)) {
          context.addIssue({ code: 'custom', message: `field ${id} is on two sections` });
        }
        placed.add(id);
      }
    }
    for (const id of ids) {
      if (!placed.has(id)) {
        context.addIssue({ code: 'custom', message: `field ${id} is on no section` });
      }
    }
  });
export type FormFillForm = z.infer<typeof FormFillFormSchema>;

/** Who said the quoted words, from the speaker label the line starts with («Врач:», «Мама:»). */
export const FORM_FILL_SPEAKER_ROLES = ['clinician', 'patient', 'companion', 'unknown'] as const;
export const FormFillSpeakerRoleSchema = z.enum(FORM_FILL_SPEAKER_ROLES);
export type FormFillSpeakerRole = z.infer<typeof FormFillSpeakerRoleSchema>;

export const FormFillSpeakerSchema = z
  .object({
    /** The label as written in the line, or null when the line has none. */
    label: z.string().min(1).max(40).nullable(),
    role: FormFillSpeakerRoleSchema,
  })
  .strict();
export type FormFillSpeaker = z.infer<typeof FormFillSpeakerSchema>;

/**
 * One located quote behind a value. A quote running over a question and its answer is attributed
 * to the speaker of its last line, the one who answered.
 */
export const FormFillEvidenceSchema = z
  .object({
    quote: VisitNoteQuoteSchema,
    speaker: FormFillSpeakerSchema,
  })
  .strict();
export type FormFillEvidence = z.infer<typeof FormFillEvidenceSchema>;

/** A value in the field's own terms: option values (not labels) for choices, ISO dates. */
export const FormFillValueSchema = z.union([
  z.string().min(1),
  z.number(),
  z.boolean(),
  z.array(z.string().min(1)).min(1),
]);
export type FormFillValue = z.infer<typeof FormFillValueSchema>;

export const FormFillMethodSchema = z.enum(['model', 'cues']);
export type FormFillMethod = z.infer<typeof FormFillMethodSchema>;

export const FormFillProposalSchema = z
  .object({
    value: FormFillValueSchema,
    evidence: z.array(FormFillEvidenceSchema).min(1).max(3),
    origin: FormFillMethodSchema,
  })
  .strict();
export type FormFillProposal = z.infer<typeof FormFillProposalSchema>;

export const FORM_FILL_REJECTION_CODES = [
  'unknown-field',
  'missing-citation',
  'invalid-value',
  'option-not-allowed',
  'out-of-range',
  'value-not-in-quote',
  'conflicting-value',
  'quote-too-short',
  'quote-not-found',
  'quote-negated',
  'line-not-found',
  'line-unrelated',
] as const;
export const FormFillRejectionCodeSchema = z.enum(FORM_FILL_REJECTION_CODES);
export type FormFillRejectionCode = z.infer<typeof FormFillRejectionCodeSchema>;

/** What was dropped and why; it carries no proposed text. */
export const FormFillRejectionSchema = z
  .object({
    fieldId: z.string().max(200).optional(),
    code: FormFillRejectionCodeSchema,
  })
  .strict();
export type FormFillRejection = z.infer<typeof FormFillRejectionSchema>;

/** Every field of the form is a key: `null` when the conversation did not give it. */
export const FormFillResultSchema = z
  .object({
    schemaVersion: z.literal(FORM_FILL_SCHEMA_VERSION),
    formId: z.string().min(1).max(200),
    method: FormFillMethodSchema,
    fields: z.record(fieldId, FormFillProposalSchema.nullable()),
    rejected: z.array(FormFillRejectionSchema),
  })
  .strict();
export type FormFillResult = z.infer<typeof FormFillResultSchema>;

/** The doctor's answer to one proposal; a field without one is still pending. */
export const FormFillDecisionSchema = z.enum(['accepted', 'rejected']);
export type FormFillDecision = z.infer<typeof FormFillDecisionSchema>;

export const FormFillReviewSchema = z
  .object({
    formId: z.string().min(1).max(200),
    decisions: z.record(fieldId, FormFillDecisionSchema),
  })
  .strict();
export type FormFillReview = z.infer<typeof FormFillReviewSchema>;

export function parseFormFillForm(value: unknown): FormFillForm {
  return FormFillFormSchema.parse(value);
}

export function parseFormFillResult(value: unknown): FormFillResult {
  return FormFillResultSchema.parse(value);
}
