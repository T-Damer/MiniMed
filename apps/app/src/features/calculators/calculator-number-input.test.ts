import { describe, expect, it } from 'vitest';

import { calculatorNumberInputAttributes } from '@/features/calculators/calculator-number-input';
import { calculatorNumberInputError } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

const NUMBER_INPUTS = loadToolModuleCalculatorSchemas().flatMap((schema) =>
  schema.inputs
    .filter((input) => input.kind === 'number')
    .map((input) => ({ schemaId: schema.id, slug: schema.slug, input })),
);

/** The browser's own rule for a number input: a value off `min + k * step` is a «step mismatch». */
function nativeStepMismatch(
  value: number,
  attributes: { readonly min: number | undefined; readonly step: number | 'any' },
): boolean {
  if (attributes.step === 'any') return false;
  return Math.abs(value - (attributes.min ?? 0)) % attributes.step > 1e-9;
}

/** Values on the declared precision grid inside [minimum, maximum]: the ends and every k * step. */
function gridValues(input: (typeof NUMBER_INPUTS)[number]['input']): readonly number[] {
  const step = input.inputStep ?? (input.integer ? 1 : undefined);
  const low = input.minimum ?? 0;
  const high = input.maximum ?? low + (step ?? 1) * 50;
  const values = new Set<number>([low, high]);
  if (step !== undefined) {
    const first = Math.ceil(low / step - 1e-9);
    const last = Math.floor(high / step + 1e-9);
    const stride = Math.max(1, Math.floor((last - first) / 400));
    for (let k = first; k <= last; k += stride) values.add(Number((k * step).toFixed(9)));
    // The grid anchored at the minimum, as a native `step` would count it.
    for (let k = 0; low + k * step <= high + 1e-9 && k <= 400; k += 1) {
      values.add(Number((low + k * step).toFixed(9)));
    }
  }
  return [...values].filter(
    (value) =>
      value >= low - 1e-9 &&
      value <= high + 1e-9 &&
      (input.integer !== true || Number.isInteger(value)),
  );
}

describe('number inputs of every tool', () => {
  it('cover the whole catalogue', () => {
    expect(NUMBER_INPUTS.length).toBeGreaterThan(500);
  });

  it.each(
    NUMBER_INPUTS.map(({ schemaId, input }) => [`${schemaId} · ${input.id}`, input] as const),
  )(
    '%s accepts every value on its declared grid, natively and in our own check',
    (_name, input) => {
      const attributes = calculatorNumberInputAttributes(input);
      for (const value of gridValues(input)) {
        expect(nativeStepMismatch(value, attributes), `native step rejects ${value}`).toBe(false);
        expect(calculatorNumberInputError(input, value), `engine rejects ${value}`).toBeUndefined();
        expect(calculatorNumberInputError(input, String(value))).toBeUndefined();
      }
    },
  );

  it('never leaves the step to the browser, whatever precision a tool declares', () => {
    for (const { input } of NUMBER_INPUTS) {
      expect(calculatorNumberInputAttributes(input).step).toBe('any');
    }
  });

  it('keeps the range in Russian, with the decimal comma', () => {
    const input = { label: 'Возраст', minimum: 0.33, maximum: 11.9 };
    expect(calculatorNumberInputError(input, 0.2)).toBe(
      'Возраст: значение меньше допустимого минимума 0,33.',
    );
    expect(calculatorNumberInputError(input, 12)).toBe(
      'Возраст: значение больше допустимого максимума 11,9.',
    );
    expect(calculatorNumberInputError(input, 4)).toBeUndefined();
    expect(calculatorNumberInputError({ label: 'Число', integer: true }, 1.5)).toBe(
      'Число: требуется целое число.',
    );
  });

  it('would have caught the native step that rejected normal values', () => {
    const input = NUMBER_INPUTS.find(
      (candidate) =>
        candidate.slug === 'infant-feeding-volume-methods' && candidate.input.id === 'ageMonths',
    )?.input;
    if (!input?.inputStep || input.minimum === undefined) throw new Error('fixture input changed');
    const oldAttributes = { ...calculatorNumberInputAttributes(input), step: input.inputStep };
    expect(nativeStepMismatch(4, oldAttributes)).toBe(true);
  });

  it('accepts the values the QA pass typed (4 months, 1.3, 5.2, 50)', () => {
    const by = (schemaId: string, id: string) => {
      const found = NUMBER_INPUTS.find(
        (candidate) => candidate.slug === schemaId && candidate.input.id === id,
      );
      if (!found) throw new Error(`${schemaId}.${id} not found`);
      return found.input;
    };
    for (const [schema, id, value] of [
      ['infant-feeding-volume-methods', 'ageMonths', 4],
      ['infant-feeding-volume-methods', 'ageMonths', 6],
      ['pooled-cohort-equations-ascvd-risk', 'hdl', 1.3],
      ['pooled-cohort-equations-ascvd-risk', 'totalChol', 5.2],
      ['dose-by-body-surface-area', 'dosePerM2', 50],
    ] as const) {
      const attributes = calculatorNumberInputAttributes(by(schema, id));
      expect(nativeStepMismatch(value, attributes)).toBe(false);
      expect(calculatorNumberInputError(by(schema, id), value)).toBeUndefined();
    }
  });
});
