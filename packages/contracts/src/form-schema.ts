import { z } from 'zod';

import { HttpUrlSchema } from './clinical-observations';

/**
 * Official medical form schema (docs/FORMS_PLAN.md). One schema describes one unified form of
 * medical documentation approved by a Минздрав order: its identity and source, the fields with the
 * exact «Порядок заполнения» paragraph that governs each, the screen sections, and the print
 * layout of the blank. Generated from the official text by the deterministic preparer
 * (tools/ingest, `localmed_ingest.medical_forms`); interpreted by a generic renderer that never
 * branches on a form id. Prefill bindings live here, not in code.
 */

export const FORM_SCHEMA_VERSION = 1 as const;

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/u, 'must be a stable identifier');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'must be an ISO date');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u, 'must be a lowercase SHA-256');

export const PATIENT_ADDRESS_PARTS = [
  'subject',
  'district',
  'locality',
  'street',
  'house',
  'building',
  'apartment',
  'phone',
] as const;

export const PATIENT_OMS_PARTS = ['number', 'issuedAt', 'insurer'] as const;

/** Every value a form field may be prefilled from. Resolved by `buildFormPrefillContext`. */
export const FORM_PREFILL_PATHS = [
  'patient.fullName',
  'patient.birthDate',
  'patient.sex',
  'patient.snils',
  'patient.workplace',
  'patient.citizenship',
  ...PATIENT_ADDRESS_PARTS.map((part) => `patient.address.${part}` as const),
  ...PATIENT_ADDRESS_PARTS.map((part) => `patient.stayAddress.${part}` as const),
  ...PATIENT_OMS_PARTS.map((part) => `patient.omsPolicy.${part}` as const),
  'episode.diagnosis.text',
  'episode.diagnosis.icd10',
  'clinician.fullName',
  'clinician.position',
  'organization.name',
  'organization.address',
  'organization.ogrn',
  'today',
] as const;

export const FormPrefillPathSchema = z.enum(FORM_PREFILL_PATHS);
export type FormPrefillPath = z.infer<typeof FormPrefillPathSchema>;

export const FormPrefillSchema = z.object({
  /** Joined in order, empty values skipped. */
  sources: z.array(FormPrefillPathSchema).min(1),
  /** Separator between joined sources; `, ` when omitted. */
  join: z.string().optional(),
  /**
   * Takes whitespace-separated words of each source value: `{ from: 1, count: 1 }` is the second
   * word (the first name of «Иванов Иван Иванович»); without `count` all words from `from` on.
   */
  words: z
    .object({ from: z.number().int().min(0).max(5), count: z.number().int().min(1).optional() })
    .optional(),
  /** Maps a source value to the printed value, e.g. `male` → `1`. Unmapped values prefill nothing. */
  map: z.record(z.string(), z.string()).optional(),
});
export type FormPrefill = z.infer<typeof FormPrefillSchema>;

export const FormFieldTypeSchema = z.enum([
  'text',
  'date',
  'choice',
  'icd10',
  'checkbox',
  'signature',
  'stamp',
]);
export type FormFieldType = z.infer<typeof FormFieldTypeSchema>;

export const FormChoiceOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});

/**
 * How the «Порядок заполнения» treats a field:
 * - `defined` — a paragraph names this line;
 * - `by-line` — the printed line is governed by a paragraph, the part itself is not named;
 * - `undefined` — the order does not define how to fill it (never invented here).
 */
export const FormRuleStatusSchema = z.enum(['defined', 'by-line', 'undefined']);

export const FormFieldRuleSchema = z
  .object({
    status: FormRuleStatusSchema,
    paragraphIds: z.array(z.string().min(1)),
    note: z.string().min(1).optional(),
  })
  .superRefine((rule, context) => {
    if (rule.status === 'undefined' && rule.paragraphIds.length > 0) {
      context.addIssue({ code: 'custom', message: 'an undefined rule cannot cite a paragraph' });
    }
    if (rule.status !== 'undefined' && rule.paragraphIds.length === 0) {
      context.addIssue({ code: 'custom', message: 'a defined rule must cite a paragraph' });
    }
  });

