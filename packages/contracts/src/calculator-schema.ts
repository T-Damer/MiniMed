import { z } from 'zod';

/**
 * A declarative calculator definition: inputs, a restricted formula expression per step, sources, and
 * population/limitation text. Interpreted by a generic engine (see `evaluateCalculatorSchema` in
 * apps/app), never executed as code — this is what makes the format safe to accept from a downloaded
 * content pack or, eventually, an LLM-authored draft: validating against this schema is the trust
 * boundary, not the formula's origin.
 */

export const CalculatorAudienceSchema = z.enum(['all', 'adult', 'pediatric']);

export const CalculatorCategorySchema = z.enum([
  'unit-conversion',
  'renal',
  'anthropometry',
  'fluids',
  'medication',
  'screening',
  'obstetrics',
  'gynecology',
  'emergency',
  'cardiology',
  'gastroenterology',
  'hematology',
  'neonatology',
]);

export const CalculatorSourceReferenceSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().min(1),
  url: z.string().min(1).optional(),
  edition: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
  reviewedAt: z.string().min(1),
});

export const CalculatorInputOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string().min(1),
});

export const CalculatorInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
  label: z.string().min(1),
  unit: z.string().min(1).optional(),
  /** 'date' inputs render as a native date picker and pass an ISO string (YYYY-MM-DD) to expressions
   *  — combine with the `today()`/`addDays()`/`daysBetween()` expression functions. */
  kind: z.enum(['number', 'select', 'date']),
  options: z.array(CalculatorInputOptionSchema).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** Reject non-integer values for a 'number' input (e.g. Bishop score sub-scores, whole weeks/days). */
  integer: z.boolean().optional(),
  required: z.boolean(),
  note: z.string().min(1).optional(),
  /** Evaluated only when `required: false` and the field is left blank — e.g. `today()` for an optional
   *  "as of" date. Evaluated in the scope of already-collected inputs only, not other defaults/steps. */
  defaultExpression: z.string().min(1).optional(),
  /** Form stage at which this input becomes visible and required, starting at 0. */
  step: z.number().int().min(0).default(0),
});

export const CalculatorWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const CalculatorStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
  label: z.string().min(1),
  /** Required even for `valueKind: 'date'` steps for schema simplicity — convention is `'дата'`; the
   *  engine ignores it for date steps (they render as formatted text, not a number + unit). */
  unit: z.string().min(1),
  expression: z.string().min(1),
  displayPrecision: z.number().int().min(0).max(10).default(2),
  /** Whether this step is a final result shown prominently, not just an intermediate trace line. */
  isOutput: z.boolean().default(false),
  /** 'date' steps must evaluate to an ISO date string (typically via `addDays()`); they render as
   *  formatted text output and are not traced as a numeric step (CalculationTraceStep.value is always
   *  a number) — use a separate 'number' step to trace the underlying day-count if that matters. */
  valueKind: z.enum(['number', 'date']).default('number'),
  /** Form stage at which this derived value becomes available, starting at 0. */
  stepRequired: z.number().int().min(0).default(0),
});

export const CalculatorInterpretationSchema = z.object({
  /** Evaluated against the scope after all steps run, in array order; the first truthy (`1`) match
   *  wins and its message is appended to the result's warnings — e.g. Bishop score's threshold bands. */
  when: z.string().min(1),
  message: z.string().min(1),
});

export const CalculatorAssertionSchema = z.object({
  /** Evaluated against the scope after all steps run, in array order. Truthy (`1`) means FAIL — the
   *  whole calculation is rejected with `error`, same as a missing/out-of-range input. Use this for
   *  guards on a *derived* value that no single input's min/max can express, e.g. "computed gestational
   *  age at the reference date exceeds 40 weeks" (a combination of two date/week inputs). */
  when: z.string().min(1),
  error: z.string().min(1),
});

export const CalculatorSchemaSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    shortTitle: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    audience: CalculatorAudienceSchema,
    category: CalculatorCategorySchema,
    clinical: z.boolean(),
    formulaDisplay: z.string().min(1),
    population: z.string().min(1),
    limitations: z.array(z.string().min(1)).min(1),
    inputs: z.array(CalculatorInputSchema).min(1),
    steps: z.array(CalculatorStepSchema).min(1),
    warnings: z.array(CalculatorWarningSchema).default([]),
    interpretations: z.array(CalculatorInterpretationSchema).default([]),
    assertions: z.array(CalculatorAssertionSchema).default([]),
    sources: z.array(CalculatorSourceReferenceSchema).min(1),
  })
  .refine((schema) => schema.steps.some((step) => step.isOutput), {
    message: 'at least one step must have isOutput: true',
    path: ['steps'],
  })
  .refine(
    (schema) => {
      const inputIds = new Set(schema.inputs.map((input) => input.id));
      const stepIds = new Set<string>();
      for (const step of schema.steps) {
        if (inputIds.has(step.id) || stepIds.has(step.id)) return false;
        stepIds.add(step.id);
      }
      return true;
    },
    { message: 'input and step ids must be unique across the whole calculator', path: ['steps'] },
  );

export type CalculatorAudience = z.infer<typeof CalculatorAudienceSchema>;
export type CalculatorCategory = z.infer<typeof CalculatorCategorySchema>;
export type CalculatorSourceReference = z.infer<typeof CalculatorSourceReferenceSchema>;
export type CalculatorInputOption = z.infer<typeof CalculatorInputOptionSchema>;
export type CalculatorInputDefinition = z.infer<typeof CalculatorInputSchema>;
export type CalculatorStepDefinition = z.infer<typeof CalculatorStepSchema>;
export type CalculatorWarning = z.infer<typeof CalculatorWarningSchema>;
export type CalculatorInterpretation = z.infer<typeof CalculatorInterpretationSchema>;
export type CalculatorAssertion = z.infer<typeof CalculatorAssertionSchema>;
export type CalculatorSchema = z.infer<typeof CalculatorSchemaSchema>;
