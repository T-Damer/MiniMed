import type { CalculatorSchema, CalculatorStepDefinition } from '@localmed/contracts';
import {
  CalculatorExpressionError,
  type CalculatorScope,
  type CalculatorValue,
  type ExpressionNode,
  evaluateCalculatorExpression,
  ISO_DATE_PATTERN,
  parseCalculatorExpression,
  parseIsoDateValue,
  renderExpressionWithValues,
} from '@/features/calculators/calculator-expression';
import type { CalculationTraceStep } from '@/features/calculators/calculator-types';
import type {
  CalculatorWarning,
  DualCalculationResult,
  NumericCalculationResult,
  StoredCalculationResult,
  TextCalculationResult,
} from '@/features/calculators/clinical-calculations';

export interface CalculatorSchemaNumberOutput {
  readonly kind: 'number';
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly displayPrecision: number;
}

export interface CalculatorSchemaTextOutput {
  readonly kind: 'text';
  readonly label: string;
  readonly text: string;
}

export type CalculatorSchemaOutput = CalculatorSchemaNumberOutput | CalculatorSchemaTextOutput;

export interface CalculatorSchemaEvaluation {
  readonly ok: true;
  readonly calculatorId: string;
  readonly formula: string;
  readonly outputs: readonly CalculatorSchemaOutput[];
  readonly trace: readonly CalculationTraceStep[];
  readonly warnings: readonly CalculatorWarning[];
}

export interface CalculatorSchemaFailure {
  readonly ok: false;
  readonly error: string;
}

export type CalculatorSchemaResult = CalculatorSchemaEvaluation | CalculatorSchemaFailure;

function failure(error: string): CalculatorSchemaFailure {
  return { ok: false, error };
}

const RU_LONG_DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });

function formatDateRu(isoDate: string): string {
  return RU_LONG_DATE.format(parseIsoDateValue(isoDate, 'date output'));
}

function formatNumberOutputText(output: CalculatorSchemaNumberOutput): string {
  const rounded =
    output.displayPrecision === 0
      ? String(Math.round(output.value))
      : output.value.toFixed(output.displayPrecision);
  return output.unit ? `${rounded} ${output.unit}` : rounded;
}

function formatExpressionError(label: string, error: unknown): string {
  const message = error instanceof CalculatorExpressionError ? error.message : String(error);
  return `${label}: ${message}`;
}

function formatStepError(step: CalculatorStepDefinition, error: unknown): string {
  return formatExpressionError(step.label, error);
}

/**
 * Validates raw input values against the schema's declared inputs, evaluates every step in declared
 * order, then checks `assertions` (fail the whole calculation on a derived-value guard, e.g. "gestational
 * age at this date exceeds 40 weeks") and `interpretations` (append a threshold-based message, e.g.
 * Bishop score's favorable/intermediate/unfavorable bands) — the same "refuse to calculate when required
 * data are missing or implausible" contract the existing hardcoded calculators follow (CALCULATORS.md).
 */
