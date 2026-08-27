import { afterEach, describe, expect, it, vi } from 'vitest';

import { printCalculationRecord } from '@/features/calculators/calculator-print';
import type { CalculationRecord } from '@/state/calculation-history';

describe('calculator print layout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links MiniMed and prints an attached note title beside the date', () => {
    const popupDocument = { write: vi.fn(), close: vi.fn() };
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5175/#/calculators/private-result' },
      open: vi.fn(() => ({ document: popupDocument })),
    });
    const record: CalculationRecord = {
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

    printCalculationRecord(record, 'Заметка пациента');

    const markup = popupDocument.write.mock.calls[0]?.[0];
    expect(markup).toContain('⋅ Заметка пациента');
    expect(markup).not.toContain('Пациент / случай:');
    expect(markup).toContain('href="https://t-damer.github.io/MiniMed/app/"');
    expect(markup).not.toContain('#/calculators/private-result');
  });
});
