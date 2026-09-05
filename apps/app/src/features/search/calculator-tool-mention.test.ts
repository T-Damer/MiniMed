import { describe, expect, it } from 'vitest';

import {
  parseCalculatorToolMention,
  replaceCalculatorToolTrigger,
} from '@/features/search/calculator-tool-mention';

// Public UI mention strings, not authentication tokens.
const whoMention = '@Калькулятор:pediatric-anthropometry-who';
const missingMention = '@Калькулятор:missing';

const calculators = [
  {
    id: 'minimed.calculator.pediatric-anthropometry-who',
    slug: 'pediatric-anthropometry-who',
    title: 'Антропометрия детей: z-score и перцентили ВОЗ',
    shortTitle: 'Антропометрия ВОЗ',
    aliases: ['развитие ребенка', 'рост ребенка'],
  },
] as const;

describe('calculator tool mentions', () => {
  it('resolves a stable picker token and keeps only the clinical text for search', () => {
    expect(
      parseCalculatorToolMention(
        '@Калькулятор:pediatric-anthropometry-who мальчик 6 лет, рост 116 см',
        calculators,
      ),
    ).toEqual({
      calculatorId: 'minimed.calculator.pediatric-anthropometry-who',
      query: 'мальчик 6 лет, рост 116 см',
      token: whoMention,
    });
  });

  it('accepts a compact Russian title when it was typed manually', () => {
    expect(
      parseCalculatorToolMention('@Калькулятор:РазвитиеРебенка 6 лет', calculators),
    ).toMatchObject({
      calculatorId: 'minimed.calculator.pediatric-anthropometry-who',
      query: '6 лет',
    });
  });

  it('does not alter ordinary search text', () => {
    expect(parseCalculatorToolMention('Парацетамол ребёнку 6 лет', calculators)).toEqual({
      query: 'Парацетамол ребёнку 6 лет',
    });
  });

  it('removes an unavailable tool token but leaves the ordinary query usable', () => {
    expect(parseCalculatorToolMention('@Калькулятор:missing кашель', calculators)).toEqual({
      query: 'кашель',
      token: missingMention,
    });
  });

  it('replaces the active @ fragment instead of duplicating it', () => {
    expect(
      replaceCalculatorToolTrigger('кашель @антро', 14, 'pediatric-anthropometry-who'),
    ).toEqual({
      caret: 48,
      value: 'кашель @Калькулятор:pediatric-anthropometry-who ',
    });
  });
});
