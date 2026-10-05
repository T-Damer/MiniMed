/** Bounds of the doctor's own calculators; the file format and the editor share them. */
export const USER_CALCULATOR_LIMITS = {
  inputs: 20,
  bands: 12,
  calculators: 200,
  title: 120,
  description: 2000,
  disclaimer: 1000,
  label: 120,
  unit: 24,
  name: 40,
  headline: 200,
  message: 1000,
  formula: 500,
  decimals: 6,
  /** Largest absolute value accepted for a limit, so no number can reach the expression text as an exponent. */
  magnitude: 1e9,
  /** An imported file larger than this is not a calculator. */
  fileBytes: 1_000_000,
} as const;

export const USER_CALCULATOR_DEFAULT_DISCLAIMER =
  'Авторский калькулятор. Результат не заменяет клиническую оценку.';
