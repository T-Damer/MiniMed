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

  it('waits for the instruction while it is read, and never refuses without one', () => {
    expect(recipeMissingText([row({ state: 'loading' })])).toBe('Читаем инструкцию…');
    // SRCHDRUG1: no instruction is no refusal — the Rp. line is the registry's, the sign the doctor's.
    for (const state of ['not-installed', 'no-instruction'] as const) {
      const text = recipeMissingText([row({ state })]);
      expect(text).toContain('Впишите');
      expect(text).not.toMatch(/не из чего|скачайте/u);
    }
  });
});
