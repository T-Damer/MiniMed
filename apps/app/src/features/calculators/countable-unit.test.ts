import { describe, expect, it } from 'vitest';

import {
  formatCalculatorQuantity,
  formatPercent,
} from '@/features/calculators/calculator-quantity';
import {
  calculatorSchemaMissingInputs,
  evaluateCalculatorSchema,
} from '@/features/calculators/calculator-schema-engine';
import {
  isCountableUnit,
  unitForNumber,
  unitForQuantity,
} from '@/features/calculators/countable-unit';
import {
  loadToolModuleCalculatorSchemas,
  loadToolModuleRecords,
} from '@/features/calculators/tool-module-test-helpers';

describe('a counted unit agrees with its number', () => {
  it.each([
    [0, 'баллов'],
    [1, 'балл'],
    [2, 'балла'],
    [4, 'балла'],
    [5, 'баллов'],
    [8, 'баллов'],
    [11, 'баллов'],
    [12, 'баллов'],
    [21, 'балл'],
    [22, 'балла'],
    [31, 'балл'],
    [111, 'баллов'],
    [-3, 'балла'],
  ])('%d is «%s»', (count, expected) => {
    // The schema may declare the unit in any of its forms.
    for (const declared of ['баллов', 'балла', 'баллы', 'балл']) {
      expect(unitForNumber(count, declared)).toBe(expected);
    }
  });

  it('puts a fraction in the genitive singular', () => {
    expect(unitForNumber(1.5, 'баллов')).toBe('балла');
    expect(unitForNumber(0.5, 'дней')).toBe('дня');
    expect(unitForNumber(2.5, 'лет')).toBe('года');
  });

  it('follows the number as the reader sees it once rounded', () => {
    expect(unitForQuantity(0.96, 0, 'баллов')).toBe('балл');
    expect(unitForQuantity(2.04, 0, 'баллов')).toBe('балла');
    expect(unitForQuantity(4.96, 2, 'баллов')).toBe('балла');
    expect(unitForQuantity(4.96, 1, 'баллов')).toBe('баллов');
    expect(unitForQuantity(4.96, 0, 'баллов')).toBe('баллов');
  });

  it('declines the other counted nouns tools declare', () => {
    expect(unitForNumber(1, 'дней')).toBe('день');
    expect(unitForNumber(3, 'дни')).toBe('дня');
    expect(unitForNumber(194, 'календарных дней')).toBe('календарных дня');
    expect(unitForNumber(1, 'лет')).toBe('год');
    expect(unitForNumber(22, 'лет')).toBe('года');
    expect(unitForNumber(2, 'критериев')).toBe('критерия');
    expect(unitForNumber(1, 'признак')).toBe('признак');
    expect(unitForNumber(5, 'сегментов')).toBe('сегментов');
    expect(unitForNumber(2, 'недели')).toBe('недели');
    expect(unitForNumber(1, 'недели')).toBe('неделя');
    expect(unitForNumber(2, 'раз')).toBe('раза');
  });

  it('leaves abbreviations and measurement units alone', () => {
    for (const unit of [
      'нед',
      'нед.',
      'мес',
      'дн',
      'шт.',
      'мг/дл',
      '%',
      'ккал',
      'мл/мин/1,73 м²',
    ]) {
      expect(isCountableUnit(unit)).toBe(false);
      expect(unitForNumber(1, unit)).toBe(unit);
      expect(unitForNumber(2, unit)).toBe(unit);
    }
  });

  it('writes a result the way a doctor says it', () => {
    expect(formatCalculatorQuantity(8, 0, 'балла')).toBe('8 баллов');
    expect(formatCalculatorQuantity(21, 0, 'баллов')).toBe('21 балл');
    expect(formatCalculatorQuantity(2, 0, 'баллов')).toBe('2 балла');
    expect(formatCalculatorQuantity(0, 0, 'баллы')).toBe('0 баллов');
    expect(formatCalculatorQuantity(1.5, 1, 'баллов')).toBe('1,5 балла');
    expect(formatCalculatorQuantity(31, 0, 'баллов')).toBe('31 балл');
  });

  it('writes a percentage with the decimal comma and a space, like every other number', () => {
    expect(formatPercent(83.3)).toBe('83,3 %');
    expect(formatPercent(40.3)).toBe('40,3 %');
    expect(formatPercent(50)).toBe('50 %');
  });
});

