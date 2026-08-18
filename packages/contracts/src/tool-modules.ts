import { z } from 'zod';

export const ToolModuleKindSchema = z.enum(['calculator', 'assessment']);

const AssessmentResponseValueSchema = z.number().int().min(0).max(100);

export const AssessmentDefinitionSchema = z.object({
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
  interpretations: z
    .array(
      z.object({
        minScore: z.number(),
        maxScore: z.number(),
        scaleId: z.string().min(1).optional(),
        headline: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .optional(),
  license: z.object({
    kind: z.enum(['project-original', 'public-domain-derived', 'third-party-attributed']),
    notice: z.string().min(1),
    sourceUrl: z.string().url().optional(),
  }),
});

export const ToolSourceLinkSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['clinical-recommendation', 'literature', 'guideline', 'regulatory']),
  relation: z.enum(['methodology', 'interpretation', 'clinical-context']),
  title: z.string().min(1),
  moduleId: z.string().min(1).nullable().default(null),
  documentId: z.string().min(1).nullable().default(null),
  url: z.string().url().nullable().default(null),
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
export type ToolSourceLink = z.infer<typeof ToolSourceLinkSchema>;
export type ToolDefinitionRecord = z.infer<typeof ToolDefinitionRecordSchema>;
