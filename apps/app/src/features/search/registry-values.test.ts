import { describe, expect, it } from 'vitest';
import {
  dropPlaceholderQuantity,
  isUnstatedValue,
  normalizePresentation,
  normalizeStrength,
  presentFormStrengths,
  presentRegistryLine,
  substanceWords,
} from '@/features/search/registry-values';

describe('registry strengths in reader words (STATE DOSE1, QA 0.6.60 item 4)', () => {
  it.each([
    ['1.0325 мг+10 мг+20 мг', '325 мг+10 мг+20 мг'],
    ['1.0 325 мг+10 мг+20 мг', '325 мг+10 мг+20 мг'],
    ['1.0650 мг+10 мг+20 мг', '650 мг+10 мг+20 мг'],
    ['1.0250 мг+65 мг+250 мг', '250 мг+65 мг+250 мг'],
    ['1.01.42 мг+18.26 мг+20 мг/мл', '1,42 мг+18,26 мг+20 мг/мл'],
    ['1.025 мг+1 мг+0.4 мг/мл', '25 мг+1 мг+0,4 мг/мл'],
  ])('%s is %s', (stored, shown) => {
    expect(normalizeStrength(stored)).toBe(shown);
  });

  it('leaves a real quantity of one alone', () => {
    expect(normalizeStrength('1.0мг/мл')).toBe('1 мг/мл');
    expect(normalizeStrength('1.0 мг')).toBe('1 мг');
    expect(normalizeStrength('1.05 мг')).toBe('1,05 мг');
    expect(dropPlaceholderQuantity('1.025 мг')).toBe('1.025 мг');
  });

  it('calls a dosage the registry does not state absent', () => {
    for (const value of ['НЕ УКАЗАНО', 'не указано', '~', '1.0~', '1.0 ~', '1.0НЕ УКАЗАНО', '']) {
      expect(isUnstatedValue(value)).toBe(true);
    }
    for (const value of ['500 мг', '1.0 мг', '325 мг+10 мг']) {
      expect(isUnstatedValue(value)).toBe(false);
    }
  });

  it('drops an unstated dosage from «форма (дозировка)» instead of printing it', () => {
    expect(normalizePresentation('ТАБЛЕТКИ ШИПУЧИЕ (НЕ УКАЗАНО)')).toBe('Таблетки шипучие');
    expect(normalizePresentation('ТАБЛЕТКИ (500 мг)')).toBe('Таблетки, 500 мг');
  });

  it('reads several forms of one pointer line, forms with commas included', () => {
    expect(
      presentFormStrengths(
        'ТАБЛЕТКИ, ПОКРЫТЫЕ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ (10 мг), КАПСУЛЫ (НЕ УКАЗАНО), КАПСУЛЫ (5 мг)',
      ),
    ).toBe('Таблетки, покрытые пленочной оболочкой, 10 мг; Капсулы; Капсулы, 5 мг');
  });

  it('names a combination of substances in a sentence', () => {
    expect(substanceWords('АМЛОДИПИН+ЛИЗИНОПРИЛ+РОЗУВАСТАТИН')).toBe(
      'амлодипин + лизиноприл + розувастатин',
    );
  });
});

describe('a registry line in reader words', () => {
  it('shows the strength of the node line without the placeholder and without НЕ УКАЗАНО', () => {
    expect(
      presentRegistryLine(
        '- СМНН: ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН; smnnCode: 21.20.10.232-000033-1-00013-0000000000000. Формы: ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ПРИЕМА ВНУТРЬ. Дозировки/концентрации: 1.0325 мг+10 мг+20 мг, 325 мг + 10 мг + 20 мг, НЕ УКАЗАНО.',
      ),
    ).toBe(
      '- Формы: Порошок для приготовления раствора для приема внутрь. Дозировки: 325 мг+10 мг+20 мг.',
    );
  });
});
