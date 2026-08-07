import type { CalculationTraceStep } from '@/features/calculators/calculator-types';

export type CreatinineUnit = 'mg/dl' | 'umol/l';
export type BiologicalSex = 'female' | 'male';

export interface CalculatorWarning {
  readonly code: string;
  readonly message: string;
}

export interface NumericCalculationResult {
  readonly ok: true;
  readonly calculatorId: string;
  readonly formula: string;
  readonly value: number;
  readonly unit: string;
  readonly displayPrecision: number;
  readonly trace: readonly CalculationTraceStep[];
  readonly warnings: readonly CalculatorWarning[];
}

export interface DualCalculationResult {
  readonly ok: true;
  readonly calculatorId: string;
  readonly formula: string;
  readonly values: readonly {
    readonly label: string;
    readonly value: number;
    readonly unit: string;
    readonly displayPrecision: number;
  }[];
  readonly trace: readonly CalculationTraceStep[];
  readonly warnings: readonly CalculatorWarning[];
}

export interface TextCalculationResult {
  readonly ok: true;
  readonly calculatorId: string;
  readonly formula: string;
  readonly textValues: readonly {
    readonly label: string;
    readonly text: string;
  }[];
  readonly trace: readonly CalculationTraceStep[];
  readonly warnings: readonly CalculatorWarning[];
}

export type StoredCalculationResult =
  | NumericCalculationResult
  | DualCalculationResult
  | TextCalculationResult;

export interface CalculationFailure {
  readonly ok: false;
  readonly error: string;
}

export type ClinicalCalculationResult = StoredCalculationResult | CalculationFailure;

const UMOL_PER_MG_DL_CREATININE = 88.4;

function failure(error: string): CalculationFailure {
  return { ok: false, error };
}

function positiveFinite(value: number, label: string): CalculationFailure | undefined {
  if (!Number.isFinite(value) || value <= 0) {
    return failure(`${label}: требуется положительное конечное число.`);
  }
  return undefined;
}

function creatinineMgDl(value: number, unit: CreatinineUnit): number {
  return unit === 'mg/dl' ? value : value / UMOL_PER_MG_DL_CREATININE;
}

function creatinineTrace(value: number, unit: CreatinineUnit): CalculationTraceStep {
  const normalized = creatinineMgDl(value, unit);
  return {
    label: 'Креатинин в единицах формулы',
    expression:
      unit === 'mg/dl' ? `${value} мг/дл` : `${value} мкмоль/л ÷ ${UMOL_PER_MG_DL_CREATININE}`,
    value: normalized,
    unit: 'мг/дл',
  };
}

export function calculateMostellerBsa(input: {
  readonly heightCm: number;
  readonly weightKg: number;
}): ClinicalCalculationResult {
  const heightError = positiveFinite(input.heightCm, 'Рост');
  if (heightError) return heightError;
  const weightError = positiveFinite(input.weightKg, 'Масса');
  if (weightError) return weightError;
  if (input.heightCm > 260 || input.weightKg > 500) {
    return failure('Рост или масса находятся вне поддерживаемого диапазона проверки ввода.');
  }

  const product = input.heightCm * input.weightKg;
  const value = Math.sqrt(product / 3600);
  return {
    ok: true,
    calculatorId: 'body-surface-area-mosteller',
    formula: 'Mosteller, 1987: BSA = √((рост, см × масса, кг) / 3600)',
    value,
    unit: 'м²',
    displayPrecision: 2,
    trace: [
      {
        label: 'Произведение роста и массы',
        expression: `${input.heightCm} × ${input.weightKg}`,
        value: product,
        unit: 'см·кг',
      },
      {
        label: 'Деление на 3600',
        expression: `${product} ÷ 3600`,
        value: product / 3600,
        unit: 'м⁴',
      },
      {
        label: 'Площадь поверхности тела',
        expression: `√${product / 3600}`,
        value,
        unit: 'м²',
      },
    ],
    warnings: [
      {
        code: 'formula-estimate',
        message:
          'Это расчётная площадь поверхности тела. Для дозирования и протоколов используйте именно формулу, указанную в соответствующем источнике.',
      },
    ],
  };
}

