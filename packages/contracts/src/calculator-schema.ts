import { z } from 'zod';

import {
  CalculatorPatientBindingSchema,
  HttpUrlSchema,
  ObservationMappingSchema,
  ReferenceAttentionLevelSchema,
  ToolEvaluationSchema,
} from './clinical-observations';
import { ToolAgeScopeSchema } from './tool-age-scope';

/**
 * A declarative calculator definition: inputs, a restricted formula expression per step, sources, and
 * population/limitation text. Interpreted by a generic engine (see `evaluateCalculatorSchema` in
 * apps/app), never executed as code — this is what makes the format safe to accept from a downloaded
 * content pack or, eventually, an LLM-authored draft: validating against this schema is the trust
 * boundary, not the formula's origin.
 */

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
  'pediatrics',
  'intensive-care',
  'surgery',
  'neurology',
  'pulmonology',
  'endocrinology',
  'laboratory',
  'rheumatology',
  'oncology',
  'urology',
  /** Calculators the doctor made in the app («Мои калькуляторы»); never shipped in a content module. */
  'custom',
]);

export const CalculatorSourceReferenceSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().min(1),
  version: z.string().min(1),
  url: HttpUrlSchema.optional(),
  edition: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
  reviewedAt: z.string().min(1),
});

export const CalculatorInputOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string().min(1),
  /** Offered only while the input's `optionGroupInput` holds this value (units of one quantity). */
  group: z.string().min(1).optional(),
});

export const CalculatorInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
  label: z.string().min(1),
  /** Optional short help opened from the field label without occupying form space. */
  labelTooltip: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  /** 'date' inputs render as a native date picker and pass an ISO string (YYYY-MM-DD) to expressions
   *  — combine with the `today()`/`addDays()`/`daysBetween()` expression functions. */
  kind: z.enum(['number', 'select', 'date', 'text', 'checkbox']),
  options: z.array(CalculatorInputOptionSchema).optional(),
  /** Earlier select input whose value picks the options on offer here: only options with a matching
   *  `group` are shown, and a change of that input resets this one to the first of them. */
  optionGroupInput: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid input id')
    .optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** Declared precision grid of the field (display rounding, age-at-event binding). It is never the
   *  HTML `step`: a native step makes every value off `minimum + k * step` «invalid», so number inputs
   *  always render with `step="any"` and ranges are checked by the engine with a Russian message. */
  inputStep: z.number().positive().optional(),
  /** Reject non-integer values for a 'number' input (e.g. Bishop score sub-scores, whole weeks/days). */
  integer: z.boolean().optional(),
  required: z.boolean(),
  note: z.string().min(1).optional(),
  /** Evaluated only when `required: false` and the field is left blank — e.g. `today()` for an optional
   *  "as of" date. Evaluated in the scope of already-collected inputs only, not other defaults/steps. */
  defaultExpression: z.string().min(1).optional(),
  /** Keep this input disabled until the referenced earlier input has a non-empty value. */
  requiresInput: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid input id')
    .optional(),
  /** Form stage at which this input becomes visible and required, starting at 0. */
  step: z.number().int().min(0).default(0),
  /** Explicitly allowed profile lookup; free-text labels are never used for autofill. */
  patientBinding: CalculatorPatientBindingSchema.optional(),
});

export const CalculatorInputRequirementSchema = z
  .object({
    kind: z.literal('atLeastOne'),
    inputIds: z.array(z.string().min(1)).min(2),
    message: z.string().min(1),
  })
  .refine((requirement) => new Set(requirement.inputIds).size === requirement.inputIds.length, {
    message: 'inputIds must be unique',
    path: ['inputIds'],
  });

export const CalculatorWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  /** Without `when` the warning belongs to every result. With it, the warning is added to a result
   *  only when this expression, evaluated against the inputs and steps, is truthy (`1`) — a
   *  plausibility note for a value outside the range a patient can have (creatinine of 5 мкмоль/л). */
  when: z.string().min(1).optional(),
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
  valueKind: z.enum(['number', 'date', 'text']).default('number'),
  /** Form stage at which this derived value becomes available, starting at 0. */
  stepRequired: z.number().int().min(0).default(0),
  /** Select input whose chosen option label is this value's unit (a converter's target unit); `unit`
   *  stays the fallback for a result saved without it. */
  unitFromInput: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid input id')
    .optional(),
  /** Only `profileContext`: the value is the card's field of that key — a saved result writes it
   *  there (the due date a calculator found), the way an input binding reads it. */
  patientBinding: CalculatorPatientBindingSchema.optional(),
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