export const FormFieldSchema = z
  .object({
    id: identifier,
    /** Label as printed on the official blank (a descriptive name when `labelPrinted` is false). */
    label: z.string().min(1),
    /** False when the blank prints no caption for this field (the form date, the header lines). */
    labelPrinted: z.boolean().optional(),
    type: FormFieldTypeSchema,
    required: z.boolean(),
    /** `source` when the order states it, `editorial` when the blank implies it. */
    requiredBasis: z.enum(['source', 'editorial']).optional(),
    multiline: z.boolean().optional(),
    multiple: z.boolean().optional(),
    options: z.array(FormChoiceOptionSchema).optional(),
    maxLength: z.number().int().positive().optional(),
    /** A date field that must not lie in the future (birth date, issue dates). */
    notAfter: z.literal('today').optional(),
    pattern: z.string().min(1).optional(),
    patternMessage: z.string().min(1).optional(),
    prefill: FormPrefillSchema.optional(),
    rule: FormFieldRuleSchema,
  })
  .superRefine((field, context) => {
    if (field.type === 'choice' && (field.options?.length ?? 0) === 0) {
      context.addIssue({ code: 'custom', message: `choice field ${field.id} needs options` });
    }
    if (field.type !== 'choice' && (field.options || field.multiple)) {
      context.addIssue({ code: 'custom', message: `only choice fields take options: ${field.id}` });
    }
    if (field.required && !field.requiredBasis) {
      context.addIssue({ code: 'custom', message: `required field ${field.id} needs a basis` });
    }
    if ((field.type === 'signature' || field.type === 'stamp') && field.prefill) {
      context.addIssue({
        code: 'custom',
        message: `${field.id} is signed on paper, never prefilled`,
      });
    }
    if (field.notAfter && field.type !== 'date') {
      context.addIssue({ code: 'custom', message: `notAfter needs a date field: ${field.id}` });
    }
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern, 'u');
      } catch {
        context.addIssue({ code: 'custom', message: `invalid pattern on ${field.id}` });
      }
    }
  });
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSourceSpanSchema = z.object({
  /** 1-based page of the official PDF. */
  pdfPage: z.number().int().positive(),
  /** Inclusive indices into the page's normalised OCR lines (see `extraction`). */
  firstLine: z.number().int().nonnegative(),
  lastLine: z.number().int().nonnegative(),
});
export type FormSourceSpan = z.infer<typeof FormSourceSpanSchema>;

export const FormRuleParagraphSchema = z.object({
  /** Paragraph number in the order's «Порядок», e.g. `6.11`. */
  id: z.string().regex(/^\d+(?:\.\d+)*$/u),
  text: z.string().min(1),
  /** Items of a code list the paragraph introduces (counted, held as field options). */
  listItemCount: z.number().int().nonnegative().optional(),
  /**
   * The appendix of the order the paragraph belongs to when the requirements for the blank are
   * spread over several (order 1094н: appendices 1 and 3); `id` is then `<appendix>.<clause>`.
   */
  appendix: z.object({ number: z.number().int().positive(), title: z.string().min(1) }).optional(),
  /** The paragraph number as printed in that appendix. */
  clause: z
    .string()
    .regex(/^\d+(?:\.\d+)*$/u)
    .optional(),
  spans: z.array(FormSourceSpanSchema).min(1),
  textSha256: sha256,
});
export type FormRuleParagraph = z.infer<typeof FormRuleParagraphSchema>;

