import type { CalculatorInputDefinition } from '@localmed/contracts';

/**
 * Attributes of a calculator number field. The HTML `step` is always `any`: a native step makes every
 * value off `minimum + k * step` «invalid» with the browser's own English tooltip (a month count of 4
 * against minimum 0.33 and step 0.1, a total cholesterol of 5,2 against 3.36). The range, the integer
 * rule and the precision grid are checked by the schema engine, which answers in Russian.
 */
export function calculatorNumberInputAttributes(input: CalculatorInputDefinition): {
  readonly inputmode: 'numeric' | 'decimal';
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly step: 'any';
} {
  return {
    inputmode: input.integer ? 'numeric' : 'decimal',
    min: input.minimum,
    max: input.maximum,
    step: 'any',
  };
}
