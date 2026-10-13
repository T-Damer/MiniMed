import { ROUTE_ORAL } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  countText,
  durationPhrase,
  frequencyPhrase,
  gramsText,
  latinGenitive,
  latinStrength,
  rpLine,
  russianGenitive,
  signaText,
} from './prescription-text';

describe('numbers as a prescription writes them', () => {
  it('writes halves and grams the Latin way', () => {
    expect(countText(1.5)).toBe('1 1/2');
    expect(countText(0.5)).toBe('1/2');
    expect(countText(21)).toBe('21');
    expect(gramsText(500)).toBe('0,5');
    expect(gramsText(1000)).toBe('1,0');
    expect(gramsText(250)).toBe('0,25');
  });

  it('writes frequencies and durations in Russian', () => {
    expect(frequencyPhrase(3, 1)).toBe('3 раза в день');
    expect(durationPhrase(7)).toBe('в течение 7 дней');
    expect(durationPhrase(1)).toBe('в течение 1 дня');
    expect(durationPhrase(14)).toBe('в течение 2 недель');
    expect(durationPhrase(10)).toBe('в течение 10 дней');
  });
});

describe('names', () => {
  it('declines a Latin nominative into the genitive', () => {
    expect(latinGenitive('Amoxicillinum')).toBe('Amoxicillini');
    expect(latinGenitive('Paracetamolum')).toBe('Paracetamoli');
    expect(latinGenitive('Acidum acetylsalicylicum')).toBe('Acidi acetylsalicylici');
  });

  it('declines a Russian substance name for the Russian wording', () => {
    expect(russianGenitive('амоксициллин')).toBe('амоксициллина');
    expect(russianGenitive('ацетилсалициловая кислота')).toBe('ацетилсалициловой кислоты');
  });

  it('writes strengths in grams for solids and in mg for liquids', () => {
    expect(latinStrength('500 мг')).toBe('0,5');
    expect(latinStrength('250 мг/5 мл')).toBe('250 mg/5 ml');
  });
});

describe('the Rp line', () => {
  it('is Latin with the substance name, the strength in grams and the count', () => {
    expect(
      rpLine({
        latinName: 'Amoxicillinum',
        russianName: 'амоксициллин',
        form: 'таблетки',
        strength: '500 мг',
        quantity: 21,
        quantityKind: 'piece',
      }),
    ).toBe('Tab. Amoxicillini 0,5 N 21');
  });

  it('falls back to Russian in the genitive when there is no Latin name', () => {
    expect(
      rpLine({
        latinName: null,
        russianName: 'амоксициллин',
        form: 'таблетки',
        strength: '500 мг',
        quantity: 21,
        quantityKind: 'piece',
      }),
    ).toBe('Таблетки амоксициллина 500 мг N 21');
  });
});

describe('the sign', () => {
  it('names the route, the units, the frequency and the course', () => {
    const text = signaText({
      form: 'таблетки',
      routeBits: ROUTE_ORAL,
      units: {
        kind: 'piece',
        count: 1,
        step: 1,
        amount: 500,
        deviationPercent: 0,
        fromInstruction: false,
      },
      singleAmount: { value: 500, unit: 'mg' },
      intakesPerDay: 3,
      periodDays: 1,
      days: 7,
    });
    expect(text.startsWith('Внутрь по 1 таблетк')).toBe(true);
    expect(text).toContain('3 раза в день');
    expect(text.endsWith('в течение 7 дней.')).toBe(true);
  });

  it('names only the default route of a tablet when nothing else is known', () => {
    expect(
      signaText({
        form: 'таблетки',
        routeBits: 0,
        units: null,
        singleAmount: null,
        intakesPerDay: null,
        periodDays: 1,
        days: null,
      }),
    ).toBe('Внутрь.');
  });
});