export const FormSegmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string(),
    bold: z.boolean().optional(),
    small: z.boolean().optional(),
    /** No gap before the segment: it continues the previous one (`(` + options + `)`). */
    joined: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('field'),
    fieldId: identifier,
    /** Approximate blank length in printed characters, measured on the official blank. */
    length: z.number().positive(),
    /**
     * A date prints as «day» month 20year2 on the blank: one field, three blanks. `year` is the
     * whole year (`год ______`) where the blank prints no «20» before the blank.
     */
    part: z.enum(['day', 'month', 'year', 'year2']).optional(),
    caption: z.string().min(1).optional(),
    grow: z.boolean().optional(),
    /** A long entry printed on several ruled lines (anamnesis, epicrisis). */
    lines: z.number().int().min(1).max(12).optional(),
  }),
  /** The choices as printed (`муж. – 1, жен. – 2`) with the picked ones marked. */
  z.object({
    kind: z.literal('options'),
    fieldId: identifier,
    separator: z.string(),
    /** Separators between neighbouring options when they differ (`, ` then `; `); length n - 1. */
    separators: z.array(z.string()).optional(),
    /** False when the blank prints only the words and the person marks the applicable one. */
    codes: z.boolean().optional(),
    /** How a picked option is marked: circled (default) or underlined («нужное подчеркнуть»). */
    mark: z.enum(['circle', 'underline']).optional(),
    /** No gap before the options: they continue the previous segment (`характер травмы (укус – 1`). */
    joined: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('check'), fieldId: identifier }),
  /**
   * A ruled line the blank prints with nothing to fill in (the continuation line under a long
   * entry). Holds no field; kept so the sheet has the lines of the official blank.
   */
  z.object({
    kind: z.literal('rule'),
    length: z.number().positive(),
    grow: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('signature'),
    fieldId: identifier,
    length: z.number().positive(),
    caption: z.string().min(1),
  }),
  z.object({ kind: z.literal('stamp'), fieldId: identifier, text: z.string().min(1) }),
  /**
   * A printed grid whose body cells are fields (the prescriptions table of a talon). `header` is
   * the printed header cells row by row; `rows` holds one field id per body cell.
   */
  z.object({
    kind: z.literal('table'),
    header: z.array(
      z
        .array(
          z.object({
            text: z.string().min(1),
            colSpan: z.number().int().min(1).max(12).optional(),
            rowSpan: z.number().int().min(1).max(4).optional(),
          }),
        )
        .min(1),
    ),
    /** A body cell is a field id, or `{ text }` for a printed caption cell. */
    rows: z
      .array(z.array(z.union([identifier, z.object({ text: z.string().min(1) })])).min(1))
      .min(1),
    /** Relative column widths (any positive numbers), one per body column. */
    columnWeights: z.array(z.number().positive()).optional(),
  }),
]);
export type FormSegment = z.infer<typeof FormSegmentSchema>;

export const FormRowSchema = z.object({
  segments: z.array(FormSegmentSchema).min(1),
  /** `justify` wraps a paragraph justified; `stretch` spreads one printed line over the width. */
  align: z.enum(['left', 'center', 'right', 'justify', 'stretch']).optional(),
  bold: z.boolean().optional(),
  size: z.enum(['small', 'normal', 'title']).optional(),
  gap: z.enum(['none', 'small', 'medium', 'large']).optional(),
  /**
   * Space above the row in mm; replaces `gap`. Measured against the official scan by the layout
   * calibration (tools/ingest, `medical_form_overlay calibrate`), so the printed rows keep the
   * vertical positions of the original blank.
   */
  spaceBeforeMm: z.number().min(0).max(80).optional(),
  /** `outline` boxes the row; `split` boxes two cells: the first segment, then the rest. */
  box: z.enum(['outline', 'split']).optional(),
  splitPercent: z.number().min(10).max(90).optional(),
});
export type FormRow = z.infer<typeof FormRowSchema>;

export const FormLayoutColumnSchema = z.object({
  widthPercent: z.number().min(10).max(100),
  align: z.enum(['left', 'center', 'right']).optional(),
  rows: z.array(FormRowSchema).min(1),
});

export const FormLayoutBlockSchema = z.object({
  id: identifier,
  /** Starts a new sheet: the reverse side of a two-sided blank. */
  pageBreakBefore: z.boolean().optional(),
  /** Draws the printed frame around the whole block (a boxed group of lines). */
  framed: z.boolean().optional(),
  columns: z.array(FormLayoutColumnSchema).min(1).max(3),
});

export const FormLayoutSchema = z.object({
  page: z.object({
    size: z.literal('A4'),
    orientation: z.enum(['portrait', 'landscape']),
    marginMm: z.object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    }),
    fontSizePt: z.number().min(7).max(16),
    /** Line height as a multiple of the font size (1.3 when omitted); measured on the scan. */
    lineHeight: z.number().min(1).max(2).optional(),
  }),
  blocks: z.array(FormLayoutBlockSchema).min(1),
});
export type FormLayout = z.infer<typeof FormLayoutSchema>;

export const FormScreenSectionSchema = z.object({
  id: identifier,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  fieldIds: z.array(identifier).min(1),
});
export type FormScreenSection = z.infer<typeof FormScreenSectionSchema>;

export const FormOcrCorrectionSchema = z.object({
  pdfPage: z.number().int().positive(),
  from: z.string().min(1),
  to: z.string(),
  reason: z.string().min(1),
});

