import type { CalculatorSchema, ToolAgeScope } from '@localmed/contracts';
import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { validateCalculatorSchema } from '@/features/calculators/calculator-schema-validate';
import { userCalculatorSchemaId } from '@/features/calculators/user-calculator/user-calculator-ids';
import {
  compileUserFormula,
  type UserFormulaResult,
  userInputNameError,
} from '@/features/calculators/user-calculator/user-formula';
import { toolAgeBadge } from '@/features/tools/tool-age-scope';
import {
  userToolPopulationError,
  userToolPopulationToAgeScope,
} from '@/features/tools/user-tool-population';
import type {
  UserCalculator,
  UserCalculatorBand,
  UserCalculatorInput,
} from '@/state/user-calculators';

/**
 * From the doctor's calculator to the `CalculatorSchema` the generic form, result panel, printing
 * and recording already understand. The conversion validates what it produces with
 * `validateCalculatorSchema`, so a calculator that converts is a calculator the engine can run.
 */

export const USER_CALCULATOR_RESULT_STEP_ID = 'result';
const ROUNDED_STEP_ID = 'result_rounded';
const NOT_APPLICABLE_REASON =
  'Авторский калькулятор не содержит проверенных клинических правил оценки: результат читают по диапазонам автора.';

export interface UserCalculatorIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

// --- Small helpers -------------------------------------------------------------------------------

/** 18.5 → «18,5»: the number as the doctor reads it. */
export function formatUserNumber(value: number, maximumFractionDigits = 6): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits, useGrouping: false }).format(
    value,
  );
}

/** A number as expression text: plain digits, never an exponent the parser would not read. */
function expressionNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(10).replace(/0+$/u, '').replace(/\.$/u, '');
}

function inputTitle(input: UserCalculatorInput, index: number): string {
  return input.label.trim() ? `Данные ${index + 1} «${input.label.trim()}»` : `Данные ${index + 1}`;
}

function bandTitle(band: UserCalculatorBand, index: number): string {
  return band.headline.trim()
    ? `Диапазон ${index + 1} «${band.headline.trim()}»`
    : `Диапазон ${index + 1}`;
}

function roundedTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function lower(band: UserCalculatorBand): number {
  return band.min ?? Number.NEGATIVE_INFINITY;
}

function upper(band: UserCalculatorBand): number {
  return band.max ?? Number.POSITIVE_INFINITY;
}

function describeBound(band: UserCalculatorBand): string {
  if (band.min !== undefined && band.max !== undefined) {
    return `от ${formatUserNumber(band.min)} до ${formatUserNumber(band.max)}`;
  }
  if (band.min !== undefined) return `от ${formatUserNumber(band.min)}`;
  if (band.max !== undefined) return `до ${formatUserNumber(band.max)}`;
  return 'любое значение';
}

export function formulaFor(model: UserCalculator): UserFormulaResult {
  return compileUserFormula(
    model.formula,
    model.inputs.map((input) => ({ id: input.id, name: input.name })),
  );
}

// --- Conversion ----------------------------------------------------------------------------------

function bandCondition(band: UserCalculatorBand): string {
  const parts: string[] = [];
  if (band.min !== undefined) parts.push(`(${ROUNDED_STEP_ID} >= ${expressionNumber(band.min)})`);
  if (band.max !== undefined) parts.push(`(${ROUNDED_STEP_ID} <= ${expressionNumber(band.max)})`);
  return parts.length > 0 ? parts.join(' * ') : '1 == 1';
}

/** «Дефицит. ИМТ ниже 18,5.»: the headline, then the author's explanation. */
function bandMessage(band: UserCalculatorBand): string {
  const headline = band.headline.trim();
  const message = band.message.trim();
  if (!message) return headline;
  return `${headline}${/[.!?…]$/u.test(headline) ? '' : '.'} ${message}`;
}

interface SchemaOptions {
  /** Preview and editor checks run while the calculator is unfinished: gaps are filled with defaults. */
  readonly lenient: boolean;
}

