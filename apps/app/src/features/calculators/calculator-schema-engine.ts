import type {
  CalculatorSchema,
  CalculatorStepDefinition,
  CalculatorVisualDefinition,
  EvaluationStatus,
  ReferenceVerdict,
} from '@localmed/contracts';
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
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly displayPrecision: number;
}

export interface CalculatorSchemaTextOutput {
  readonly kind: 'text';
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export type CalculatorSchemaOutput =
  | CalculatorSchemaNumberOutput
  | CalculatorSchemaTextOutput
  | CalculatorSchemaVisualOutput;

/** Plain serializable Chart.js-ready spec: the engine evaluates dataset expressions to finite
 *  numbers, so the UI can render (or re-render for print) without touching the expression scope. */
export interface CalculatorChartSpec {
  readonly type: CalculatorVisualDefinition['kind'];
  readonly labels: readonly string[];
  readonly datasets: readonly {
    readonly label: string;
    readonly data: readonly number[];
  }[];
}

export interface CalculatorSchemaVisualOutput {
  readonly kind: 'visual';
  readonly id: string;
  readonly label: string;
  readonly chart: CalculatorChartSpec;
}

export interface CalculatorSchemaEvaluation {
  readonly ok: true;
  readonly calculatorId: string;
  readonly formula: string;
  readonly outputs: readonly CalculatorSchemaOutput[];
  readonly trace: readonly CalculationTraceStep[];
  readonly warnings: readonly CalculatorWarning[];
  readonly evaluation: {
    readonly status: EvaluationStatus;
    readonly verdict?: ReferenceVerdict;
    readonly missingContext: readonly string[];
    readonly reason?: string;
    readonly sourceIds: readonly string[];
  };
}

export interface CalculatorSchemaFailure {
  readonly ok: false;
  readonly error: string;
}

export type CalculatorSchemaResult = CalculatorSchemaEvaluation | CalculatorSchemaFailure;

export interface CalculatorSchemaEvaluationOptions {
  /** Evaluate only inputs and derived values available through this form stage. */
  readonly maxStep?: number;
}

function failure(error: string): CalculatorSchemaFailure {
  return { ok: false, error };
}

const RU_LONG_DATE = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });

function formatDateRu(isoDate: string): string | null {
  try {
    return RU_LONG_DATE.format(parseIsoDateValue(isoDate, 'date output'));
  } catch {
    return null;
  }
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
 * Validates raw input values against the schema's declared inputs, evaluates the available steps in
 * declared order, then checks `assertions` (fail the whole calculation on a derived-value guard, e.g.
 * "gestational age at this date exceeds 40 weeks") and `interpretations` (append a threshold-based
 * message, e.g. Bishop score's favorable/intermediate/unfavorable bands) on a final evaluation — the
 * same "refuse to calculate when required data are missing or implausible" contract the existing
 * hardcoded calculators follow (CALCULATORS.md).
 */
export function evaluateCalculatorSchema(
  schema: CalculatorSchema,
  rawInputs: Readonly<Record<string, string | number>>,
  options: CalculatorSchemaEvaluationOptions = {},
): CalculatorSchemaResult {
  try {
    return evaluateCalculatorSchemaInner(schema, rawInputs, options);
  } catch (error) {
    return failure(formatExpressionError('Калькулятор', error));
  }
}

function evaluateCalculatorSchemaInner(
  schema: CalculatorSchema,
  rawInputs: Readonly<Record<string, string | number>>,
  options: CalculatorSchemaEvaluationOptions,
): CalculatorSchemaResult {
  const scope: Record<string, CalculatorValue> = {};
  const maxStep = options.maxStep ?? Number.MAX_SAFE_INTEGER;

  for (const input of schema.inputs) {
    if (input.step > maxStep) continue;
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
    } else if (input.kind === 'text') {
      scope[input.id] = String(raw);
    } else if (input.kind === 'checkbox') {
      if (raw !== 0 && raw !== 1 && raw !== '0' && raw !== '1') {
        return failure(`${input.label}: недопустимое значение.`);
      }
      scope[input.id] = Number(raw);
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
    if (step.stepRequired > maxStep) continue;
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
        const formatted = formatDateRu(value);
        if (formatted === null) {
          return failure(`${step.label}: результат не является корректной датой.`);
        }
        outputs.push({ kind: 'text', id: step.id, label: step.label, text: formatted });
      }
      continue;
    }

    if (step.valueKind === 'text') {
      if (typeof value !== 'string') {
        return failure(`${step.label}: результат не является текстом.`);
      }
      scope[step.id] = value;
      if (step.isOutput) {
        outputs.push({ kind: 'text', id: step.id, label: step.label, text: value });
      }
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return failure(`${step.label}: результат не является конечным числом.`);
    }
    const expressionText = renderExpressionWithValues(node, scope as CalculatorScope);
    trace.push({
      id: step.id,
      label: step.label,
      expression: expressionText,
      value,
      unit: step.unit,
    });
    scope[step.id] = value;
    if (step.isOutput) {
      outputs.push({
        kind: 'number',
        id: step.id,
        label: step.label,
        value,
        unit: step.unit,
        displayPrecision: step.displayPrecision,
      });
    }
  }

  if (outputs.length === 0) return failure('Калькулятор не определил ни одного результата.');

  const warnings: CalculatorWarning[] = [...schema.warnings];
  let evaluation: CalculatorSchemaEvaluation['evaluation'] = {
    status: schema.evaluation.status,
    missingContext: schema.evaluation.missingContext,
    ...(schema.evaluation.reason ? { reason: schema.evaluation.reason } : {}),
    sourceIds: schema.evaluation.sourceIds,
  };
  // Partial stages intentionally defer cross-step guards and interpretations until the final
  // evaluation, when all declared inputs/derived values are available in scope.
  if (options.maxStep === undefined) {
    for (const assertion of schema.assertions) {
      let triggered: CalculatorValue;
      try {
        triggered = evaluateCalculatorExpression(assertion.when, scope as CalculatorScope);
      } catch (error) {
        return failure(formatExpressionError('Проверка результата', error));
      }
      if (triggered === 1) return failure(assertion.error);
    }
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
    if (schema.evaluation.status === 'verdict') {
      for (const rule of schema.evaluation.rules) {
        let matched: CalculatorValue;
        try {
          matched = evaluateCalculatorExpression(rule.when, scope as CalculatorScope);
        } catch (error) {
          return failure(formatExpressionError('Оценка результата', error));
        }
        if (matched === 1) {
          evaluation = {
            status: 'verdict',
            verdict: rule.verdict,
            missingContext: [],
            sourceIds: rule.verdict.sourceIds,
          };
          break;
        }
      }
      if (evaluation.status !== 'verdict') {
        evaluation = {
          status: 'unavailable',
          missingContext: [],
          reason: 'Для рассчитанного результата не найдено правило оценки.',
          sourceIds: schema.evaluation.sourceIds,
        };
      }
    }
  }

  const visualOutputs: CalculatorSchemaVisualOutput[] = [];
  for (const visual of schema.visuals) {
    const result = evaluateCalculatorVisual(visual, scope as CalculatorScope);
    if (!result.ok) return failure(result.error);
    visualOutputs.push(result.output);
  }
  outputs.push(...visualOutputs);

  return {
    ok: true,
    calculatorId: schema.id,
    formula: schema.formulaDisplay,
    outputs,
    trace,
    warnings,
    evaluation,
  };
}

