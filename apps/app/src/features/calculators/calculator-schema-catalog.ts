import type {
  CalculatorResultLayout,
  CalculatorSchema,
  ToolDefinitionRecord,
} from '@localmed/contracts';
import { CalculatorSchemaSchema } from '@localmed/contracts';
import { UNIT_CONVERSION_SCHEMA } from '@/features/calculators/unit-conversion-schema';

/** Calculators that ship inside the app and need no module. */
const BUILT_IN_CALCULATOR_SCHEMAS: ReadonlyMap<string, CalculatorSchema> = new Map([
  [UNIT_CONVERSION_SCHEMA.id, UNIT_CONVERSION_SCHEMA],
]);

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
  return (
    USER_CALCULATOR_SCHEMAS.get(id) ??
    DOWNLOADED_CALCULATOR_SCHEMAS.get(id) ??
    BUILT_IN_CALCULATOR_SCHEMAS.get(id)
  );
}

/** How the saved result of this calculator is laid out; `undefined` is the plain output list. */
export function calculatorResultLayout(calculatorId: string): CalculatorResultLayout | undefined {
  return getCalculatorSchema(calculatorId)?.resultLayout;
}

/**
 * Whether the calculator works with a patient card: it takes values from it (an input with a
 * patient binding) or records its result in it (observation mappings, or a step bound to a card
 * field). The schema declares this, so
 * the screen decides by data, never by the tool's id. A calculator without a schema works on typed
 * numbers only.
 */
export function calculatorUsesPatientData(schema: CalculatorSchema | undefined): boolean {
  return (
    schema !== undefined &&
    (schema.observationMappings.length > 0 ||
      schema.inputs.some((input) => input.patientBinding !== undefined) ||
      schema.steps.some((step) => step.patientBinding !== undefined))
  );
}
