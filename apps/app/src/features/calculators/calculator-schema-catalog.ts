import type { CalculatorSchema, ToolDefinitionRecord } from '@localmed/contracts';
import { CalculatorSchemaSchema } from '@localmed/contracts';

const DOWNLOADED_CALCULATOR_SCHEMAS = new Map<string, CalculatorSchema>();

export function clearDownloadedCalculatorSchemas(): void {
  DOWNLOADED_CALCULATOR_SCHEMAS.clear();
}

export function registerDownloadedCalculatorSchema(
  record: ToolDefinitionRecord,
): CalculatorSchema | null {
  if (record.kind !== 'calculator') return null;
  const schema = CalculatorSchemaSchema.parse(record.definition);
  if (schema.id !== record.id || schema.slug !== record.slug) {
    throw new Error(`Calculator payload does not match ${record.id}.`);
  }
  DOWNLOADED_CALCULATOR_SCHEMAS.set(record.id, schema);
  return schema;
}

export function getCalculatorSchema(id: string): CalculatorSchema | undefined {
  return DOWNLOADED_CALCULATOR_SCHEMAS.get(id);
}
