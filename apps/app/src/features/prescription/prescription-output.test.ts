import { describe, expect, it } from 'vitest';

import { renderFormPrintHtml } from '@/features/forms/form-print';
import { findFormSchema } from '@/features/forms/form-registry';
import { ADULT_AGE_DAYS } from './dose-population';
import {
  blankValues,
  FORM_107_ID,
  FORM_148_ID,
  isSingleNameAtc,
  type PrescribedLine,
  prescriptionBlock,
  recipeDate,
  recipeText,
  splitIntoBlanks,
} from './prescription-output';

function line(id: string, atcCodes: readonly string[] = ['J01CA04']): PrescribedLine {
  return {
    id,
    rp: `Tab. Name${id} 0,5 N 21`,
    signa: 'Внутрь по 1 таблетке 3 раза в день в течение 7 дней.',
    atcCodes,
  };
}

describe('splitting a prescription into blanks', () => {
  it('puts up to three names on one 107-1/у', () => {
    const blanks = splitIntoBlanks([line('1'), line('2'), line('3'), line('4')], FORM_107_ID);
    expect(blanks.map((blank) => blank.length)).toEqual([3, 1]);
  });

  it('keeps a psychotropic of paragraph 15 alone on its blank', () => {
    const blanks = splitIntoBlanks([line('1'), line('2', ['N05BA01']), line('3')], FORM_107_ID);
    expect(blanks.map((blank) => blank.map((item) => item.id))).toEqual([['1'], ['2'], ['3']]);
    expect(isSingleNameAtc(['N06AB03'])).toBe(true);
    expect(isSingleNameAtc(['N02BE01'])).toBe(false);
  });

  it('puts one name on a 148-1/у-88', () => {
    expect(
      splitIntoBlanks([line('1'), line('2')], FORM_148_ID).map((blank) => blank.length),
    ).toEqual([1, 1]);
  });
});

describe('the official blanks', () => {
  it('has the prescription fields the engine fills', () => {
    const schema107 = findFormSchema(FORM_107_ID);
    const schema148 = findFormSchema(FORM_148_ID);
    expect(schema107?.fields.map((field) => field.id)).toEqual(
      expect.arrayContaining(['prescription1', 'prescription2', 'prescription3']),
    );
    expect(schema148?.fields.map((field) => field.id)).toContain('prescription');
  });

  it('fills the Latin line and the signa of each name and prints them', () => {
    const schema = findFormSchema(FORM_107_ID);
    if (!schema) throw new Error('schema missing');
    const values = blankValues(schema, {}, [line('A'), line('B')], { ageDays: 6 * 365 });
    expect(values['prescription1']).toContain('Tab. NameA 0,5 N 21');
    expect(values['prescription1']).toContain('D.S. Внутрь по 1 таблетке');
    expect(values['prescription2']).toContain('Tab. NameB');
    expect(values['prescription3']).toBeUndefined();
    const html = renderFormPrintHtml(schema, values);
    expect(html).toContain('Tab. NameA 0,5 N 21');
    expect(html).toContain('Tab. NameB 0,5 N 21');
  });

  it('marks a child blank by the age and an adult blank otherwise', () => {
    const schema = findFormSchema(FORM_107_ID);
    if (!schema) throw new Error('schema missing');
    if (!schema.fields.some((field) => field.id === 'recipeKind')) return;
    expect(blankValues(schema, {}, [line('1')], { ageDays: 6 * 365 })['recipeKind']).toBe('child');
    expect(
      blankValues(schema, {}, [line('1')], { ageDays: ADULT_AGE_DAYS + 5 })['recipeKind'],
    ).toBe('adult');
    expect(blankValues(schema, {}, [line('1')], { ageDays: null })['recipeKind']).toBeUndefined();
  });

  it('fills the single field of the 148-1/у-88', () => {
    const schema = findFormSchema(FORM_148_ID);
    if (!schema) throw new Error('schema missing');
    const values = blankValues(schema, {}, [line('X')], { ageDays: null });
    expect(String(values['prescription'])).toContain('Tab. NameX');
  });
});

describe('the recipe text', () => {
  it('numbers the names and gives the sign under each', () => {
    const text = recipeText({ date: '13.10.2026', patient: 'Иванов И.И., 6 лет, 20 кг' }, [
      line('1'),
      line('2'),
    ]);
    expect(text.split('\n')).toEqual([
      'Рецепт · 13.10.2026',
      'Пациент: Иванов И.И., 6 лет, 20 кг',
      '',
      '1. Rp.: Tab. Name1 0,5 N 21',
      '   D.S. Внутрь по 1 таблетке 3 раза в день в течение 7 дней.',
      '',
      '2. Rp.: Tab. Name2 0,5 N 21',
      '   D.S. Внутрь по 1 таблетке 3 раза в день в течение 7 дней.',
    ]);
  });

  it('leaves out the patient and an empty sign', () => {
    const text = recipeText({ date: recipeDate(new Date(2026, 9, 13)), patient: null }, [
      { id: 'x', rp: 'Tab. Y 0,5', signa: ' ', atcCodes: [] },
    ]);
    expect(text).toBe('Рецепт · 13.10.2026\n\n1. Rp.: Tab. Y 0,5');
    expect(prescriptionBlock({ rp: 'Tab. Y 0,5', signa: '' })).toBe('Tab. Y 0,5');
  });
});
