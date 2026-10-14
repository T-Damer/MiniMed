import { describe, expect, it } from 'vitest';

import {
  displayCalculatorLabel,
  displayCalculatorUnit,
  formatCalculatorQuantity,
} from '@/features/calculators/calculator-quantity';

describe('how a result value reads', () => {
  it('writes an age of two years or more as years and months', () => {
    expect(formatCalculatorQuantity(39.98, 2, 'мес')).toBe('3 года 4 мес');
    expect(formatCalculatorQuantity(24, 2, 'мес')).toBe('2 года');
    expect(formatCalculatorQuantity(60, 2, 'мес')).toBe('5 лет');
    expect(formatCalculatorQuantity(135, 2, 'мес')).toBe('11 лет 3 мес');
    expect(formatCalculatorQuantity(251, 2, 'мес')).toBe('20 лет 11 мес');
  });

  it('keeps months below two years as the number the schema gave', () => {
    expect(formatCalculatorQuantity(11.5, 2, 'мес')).toBe('11,5 мес');
    expect(formatCalculatorQuantity(0.75, 2, 'мес')).toBe('0,75 мес');
  });

  it('carries the unit of other quantities as declared', () => {
    expect(formatCalculatorQuantity(15.62, 2, 'кг/м²')).toBe('15,62 кг/м²');
    expect(formatCalculatorQuantity(56.4, 1, '%')).toBe('56,4 %');
    expect(formatCalculatorQuantity(2500, 8, 'г')).toBe('2 500 г'.replace(' ', ' '));
  });

  it('writes a z-score without a unit and any other «SD» in Russian', () => {
    expect(
      formatCalculatorQuantity(-0.01, 2, 'SD', 'ВОЗ 0–5: длина / рост к возрасту, z-score'),
    ).toBe('-0,01');
    expect(displayCalculatorUnit('SD', 'Отклонение')).toBe('ст. откл.');
    expect(displayCalculatorUnit('SD', 'z-score по возрасту')).toBe('');
  });

  it('names the body mass index in Russian', () => {
    expect(displayCalculatorLabel('ВОЗ 0–5: BMI к возрасту, z-score')).toBe(
      'ВОЗ 0–5: ИМТ к возрасту, z-score',
    );
    expect(displayCalculatorLabel('Индекс массы тела')).toBe('Индекс массы тела');
  });
});