export function calculateAdultEgfrCkdEpi2021(input: {
  readonly ageYears: number;
  readonly sex: BiologicalSex;
  readonly creatinine: number;
  readonly creatinineUnit: CreatinineUnit;
}): ClinicalCalculationResult {
  const ageError = positiveFinite(input.ageYears, 'Возраст');
  if (ageError) return ageError;
  const creatinineError = positiveFinite(input.creatinine, 'Креатинин');
  if (creatinineError) return creatinineError;
  if (input.ageYears < 18 || input.ageYears > 120) {
    return failure('CKD-EPI 2021 в MiniMed поддерживается только для взрослых 18–120 лет.');
  }

  const scr = creatinineMgDl(input.creatinine, input.creatinineUnit);
  if (scr > 30) return failure('Проверьте значение и единицы креатинина.');
  const kappa = input.sex === 'female' ? 0.7 : 0.9;
  const alpha = input.sex === 'female' ? -0.241 : -0.302;
  const ratio = scr / kappa;
  const minimum = Math.min(ratio, 1);
  const maximum = Math.max(ratio, 1);
  const sexFactor = input.sex === 'female' ? 1.012 : 1;
  const value = 142 * minimum ** alpha * maximum ** -1.2 * 0.9938 ** input.ageYears * sexFactor;

  return {
    ok: true,
    calculatorId: 'adult-egfr-ckd-epi-2021',
    formula: 'CKD-EPI 2021, креатинин, без расового коэффициента',
    value,
    unit: 'мл/мин/1,73 м²',
    displayPrecision: 0,
    trace: [
      creatinineTrace(input.creatinine, input.creatinineUnit),
      {
        label: 'Отношение Scr/κ',
        expression: `${scr} ÷ ${kappa}`,
        value: ratio,
        unit: 'безразмерно',
      },
      {
        label: 'Минимальная часть',
        expression: `min(${ratio}, 1)^${alpha}`,
        value: minimum ** alpha,
        unit: 'безразмерно',
      },
      {
        label: 'Максимальная часть',
        expression: `max(${ratio}, 1)^−1,2`,
        value: maximum ** -1.2,
        unit: 'безразмерно',
      },
      {
        label: 'Расчётная СКФ',
        expression: `142 × min^α × max^−1,2 × 0,9938^${input.ageYears} × ${sexFactor}`,
        value,
        unit: 'мл/мин/1,73 м²',
      },
    ],
    warnings: [
      {
        code: 'idms-creatinine',
        message: 'Формула предполагает стандартизованный по IDMS сывороточный креатинин.',
      },
      {
        code: 'not-drug-clearance',
        message:
          'Индексированная eGFR не равна клиренсу креатинина по Cockcroft–Gault и не должна автоматически подменять формулу из инструкции препарата.',
      },
      {
        code: 'unstable-creatinine',
        message:
          'Оценка ненадёжна при быстро меняющемся креатинине, острой почечной недостаточности и состояниях с нетипичной мышечной массой.',
      },
    ],
  };
}

export function calculatePediatricEgfrSchwartz2009(input: {
  readonly ageYears: number;
  readonly heightCm: number;
  readonly creatinine: number;
  readonly creatinineUnit: CreatinineUnit;
}): ClinicalCalculationResult {
  const ageError = positiveFinite(input.ageYears, 'Возраст');
  if (ageError) return ageError;
  const heightError = positiveFinite(input.heightCm, 'Рост');
  if (heightError) return heightError;
  const creatinineError = positiveFinite(input.creatinine, 'Креатинин');
  if (creatinineError) return creatinineError;
  if (input.ageYears < 1 || input.ageYears > 16) {
    return failure('Bedside CKiD 2009 в MiniMed ограничена исходной возрастной группой 1–16 лет.');
  }
  if (input.heightCm < 40 || input.heightCm > 220) {
    return failure('Проверьте рост ребёнка и его единицы.');
  }

  const scr = creatinineMgDl(input.creatinine, input.creatinineUnit);
  if (scr > 20) return failure('Проверьте значение и единицы креатинина.');
  const numerator = 0.413 * input.heightCm;
  const value = numerator / scr;
  return {
    ok: true,
    calculatorId: 'pediatric-egfr-schwartz-2009',
    formula: 'Bedside CKiD (Schwartz), 2009: eGFR = 0,413 × рост(см) / Scr(мг/дл)',
    value,
    unit: 'мл/мин/1,73 м²',
    displayPrecision: 0,
    trace: [
      creatinineTrace(input.creatinine, input.creatinineUnit),
      {
        label: 'Рост с коэффициентом',
        expression: `0,413 × ${input.heightCm}`,
        value: numerator,
        unit: 'см',
      },
      {
        label: 'Расчётная СКФ',
        expression: `${numerator} ÷ ${scr}`,
        value,
        unit: 'мл/мин/1,73 м²',
      },
    ],
    warnings: [
      {
        code: 'derived-in-ckd',
        message:
          'Формула разработана преимущественно у детей с хронической болезнью почек и умеренно сниженной СКФ; для скрининга детей с нормальной функцией почек точность ограничена.',
      },
      {
        code: 'enzymatic-creatinine',
        message:
          'Исходная CKiD-формула основана на стандартизованном ферментативном измерении креатинина.',
      },
    ],
  };
}

