import { afterEach, describe, expect, it, vi } from 'vitest';

import { printCalculationRecord } from '@/features/calculators/calculator-print';
import type { CalculationRecord } from '@/state/calculation-history';

function buildRecord(): CalculationRecord {
  return {
    id: 'calculator-print-test',
    calculatorId: 'bsa',
    subjectLabel: 'Скрытая подпись',
    createdAt: '2026-08-10T10:00:00.000Z',
    inputSummary: 'Рост 170 см, масса 70 кг',
    result: {
      ok: true,
      calculatorId: 'bsa',
      formula: 'Дюбуа',
      trace: [],
      warnings: [],
      value: 1.82,
      unit: 'м²',
      displayPrecision: 2,
    },
  };
}

function buildFeedingRecord(): CalculationRecord {
  return {
    id: 'feeding-print-test',
    calculatorId: 'minimed.calculator.pediatric-feeding-plan',
    subjectLabel: 'Миша',
    createdAt: '2026-08-31T10:00:00.000Z',
    inputSummary: 'Возраст 9 мес., грудное вскармливание',
    result: {
      ok: true,
      calculatorId: 'minimed.calculator.pediatric-feeding-plan',
      formula: 'Возрастной рацион',
      trace: [],
      warnings: [{ code: 'responsive', message: 'Не кормите насильно.' }],
      textValues: [
        { id: 'dailyCalories', label: 'Калорийность за сутки', text: '880 ккал' },
        { id: 'dailyVolume', label: 'Объём за сутки', text: '1000 г/мл' },
        { id: 'feedingCount', label: 'Частота', text: '5 раз/сут' },
        { id: 'oneFeedVolume', label: 'Объём одного кормления', text: '200 г/мл' },
        { id: 'mixedSupplementPerFeed', label: 'Докорм', text: '0 мл' },
        { id: 'ageMonthsOut', label: 'Возраст', text: '9 мес.' },
        { id: 'feedingModeOut', label: 'Режим', text: 'breast' },
        { id: 'allergyAlternative', label: 'Замены', text: '' },
        { id: 'excludedFoodsOut', label: 'Исключить', text: '' },
        { id: 'meal1Time', label: 'Время', text: '06:00' },
        { id: 'meal1Food', label: 'Кормление', text: 'Грудное молоко по требованию' },
        { id: 'meal1Volume', label: 'Объём', text: '200 г/мл' },
        { id: 'meal1Calories', label: 'Калорийность', text: '176 ккал' },
        { id: 'calendarDay1', label: 'День 1', text: 'Новый продукт утром.' },
      ],
    },
  };
}

describe('calculator print layout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links MiniMed and prints an attached note title beside the date', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/#/calculators/private-result' },
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(printCalculationRecord(buildRecord(), 'Заметка пациента')).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain('⋅ Заметка пациента');
    expect(markup).not.toContain('Пациент / случай:');
    expect(markup).toContain('href="https://t-damer.github.io/MiniMed/app/"');
    expect(markup).not.toContain('#/calculators/private-result');
  });

  it('reports a blocked print popup instead of throwing', () => {
    vi.stubGlobal('window', { open: vi.fn(() => null) });

    expect(printCalculationRecord(buildRecord())).toBe(false);
  });

  it('prints the feeding plan as an A4 table with a decorative bottom-right emoji', () => {
    const popupDocument = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
    const popup = { document: popupDocument, focus: vi.fn(), print: vi.fn() };
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      setTimeout: (callback: () => void) => {
        callback();
        return 0;
      },
    });

    expect(printCalculationRecord(buildFeedingRecord())).toBe(true);

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain('@page{size:A4 portrait');
    expect(markup).toContain('<table class="feeding-sheet__table">');
    expect(markup).toContain('height:279mm;overflow:hidden');
    expect(markup).toContain('position:absolute;right:0;bottom:0');
    expect(markup).toContain('👩‍🍼');
    expect(markup).toContain('Миша');
    expect(markup).toContain('Календарь введения прикорма');
    expect(markup).not.toContain('Важно');
    expect(markup).not.toContain('Источники:');
  });
});
