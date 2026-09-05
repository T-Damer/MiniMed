import { z } from 'zod';

/** External source links are navigation targets, never script or data payloads. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export const HttpUrlSchema = z
  .string()
  .url()
  .refine(isHttpUrl, 'URL источника должен использовать http или https.');

/** The four explicit states an instrument may report before a result is persisted. */
export const EvaluationStatusSchema = z.enum([
  'verdict',
  'missing-context',
  'unavailable',
  'not-applicable',
]);

export type EvaluationStatus = z.infer<typeof EvaluationStatusSchema>;

export const ReferenceAttentionLevelSchema = z.enum(['none', 'low', 'moderate', 'high', 'urgent']);

/** A snapshot of the rule used to explain one deterministic result. */
export const ReferenceVerdictSchema = z
  .object({
    rangeId: z.string().min(1),
    title: z.string().min(1),
    explanation: z.string().min(1),
    attentionLevel: ReferenceAttentionLevelSchema,
    lowerBound: z.number().finite().optional(),
    upperBound: z.number().finite().optional(),
    lowerInclusive: z.boolean().default(true),
    upperInclusive: z.boolean().default(true),
    sourceIds: z.array(z.string().min(1)).default([]),
  })
  .refine(
    (verdict) =>
      verdict.lowerBound === undefined ||
      verdict.upperBound === undefined ||
      verdict.lowerBound <= verdict.upperBound,
    { message: 'lowerBound must not exceed upperBound', path: ['upperBound'] },
  );

export type ReferenceVerdict = z.infer<typeof ReferenceVerdictSchema>;

/** A declarative threshold rule. The expression grammar is validated by the app engine. */
export const ReferenceVerdictRuleSchema = z.object({
  when: z.string().min(1),
  verdict: ReferenceVerdictSchema,
});

export type ReferenceVerdictRule = z.infer<typeof ReferenceVerdictRuleSchema>;

/**
 * Evaluation metadata is deliberately serialisable and contains no executable code. A definition
 * may publish rules, or explicitly state why no reference verdict is available.
 */
export const ToolEvaluationSchema = z
  .object({
    status: EvaluationStatusSchema,
    rules: z.array(ReferenceVerdictRuleSchema).default([]),
    missingContext: z.array(z.string().min(1)).default([]),
    reason: z.string().min(1).optional(),
    sourceIds: z.array(z.string().min(1)).default([]),
  })
  .refine((evaluation) => evaluation.status !== 'verdict' || evaluation.rules.length > 0, {
    message: 'status verdict requires at least one executable evaluation rule',
    path: ['rules'],
  });

export type ToolEvaluation = z.infer<typeof ToolEvaluationSchema>;

const MappingIdSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/u);

/**
 * Connects one deterministic input/output/scale to a stable longitudinal metric. Exactly one
 * source reference is required; this prevents a UI label from accidentally becoming a chart point.
 */
export const ObservationMappingSchema = z
  .object({
    metricId: MappingIdSchema,
    label: z.string().min(1).optional(),
    unit: z.string().min(1),
    inputId: MappingIdSchema.optional(),
    stepId: MappingIdSchema.optional(),
    outputId: MappingIdSchema.optional(),
    scaleId: MappingIdSchema.optional(),
    method: z.string().min(1).optional(),
    /** Multiplies the numeric source value before it is stored in the canonical observation unit. */
    valueMultiplier: z.number().finite().positive().optional(),
  })
  .refine(
    (mapping) =>
      [mapping.inputId, mapping.stepId, mapping.outputId, mapping.scaleId].filter(
        (value) => value !== undefined,
      ).length === 1,
    { message: 'exactly one of inputId, stepId, outputId, or scaleId is required' },
  );

export type ObservationMapping = z.infer<typeof ObservationMappingSchema>;

export const CalculatorPatientBindingKindSchema = z.enum([
  'birthDate',
  'dateOfBirth',
  'biologicalSex',
  'ageAtEvent',
  'latestObservation',
  'latestMeasurement',
]);

/** Explicit patient context lookup. There is intentionally no name/label binding. */
export const CalculatorPatientBindingSchema = z
  .object({
    kind: CalculatorPatientBindingKindSchema,
    metricId: MappingIdSchema.optional(),
    unit: z.string().min(1).optional(),
    maxAgeDays: z.number().int().nonnegative().optional(),
    /** Multiplies a numeric patient value before it is placed into the calculator input. */
    valueMultiplier: z.number().finite().positive().optional(),
  })
  .refine(
    (binding) =>
      !['latestObservation', 'latestMeasurement'].includes(binding.kind) ||
      binding.metricId !== undefined,
    { message: 'latest observation binding requires metricId', path: ['metricId'] },
  );

export type CalculatorPatientBinding = z.infer<typeof CalculatorPatientBindingSchema>;

/** One of the values a completed deterministic instrument can persist. */
export const ObservationValueSchema = z.object({
  value: z.number().finite(),
  unit: z.string().min(1),
  metricId: MappingIdSchema,
});

export type ObservationValue = z.infer<typeof ObservationValueSchema>;