export function evaluateCalculatorSchema(
  schema: CalculatorSchema,
  rawInputs: Readonly<Record<string, string | number>>,
): CalculatorSchemaResult {
  const scope: Record<string, CalculatorValue> = {};

  for (const input of schema.inputs) {
    const raw = rawInputs[input.id];
    const blank = raw === undefined || raw === '';
    if (blank) {
      if (input.required) return failure(`${input.label}: значение обязательно.`);
      if (input.defaultExpression) {
        try {
          scope[input.id] = evaluateCalculatorExpression(
            input.defaultExpression,
            scope as CalculatorScope,
          );
        } catch (error) {
          return failure(formatExpressionError(`${input.label} (значение по умолчанию)`, error));
        }
      }
      continue;
    }
    if (input.kind === 'number') {
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        return failure(`${input.label}: требуется конечное число.`);
      }
      if (input.integer === true && !Number.isInteger(value)) {
        return failure(`${input.label}: требуется целое число.`);
      }
      if (input.minimum !== undefined && value < input.minimum) {
        return failure(`${input.label}: значение меньше допустимого минимума ${input.minimum}.`);
      }
      if (input.maximum !== undefined && value > input.maximum) {
        return failure(`${input.label}: значение больше допустимого максимума ${input.maximum}.`);
      }
      scope[input.id] = value;
    } else if (input.kind === 'date') {
      const dateText = String(raw);
      if (!ISO_DATE_PATTERN.test(dateText)) {
        return failure(`${input.label}: некорректная дата.`);
      }
      try {
        parseIsoDateValue(dateText, input.label);
      } catch {
        return failure(`${input.label}: некорректная дата.`);
      }
      scope[input.id] = dateText;
    } else {
      const allowed = input.options?.map((option) => option.value) ?? [];
      const matched = allowed.find((option) => String(option) === String(raw));
      if (matched === undefined) {
        return failure(`${input.label}: недопустимое значение.`);
      }
      scope[input.id] = matched;
    }
  }

  const trace: CalculationTraceStep[] = [];
  const outputs: CalculatorSchemaOutput[] = [];

  for (const step of schema.steps) {
    let node: ExpressionNode;
    try {
      node = parseCalculatorExpression(step.expression);
    } catch (error) {
      return failure(formatStepError(step, error));
    }
    let value: CalculatorValue;
    try {
      value = evaluateCalculatorExpression(step.expression, scope as CalculatorScope);
    } catch (error) {
      return failure(formatStepError(step, error));
    }

    if (step.valueKind === 'date') {
      if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
        return failure(`${step.label}: результат не является корректной датой.`);
      }
      scope[step.id] = value;
      // Date-valued steps are never traced: CalculationTraceStep.value is always a number.
      if (step.isOutput) {
        outputs.push({ kind: 'text', label: step.label, text: formatDateRu(value) });
      }
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return failure(`${step.label}: результат не является конечным числом.`);
    }
    const expressionText = renderExpressionWithValues(node, scope as CalculatorScope);
    trace.push({ label: step.label, expression: expressionText, value, unit: step.unit });
    scope[step.id] = value;
    if (step.isOutput) {
      outputs.push({
        kind: 'number',
        label: step.label,
        value,
        unit: step.unit,
        displayPrecision: step.displayPrecision,
      });
    }
  }

  if (outputs.length === 0) return failure('Калькулятор не определил ни одного результата.');

  for (const assertion of schema.assertions) {
    let triggered: CalculatorValue;
    try {
      triggered = evaluateCalculatorExpression(assertion.when, scope as CalculatorScope);
    } catch (error) {
      return failure(formatExpressionError('Проверка результата', error));
    }
    if (triggered === 1) return failure(assertion.error);
  }

  const warnings: CalculatorWarning[] = [...schema.warnings];
  for (const interpretation of schema.interpretations) {
    let matched: CalculatorValue;
    try {
      matched = evaluateCalculatorExpression(interpretation.when, scope as CalculatorScope);
    } catch (error) {
      return failure(formatExpressionError('Интерпретация результата', error));
    }
    if (matched === 1) {
      warnings.push({ code: 'interpretation', message: interpretation.message });
      break;
    }
  }

  return {
    ok: true,
    calculatorId: schema.id,
    formula: schema.formulaDisplay,
    outputs,
    trace,
    warnings,
  };
}

/**
 * Adapts a schema evaluation into the same `StoredCalculationResult` shape the hardcoded calculators
 * produce, so the existing result panel (print/share/save-to-note, trace expansion) needs no changes to
 * render a schema-driven calculator's result. If every output is numeric, this keeps the existing
 * Numeric/Dual numeric rendering; if any output is text/date, the *whole* result renders as text lines —
 * matching how the original hand-written date calculators always used `textValues` for the entire result
 * rather than mixing numbers and formatted dates in one result shape.
 */
export function toStoredCalculationResult(
  evaluation: CalculatorSchemaEvaluation,
): StoredCalculationResult {
  const base = {
    ok: true as const,
    calculatorId: evaluation.calculatorId,
    formula: evaluation.formula,
    trace: evaluation.trace,
    warnings: evaluation.warnings,
  };

  const hasTextOutput = evaluation.outputs.some((output) => output.kind === 'text');
  if (hasTextOutput) {
    const result: TextCalculationResult = {
      ...base,
      textValues: evaluation.outputs.map((output) =>
        output.kind === 'text'
          ? { label: output.label, text: output.text }
          : { label: output.label, text: formatNumberOutputText(output) },
      ),
    };
    return result;
  }

  const numberOutputs = evaluation.outputs.filter(
    (output): output is CalculatorSchemaNumberOutput => output.kind === 'number',
  );
  if (numberOutputs.length === 1) {
    const output = numberOutputs[0];
    if (!output) throw new Error('unreachable: numberOutputs.length === 1');
    const result: NumericCalculationResult = {
      ...base,
      value: output.value,
      unit: output.unit,
      displayPrecision: output.displayPrecision,
    };
    return result;
  }
  const result: DualCalculationResult = {
    ...base,
    values: numberOutputs.map((output) => ({
      label: output.label,
      value: output.value,
      unit: output.unit,
      displayPrecision: output.displayPrecision,
    })),
  };
  return result;
}
