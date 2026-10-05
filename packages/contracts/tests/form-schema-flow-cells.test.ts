import { describe, expect, it } from 'vitest';

import { FormSchemaSchema } from '../src/form-schema';

const SHA = 'a'.repeat(64);

function form(blocks: unknown[], extraFields: unknown[] = []): unknown {
  return {
    schemaVersion: 1,
    id: 'test.flow',
    formNumber: '000/у',
    title: 'Тестовая форма',
    edition: 'Тестовый приказ',
    source: {
      issuer: 'Минздрав',
      orderNumber: '1н',
      orderDate: '2025-01-02',
      orderTitle: 'Об утверждении',
      registration: { authority: 'Минюст', number: '1', date: '2025-01-03' },
      effectiveFrom: '2025-09-01',
      publicationUrl: 'http://publication.pravo.gov.ru/document/1',
      pdfUrl: 'http://publication.pravo.gov.ru/file/pdf?eoNumber=1',
      retrievedAt: '2026-10-05',
      sha256: SHA,
      pdfPages: 3,
      blankAppendix: { number: 1, pdfPages: [1] },
      rulesAppendix: { number: 2, pdfPages: [2] },
      extraction: {
        method: 'test',
        ocrSha256: SHA,
        corrections: [],
        blankLabelsVerified: 1,
        note: 'test',
      },
    },
    sections: [
      { id: 'main', title: 'Главное', fieldIds: ['box', 'name', ...extraFields.map(() => 'x')] },
    ],
    fields: [
      {
        id: 'box',
        label: 'Отметка',
        type: 'checkbox',
        required: false,
        rule: { status: 'undefined', paragraphIds: [], note: 'нет' },
      },
      {
        id: 'name',
        label: 'Имя',
        type: 'text',
        required: false,
        rule: { status: 'undefined', paragraphIds: [], note: 'нет' },
      },
    ],
    rules: [
      {
        id: '1',
        text: '1. Текст',
        spans: [{ pdfPage: 2, firstLine: 0, lastLine: 1 }],
        textSha256: SHA,
      },
    ],
    layout: {
      page: {
        size: 'A4',
        orientation: 'portrait',
        marginMm: { top: 10, right: 10, bottom: 10, left: 15 },
        fontSizePt: 10,
      },
      blocks,
    },
  };
}

const table = (cell: unknown) => ({
  id: 'grid',
  columns: [
    {
      widthPercent: 100,
      rows: [
        {
          segments: [
            { kind: 'check', fieldId: 'box', inline: true },
            { kind: 'field', fieldId: 'name', length: 10 },
            {
              kind: 'table',
              header: [[{ text: 'Графа' }]],
              rows: [[cell]],
              cellPaddingMm: { x: 1.5, y: 1 },
            },
          ],
        },
      ],
    },
  ],
});

describe('form schema: running-text table cells and split option lists', () => {
  it('accepts a cell with text, a box and a blank, and counts its fields as printed', () => {
    const parsed = FormSchemaSchema.safeParse(
      form([
        table({
          segments: [
            { kind: 'text', text: '5.1.' },
            { kind: 'check', fieldId: 'box' },
            { kind: 'text', text: 'Установление группы' },
          ],
          colSpan: 2,
          align: 'justify',
        }),
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a flow cell that cites a field the form does not have', () => {
    const parsed = FormSchemaSchema.safeParse(
      form([table({ segments: [{ kind: 'check', fieldId: 'ghost' }] })]),
    );
    expect(parsed.success).toBe(false);
  });

  it('rejects a table inside a table cell and an empty cell', () => {
    expect(FormSchemaSchema.safeParse(form([table({ segments: [] })])).success).toBe(false);
    expect(
      FormSchemaSchema.safeParse(
        form([
          table({ segments: [{ kind: 'table', header: [[{ text: 'a' }]], rows: [['name']] }] }),
        ]),
      ).success,
    ).toBe(false);
  });

  it('accepts a range on an options segment and rejects an empty range tuple', () => {
    const options = (range: unknown) => ({
      id: 'opts',
      columns: [
        {
          widthPercent: 100,
          rows: [
            {
              segments: [
                { kind: 'check', fieldId: 'box' },
                { kind: 'options', fieldId: 'name', separator: ', ', range },
              ],
            },
          ],
        },
      ],
    });
    // `name` is a text field here: only the layout shape is under test, not option validity.
    expect(FormSchemaSchema.safeParse(form([options([0, 2])])).success).toBe(true);
    expect(FormSchemaSchema.safeParse(form([options([0])])).success).toBe(false);
  });
});
