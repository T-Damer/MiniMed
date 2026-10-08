import type { CalculationTraceStep } from '@/features/calculators/calculator-types';

const UNIT_FACTORS = {
  mass: {
    kg: 1,
    g: 1e-3,
    mg: 1e-6,
    mcg: 1e-9,
  },
  length: {
    m: 1,
    cm: 1e-2,
    mm: 1e-3,
  },
  volume: {
    l: 1,
    ml: 1e-3,
  },
} as const;

/** The units as they are written on a Russian prescription and in a protocol. */
const UNIT_LABELS: Readonly<Record<QuantityUnit, string>> = {
  kg: 'кг',
  g: 'г',
  mg: 'мг',
  mcg: 'мкг',
  m: 'м',
  cm: 'см',
  mm: 'мм',
  l: 'л',
  ml: 'мл',
};

export type QuantityFamily = keyof typeof UNIT_FACTORS;
export type MassUnit = keyof (typeof UNIT_FACTORS)['mass'];
export type LengthUnit = keyof (typeof UNIT_FACTORS)['length'];
export type VolumeUnit = keyof (typeof UNIT_FACTORS)['volume'];
export type QuantityUnit = MassUnit | LengthUnit | VolumeUnit;

/** `mcg` as `мкг`: what the screen, the saved summary and the result show. */
export function unitLabel(unit: string): string {
  return (UNIT_LABELS as Readonly<Record<string, string>>)[unit] ?? unit;
}

export interface QuantityConversionRequest {
  readonly family: QuantityFamily;
  readonly value: number;
  readonly from: string;
  readonly to: string;
}

export type QuantityConversionErrorCode =
  | 'non-finite-value'
  | 'negative-value'
  | 'unknown-source-unit'
  | 'unknown-target-unit';

export interface QuantityConversionError {
  readonly code: QuantityConversionErrorCode;
  readonly message: string;
}

export interface QuantityConversionSuccess {
  readonly ok: true;
  readonly value: number;
  readonly unit: QuantityUnit;
  readonly trace: readonly CalculationTraceStep[];
}

export interface QuantityConversionFailure {
  readonly ok: false;
  readonly error: QuantityConversionError;
}

export type QuantityConversionResult = QuantityConversionSuccess | QuantityConversionFailure;

function failure(code: QuantityConversionErrorCode, message: string): QuantityConversionFailure {
  return { ok: false, error: { code, message } };
}

export function convertQuantity(request: QuantityConversionRequest): QuantityConversionResult {
  if (!Number.isFinite(request.value)) {
    return failure('non-finite-value', 'Значение должно быть конечным числом.');
  }
  if (request.value < 0) {
    return failure(
      'negative-value',
      'Для массы, длины и объёма нельзя использовать отрицательное значение.',
    );
  }

  const factors = UNIT_FACTORS[request.family] as Readonly<Record<string, number>>;
  const sourceFactor = factors[request.from];
  if (sourceFactor === undefined) {
    return failure(
      'unknown-source-unit',
      `Единица ${unitLabel(request.from)} не относится к величине ${request.family}.`,
    );
  }
  const targetFactor = factors[request.to];
  if (targetFactor === undefined) {
    return failure(
      'unknown-target-unit',
      `Единица ${unitLabel(request.to)} не относится к величине ${request.family}.`,
    );
  }

  const baseValue = request.value * sourceFactor;
  const convertedValue = baseValue / targetFactor;
  const baseUnit = Object.entries(factors).find(([, factor]) => factor === 1)?.[0] ?? request.from;

  return {
    ok: true,
    value: convertedValue,
    unit: request.to as QuantityUnit,
    trace: [
      {
        label: 'Исходное значение',
        expression: `${request.value} ${unitLabel(request.from)}`,
        value: request.value,
        unit: unitLabel(request.from),
      },
      {
        label: 'В базовой единице',
        expression: `${request.value} × ${sourceFactor}`,
        value: baseValue,
        unit: unitLabel(baseUnit),
      },
      {
        label: 'Результат',
        expression: `${baseValue} ÷ ${targetFactor}`,
        value: convertedValue,
        unit: unitLabel(request.to),
      },
    ],
  };
}

export function unitsForFamily(family: QuantityFamily): readonly QuantityUnit[] {
  return Object.keys(UNIT_FACTORS[family]) as QuantityUnit[];
}