const CalculatorVisualValueSchema = z.union([z.number(), z.string().min(1)]);

export const CalculatorVisualPointSchema = z.object({
  x: CalculatorVisualValueSchema,
  y: CalculatorVisualValueSchema,
});

export const CalculatorVisualSampleSchema = z
  .object({
    variable: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
    from: z.number().finite(),
    to: z.number().finite(),
    step: z.number().positive().finite(),
    x: z.string().min(1),
    y: z.string().min(1),
  })
  .superRefine((sample, context) => {
    if (sample.to < sample.from) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'must be greater than from' });
      return;
    }
    if (Math.floor((sample.to - sample.from) / sample.step) + 1 > 500) {
      context.addIssue({
        code: 'custom',
        path: ['step'],
        message: 'must produce at most 500 points',
      });
    }
  });

/** One plotted series. `data` preserves category charts; `points` and bounded `sample` support
 *  generic XY curves without allowing arbitrary loops or renderer code in downloaded schemas. */
export const CalculatorVisualDatasetSchema = z
  .object({
    label: z.string().min(1),
    data: z.array(CalculatorVisualValueSchema).min(1).optional(),
    points: z.array(CalculatorVisualPointSchema).min(1).optional(),
    sample: CalculatorVisualSampleSchema.optional(),
    render: z.enum(['line', 'point']).optional(),
    tone: z.enum(['neutral', 'danger', 'warning', 'success', 'accent']).optional(),
  })
  .superRefine((dataset, context) => {
    const sourceCount =
      Number(Boolean(dataset.data)) +
      Number(Boolean(dataset.points)) +
      Number(Boolean(dataset.sample));
    if (sourceCount !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'exactly one of data, points, or sample is required',
      });
    }
  });

export const CalculatorVisualAxisSchema = z.object({
  label: z.string().min(1),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  minimumLabel: z.string().min(1).optional(),
  maximumLabel: z.string().min(1).optional(),
  reverse: z.boolean().default(false),
});

export const CalculatorVisualAnnotationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('quadrants'),
    x: z.number().finite(),
    y: z.number().finite(),
    labels: z.object({
      topLeft: z.string().min(1),
      topRight: z.string().min(1),
      bottomLeft: z.string().min(1),
      bottomRight: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal('rings'),
    x: z.number().finite(),
    y: z.number().finite(),
    radiusPercent: z.array(z.number().positive().max(50)).min(1),
  }),
]);

/**
 * A declarative chart rendered under the calculation result. The engine evaluates dataset
 * expressions and emits a plain serializable spec (type/labels/datasets with numbers only); the UI
 * draws it with Chart.js. No arbitrary code runs at render time.
 */
export const CalculatorVisualSchema = z.object({
  id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
  title: z.string().min(1),
  kind: z.enum(['bar', 'line', 'pie', 'doughnut', 'scatter']),
  /** Category labels for bar/line/pie charts (one per data point). */
  labels: z.array(z.string()).default([]),
  datasets: z.array(CalculatorVisualDatasetSchema).min(1),
  xAxis: CalculatorVisualAxisSchema.optional(),
  yAxis: CalculatorVisualAxisSchema.optional(),
  annotations: z.array(CalculatorVisualAnnotationSchema).default([]),
  caption: z.string().min(1).optional(),
  heightPx: z.number().int().min(80).max(600).optional(),
});

/** One band of a score scale: from its first value up to the first value of the next band. */
export const ScoreScaleBandSchema = z.object({
  /** First value the band covers, in the units of the scale's value; bands are listed in ascending order. */
  from: z.number().finite(),
  /** Short name of the band («Низкий риск», «III класс»). */
  label: z.string().min(1).optional(),
  /** How much attention the band calls for; the track is coloured by it, neutral when absent. */
  attentionLevel: ReferenceAttentionLevelSchema.optional(),
  /** Index into the definition's `interpretations` whose text explains the band. */
  interpretation: z.number().int().min(0).optional(),
});

