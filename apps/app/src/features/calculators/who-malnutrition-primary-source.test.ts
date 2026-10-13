import { describe, expect, it } from 'vitest';

import { evaluateCalculatorSchema } from '@/features/calculators/calculator-schema-engine';
import { loadToolModuleCalculatorSchemas } from '@/features/calculators/tool-module-test-helpers';

/**
 * Primary-source verification (2026-10-13) of acute-malnutrition-who in pediatrics.json.
 *
 * WHO guideline on the prevention and management of wasting and nutritional oedema (acute
 * malnutrition) in infants and children under 5 years, Geneva 2023, ISBN 978-92-4-008283-0
 * (full text read from the WHO IRIS PDF, sections 1.2.2, 1.2.3 and 1.4, pp. 29-32):
 *   severe wasting   = WHZ/WLZ < -3 SD, or MUAC < 115 mm (children 6-59 months);
 *   moderate wasting = WHZ/WLZ >= -3 to < -2 SD, or MUAC >= 115 to < 125 mm (6-59 months);
 *   SAM = nutritional oedema and/or WHZ/WLZ < -3 and/or MUAC < 115 mm;
 *   MAM = WHZ/WLZ >= -3 to < -2 and/or MUAC >= 115 to < 125 mm, and no nutritional oedema;
 *   nutritional oedema = bilateral pitting oedema starting in the feet; any oedema means SAM
 *   (the guideline defines no grading for the classification).
 */

const SCHEMA = loadToolModuleCalculatorSchemas(['content/tool-modules/pediatrics.json']).find(
  (candidate) => candidate.id === 'minimed.calculator.acute-malnutrition-who',
);

function classify(inputs: Record<string, number>) {
  if (!SCHEMA) throw new Error('Missing acute-malnutrition-who');
  const result = evaluateCalculatorSchema(SCHEMA, inputs);
  if (!result.ok) throw new Error(result.error);
  const output = result.outputs[0];
  if (output?.kind !== 'number') throw new Error('expected a numeric output');
  return {
    degree: output.value,
    rangeId: result.evaluation.verdict?.rangeId,
    text: result.warnings.find((warning) => warning.code === 'interpretation')?.message ?? '',
  };
}

describe('Acute malnutrition against WHO 2023', () => {
  it('limits the age scope to 6-59 months, where the MUAC cut-offs apply', () => {
    expect(SCHEMA?.ageScope).toMatchObject({
      minAge: { value: 6, unit: 'months' },
      maxAge: { value: 59, unit: 'months' },
    });
  });

  it('classifies weight-for-height z-score: >= -2 none, -3 to < -2 moderate, < -3 severe', () => {
    const cases: readonly (readonly [number, number, string])[] = [
      [0, 0, 'none'],
      [-1.99, 0, 'none'],
      [-2, 0, 'none'],
      [-2.01, 1, 'moderate'],
      [-3, 1, 'moderate'],
      [-3.01, 2, 'severe'],
      [-4.5, 2, 'severe'],
    ];
    for (const [z, degree, rangeId] of cases) {
      const result = classify({ wfhz: z });
      expect(result.degree, `z=${z}`).toBe(degree);
      expect(result.rangeId, `z=${z}`).toBe(rangeId);
    }
  });

  it('classifies MUAC: >= 125 none, 115 to < 125 moderate, < 115 severe', () => {
    const cases: readonly (readonly [number, number, string])[] = [
      [140, 0, 'none'],
      [125, 0, 'none'],
      [124, 1, 'moderate'],
      [115, 1, 'moderate'],
      [114, 2, 'severe'],
      [90, 2, 'severe'],
    ];
    for (const [muac, degree, rangeId] of cases) {
      const result = classify({ muac });
      expect(result.degree, `MUAC=${muac}`).toBe(degree);
      expect(result.rangeId, `MUAC=${muac}`).toBe(rangeId);
    }
  });

  it('treats any nutritional oedema as severe, even with normal anthropometry', () => {
    const result = classify({ wfhz: 0, muac: 140, edema: 1 });
    expect(result.degree).toBe(2);
    expect(result.rangeId).toBe('severe');
    expect(result.text).toContain('нутритивные отёки');
  });

  it('takes the worse of z-score and MUAC (and/or criteria)', () => {
    // WHZ -2.5 (moderate) with MUAC 110 (severe) -> SAM.
    expect(classify({ wfhz: -2.5, muac: 110 }).rangeId).toBe('severe');
    // WHZ -3.5 (severe) with MUAC 130 (normal) -> SAM.
    expect(classify({ wfhz: -3.5, muac: 130 }).rangeId).toBe('severe');
    // WHZ -1 (normal) with MUAC 120 (moderate) -> MAM.
    expect(classify({ wfhz: -1, muac: 120 }).rangeId).toBe('moderate');
    // WHZ -2.5 and MUAC 118, no oedema -> MAM.
    const mam = classify({ wfhz: -2.5, muac: 118, edema: 0 });
    expect(mam.rangeId).toBe('moderate');
    expect(mam.text).toContain('без нутритивных отёков');
  });

  it('carries the published thresholds in the band wording', () => {
    expect(classify({ wfhz: -3.2 }).text).toContain('<−3');
    expect(classify({ muac: 114 }).text).toContain('115 мм');
    expect(classify({ muac: 120 }).text).toContain('125 мм');
  });
});
