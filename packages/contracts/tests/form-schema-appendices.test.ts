import { describe, expect, it } from 'vitest';

import { FormSchemaSchema } from '../src/form-schema';

const SHA = 'a'.repeat(64);

/** A form whose requirements sit in two appendices of the order (1094н: appendices 1 and 3). */
function twoAppendixForm(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test.rx',
    formNumber: '000-1/у',
    title: 'Тестовый бланк',
    edition: 'Тестовый приказ',
    source: {
      issuer: 'Минздрав',
      orderNumber: '1094н',
      orderDate: '2021-11-24',
      orderTitle: 'Об утверждении',
      registration: { authority: 'Минюст', number: '66124', date: '2021-11-30' },
      effectiveFrom: '2022-03-01',
      publicationUrl: 'http://publication.pravo.gov.ru/document/1',
      pdfUrl: 'http://publication.pravo.gov.ru/file/pdf?eoNumber=1',
      retrievedAt: '2026-10-05',
      sha256: SHA,
      pdfPages: 43,
      blankAppendix: { number: 2, pdfPages: [23] },
      rulesAppendix: { number: 3, pdfPages: [27] },
      extraction: {
        method: 'test',
        ocrSha256: SHA,
        corrections: [],
        blankLabelsVerified: 1,
        note: 'n',
      },
    },
    sections: [{ id: 'main', title: 'Главное', fieldIds: ['name'] }],
    fields: [
      {
        id: 'name',
        label: 'Фамилия',
        type: 'text',
        required: false,
        rule: { status: 'defined', paragraphIds: ['3.6', '1.6'] },
      },
    ],
    rules: [
      {
        id: '1.6',
        clause: '6',
        appendix: { number: 1, title: 'Порядок назначения лекарственных препаратов' },
        text: '6. Назначение оформляется на имя пациента.',
        spans: [{ pdfPage: 8, firstLine: 20, lastLine: 22 }],
        textSha256: SHA,
      },
      {
        id: '3.6',
        clause: '6',
        appendix: { number: 3, title: 'Порядок оформления рецептурных бланков' },
        text: '6. Указываются фамилия и инициалы.',
        spans: [{ pdfPage: 28, firstLine: 14, lastLine: 17 }],
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
      blocks: [
        {
          id: 'body',
          columns: [
            {
              widthPercent: 100,
              rows: [{ segments: [{ kind: 'field', fieldId: 'name', length: 30 }] }],
            },
          ],
        },
      ],
    },
  };
}

describe('rule paragraphs from several appendices', () => {
  it('accepts paragraphs that name their appendix and the clause printed in it', () => {
    const parsed = FormSchemaSchema.parse(twoAppendixForm());
    expect(parsed.rules.map((rule) => [rule.id, rule.appendix?.number, rule.clause])).toEqual([
      ['1.6', 1, '6'],
      ['3.6', 3, '6'],
    ]);
  });

  it('keeps single-appendix schemas valid: appendix and clause are optional', () => {
    const form = twoAppendixForm();
    form['rules'] = [
      {
        id: '6.1',
        text: '6.1. Указывается фамилия.',
        spans: [{ pdfPage: 2, firstLine: 0, lastLine: 1 }],
        textSha256: SHA,
      },
    ];
    (form['fields'] as Record<string, unknown>[])[0] = {
      id: 'name',
      label: 'Фамилия',
      type: 'text',
      required: false,
      rule: { status: 'defined', paragraphIds: ['6.1'] },
    };
    expect(FormSchemaSchema.safeParse(form).success).toBe(true);
  });

  it('rejects a clause that is not a paragraph number', () => {
    const form = twoAppendixForm();
    const rules = form['rules'] as Record<string, unknown>[];
    rules[0] = { ...rules[0], clause: 'п. шесть' };
    expect(FormSchemaSchema.safeParse(form).success).toBe(false);
  });
});
