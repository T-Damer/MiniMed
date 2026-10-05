import { describe, expect, it } from 'vitest';

import { FormRowSchema, FormSchemaSchema, FormSegmentSchema } from '../src/form-schema';

describe('layout vocabulary of the prescription blanks', () => {
  it('accepts indents, plain and dotted blanks, character cells and a numeric pitch', () => {
    const field = FormSegmentSchema.parse({
      kind: 'field',
      fieldId: 'rp',
      length: 40,
      lines: 5,
      lineStyle: 'dotted',
      pitch: 4.1,
      plain: true,
      indentMm: 12,
      charCells: { count: 21, widthMm: 6.3, heightMm: 8.6 },
    });
    expect(field.kind === 'field' && field.charCells?.count).toBe(21);
    expect(
      FormSegmentSchema.safeParse({ kind: 'field', fieldId: 'a', length: 1, pitch: 'text' })
        .success,
    ).toBe(true);
    expect(
      FormSegmentSchema.safeParse({ kind: 'field', fieldId: 'a', length: 1, pitch: 'wide' })
        .success,
    ).toBe(false);
    expect(
      FormSegmentSchema.safeParse({ kind: 'field', fieldId: 'a', length: 1, pitch: 1 }).success,
    ).toBe(false);
  });

  it('accepts a monthNumber date part and refuses an unknown one', () => {
    expect(
      FormSegmentSchema.safeParse({ kind: 'field', fieldId: 'd', length: 2, part: 'monthNumber' })
        .success,
    ).toBe(true);
    expect(
      FormSegmentSchema.safeParse({ kind: 'field', fieldId: 'd', length: 2, part: 'week' }).success,
    ).toBe(false);
  });

  it('accepts underlined, large and indented text, dashed rules and stamps with an indent', () => {
    expect(
      FormSegmentSchema.safeParse({
        kind: 'text',
        text: 'от',
        underline: true,
        large: true,
        indentMm: 3,
      }).success,
    ).toBe(true);
    expect(
      FormSegmentSchema.safeParse({
        kind: 'rule',
        length: 40,
        grow: true,
        lineStyle: 'dashed',
        indentMm: 2,
      }).success,
    ).toBe(true);
    expect(
      FormSegmentSchema.safeParse({ kind: 'rule', length: 40, lineStyle: 'wavy' }).success,
    ).toBe(false);
    expect(
      FormSegmentSchema.safeParse({ kind: 'stamp', fieldId: 'seal', text: 'М.П.', indentMm: 68.7 })
        .success,
    ).toBe(true);
  });

  it('bounds the row heights and the padding of a boxed row', () => {
    const row = {
      segments: [{ kind: 'text', text: 'Отметка' }],
      minHeightMm: 27.5,
      heightMm: 3.4,
      paddingTopMm: 2.2,
    };
    expect(FormRowSchema.safeParse(row).success).toBe(true);
    expect(FormRowSchema.safeParse({ ...row, heightMm: 500 }).success).toBe(false);
    expect(FormRowSchema.safeParse({ ...row, paddingTopMm: -1 }).success).toBe(false);
  });

  it('declares the surname-and-initials format in a prefill binding and no other format', () => {
    const shape = FormSchemaSchema.shape.fields.element.shape.prefill;
    expect(shape.safeParse({ sources: ['clinician.fullName'], format: 'initials' }).success).toBe(
      true,
    );
    expect(shape.safeParse({ sources: ['clinician.fullName'], format: 'upper' }).success).toBe(
      false,
    );
  });
});
