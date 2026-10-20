import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  type ScoreScaleDefinition,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateCalculatorExpression } from '@/features/calculators/calculator-expression';

// Every tool module is read from disk, so a tool added by anyone is held to the same rules.
const MODULES_DIR = resolve(process.cwd(), 'content/tool-modules');
const records = readdirSync(MODULES_DIR)
  .filter((name) => name.endsWith('.json'))
  .flatMap(
    (name) =>
      (JSON.parse(readFileSync(resolve(MODULES_DIR, name), 'utf8')) as { tools: unknown[] }).tools,
  )
  .map((tool) => ToolDefinitionRecordSchema.parse(tool));

const calculators = records
  .filter((record) => record.kind === 'calculator')
  .map((record) => CalculatorSchemaSchema.parse(record.definition));
const assessments = records
  .filter((record) => record.kind === 'assessment')
  .map((record) => AssessmentDefinitionSchema.parse(record.definition));

/** Interpretation cascades that cannot be drawn as one ordered track, with the reason. */
const NO_SCALE_BY_DESIGN: Readonly<Record<string, string>> = {
  'minimed.calculator.kerdo-index': 'a single-point band at 0 without a tolerance in the source',
  'minimed.calculator.covid19-severity-china': 'classes 1–3 are codes, not an ordered score',
  'minimed.calculator.pediatric-blood-pressure-aap':
    'a category code of one office measurement (normal … stage 2), not a score',
};

/** Scales whose grid has values that are not reachable results, so the cascade cannot be replayed on them. */
const NOT_REPLAYABLE: Readonly<Record<string, string>> = {
  'minimed.calculator.hoehn-yahr-modified':
    'stages are half-steps; 0,5, 3,5 and 4,5 are not stages',
};

function identifiers(expression: string): string[] {
  return [...expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/gu)].map((match) => match[0]);
}

/** Values inside each band: every whole step on a grid, otherwise points well inside the band. */
function samples(scale: ScoreScaleDefinition): { band: number; values: number[] }[] {
  return scale.bands.map((band, index) => {
    const next = scale.bands[index + 1]?.from ?? scale.maximum + (scale.step ?? 0);
    if (scale.step) {
      const values: number[] = [];
      for (let value = band.from; value < next - 1e-9; value += scale.step) {
        values.push(Math.round(value * 1e6) / 1e6);
        if (values.length >= 6) break;
      }
      return { band: index, values };
    }
    const width = next - band.from;
    return {
      band: index,
      values: [band.from + width * 0.1, band.from + width * 0.5, next - width * 0.1],
    };
  });
}

