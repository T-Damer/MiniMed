import { describe, expect, it } from 'vitest';

import type { ExternalAssessmentVariant } from '@/features/assessments/external-assessment';
import {
  isAcceptedExternalAssessmentMaterial,
  parseExternalAssessmentValues,
} from '@/features/assessments/external-assessment';

const mmseVariant: ExternalAssessmentVariant = {
  id: 'mmse',
  label: 'MMSE',
  shortLabel: 'MMSE',
  description: 'External MMSE result.',
  audience: 'Adults',
  resultFields: [
    {
      id: 'total_score',
      kind: 'number',
      label: 'Общий балл',
      required: true,
      minimum: 0,
      maximum: 30,
      integer: true,
    },
    {
      id: 'edition',
      kind: 'text',
      label: 'Редакция',
      required: false,
      multiline: false,
    },
  ],
};

describe('external assessment validation', () => {
  it('accepts MMSE boundary values and parses comma decimal input when allowed', () => {
    expect(parseExternalAssessmentValues(mmseVariant, { total_score: '0' })).toEqual({
      ok: true,
      values: { total_score: 0 },
    });
    expect(parseExternalAssessmentValues(mmseVariant, { total_score: '30' })).toEqual({
      ok: true,
      values: { total_score: 30 },
    });

    const percentileVariant: ExternalAssessmentVariant = {
      ...mmseVariant,
      resultFields: [
        {
          id: 'percentile',
          kind: 'number',
          label: 'Процентиль',
          required: true,
          minimum: 0,
          maximum: 100,
          integer: false,
        },
      ],
    };
    expect(parseExternalAssessmentValues(percentileVariant, { percentile: '82,5' })).toEqual({
      ok: true,
      values: { percentile: 82.5 },
    });
  });

  it('rejects missing, out-of-range and non-integer MMSE totals', () => {
    expect(parseExternalAssessmentValues(mmseVariant, {})).toMatchObject({
      ok: false,
      error: 'Заполните поле «Общий балл».',
    });
    expect(parseExternalAssessmentValues(mmseVariant, { total_score: '31' })).toMatchObject({
      ok: false,
      error: '«Общий балл» не может быть больше 30.',
    });
    expect(parseExternalAssessmentValues(mmseVariant, { total_score: '29.5' })).toMatchObject({
      ok: false,
      error: '«Общий балл» должно быть целым числом.',
    });
  });

  it('validates schema-declared select options', () => {
    const variant: ExternalAssessmentVariant = {
      ...mmseVariant,
      resultFields: [
        {
          id: 'band',
          kind: 'select',
          label: 'Категория',
          required: true,
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        },
      ],
    };
    expect(parseExternalAssessmentValues(variant, { band: 'b' })).toEqual({
      ok: true,
      values: { band: 'b' },
    });
    expect(parseExternalAssessmentValues(variant, { band: 'c' })).toMatchObject({
      ok: false,
      error: 'Выберите допустимое значение для «Категория».',
    });
  });

  it('accepts declared local material MIME types and safe extension fallback', () => {
    const accepted = ['application/pdf', 'image/jpeg', 'image/png'];
    expect(
      isAcceptedExternalAssessmentMaterial(
        { name: 'raven.pdf', type: 'application/pdf' },
        accepted,
      ),
    ).toBe(true);
    expect(isAcceptedExternalAssessmentMaterial({ name: 'page.JPG', type: '' }, accepted)).toBe(
      true,
    );
    expect(
      isAcceptedExternalAssessmentMaterial(
        { name: 'page.jpeg', type: 'application/octet-stream' },
        accepted,
      ),
    ).toBe(true);
    expect(
      isAcceptedExternalAssessmentMaterial({ name: 'notes.txt', type: 'text/plain' }, accepted),
    ).toBe(false);
  });
});
