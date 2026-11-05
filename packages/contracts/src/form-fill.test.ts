import { describe, expect, it } from 'vitest';

import { FormFillFormSchema, FormFillResultSchema } from './form-fill';

const form = {
  schemaVersion: 1,
  id: 'test.form',
  title: 'Проверка',
  sections: [{ id: 'main', title: 'Основное', fieldIds: ['age', 'season'] }],
  fields: [
    { id: 'age', label: 'Возраст', type: 'number', minimum: 0, maximum: 120, integer: true },
    {
      id: 'season',
      label: 'Сезон',
      type: 'choice',
      options: [
        { value: '1', label: 'зима', cues: ['зим~'] },
        { value: '2', label: 'лето' },
      ],
    },
  ],
};

describe('form-fill contract', () => {
  it('accepts a form whose every field is on one section', () => {
    expect(FormFillFormSchema.parse(form).fields).toHaveLength(2);
  });

  it('rejects options on non-choice fields, repeated options and stray fields', () => {
    const bad = (patch: object) => FormFillFormSchema.safeParse({ ...form, ...patch }).success;
    expect(
      bad({ fields: [{ ...form.fields[0], options: form.fields[1]?.options }, form.fields[1]] }),
    ).toBe(false);
    expect(
      bad({
        fields: [
          form.fields[0],
          {
            ...form.fields[1],
            options: [
              { value: '1', label: 'зима' },
              { value: '2', label: 'Зима' },
            ],
          },
        ],
      }),
    ).toBe(false);
    expect(bad({ sections: [{ id: 'main', title: 'Основное', fieldIds: ['age'] }] })).toBe(false);
    expect(bad({ fields: [{ ...form.fields[0], maxLength: 10 }, form.fields[1]] })).toBe(false);
  });

  it('keeps every field as a key, null when not discussed', () => {
    const quote = {
      source: 'transcript',
      startLine: 0,
      start: 0,
      endLine: 0,
      end: 5,
      text: 'Зимой',
    };
    const result = FormFillResultSchema.parse({
      schemaVersion: 1,
      formId: 'test.form',
      method: 'cues',
      fields: {
        age: null,
        season: {
          value: '1',
          origin: 'cues',
          evidence: [{ quote, speaker: { label: null, role: 'unknown' } }],
        },
      },
      rejected: [{ fieldId: 'age', code: 'value-not-in-quote' }],
    });
    expect(result.fields['age']).toBeNull();
    expect(
      FormFillResultSchema.safeParse({
        ...result,
        fields: { season: { ...result.fields['season'], evidence: [] } },
      }).success,
    ).toBe(false);
  });
});
