import { describe, expect, it } from 'vitest';

import { FormRuleParagraphSchema, FormSegmentSchema } from '../src/form-schema';

describe('form layout: ruled tables', () => {
  it('accepts a body row height for a table that is ruled on the blank', () => {
    const table = FormSegmentSchema.parse({
      kind: 'table',
      header: [],
      rows: [[{ text: 'Осмотр врачом-неврологом' }, 'resultNeurologist']],
      columnWeights: [1, 1],
      rowHeightMm: 8.5,
    });
    expect(table).toMatchObject({ kind: 'table', rowHeightMm: 8.5 });
  });

  it('rejects a zero or absurd row height', () => {
    const base = { kind: 'table', header: [], rows: [['a']] };
    expect(FormSegmentSchema.safeParse({ ...base, rowHeightMm: 0 }).success).toBe(false);
    expect(FormSegmentSchema.safeParse({ ...base, rowHeightMm: 200 }).success).toBe(false);
  });
});

describe('form rules: sub-items numbered «1)» under an item', () => {
  const paragraph = {
    id: '6.1',
    text: '1) в строке 1 указываются фамилия, имя, отчество (при наличии);',
    spans: [{ pdfPage: 12, firstLine: 40, lastLine: 41 }],
    textSha256: 'a'.repeat(64),
  };

  it('keeps the printed designation next to the id', () => {
    expect(FormRuleParagraphSchema.parse({ ...paragraph, clause: '6, подпункт 1' })).toMatchObject({
      id: '6.1',
      clause: '6, подпункт 1',
    });
  });

  it('still rejects a free-form clause', () => {
    expect(FormRuleParagraphSchema.safeParse({ ...paragraph, clause: 'item six' }).success).toBe(
      false,
    );
  });
});
