#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  type ToolDefinitionRecord,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';

const TOOL_MODULES = [
  'content/tool-modules/core-clinical.json',
  'content/tool-modules/gastroenterology.json',
  'content/tool-modules/neonatology.json',
  'content/tool-modules/emergency.json',
  'content/tool-modules/pediatrics.json',
  'content/tool-modules/obstetrics-gynecology.json',
  'content/tool-modules/psychology.json',
  'content/tool-modules/pediatrics-growth.json',
] as const;

function mappingReference(mapping: {
  readonly inputId?: string;
  readonly stepId?: string;
  readonly outputId?: string;
  readonly scaleId?: string;
}): string {
  if (mapping.inputId) return `input:${mapping.inputId}`;
  if (mapping.stepId) return `step:${mapping.stepId}`;
  if (mapping.outputId) return `output:${mapping.outputId}`;
  return `scale:${mapping.scaleId ?? 'missing'}`;
}

function appendProvenanceErrors(
  record: ToolDefinitionRecord,
  evaluation: {
    readonly sourceIds: readonly string[];
    readonly rules: readonly { readonly verdict: { readonly sourceIds: readonly string[] } }[];
  },
  errors: string[],
): void {
  const sourceIds = new Set(record.sources.map((source) => source.id));
  if (sourceIds.size !== record.sources.length) {
    errors.push(`${record.id}: source ids must be unique`);
  }
  const declaredSourceIds = [
    ...evaluation.sourceIds,
    ...evaluation.rules.flatMap((rule) => rule.verdict.sourceIds),
  ];
  for (const sourceId of declaredSourceIds) {
    if (!sourceIds.has(sourceId)) {
      errors.push(`${record.id}: evaluation references unknown source id (${sourceId})`);
    }
  }
  if (record.sources.length === 0) {
    errors.push(`${record.id}: every released tool needs at least one provenance source`);
  }
}

async function loadAllRecords(): Promise<readonly ToolDefinitionRecord[]> {
  const records: ToolDefinitionRecord[] = [];
  for (const modulePath of TOOL_MODULES) {
    const module = JSON.parse(await readFile(modulePath, 'utf8')) as {
      schemaVersion?: unknown;
      tools: readonly unknown[];
    };
    if (module.schemaVersion !== 2) {
      throw new Error(`${modulePath}: only tool-module schemaVersion 2 is supported`);
    }
    for (const raw of module.tools) records.push(ToolDefinitionRecordSchema.parse(raw));
  }
  return records;
}

