import { describe, expect, it } from 'vitest';

import { bindNumberUnits, joinNumberUnit } from '@/i18n/no-break';

const NBSP = ' ';

describe('bindNumberUnits', () => {
  it('keeps a number and its unit on one line', () => {
    expect(bindNumberUnits('по 250 мг 2 раза в сутки')).toBe(`по 250${NBSP}мг 2 раза в сутки`);
    expect(bindNumberUnits('вес 20 кг, 8,5 МБ, 6 мес.')).toBe(
      `вес 20${NBSP}кг, 8,5${NBSP}МБ, 6${NBSP}мес.`,
    );
  });

  it('keeps «%», «‰», «°» and «№» with their neighbours', () => {
    expect(bindNumberUnits('SpO₂ 94 %, 37 °C, 12 ‰')).toBe(
      `SpO₂ 94${NBSP}%, 37${NBSP}°C, 12${NBSP}‰`,
    );
    expect(bindNumberUnits('приказ № 1122н')).toBe(`приказ №${NBSP}1122н`);
  });

  it('leaves words that only start like a unit, and text without numbers, alone', () => {
    expect(bindNumberUnits('3 класс')).toBe('3 класс');
    expect(bindNumberUnits('2 месяца назад')).toBe('2 месяца назад');
    expect(bindNumberUnits('без чисел')).toBe('без чисел');
  });

  it('joins a value and a unit', () => {
    expect(joinNumberUnit(250, 'мг')).toBe(`250${NBSP}мг`);
  });
});