/**
 * A banded track drawn under a numeric result: the bands side by side, a marker at the value and the
 * text of the band it falls in. Pure presentation data — the verdict rules and interpretations
 * stay the authority for what a result means, and a catalog test keeps the two in step. Without
 * bands the track is a plain gauge between `minimum` and `maximum`.
 */
export const ScoreScaleSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'must be a valid expression variable name'),
    /** The numeric value the marker shows: a calculator output/step/input id, or an assessment scale id. */
    valueId: z.string().min(1),
    label: z.string().min(1).optional(),
    /** Lowest and highest value of the track: the range worth drawing — a value beyond it is held at the end and marked. */
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    /** Distance between two neighbouring values (1 for point scores); a value then fills a cell of
     *  this width, so a boundary falls between two values instead of on one. */
    step: z.number().positive().finite().optional(),
    /** `equal` gives every band the same width (classes such as NYHA I–IV); `proportional` scales by value. */
    layout: z.enum(['proportional', 'equal']).default('proportional'),
    bands: z.array(ScoreScaleBandSchema).default([]),
  })
  .superRefine((scale, context) => {
    if (scale.maximum <= scale.minimum) {
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'must be greater than minimum',
      });
    }
    for (const [index, band] of scale.bands.entries()) {
      if (band.from < scale.minimum || band.from > scale.maximum) {
        context.addIssue({
          code: 'custom',
          path: ['bands', index, 'from'],
          message: 'must lie between minimum and maximum',
        });
      }
      const previous = scale.bands[index - 1];
      if (previous && band.from <= previous.from) {
        context.addIssue({
          code: 'custom',
          path: ['bands', index, 'from'],
          message: 'bands must be in strictly ascending order',
        });
      }
    }
    const first = scale.bands[0];
    if (first && first.from !== scale.minimum) {
      context.addIssue({
        code: 'custom',
        path: ['bands', 0, 'from'],
        message: 'the first band starts at minimum',
      });
    }
    if (scale.layout === 'equal' && scale.bands.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['layout'],
        message: 'equal layout needs at least two bands',
      });
    }
  });

const CalculatorSearchBindingsSchema = z.object({
  weightKgInputId: z.string().min(1).optional(),
  ageYearsInputId: z.string().min(1).optional(),
  formInputId: z.string().min(1).optional(),
  routeInputId: z.string().min(1).optional(),
  indicationInputId: z.string().min(1).optional(),
});

export const CalculatorSearchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('medication-dose'),
    medication: z.object({
      canonicalTerm: z.string().min(1),
      aliases: z.array(z.string().min(1)).default([]),
    }),
    bindings: CalculatorSearchBindingsSchema,
  }),
  z.object({
    kind: z.literal('infusion-volume'),
    bindings: CalculatorSearchBindingsSchema,
  }),
]);

/** How the saved result is laid out; the plain list of outputs when a calculator declares none. */
export const CalculatorResultLayoutSchema = z.enum(['feeding-plan']);

