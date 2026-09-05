import { z } from 'zod';
import { CalculatorSchemaSchema, CalculatorVisualSchema } from './calculator-schema';
import {
  HttpUrlSchema,
  ObservationMappingSchema,
  ToolEvaluationSchema,
} from './clinical-observations';

export const ToolModuleKindSchema = z.enum(['calculator', 'assessment']);

const AssessmentResponseValueSchema = z.number().int().min(0).max(100);

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

export const AssessmentDefinitionSchema = z.object({
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
  estimatedMinutes: z.number().int().positive(),
  audience: z.string().min(1),
  responseOptions: z.array(
    z.object({ value: AssessmentResponseValueSchema, label: z.string().min(1) }),
  ),
  scales: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      shortLabel: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  questions: z.array(
    z.object({
      id: z.string().min(1),
      prompt: z.string().min(1),
      scaleId: z.string().min(1),
      reverse: z.literal(true).optional(),
      responseOptions: z
        .array(z.object({ value: AssessmentResponseValueSchema, label: z.string().min(1) }))
        .optional(),
    }),
  ),
  disclaimer: z.string().min(1),
  evidenceNote: z.string().min(1),
  interpretations: z.array(AssessmentInterpretationSchema).optional(),
  visuals: z.array(CalculatorVisualSchema).default([]),
  evaluation: ToolEvaluationSchema,
  observationMappings: z.array(ObservationMappingSchema).default([]),
  license: z.object({
    kind: z.enum(['project-original', 'public-domain-derived', 'third-party-attributed']),
    notice: z.string().min(1),
    sourceUrl: HttpUrlSchema.optional(),
  }),
});

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
  audience: true,
  category: true,
  tags: true,
  clinical: true,
  formulaDisplay: true,
  population: true,
  limitations: true,
  inputs: true,
  sources: true,
});

const ToolCatalogMetadataSchema = ToolDefinitionRecordSchema.omit({
  definition: true,
  sources: true,
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
