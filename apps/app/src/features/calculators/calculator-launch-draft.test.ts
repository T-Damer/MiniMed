import { describe, expect, it } from 'vitest';

import {
  consumeCalculatorLaunchDraft,
  saveCalculatorLaunchDraft,
} from '@/features/calculators/calculator-launch-draft';

describe('calculator launch draft', () => {
  it('consumes only valid values for the matching schema once', () => {
    saveCalculatorLaunchDraft('dose-preview', {
      ageYears: '5',
      route: 'oral',
      staleInput: 'ignored',
      invalidRoute: 'intravenous',
    });

    const inputs = [
      {
        id: 'ageYears',
        label: 'Возраст',
        kind: 'number' as const,
        required: false,
        step: 0,
        minimum: 0,
        maximum: 18,
      },
      {
        id: 'route',
        label: 'Путь введения',
        kind: 'select' as const,
        required: false,
        step: 0,
        options: [{ value: 'oral', label: 'Через рот' }],
      },
    ];

    expect(consumeCalculatorLaunchDraft('dose-preview', inputs)).toEqual({
      ageYears: '5',
      route: 'oral',
    });
    expect(consumeCalculatorLaunchDraft('dose-preview', inputs)).toEqual({});
  });
});