export function calculatePediatricMaintenanceFluids(input: {
  readonly weightKg: number;
}): ClinicalCalculationResult {
  const weightError = positiveFinite(input.weightKg, 'Масса');
  if (weightError) return weightError;
  if (input.weightKg < 0.5 || input.weightKg > 200) {
    return failure('Масса находится вне поддерживаемого диапазона 0,5–200 кг.');
  }

  const firstTen = Math.min(input.weightKg, 10);
  const secondTen = Math.min(Math.max(input.weightKg - 10, 0), 10);
  const remaining = Math.max(input.weightKg - 20, 0);
  const daily = firstTen * 100 + secondTen * 50 + remaining * 20;
  const hourly421 = firstTen * 4 + secondTen * 2 + remaining;

  return {
    ok: true,
    calculatorId: 'pediatric-maintenance-fluids',
    formula: 'Holliday–Segar 100/50/20 мл/кг/сут и приближённое правило 4–2–1 мл/кг/ч',
    values: [
      {
        label: 'Суточная поддерживающая потребность',
        value: daily,
        unit: 'мл/сут',
        displayPrecision: 0,
      },
      {
        label: 'Почасовая скорость 4–2–1',
        value: hourly421,
        unit: 'мл/ч',
        displayPrecision: 1,
      },
      {
        label: 'Средняя скорость из суточного объёма',
        value: daily / 24,
        unit: 'мл/ч',
        displayPrecision: 1,
      },
    ],
    trace: [
      {
        label: 'Первые 10 кг',
        expression: `${firstTen} × 100`,
        value: firstTen * 100,
        unit: 'мл/сут',
      },
      {
        label: 'Вторые 10 кг',
        expression: `${secondTen} × 50`,
        value: secondTen * 50,
        unit: 'мл/сут',
      },
      {
        label: 'Масса свыше 20 кг',
        expression: `${remaining} × 20`,
        value: remaining * 20,
        unit: 'мл/сут',
      },
      {
        label: 'Суточный объём',
        expression: `${firstTen * 100} + ${secondTen * 50} + ${remaining * 20}`,
        value: daily,
        unit: 'мл/сут',
      },
      {
        label: 'Правило 4–2–1',
        expression: `${firstTen} × 4 + ${secondTen} × 2 + ${remaining} × 1`,
        value: hourly421,
        unit: 'мл/ч',
      },
    ],
    warnings: [
      {
        code: 'maintenance-only',
        message:
          'Это только поддерживающая потребность: дефицит, продолжающиеся потери, болюсы и ограничения жидкости рассчитываются отдельно.',
      },
      {
        code: 'clinical-adjustment',
        message:
          'Расчёт требует клинической коррекции при лихорадке, вентиляции, олигурии, сердечной/почечной недостаточности, ожирении, обезвоживании и нарушениях натрия.',
      },
      {
        code: 'hourly-difference',
        message:
          'Правило 4–2–1 является округлённым почасовым приближением и может немного отличаться от суточного объёма, делённого на 24.',
      },
    ],
  };
}