function buildCandidate(
  model: UserCalculator,
  formula: Extract<UserFormulaResult, { ok: true }>,
  options: SchemaOptions,
): unknown {
  // A draft with contradictory age limits still previews: it falls back to «any age» until fixed.
  const population =
    model.population && userToolPopulationError(model.population) === null
      ? model.population
      : ({ group: 'any' } as const);
  const ageScope: ToolAgeScope = userToolPopulationToAgeScope(population);
  const title = model.title.trim() || (options.lenient ? 'Калькулятор' : '');
  const resultLabel = model.result.label.trim() || (options.lenient ? 'Результат' : '');
  const resultUnit = model.result.unit.trim() || 'ед.';
  const disclaimer = model.disclaimer.trim();
  const steps: unknown[] = [
    {
      id: USER_CALCULATOR_RESULT_STEP_ID,
      label: resultLabel,
      unit: resultUnit,
      expression: formula.expression,
      displayPrecision: model.result.decimals,
      isOutput: true,
      valueKind: 'number',
      stepRequired: 0,
    },
  ];
  if (model.bands.length > 0) {
    const scale = expressionNumber(10 ** model.result.decimals);
    steps.push({
      id: ROUNDED_STEP_ID,
      label: `${resultLabel} (округлено до ${model.result.decimals} зн.)`,
      unit: resultUnit,
      expression: `round(${USER_CALCULATOR_RESULT_STEP_ID} * ${scale}) / ${scale}`,
      displayPrecision: model.result.decimals,
      isOutput: false,
      valueKind: 'number',
      stepRequired: 0,
    });
  }
  return {
    schemaVersion: 2,
    id: userCalculatorSchemaId(model.id),
    slug: model.id,
    title,
    shortTitle: title,
    aliases: [],
    summary: model.description.trim() || `Авторский калькулятор: ${resultLabel || 'результат'}.`,
    ageScope,
    category: 'custom',
    tags: [],
    clinical: false,
    formulaDisplay: model.formula.trim(),
    population: `${toolAgeBadge(ageScope).label}. Указано автором калькулятора.`,
    limitations: [disclaimer || (options.lenient ? 'Авторский калькулятор.' : '')],
    inputs: model.inputs.map((input) => ({
      id: input.id,
      label: input.label.trim() || (options.lenient ? input.name : ''),
      ...(input.unit.trim() ? { unit: input.unit.trim() } : {}),
      kind: 'number',
      ...(input.minimum === undefined ? {} : { minimum: input.minimum }),
      ...(input.maximum === undefined ? {} : { maximum: input.maximum }),
      ...(input.integer ? { integer: true } : {}),
      required: true,
      step: 0,
    })),
    inputRequirements: [],
    steps,
    // The author's own disclaimer rides with every result, so it reaches the print-out too.
    warnings: [{ code: 'user-disclaimer', message: disclaimer || 'Авторский калькулятор.' }],
    interpretations: model.bands.map((band) => ({
      when: bandCondition(band),
      message: bandMessage(band),
    })),
    evaluation: {
      status: 'not-applicable',
      rules: [],
      missingContext: [],
      reason: NOT_APPLICABLE_REASON,
      sourceIds: [],
    },
    observationMappings: [],
    assertions: [],
    visuals: [],
    sources: [
      {
        title: 'Авторский калькулятор',
        publisher: 'Создан пользователем',
        version: '1',
        reviewedAt: model.updatedAt.slice(0, 10),
      },
    ],
  };
}

export type UserCalculatorSchemaResult =
  | { readonly ok: true; readonly schema: CalculatorSchema }
  | { readonly ok: false; readonly errors: readonly string[] };

function convert(model: UserCalculator, options: SchemaOptions): UserCalculatorSchemaResult {
  const formula = formulaFor(model);
  if (!formula.ok) return { ok: false, errors: [formula.error] };
  if (model.inputs.length === 0) {
    return { ok: false, errors: ['Добавьте хотя бы одни входные данные.'] };
  }
  const validation = validateCalculatorSchema(buildCandidate(model, formula, options));
  if (!validation.ok || !validation.schema) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, schema: validation.schema };
}

/**
 * The schema of a finished calculator. Throws a plain Russian message when the calculator is not
 * finished (see `userCalculatorIssues`) so nothing half-written is ever registered.
 */
export function userCalculatorToSchema(model: UserCalculator): CalculatorSchema {
  const error = userCalculatorBlockingError(model);
  if (error) throw new Error(error);
  const result = convert(model, { lenient: false });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.schema;
}

// --- Issues --------------------------------------------------------------------------------------

function inputIssues(model: UserCalculator, issues: UserCalculatorIssue[]): void {
  const error = (message: string): void => {
    issues.push({ severity: 'error', message });
  };
  if (model.inputs.length === 0) error('Входные данные: добавьте хотя бы одни.');
  for (const [index, input] of model.inputs.entries()) {
    const title = inputTitle(input, index);
    if (input.label.trim() === '') error(`${title}: подпись — заполните это поле.`);
    const nameError = userInputNameError(
      input.name,
      model.inputs.filter((other) => other.id !== input.id).map((other) => other.name),
    );
    if (nameError) error(`${title}: ${nameError}`);
    if (
      input.minimum !== undefined &&
      input.maximum !== undefined &&
      input.minimum > input.maximum
    ) {
      error(`${title}: минимум больше максимума.`);
    }
  }
}

