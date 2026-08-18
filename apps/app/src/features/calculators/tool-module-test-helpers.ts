import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type CalculatorSchema,
  CalculatorSchemaSchema,
  type ToolDefinitionRecord,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';

export const TOOL_MODULE_FILES = [
  'content/tool-modules/core-clinical.json',
  'content/tool-modules/gastroenterology.json',
  'content/tool-modules/neonatology.json',
  'content/tool-modules/emergency.json',
  'content/tool-modules/pediatrics.json',
  'content/tool-modules/obstetrics-gynecology.json',
  'content/tool-modules/psychology.json',
] as const;

export function loadToolModuleRecords(
  files: readonly string[] = TOOL_MODULE_FILES,
): readonly ToolDefinitionRecord[] {
  const records: ToolDefinitionRecord[] = [];
  for (const relativePath of files) {
    const source = JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as {
      tools: readonly unknown[];
    };
    for (const rawTool of source.tools) {
      records.push(ToolDefinitionRecordSchema.parse(rawTool));
    }
  }
  return records;
}

export function loadToolModuleCalculatorSchemas(
  files: readonly string[] = TOOL_MODULE_FILES,
): readonly CalculatorSchema[] {
  return loadToolModuleRecords(files)
    .filter((record) => record.kind === 'calculator')
    .map((record) => CalculatorSchemaSchema.parse(record.definition));
}

export function calculatorSchemaFromModules(id: string): CalculatorSchema {
  const schema = loadToolModuleCalculatorSchemas().find((candidate) => candidate.id === id);
  if (!schema) throw new Error(`Calculator schema not found in tool modules: ${id}`);
  return schema;
}

export function registerToolModuleRecords(
  registerCalculator: (record: ToolDefinitionRecord) => void,
  registerAssessment: (record: ToolDefinitionRecord) => void,
  files: readonly string[] = TOOL_MODULE_FILES,
): void {
  for (const record of loadToolModuleRecords(files)) {
    if (record.kind === 'calculator') registerCalculator(record);
    if (record.kind === 'assessment') registerAssessment(record);
  }
}