describe('score scales across the tool catalog', () => {
  const scaledCalculators = calculators.filter((schema) => schema.scoreScales.length > 0);
  const scaledAssessments = assessments.filter((definition) => definition.scoreScales.length > 0);

  it('covers most tools that report a numeric score or risk', () => {
    expect(scaledCalculators.length).toBeGreaterThanOrEqual(150);
    expect(scaledAssessments.length).toBeGreaterThanOrEqual(15);
  });

  it('gives every single-score interpretation cascade a scale', () => {
    const missing = calculators
      .filter((schema) => schema.interpretations.length > 0 && schema.scoreScales.length === 0)
      .filter((schema) => !(schema.id in NO_SCALE_BY_DESIGN))
      .filter((schema) => {
        const known = new Set([
          ...schema.inputs.map((input) => input.id),
          ...schema.steps.map((step) => step.id),
        ]);
        const used = new Set(
          schema.interpretations.flatMap((interpretation) =>
            identifiers(interpretation.when).filter((name) => known.has(name)),
          ),
        );
        // One calculated result, not an input such as the child's age that only selects a note.
        const [only] = [...used];
        return used.size === 1 && schema.steps.some((step) => step.id === only);
      })
      .map((schema) => schema.id);
    expect(missing).toEqual([]);
    const missingAssessments = assessments
      .filter((definition) =>
        (definition.interpretations ?? []).some((band) => band.minScore !== undefined),
      )
      .filter((definition) => definition.scoreScales.length === 0)
      .map((definition) => definition.id);
    expect(missingAssessments).toEqual([]);
  });

  it.each(
    scaledCalculators.flatMap((schema) =>
      schema.scoreScales.map((scale) => [schema.id, schema, scale] as const),
    ),
  )('%s: the scale agrees with the interpretations', (_id, schema, scale) => {
    const value = schema.steps.find((step) => step.id === scale.valueId);
    const input = schema.inputs.find((candidate) => candidate.id === scale.valueId);
    expect(value ? value.valueKind : input?.kind).toMatch(/^(number)$/u);
    // Bands are either all coloured or all neutral, and all named or all anonymous.
    expect(
      new Set(scale.bands.map((band) => band.attentionLevel === undefined)).size,
    ).toBeLessThanOrEqual(1);
    expect(new Set(scale.bands.map((band) => band.label === undefined)).size).toBeLessThanOrEqual(
      1,
    );
    for (const band of scale.bands) {
      if (band.interpretation !== undefined) {
        expect(schema.interpretations[band.interpretation]).toBeDefined();
      }
    }
    const linked = scale.bands.every((band) => band.interpretation !== undefined);
    const names = new Set(
      schema.interpretations.flatMap((interpretation) =>
        identifiers(interpretation.when).filter(
          (name) =>
            schema.steps.some((step) => step.id === name) ||
            schema.inputs.some((candidate) => candidate.id === name),
        ),
      ),
    );
    // Only a cascade that depends on this one value can be replayed here.
    if (!linked || names.size !== 1 || !names.has(scale.valueId) || schema.id in NOT_REPLAYABLE)
      return;
    for (const { band, values } of samples(scale)) {
      expect(values.length).toBeGreaterThan(0);
      for (const sample of values) {
        const matched = schema.interpretations.findIndex(
          (interpretation) =>
            evaluateCalculatorExpression(interpretation.when, { [scale.valueId]: sample }) === 1,
        );
        expect(matched, `${scale.valueId} = ${sample}`).toBe(scale.bands[band]?.interpretation);
      }
    }
  });

  it.each(
    scaledAssessments.flatMap((definition) =>
      definition.scoreScales.map((scale) => [definition.id, definition, scale] as const),
    ),
  )('%s: the scale agrees with the score bands', (_id, definition, scale) => {
    expect(definition.scales.some((candidate) => candidate.id === scale.valueId)).toBe(true);
    // A band names the scale it reads; one without a scale reads the first one.
    const readsScale = (band: { readonly scaleId?: string | undefined }) =>
      (band.scaleId ?? definition.scales[0]?.id) === scale.valueId;
    const ranged = (definition.interpretations ?? []).filter(
      (band) => band.minScore !== undefined && band.maxScore !== undefined,
    );
    if (ranged.length === 0) return;
    // A track of its own (the PHQ-9 difficulty item) has no interpretation to agree with.
    if (!ranged.some(readsScale)) {
      expect(scale.bands.every((band) => band.interpretation === undefined)).toBe(true);
      return;
    }
    for (const { band, values } of samples(scale)) {
      for (const sample of values) {
        const matched = (definition.interpretations ?? []).findIndex(
          (candidate) =>
            readsScale(candidate) &&
            candidate.minScore !== undefined &&
            candidate.maxScore !== undefined &&
            sample >= candidate.minScore &&
            sample <= candidate.maxScore,
        );
        // The first band reaches down to the lowest possible score.
        if (matched < 0 && band === 0) continue;
        expect(matched, `${scale.valueId} = ${sample}`).toBe(scale.bands[band]?.interpretation);
      }
    }
  });

  it('colours bands in the direction the interpretation names the worse side', () => {
    // Where a verdict rule and a band share a condition, a more serious band never sits on the
    // side the verdict calls less serious: the two must not contradict at the extremes.
    const rank = { none: 0, low: 1, moderate: 2, high: 3, urgent: 4 } as const;
    for (const schema of scaledCalculators) {
      if (schema.evaluation.status !== 'verdict') continue;
      for (const scale of schema.scoreScales) {
        const bands = scale.bands.filter(
          (band) => band.interpretation !== undefined && band.attentionLevel !== undefined,
        );
        const verdicts = bands.map((band) => {
          const when = schema.interpretations[band.interpretation ?? -1]?.when;
          return schema.evaluation.rules.find((rule) => rule.when === when)?.verdict.attentionLevel;
        });
        const pairs = bands.flatMap((band, index) => {
          const verdict = verdicts[index];
          return verdict && band.attentionLevel ? [[verdict, band.attentionLevel] as const] : [];
        });
        // A scale and its verdict rules may differ in grain but never invert: the band that is
        // calmest on the verdict side is not the most serious on the scale, and vice versa.
        if (pairs.length < 2) continue;
        const calmest = pairs.reduce((a, b) => (rank[b[0]] < rank[a[0]] ? b : a));
        const gravest = pairs.reduce((a, b) => (rank[b[0]] > rank[a[0]] ? b : a));
        if (rank[calmest[0]] === rank[gravest[0]]) continue;
        expect(rank[calmest[1]], schema.id).toBeLessThanOrEqual(rank[gravest[1]]);
      }
    }
  });
});