function bandIssues(model: UserCalculator, issues: UserCalculatorIssue[]): void {
  const { bands } = model;
  for (const [index, band] of bands.entries()) {
    const title = bandTitle(band, index);
    if (band.headline.trim() === '') {
      issues.push({ severity: 'error', message: `${title}: заголовок — заполните это поле.` });
    }
    if (band.min !== undefined && band.max !== undefined && band.min > band.max) {
      issues.push({
        severity: 'error',
        message: `${title}: «от» больше «до» — поменяйте границы местами.`,
      });
    }
  }
  for (const [index, first] of bands.entries()) {
    for (const [offset, second] of bands.slice(index + 1).entries()) {
      if (lower(first) > upper(first) || lower(second) > upper(second)) continue;
      const from = Math.max(lower(first), lower(second));
      const to = Math.min(upper(first), upper(second));
      if (from <= to) {
        const where =
          Number.isFinite(from) && Number.isFinite(to)
            ? from === to
              ? `значение ${formatUserNumber(from)} попадает`
              : `значения от ${formatUserNumber(from)} до ${formatUserNumber(to)} попадают`
            : 'часть значений попадает';
        issues.push({
          severity: 'error',
          message: `Диапазоны ${index + 1} и ${index + offset + 2} пересекаются: ${where} в оба. Граница входит в диапазон — сдвиньте её.`,
        });
      }
    }
  }
}

/** Results sit on the grid of the displayed decimals, so a gap is measurable between neighbours. */
function gapWarnings(model: UserCalculator, issues: UserCalculatorIssue[]): void {
  const step = 10 ** -model.result.decimals;
  const ordered = model.bands
    .map((band, index) => ({ band, index }))
    .filter(({ band }) => lower(band) <= upper(band))
    .toSorted((left, right) => lower(left.band) - lower(right.band));
  for (let position = 0; position + 1 < ordered.length; position += 1) {
    const first = ordered[position];
    const second = ordered[position + 1];
    if (!first || !second) continue;
    const end = first.band.max;
    const start = second.band.min;
    if (end === undefined || start === undefined || start <= end) continue;
    if (start - end > step + step * 1e-6) {
      issues.push({
        severity: 'warning',
        message: `Между диапазонами ${first.index + 1} и ${second.index + 1} есть пропуск: результаты от ${formatUserNumber(end + step, model.result.decimals)} до ${formatUserNumber(start - step, model.result.decimals)} не попадут ни в один диапазон.`,
      });
    }
  }
}

/** Evaluates the formula on every corner of the allowed input box (and its centre). */
export function sampleResultRange(
  model: UserCalculator,
): { readonly minimum: number; readonly maximum: number } | null {
  const converted = convert(model, { lenient: true });
  if (!converted.ok) return null;
  const inputs = model.inputs;
  if (inputs.length === 0 || inputs.length > 8) return null;
  if (inputs.some((input) => input.minimum === undefined || input.maximum === undefined)) {
    return null;
  }
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  const corners = 2 ** inputs.length;
  for (let mask = 0; mask <= corners; mask += 1) {
    const values: Record<string, number> = {};
    for (const [bit, input] of inputs.entries()) {
      const low = input.minimum ?? 0;
      const high = input.maximum ?? 0;
      values[input.id] = mask === corners ? (low + high) / 2 : (mask >> bit) & 1 ? high : low;
      if (input.integer) values[input.id] = Math.round(values[input.id] ?? 0);
    }
    const evaluation = evaluateCalculatorSchema(converted.schema, values);
    if (!evaluation.ok) return null;
    const output = evaluation.outputs.find((item) => item.kind === 'number');
    if (output?.kind !== 'number') return null;
    minimum = Math.min(minimum, output.value);
    maximum = Math.max(maximum, output.value);
  }
  return { minimum, maximum };
}

function rangeWarnings(model: UserCalculator, issues: UserCalculatorIssue[]): void {
  if (model.bands.length === 0) return;
  const range = sampleResultRange(model);
  if (!range) return;
  const low = roundedTo(range.minimum, model.result.decimals);
  const high = roundedTo(range.maximum, model.result.decimals);
  for (const [index, band] of model.bands.entries()) {
    if ((band.max !== undefined && band.max < low) || (band.min !== undefined && band.min > high)) {
      issues.push({
        severity: 'warning',
        message: `${bandTitle(band, index)} (${describeBound(band)}) лежит вне возможных значений результата: при допустимых данных он получается от ${formatUserNumber(low)} до ${formatUserNumber(high)} (проверены крайние значения данных).`,
      });
    }
  }
}

