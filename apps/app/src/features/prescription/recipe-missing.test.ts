import { describe, expect, it } from 'vitest';

import { recipeMissingText } from './recipe-missing';

type Row = Parameters<typeof recipeMissingText>[0][number];
const row = (patch: Partial<Row>): Row => ({
  state: 'ready',
  form: 'таблетки',
  strength: '500 мг',
  rp: '',
  ...patch,
});

describe('what the recipe sheet says is missing', () => {
  it('asks for a drug first, then the form, then the strength', () => {
    expect(recipeMissingText([])).toContain('Добавьте препарат');
    expect(recipeMissingText([row({ state: 'pick-drug', form: null, strength: null })])).toContain(
      'Выберите препарат',
    );
    expect(recipeMissingText([row({ form: null, strength: null })])).toContain(
      'Выберите лекарственную форму',
    );
    expect(recipeMissingText([row({ strength: null })])).toContain('Выберите дозировку');
  });

  it('names the instruction when the product is chosen but the text cannot be read', () => {
    expect(recipeMissingText([row({ state: 'loading' })])).toBe('Читаем инструкцию…');
    expect(recipeMissingText([row({ state: 'not-installed' })])).toContain('скачайте её');
    expect(recipeMissingText([row({ state: 'no-instruction' })])).toContain('нет в источниках');
  });
});