function lintRecord(record: ToolDefinitionRecord): readonly string[] {
  if (record.kind === 'calculator') {
    const parsed = CalculatorSchemaSchema.safeParse(record.definition);
    if (!parsed.success)
      return parsed.error.issues.map(
        (issue) => `${record.id}: ${issue.path.join('.')}: ${issue.message}`,
      );
    const schema = parsed.data;
    const errors: string[] = [];
    const inputIds = new Set(schema.inputs.map((input) => input.id));
    const stepIds = new Set(schema.steps.map((step) => step.id));
    const outputIds = new Set(schema.steps.filter((step) => step.isOutput).map((step) => step.id));
    const mappingKeys = new Set<string>();
    for (const mapping of schema.observationMappings) {
      const reference = mapping.inputId ?? mapping.stepId ?? mapping.outputId;
      const known = mapping.inputId
        ? inputIds.has(mapping.inputId)
        : mapping.stepId
          ? stepIds.has(mapping.stepId)
          : mapping.outputId
            ? outputIds.has(mapping.outputId)
            : false;
      if (!known)
        errors.push(
          `${record.id}: observation mapping points to an unknown or non-output value (${reference ?? mapping.scaleId ?? 'missing'})`,
        );
      if (
        mapping.inputId &&
        schema.inputs.find((input) => input.id === mapping.inputId)?.kind !== 'number'
      ) {
        errors.push(`${record.id}: observation mapping input must be numeric (${mapping.inputId})`);
      }
      if (
        mapping.stepId &&
        schema.steps.find((step) => step.id === mapping.stepId)?.valueKind !== 'number'
      ) {
        errors.push(`${record.id}: observation mapping step must be numeric (${mapping.stepId})`);
      }
      if (
        mapping.outputId &&
        schema.steps.find((step) => step.id === mapping.outputId)?.valueKind !== 'number'
      ) {
        errors.push(
          `${record.id}: observation mapping output must be numeric (${mapping.outputId})`,
        );
      }
      if (!mapping.label || !mapping.method) {
        errors.push(
          `${record.id}: observation mapping needs label and method (${reference ?? 'missing'})`,
        );
      }
      const key = `${mapping.metricId}|${mapping.unit}|${mappingReference(mapping)}`;
      if (mappingKeys.has(key)) errors.push(`${record.id}: duplicate observation mapping (${key})`);
      mappingKeys.add(key);
      if (mapping.stepId && !outputIds.has(mapping.stepId)) {
        errors.push(`${record.id}: observation mapping step must be an output (${mapping.stepId})`);
      }
    }
    const mappedNumericOutputs = new Set(
      schema.observationMappings.flatMap((mapping) =>
        mapping.outputId && outputIds.has(mapping.outputId)
          ? [mapping.outputId]
          : mapping.stepId && outputIds.has(mapping.stepId)
            ? [mapping.stepId]
            : [],
      ),
    );
    for (const output of schema.steps.filter(
      (step) => step.isOutput && step.valueKind === 'number',
    )) {
      if (!mappedNumericOutputs.has(output.id) && schema.evaluation.status !== 'not-applicable') {
        errors.push(`${record.id}: numeric output needs an observation mapping (${output.id})`);
      }
    }
    if (schema.evaluation.status === 'verdict' && schema.evaluation.rules.length === 0) {
      errors.push(`${record.id}: verdict evaluation needs at least one deterministic rule`);
    }
    if (
      schema.evaluation.status !== 'verdict' &&
      !schema.evaluation.reason &&
      schema.evaluation.missingContext.length === 0
    ) {
      errors.push(`${record.id}: non-verdict evaluation needs a reason or missing context`);
    }
    if (
      schema.evaluation.status === 'verdict' &&
      schema.evaluation.sourceIds.length === 0 &&
      record.sources.length === 0
    ) {
      errors.push(`${record.id}: verdict evaluation needs provenance source ids`);
    }
    appendProvenanceErrors(record, schema.evaluation, errors);
    return errors;
  }
  const parsed = AssessmentDefinitionSchema.safeParse(record.definition);
  if (!parsed.success)
    return parsed.error.issues.map(
      (issue) => `${record.id}: ${issue.path.join('.')}: ${issue.message}`,
    );
  const definition = parsed.data;
  const errors: string[] = [];
  const scaleIds = new Set(definition.scales.map((scale) => scale.id));
  const mappingKeys = new Set<string>();
  const mappedScaleIds = new Set<string>();
  for (const mapping of definition.observationMappings) {
    if (!mapping.scaleId || !scaleIds.has(mapping.scaleId)) {
      errors.push(
        `${record.id}: observation mapping points to an unknown scale (${mapping.scaleId ?? 'missing'})`,
      );
    }
    if (!mapping.label || !mapping.method) {
      errors.push(
        `${record.id}: observation mapping needs label and method (${mapping.scaleId ?? 'missing'})`,
      );
    }
    if (mapping.scaleId) {
      const key = `${mapping.metricId}|${mapping.unit}|scale:${mapping.scaleId}`;
      if (mappingKeys.has(key)) errors.push(`${record.id}: duplicate observation mapping (${key})`);
      mappingKeys.add(key);
      mappedScaleIds.add(mapping.scaleId);
    }
  }
  for (const scale of definition.scales) {
    if (!mappedScaleIds.has(scale.id) && definition.evaluation.status !== 'not-applicable') {
      errors.push(`${record.id}: assessment scale needs an observation mapping (${scale.id})`);
    }
  }
  appendProvenanceErrors(record, definition.evaluation, errors);
  if (record.sources.length === 0 && !definition.license.sourceUrl) {
    // The generic provenance check above intentionally accepts an attributed license URL for
    // local drafts; released catalog records still need source links unless the license itself is
    // the declared source.
    errors.push(`${record.id}: assessment needs provenance in sources or license.sourceUrl`);
  }
  if (
    definition.evaluation.status !== 'verdict' &&
    !definition.evaluation.reason &&
    definition.evaluation.missingContext.length === 0
  ) {
    errors.push(`${record.id}: non-verdict evaluation needs a reason or missing context`);
  }
  if (definition.evaluation.status === 'verdict' && definition.evaluation.rules.length === 0) {
    errors.push(`${record.id}: verdict evaluation needs at least one deterministic rule`);
  }
  return errors;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    const records = await loadAllRecords();
    const errors = records.flatMap(lintRecord);
    const calculators = records.filter((record) => record.kind === 'calculator').length;
    const assessments = records.filter((record) => record.kind === 'assessment').length;
    if (calculators !== 50 || assessments !== 19) {
      errors.push(
        `expected 50 calculators and 19 assessments, got ${calculators} and ${assessments}`,
      );
    }
    if (errors.length > 0) {
      console.error('Tool catalog has invalid v2 definitions');
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`tool catalog ok (${calculators} calculators, ${assessments} assessments)`);
    return;
  }
  const raw = await readFile(path, 'utf8');
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const { validateCalculatorSchema } = await import(
    '../apps/app/src/features/calculators/calculator-schema-validate'
  );
  const result = validateCalculatorSchema(candidate);
  if (!result.ok) {
    console.error(`${path}: invalid calculator schema`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${path}: ok (${result.schema?.id})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