/** Every problem and hint about a calculator: errors block opening it, warnings do not. */
export function userCalculatorIssues(model: UserCalculator): readonly UserCalculatorIssue[] {
  const issues: UserCalculatorIssue[] = [];
  const error = (message: string): void => {
    issues.push({ severity: 'error', message });
  };
  if (model.title.trim() === '') error('Название: заполните это поле.');
  if (model.disclaimer.trim() === '') error('Ограничение: заполните это поле.');
  const populationError = userToolPopulationError(model.population);
  if (populationError) error(populationError);
  inputIssues(model, issues);
  if (model.result.label.trim() === '') error('Результат, название: заполните это поле.');

  const formula = formulaFor(model);
  if (model.formula.trim() === '') error('Формула: заполните это поле.');
  else if (!formula.ok) error(`Формула: ${formula.error}`);
  if (formula.ok) {
    const used = new Set(formula.usedIds);
    for (const [index, input] of model.inputs.entries()) {
      if (!used.has(input.id)) {
        issues.push({
          severity: 'warning',
          message: `${inputTitle(input, index)}: не используется в формуле.`,
        });
      }
    }
  }
  bandIssues(model, issues);
  const blocked = issues.some((issue) => issue.severity === 'error');
  if (!blocked) {
    const converted = convert(model, { lenient: false });
    if (!converted.ok) {
      error(`Не удалось собрать калькулятор: ${converted.errors.join('; ')}`);
    }
    gapWarnings(model, issues);
    rangeWarnings(model, issues);
  }
  return issues;
}

/** The first thing that stops the calculator from running, or null when it is ready. */
export function userCalculatorBlockingError(model: UserCalculator): string | null {
  return userCalculatorIssues(model).find((issue) => issue.severity === 'error')?.message ?? null;
}

// --- Preview and band tester ---------------------------------------------------------------------

/** Typing aid for the preview: the middle of the allowed range, or the one limit there is. */
export function defaultSampleValues(model: UserCalculator): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of model.inputs) {
    const { minimum, maximum } = input;
    let sample: number | undefined;
    if (minimum !== undefined && maximum !== undefined) sample = (minimum + maximum) / 2;
    else sample = minimum ?? maximum;
    if (sample !== undefined) {
      values[input.id] = formatUserNumber(input.integer ? Math.round(sample) : sample).replace(
        ',',
        '.',
      );
    }
  }
  return values;
}

export type UserCalculatorPreview =
  | {
      readonly ok: true;
      readonly value: number;
      readonly display: string;
      /** The message of the range the result falls in, if any. */
      readonly bandMessage?: string;
    }
  | { readonly ok: false; readonly error: string };

const NON_FINITE_MARK = 'не является конечным числом';

/** Runs the real engine on sample values; the result or the engine's own plain-language error. */
export function previewUserCalculator(
  model: UserCalculator,
  values: Readonly<Record<string, string>>,
): UserCalculatorPreview {
  const converted = convert(model, { lenient: true });
  if (!converted.ok) return { ok: false, error: converted.errors[0] ?? 'Формула не читается.' };
  const evaluation = evaluateCalculatorSchema(converted.schema, values);
  if (!evaluation.ok) {
    return {
      ok: false,
      error: evaluation.error.includes(NON_FINITE_MARK)
        ? 'При этих значениях формула не даёт числа: проверьте деление на ноль и корень из отрицательного.'
        : evaluation.error,
    };
  }
  const output = evaluation.outputs.find((item) => item.kind === 'number');
  if (output?.kind !== 'number')
    return { ok: false, error: 'Формула не дала числового результата.' };
  const interpretation = evaluation.warnings.find((warning) => warning.code === 'interpretation');
  return {
    ok: true,
    value: output.value,
    display: `${formatUserNumber(output.value, output.displayPrecision)} ${output.unit}`,
    ...(interpretation ? { bandMessage: interpretation.message } : {}),
  };
}

/** Which range fires for a typed result, rounded to the displayed decimals like the engine does. */
export function bandForResult(
  model: UserCalculator,
  value: number,
): { readonly index: number; readonly band: UserCalculatorBand } | undefined {
  const rounded = roundedTo(value, model.result.decimals);
  for (const [index, band] of model.bands.entries()) {
    if (band.min !== undefined && !(rounded >= band.min)) continue;
    if (band.max !== undefined && !(rounded <= band.max)) continue;
    return { index, band };
  }
  return undefined;
}