describe('what a disabled «Рассчитать» is waiting for', () => {
  const qtc = loadToolModuleCalculatorSchemas().find(
    (schema) => schema.slug === 'qtc-bazett-fridericia',
  );

  it('names the required fields that are still empty', () => {
    if (!qtc) throw new Error('QTc schema missing');
    expect(calculatorSchemaMissingInputs(qtc, {})).toEqual(['Интервал QT', 'Интервал RR']);
    expect(calculatorSchemaMissingInputs(qtc, { qtMs: '400', rrSeconds: '' })).toEqual([
      'Интервал RR',
    ]);
    expect(calculatorSchemaMissingInputs(qtc, { qtMs: '400', rrSeconds: '0.8' })).toEqual([]);
  });
});

describe('plausibility notes declared by a tool', () => {
  const schemas = loadToolModuleCalculatorSchemas();
  const bySlug = (slug: string) => {
    const schema = schemas.find((candidate) => candidate.slug === slug);
    if (!schema) throw new Error(`${slug} missing`);
    return schema;
  };

  it('tell the reader that a creatinine of 5 µmol/l is not a real one', () => {
    for (const slug of [
      'adult-egfr-ckd-epi-2021',
      'cockcroft-gault-creatinine-clearance',
      'pediatric-egfr-schwartz-2009',
    ]) {
      const schema = bySlug(slug);
      const common = { sex: 'female', creatinineUnit: 'umol/l' };
      const inputs =
        slug === 'adult-egfr-ckd-epi-2021'
          ? { ...common, ageYears: 40, creatinine: 5 }
          : slug === 'cockcroft-gault-creatinine-clearance'
            ? { ...common, ageYears: 40, weightKg: 70, creatinine: 5 }
            : { ageYears: 10, heightCm: 140, creatinine: 5, creatinineUnit: 'umol/l' };
      const low = evaluateCalculatorSchema(schema, inputs);
      if (!low.ok) throw new Error(`${slug}: ${low.error}`);
      expect(low.warnings[0]?.code, slug).toBe('implausible-creatinine');
      expect(low.warnings.every((warning) => !('when' in warning))).toBe(true);
      const normal = evaluateCalculatorSchema(schema, { ...inputs, creatinine: 80 });
      if (!normal.ok) throw new Error(`${slug}: ${normal.error}`);
      expect(normal.warnings.map((warning) => warning.code)).not.toContain(
        'implausible-creatinine',
      );
    }
  });

  it('every conditional warning of the catalogue parses', () => {
    const conditional = schemas.flatMap((schema) =>
      schema.warnings.filter((warning) => warning.when !== undefined),
    );
    expect(conditional.length).toBeGreaterThanOrEqual(3);
  });
});

describe('glasgow coma scale wording', () => {
  const gcs = loadToolModuleRecords().find((record) => record.slug === 'glasgow-coma-scale');
  const definition = gcs?.definition as {
    questions: { id: string; responseOptions: { value: number; label: string }[] }[];
    interpretations: { headline: string; message: string }[];
  };

  it('uses Teasdale and Jennett answers: confused speech, flexion is decorticate', () => {
    const verbal = definition.questions.find((question) => question.id === 'gcs-verbal-response');
    const motor = definition.questions.find((question) => question.id === 'gcs-motor-response');
    expect(verbal?.responseOptions.find((option) => option.value === 4)?.label).toMatch(
      /^Спутанная/u,
    );
    expect(verbal?.responseOptions.map((option) => option.label).join()).not.toMatch(/Смазанн/u);
    expect(motor?.responseOptions.find((option) => option.value === 3)?.label).toBe(
      'Патологическое сгибание на боль (декортикация)',
    );
    expect(motor?.responseOptions.find((option) => option.value === 2)?.label).toBe(
      'Патологическое разгибание на боль (децеребрация)',
    );
  });

  it('names a level of consciousness, not a head injury, for any cause of coma', () => {
    for (const band of definition.interpretations) {
      expect(band.headline).toMatch(/нарушение сознания/u);
      expect(band.headline).not.toMatch(/черепно-мозговая/u);
    }
  });
});
