import { z } from 'zod';
import {
  CalculatorSchemaSchema,
  CalculatorVisualSchema,
  ScoreScaleSchema,
} from './calculator-schema';
import {
  HttpUrlSchema,
  ObservationMappingSchema,
  ToolEvaluationSchema,
} from './clinical-observations';
import { ToolAgeScopeSchema } from './tool-age-scope';

export const ToolModuleKindSchema = z.enum(['calculator', 'assessment']);

const AssessmentResponseValueSchema = z.number().int().min(0).max(100);

const AssessmentResponseOptionSchema = z.object({
  value: AssessmentResponseValueSchema,
  label: z.string().min(1),
  /** One or two letters for a printed answer sheet («В», «Н», «?»). */
  shortLabel: z.string().min(1).max(3).optional(),
});

const AssessmentInterpretationSchema = z
  .object({
    minScore: z.number().optional(),
    maxScore: z.number().optional(),
    scaleId: z.string().min(1).optional(),
    when: z.string().min(1).optional(),
    headline: z.string().min(1),
    message: z.string().min(1),
  })
  .superRefine((interpretation, context) => {
    const hasBand = interpretation.minScore !== undefined || interpretation.maxScore !== undefined;
    if (Boolean(interpretation.when) === hasBand) {
      context.addIssue({
        code: 'custom',
        message: 'exactly one of when or minScore/maxScore is required',
      });
    }
    if (
      hasBand &&
      (interpretation.minScore === undefined || interpretation.maxScore === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'minScore and maxScore must be provided together',
      });
    }
  });

/**
 * A notice shown above the result whenever `when` holds, whatever band the score falls in — a
 * safety answer (EPDS item 10, PHQ-9 item 9) must not hide inside one band's wording. `when` is a
 * calculator expression over the scale scores (`score_<scale>`, `percent_<scale>`) and the answers
 * (`answer_<question id>`).
 */
const AssessmentAlertSchema = z.object({
  id: z.string().min(1),
  when: z.string().min(1),
  title: z.string().min(1),
  message: z.string().min(1),
});

/**
 * How often one answer value was chosen, shown while the questionnaire is filled in and on the
 * result; from `warnAt` on, the warning is shown with it.
 */
const AssessmentTallySchema = z.object({
  id: z.string().min(1),
  value: AssessmentResponseValueSchema,
  label: z.string().min(1),
  warnAt: z.number().int().positive().optional(),
  warning: z.string().min(1).optional(),
});

/** A table of numbers under the result; every cell is an expression over the scores and answers. */
const AssessmentTableSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    columns: z.array(z.string().min(1)).min(1),
    rows: z
      .array(
        z.object({
          label: z.string().min(1),
          cells: z.array(z.string().min(1)).min(1),
        }),
      )
      .min(1),
    caption: z.string().min(1).optional(),
  })
  .refine((table) => table.rows.every((row) => row.cells.length === table.columns.length), {
    message: 'every row needs one cell per column',
    path: ['rows'],
  });

/** One form of the same instrument: another language, or the men's and women's booklets. */
const AssessmentVariantSchema = z.object({
  /** Its name on the switch («Мужской», «English»). */
  label: z.string().min(1),
  assessmentId: z.string().min(1),
  /** BCP 47 language of that form's text, when the forms differ by language (`en`). */
  language: z.string().min(2).max(12).optional(),
});

