import { readdirSync, readFileSync } from 'node:fs';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  ToolAgeScopeSchema,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { CALCULATOR_REGISTRY } from '@/features/calculators/calculator-registry';
import { MODULE_CATALOG, TOOL_CATALOG } from '@/features/modules/module-catalog';

const moduleFiles = readdirSync('content/tool-modules').filter((file) => file.endsWith('.json'));

const sourceTools = moduleFiles.flatMap((file) => {
  const source = JSON.parse(readFileSync(`content/tool-modules/${file}`, 'utf8')) as {
    readonly tools: readonly unknown[];
  };
  return source.tools.map((tool) => ToolDefinitionRecordSchema.parse(tool));
});

describe('every tool declares who it is for', () => {
  it('requires an age scope in every authored calculator and questionnaire definition', () => {
    expect(sourceTools).toHaveLength(69);
    for (const record of sourceTools) {
      const schema =
        record.kind === 'calculator' ? CalculatorSchemaSchema : AssessmentDefinitionSchema;
      const parsed = schema.safeParse(record.definition);
      expect(parsed.success, `${record.id} must parse`).toBe(true);
      const scope = ToolAgeScopeSchema.safeParse(record.definition['ageScope']);
      expect(scope.success, `${record.id} must declare ageScope`).toBe(true);
    }
  });

  it('fails a definition whose age scope is removed', () => {
    for (const record of sourceTools) {
      const { ageScope: _removed, ...withoutScope } = record.definition;
      const schema =
        record.kind === 'calculator' ? CalculatorSchemaSchema : AssessmentDefinitionSchema;
      expect(schema.safeParse(withoutScope).success, record.id).toBe(false);
    }
  });

  it('keeps the catalog entries equal to the authored definitions', () => {
    for (const record of sourceTools) {
      const entry = TOOL_CATALOG.find((candidate) => candidate.id === record.id);
      expect(entry?.ageScope, record.id).toEqual(record.definition['ageScope']);
    }
    expect(MODULE_CATALOG.modules.flatMap((module) => module.tools ?? [])).toHaveLength(69);
  });

  it('states a basis for every declaration, never an empty guess', () => {
    for (const record of sourceTools) {
      const scope = ToolAgeScopeSchema.parse(record.definition['ageScope']);
      expect(scope.basis.length, record.id).toBeGreaterThan(8);
    }
  });

  it('declares an age scope for the built-in calculators', () => {
    for (const calculator of CALCULATOR_REGISTRY) {
      expect(ToolAgeScopeSchema.safeParse(calculator.ageScope).success, calculator.id).toBe(true);
    }
  });
});