export const FormSourceSchema = z.object({
  issuer: z.string().min(1),
  orderNumber: z.string().min(1),
  orderDate: isoDate,
  orderTitle: z.string().min(1),
  registration: z.object({
    authority: z.string().min(1),
    number: z.string().min(1),
    date: isoDate,
  }),
  effectiveFrom: isoDate,
  effectiveUntil: isoDate.optional(),
  /** Official portal page and the PDF file the schema was built from. */
  publicationUrl: HttpUrlSchema,
  pdfUrl: HttpUrlSchema,
  retrievedAt: isoDate,
  sha256,
  pdfPages: z.number().int().positive(),
  blankAppendix: z.object({
    number: z.number().int().positive(),
    pdfPages: z.array(z.number().int().positive()).min(1),
  }),
  rulesAppendix: z.object({
    number: z.number().int().positive(),
    pdfPages: z.array(z.number().int().positive()).min(1),
  }),
  extraction: z.object({
    method: z.string().min(1),
    /** SHA-256 of the OCR JSON the paragraphs were cut from. */
    ocrSha256: sha256,
    /** Reviewed substitutions applied to the OCR text, each with its reason. */
    corrections: z.array(FormOcrCorrectionSchema),
    /** Printed labels of the blank that were located in the OCR text of the blank page. */
    blankLabelsVerified: z.number().int().nonnegative(),
    /** Captions the OCR dropped that a reviewer confirmed on the scan (listed, never silent). */
    captionsReviewedOnScan: z.array(z.string().min(1)).optional(),
    note: z.string().min(1),
  }),
});
export type FormSource = z.infer<typeof FormSourceSchema>;

export const FormSchemaSchema = z
  .object({
    schemaVersion: z.literal(FORM_SCHEMA_VERSION),
    id: identifier,
    formNumber: z.string().min(1),
    title: z.string().min(1),
    edition: z.string().min(1),
    source: FormSourceSchema,
    sections: z.array(FormScreenSectionSchema).min(1),
    fields: z.array(FormFieldSchema).min(1),
    rules: z.array(FormRuleParagraphSchema).min(1),
    layout: FormLayoutSchema,
    /** Plain statements the preparer could not settle (ambiguous or undefined rules). */
    notes: z.array(z.string().min(1)).optional(),
  })
  .superRefine((form, context) => {
    const fieldIds = new Set<string>();
    for (const field of form.fields) {
      if (fieldIds.has(field.id)) {
        context.addIssue({ code: 'custom', message: `duplicate field id ${field.id}` });
      }
      fieldIds.add(field.id);
    }
    const ruleIds = new Set(form.rules.map((rule) => rule.id));
    if (ruleIds.size !== form.rules.length) {
      context.addIssue({ code: 'custom', message: 'duplicate rule paragraph id' });
    }
    for (const field of form.fields) {
      for (const paragraphId of field.rule.paragraphIds) {
        if (!ruleIds.has(paragraphId)) {
          context.addIssue({
            code: 'custom',
            message: `field ${field.id} cites unknown paragraph ${paragraphId}`,
          });
        }
      }
    }
    const sectioned = new Set<string>();
    for (const section of form.sections) {
      for (const id of section.fieldIds) {
        if (!fieldIds.has(id)) {
          context.addIssue({ code: 'custom', message: `section cites unknown field ${id}` });
        }
        sectioned.add(id);
      }
    }
    for (const field of form.fields) {
      if (field.type !== 'signature' && field.type !== 'stamp' && !sectioned.has(field.id)) {
        context.addIssue({ code: 'custom', message: `field ${field.id} is on no screen section` });
      }
    }
    const printed = new Set<string>();
    for (const block of form.layout.blocks) {
      for (const column of block.columns) {
        for (const row of column.rows) {
          for (const segment of row.segments) {
            if (segment.kind === 'text' || segment.kind === 'rule') continue;
            const cited =
              segment.kind === 'table'
                ? segment.rows.flat().filter((cell): cell is string => typeof cell === 'string')
                : [segment.fieldId];
            for (const id of cited) {
              if (!fieldIds.has(id)) {
                context.addIssue({ code: 'custom', message: `layout cites unknown field ${id}` });
              }
              printed.add(id);
            }
          }
        }
      }
    }
    for (const field of form.fields) {
      if (!printed.has(field.id)) {
        context.addIssue({ code: 'custom', message: `field ${field.id} is not on the blank` });
      }
    }
  });
export type FormSchema = z.infer<typeof FormSchemaSchema>;

export function parseFormSchema(value: unknown): FormSchema {
  return FormSchemaSchema.parse(value);
}