type CalculatorVisualEvaluation =
  | { readonly ok: true; readonly output: CalculatorSchemaVisualOutput }
  | { readonly ok: false; readonly error: string };

function evaluateCalculatorVisual(
  visual: CalculatorVisualDefinition,
  scope: CalculatorScope,
): CalculatorVisualEvaluation {
  const datasets: { label: string; data: number[] }[] = [];
  for (const dataset of visual.datasets) {
    const data: number[] = [];
    for (const [index, entry] of dataset.data.entries()) {
      let value: CalculatorValue;
      if (typeof entry === 'number') {
        value = entry;
      } else {
        try {
          value = evaluateCalculatorExpression(entry, scope);
        } catch (error) {
          return {
            ok: false,
            error: `Визуализация «${visual.title}», ряд «${dataset.label}»: ${formatExpressionError(`точка ${index + 1}`, error)}`,
          };
        }
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {
          ok: false,
          error: `Визуализация «${visual.title}», ряд «${dataset.label}»: точка ${index + 1} не является конечным числом.`,
        };
      }
      data.push(value);
    }
    if (visual.labels.length > 0 && visual.labels.length !== data.length) {
      return {
        ok: false,
        error: `Визуализация «${visual.title}», ряд «${dataset.label}»: число точек (${data.length}) не совпадает с числом подписей (${visual.labels.length}).`,
      };
    }
    datasets.push({ label: dataset.label, data });
  }
  return {
    ok: true,
    output: {
      kind: 'visual',
      id: visual.id,
      label: visual.title,
      chart: {
        type: visual.kind,
        labels: [...visual.labels],
        datasets,
        ...(visual.heightPx === undefined ? {} : { heightPx: visual.heightPx }),
      },
    },
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
  const visuals = evaluation.outputs.flatMap((output) =>
    output.kind === 'visual' ? [output.chart] : [],
  );
  const base = {
    ok: true as const,
    calculatorId: evaluation.calculatorId,
    formula: evaluation.formula,
    trace: evaluation.trace,
    warnings: evaluation.warnings,
    evaluation: evaluation.evaluation,
    ...(visuals.length > 0 ? { visuals } : {}),
  };

  const hasTextOutput = evaluation.outputs.some((output) => output.kind === 'text');
  if (hasTextOutput) {
    const result: TextCalculationResult = {
      ...base,
      textValues: evaluation.outputs.flatMap((output) => {
        if (output.kind === 'text')
          return [{ id: output.id, label: output.label, text: output.text }];
        if (output.kind === 'number')
          return [{ id: output.id, label: output.label, text: formatNumberOutputText(output) }];
        return [];
      }),
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
      outputId: output.id,
      displayPrecision: output.displayPrecision,
    };
    return result;
  }
  const result: DualCalculationResult = {
    ...base,
    values: numberOutputs.map((output) => ({
      id: output.id,
      label: output.label,
      value: output.value,
      unit: output.unit,
      displayPrecision: output.displayPrecision,
    })),
  };
  return result;
}