export const AssessmentDefinitionSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    shortTitle: z.string().min(1),
    aliases: z.array(z.string().min(1)),
    bankId: z.string().min(1),
    bankLabel: z.string().min(1),
    category: z.string().min(1),
    description: z.string().min(1),
    /** The instruction read before the questions (the source's own words). */
    intro: z.string().min(1).optional(),
    estimatedMinutes: z.number().int().positive(),
    /** Who fills it in, in words («Взрослые; заполняет специалист»). */
    audience: z.string().min(1),
    /** Whose age the questionnaire is for (children with a range, adults, any age); required. */
    ageScope: ToolAgeScopeSchema,
    responseOptions: z.array(AssessmentResponseOptionSchema),
    scales: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        shortLabel: z.string().min(1),
        description: z.string().min(1),
        /**
         * The score as an expression over the answers (`answer_<question id>`, `max`, `min`) in
         * place of the sum of the scale's questions: some instruments count the larger of two items.
         */
        formula: z.string().min(1).optional(),
        /** An answer that only picks the thresholds (sex for RUS-AUDIT): not a score to show. */
        context: z.literal(true).optional(),
        /**
         * A step of the count (a raw or corrected score) that later formulas, rules and tables use
         * but the result does not list. A formula may name any scale declared before it as
         * `score_<id>`.
         */
        hidden: z.literal(true).optional(),
      }),
    ),
    questions: z.array(
      z.object({
        id: z.string().min(1),
        prompt: z.string().min(1),
        scaleId: z.string().min(1),
        reverse: z.literal(true).optional(),
        responseOptions: z.array(AssessmentResponseOptionSchema).optional(),
      }),
    ),
    disclaimer: z.string().min(1),
    evidenceNote: z.string().min(1),
    interpretations: z.array(AssessmentInterpretationSchema).optional(),
    alerts: z.array(AssessmentAlertSchema).default([]),
    /**
     * The blank prints an answer sheet as well: question numbers in a grid with a box for every
     * answer (`shortLabel`), for a booklet questionnaire answered on paper.
     */
    answerSheet: z.literal(true).optional(),
    /** Long questionnaires show this many questions at a time, with page arrows. */
    pageSize: z.number().int().min(5).max(100).optional(),
    /** Answers counted while the questionnaire is filled in («не знаю»), with a warning level. */
    tallies: z.array(AssessmentTallySchema).default([]),
    /** Tables of scores under the result (raw → corrected → standard score); cells are expressions. */
    tables: z.array(AssessmentTableSchema).default([]),
    /**
     * Every form of the instrument, this one included (languages, men's and women's booklets):
     * separate definitions whose questions have the same ids, so the answers given so far carry
     * over when the user switches. Shown as a switch named `variantLabel`.
     */
    variants: z.array(AssessmentVariantSchema).default([]),
    /** What the variant switch chooses («Вариант бланка», «Язык»). */
    variantLabel: z.string().min(1).optional(),
    /** The language of this definition's text (BCP 47: `ru`, `en`). */
    language: z.string().min(2).max(12).optional(),
    visuals: z.array(CalculatorVisualSchema).default([]),
    /** Banded score tracks drawn under the result; `valueId` is the id of one of `scales`. */
    scoreScales: z.array(ScoreScaleSchema).default([]),
    evaluation: ToolEvaluationSchema,
    observationMappings: z.array(ObservationMappingSchema).default([]),
    license: z.object({
      kind: z.enum(['project-original', 'public-domain-derived', 'third-party-attributed']),
      notice: z.string().min(1),
      sourceUrl: HttpUrlSchema.optional(),
    }),
  })
  .refine(
    (definition) =>
      definition.scoreScales.every(
        (scale) =>
          definition.scales.some((candidate) => candidate.id === scale.valueId) &&
          scale.bands.every(
            (band) =>
              band.interpretation === undefined ||
              band.interpretation < (definition.interpretations?.length ?? 0),
          ),
      ),
    {
      message:
        'score scales must reference one of the questionnaire scales and, for a band, an existing interpretation',
      path: ['scoreScales'],
    },
  );

export const ToolSourceLinkSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['clinical-recommendation', 'literature', 'guideline', 'regulatory']),
  relation: z.enum(['methodology', 'interpretation', 'clinical-context']),
  title: z.string().min(1),
  moduleId: z.string().min(1).nullable().default(null),
  documentId: z.string().min(1).nullable().default(null),
  url: HttpUrlSchema.nullable().default(null),
  reviewedAt: z.string().min(1),
});

export const ToolDefinitionRecordSchema = z.object({
  id: z.string().min(1),
  kind: ToolModuleKindSchema,
  version: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  shortTitle: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  bankId: z.string().min(1),
  bankLabel: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  audience: z.string().min(1),
  definition: z.record(z.string(), z.unknown()),
  sources: z.array(ToolSourceLinkSchema).default([]),
});

export type ToolModuleKind = z.infer<typeof ToolModuleKindSchema>;
export type AssessmentVisualDefinition = z.infer<typeof CalculatorVisualSchema>;
export type ToolSourceLink = z.infer<typeof ToolSourceLinkSchema>;
export type ToolDefinitionRecord = z.infer<typeof ToolDefinitionRecordSchema>;

/** Descriptive core metadata only: executable steps and questionnaire questions stay in packs. */
export const CalculatorToolPreviewSchema = z.object({ ...CalculatorSchemaSchema.shape }).pick({
  summary: true,
  category: true,
  tags: true,
  clinical: true,
  formulaDisplay: true,
  population: true,
  limitations: true,
  inputs: true,
  bundled: true,
  sources: true,
});

const ToolCatalogMetadataSchema = ToolDefinitionRecordSchema.omit({
  definition: true,
  sources: true,
}).extend({
  /** Copied from the definition so catalog lists can filter by age without loading it. */
  ageScope: ToolAgeScopeSchema,
});

export const ToolCatalogEntrySchema = z.discriminatedUnion('kind', [
  ToolCatalogMetadataSchema.extend({
    kind: z.literal('calculator'),
    preview: CalculatorToolPreviewSchema,
  }),
  ToolCatalogMetadataSchema.extend({
    kind: z.literal('assessment'),
    estimatedMinutes: z.number().int().positive(),
  }),
]);

export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntrySchema>;
export type CalculatorToolPreview = z.infer<typeof CalculatorToolPreviewSchema>;