export const CalculatorSchemaSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    shortTitle: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    summary: z.string().min(1),
    /** Who the calculator is for (children with an age range, adults, any age); required. */
    ageScope: ToolAgeScopeSchema,
    category: CalculatorCategorySchema,
    /** Additional calculator sections where this same definition is listed. */
    tags: z.array(CalculatorCategorySchema).default([]),
    clinical: z.boolean(),
    formulaDisplay: z.string().min(1),
    population: z.string().min(1),
    limitations: z.array(z.string().min(1)).min(1),
    inputs: z.array(CalculatorInputSchema).min(1),
    inputRequirements: z.array(CalculatorInputRequirementSchema).default([]),
    steps: z.array(CalculatorStepSchema).min(1),
    warnings: z.array(CalculatorWarningSchema).default([]),
    interpretations: z.array(CalculatorInterpretationSchema).default([]),
    /** Deterministic reference evaluation or an explicit unavailable/not-applicable declaration. */
    evaluation: ToolEvaluationSchema,
    /** Stable longitudinal metrics emitted by input/step/output definitions. */
    observationMappings: z.array(ObservationMappingSchema).default([]),
    assertions: z.array(CalculatorAssertionSchema).default([]),
    visuals: z.array(CalculatorVisualSchema).default([]),
    /** Banded score tracks drawn under the result (see `ScoreScaleSchema`). */
    scoreScales: z.array(ScoreScaleSchema).default([]),
    resultLayout: CalculatorResultLayoutSchema.optional(),
    /** Usable without downloading its section (set on the few tools that ship with the app). */
    bundled: z.boolean().optional(),
    /** Optional runtime discoverability metadata; dose rules remain external to calculator schemas. */
    search: CalculatorSearchSchema.optional(),
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
  )
  .refine(
    (schema) => {
      const inputIds = new Set(schema.inputs.map((input) => input.id));
      return schema.inputRequirements.every((requirement) =>
        requirement.inputIds.every((id) => inputIds.has(id)),
      );
    },
    {
      message: 'input requirements must reference existing inputs',
      path: ['inputRequirements'],
    },
  )
  .refine(
    (schema) => {
      const valueIds = new Set([
        ...schema.inputs.map((input) => input.id),
        ...schema.steps.map((step) => step.id),
      ]);
      return schema.scoreScales.every(
        (scale) =>
          valueIds.has(scale.valueId) &&
          scale.bands.every(
            (band) =>
              band.interpretation === undefined ||
              band.interpretation < schema.interpretations.length,
          ),
      );
    },
    {
      message:
        'score scales must reference an existing input or step and, for a band, an existing interpretation',
      path: ['scoreScales'],
    },
  )
  .refine(
    (schema) =>
      schema.steps.every(
        (step) =>
          step.patientBinding === undefined || step.patientBinding.kind === 'profileContext',
      ),
    {
      message: 'a step can only bind to a patient context field (kind profileContext)',
      path: ['steps'],
    },
  )
  .refine(
    (schema) => {
      const search = schema.search;
      if (!search) return true;
      const inputsById = new Map(schema.inputs.map((input) => [input.id, input]));
      const bindingIds = [
        search.bindings.weightKgInputId,
        search.bindings.ageYearsInputId,
        search.bindings.formInputId,
        search.bindings.routeInputId,
        search.bindings.indicationInputId,
      ].filter((id): id is string => id !== undefined);
      if (bindingIds.some((id) => !inputsById.has(id))) return false;
      return [
        search.bindings.formInputId,
        search.bindings.routeInputId,
        search.bindings.indicationInputId,
      ].every((id) => id === undefined || inputsById.get(id)?.kind === 'select');
    },
    {
      message:
        'search bindings must reference inputs; form, route, and indication bindings must be select inputs',
      path: ['search', 'bindings'],
    },
  );

export type CalculatorResultLayout = z.infer<typeof CalculatorResultLayoutSchema>;
export type CalculatorCategory = z.infer<typeof CalculatorCategorySchema>;
export type CalculatorSourceReference = z.infer<typeof CalculatorSourceReferenceSchema>;
export type CalculatorInputOption = z.infer<typeof CalculatorInputOptionSchema>;
export type CalculatorInputDefinition = z.infer<typeof CalculatorInputSchema>;
export type CalculatorInputRequirement = z.infer<typeof CalculatorInputRequirementSchema>;
export type CalculatorStepDefinition = z.infer<typeof CalculatorStepSchema>;
export type CalculatorWarning = z.infer<typeof CalculatorWarningSchema>;
export type CalculatorInterpretation = z.infer<typeof CalculatorInterpretationSchema>;
export type CalculatorAssertion = z.infer<typeof CalculatorAssertionSchema>;
export type ScoreScaleBand = z.infer<typeof ScoreScaleBandSchema>;
export type ScoreScaleDefinition = z.infer<typeof ScoreScaleSchema>;
export type CalculatorVisualDataset = z.infer<typeof CalculatorVisualDatasetSchema>;
export type CalculatorVisualDefinition = z.infer<typeof CalculatorVisualSchema>;
export type CalculatorSearch = z.infer<typeof CalculatorSearchSchema>;
export type CalculatorSchema = z.infer<typeof CalculatorSchemaSchema>;
