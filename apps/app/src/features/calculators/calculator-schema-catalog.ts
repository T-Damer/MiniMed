import type { CalculatorSchema, ToolDefinitionRecord } from '@localmed/contracts';
import { CalculatorSchemaSchema } from '@localmed/contracts';

const DOWNLOADED_CALCULATOR_SCHEMAS = new Map<string, CalculatorSchema>();
/** The doctor's own calculators live apart so refreshing downloaded modules never drops them. */
const USER_CALCULATOR_SCHEMAS = new Map<string, CalculatorSchema>();

export function clearDownloadedCalculatorSchemas(): void {
  DOWNLOADED_CALCULATOR_SCHEMAS.clear();
}

export function clearUserCalculatorSchemas(): void {
  USER_CALCULATOR_SCHEMAS.clear();
}

export function registerUserCalculatorSchema(schema: CalculatorSchema): void {
  USER_CALCULATOR_SCHEMAS.set(schema.id, schema);
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
  return USER_CALCULATOR_SCHEMAS.get(id) ?? DOWNLOADED_CALCULATOR_SCHEMAS.get(id);
}

/**
 * Whether the calculator works with a patient card: it takes values from it (an input with a
 * patient binding) or records its result in it (observation mappings). The schema declares this, so
 * the screen decides by data, never by the tool's id. A calculator without a schema works on typed
 * numbers only.
 */
export function calculatorUsesPatientData(schema: CalculatorSchema | undefined): boolean {
  return (
    schema !== undefined &&
    (schema.observationMappings.length > 0 ||
      schema.inputs.some((input) => input.patientBinding !== undefined))
  );
}
