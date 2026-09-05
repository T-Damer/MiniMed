import type { CalculatorInputDefinition } from '@localmed/contracts';

export type CalculatorLaunchValues = Readonly<Record<string, string>>;

interface CalculatorLaunchDraft {
  readonly calculatorId: string;
  readonly values: CalculatorLaunchValues;
}

let pendingDraft: CalculatorLaunchDraft | undefined;

function finiteNumber(value: string): number | undefined {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validValue(input: CalculatorInputDefinition, value: string): boolean {
  if (input.kind === 'select') {
    return input.options?.some((option) => String(option.value) === value) ?? false;
  }
  if (input.kind === 'checkbox') return value === '0' || value === '1';
  if (input.kind === 'date') return validDate(value);
  if (input.kind === 'number') {
    const number = finiteNumber(value);
    if (number === undefined) return false;
    if (input.integer && !Number.isInteger(number)) return false;
    if (input.minimum !== undefined && number < input.minimum) return false;
    if (input.maximum !== undefined && number > input.maximum) return false;
  }
  return value.trim().length > 0;
}

export function saveCalculatorLaunchDraft(
  calculatorId: string,
  values: Readonly<Record<string, string | number | boolean>>,
): void {
  if (!calculatorId.trim()) return;
  const normalized: Record<string, string> = {};
  for (const [id, value] of Object.entries(values)) {
    if (!id.trim()) continue;
    if (typeof value === 'string') normalized[id] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) normalized[id] = String(value);
    else if (typeof value === 'boolean') normalized[id] = value ? '1' : '0';
  }
  pendingDraft = { calculatorId, values: normalized };
}

export function consumeCalculatorLaunchDraft(
  calculatorId: string,
  inputs: readonly CalculatorInputDefinition[],
): CalculatorLaunchValues {
  if (!pendingDraft || pendingDraft.calculatorId !== calculatorId) return {};
  const draft = pendingDraft;
  pendingDraft = undefined;
  const definitions = new Map(inputs.map((input) => [input.id, input]));
  const values: Record<string, string> = {};
  for (const [id, value] of Object.entries(draft.values)) {
    const input = definitions.get(id);
    if (input && validValue(input, value)) values[id] = value;
  }
  return values;
}
