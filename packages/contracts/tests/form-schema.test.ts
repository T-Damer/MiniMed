import { describe, expect, it } from 'vitest';

import { type FormSchema, FormSchemaSchema, parseFormSchema } from '../src/form-schema';

const SHA = 'a'.repeat(64);

function minimalForm(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test.form',
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
    sections: [{ id: 'main', title: 'Главное', fieldIds: ['name'] }],
    fields: [
      {
        id: 'name',
        label: 'Фамилия',
        type: 'text',
        required: true,
        requiredBasis: 'source',
        prefill: { sources: ['patient.fullName'] },
        rule: { status: 'defined', paragraphIds: ['6.1'] },
      },
    ],
    rules: [
      {
        id: '6.1',
        text: '6.1. Указывается фамилия.',
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
      blocks: [
        {
          id: 'body',
          columns: [
            {
              widthPercent: 100,
              rows: [
                {
                  segments: [
                    { kind: 'text', text: 'Фамилия' },
                    { kind: 'field', fieldId: 'name', length: 30, grow: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function withField(form: Record<string, unknown>, patch: Record<string, unknown>): unknown {
  const fields = form['fields'] as Record<string, unknown>[];
  return { ...form, fields: [{ ...fields[0], ...patch }] };
}

describe('form schema contract', () => {
  it('accepts a form with a prefill binding declared in the schema', () => {
    const parsed: FormSchema = parseFormSchema(minimalForm());
    expect(parsed.fields[0]?.prefill?.sources).toEqual(['patient.fullName']);
  });

  it('rejects a prefill path the resolver does not know', () => {
    const bad = withField(minimalForm(), { prefill: { sources: ['patient.passport'] } });
    expect(FormSchemaSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a basis for a required field and a paragraph for a defined rule', () => {
    expect(
      FormSchemaSchema.safeParse(withField(minimalForm(), { requiredBasis: undefined })).success,
    ).toBe(false);
    expect(
      FormSchemaSchema.safeParse(
        withField(minimalForm(), { rule: { status: 'defined', paragraphIds: [] } }),
      ).success,
    ).toBe(false);
  });

  it('never invents a rule: an undefined rule cites no paragraph', () => {
    const cited = withField(minimalForm(), {
      rule: { status: 'undefined', paragraphIds: ['6.1'] },
    });
    expect(FormSchemaSchema.safeParse(cited).success).toBe(false);
    const honest = withField(minimalForm(), {
      rule: { status: 'undefined', paragraphIds: [], note: 'Порядок не определяет.' },
    });
    expect(FormSchemaSchema.safeParse(honest).success).toBe(true);
  });

  it('rejects a cited paragraph that the form does not carry', () => {
    const bad = withField(minimalForm(), { rule: { status: 'defined', paragraphIds: ['9.9'] } });
    expect(FormSchemaSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects choice fields without options and options on other types', () => {
    expect(FormSchemaSchema.safeParse(withField(minimalForm(), { type: 'choice' })).success).toBe(
      false,
    );
    expect(
      FormSchemaSchema.safeParse(
        withField(minimalForm(), { options: [{ value: '1', label: 'да' }] }),
      ).success,
    ).toBe(false);
  });

  it('keeps signatures and stamps on paper: no prefill', () => {
    const paper = withField(minimalForm(), {
      type: 'signature',
      required: false,
      requiredBasis: undefined,
      prefill: undefined,
    });
    expect(FormSchemaSchema.safeParse(paper).success).toBe(true);
    const prefilled = withField(minimalForm(), {
      type: 'signature',
      required: false,
      requiredBasis: undefined,
      prefill: { sources: ['today'] },
    });
    expect(FormSchemaSchema.safeParse(prefilled).success).toBe(false);
  });

  it('rejects layout and sections that cite unknown fields, and unprinted fields', () => {
    const form = minimalForm();
    const layout = form['layout'] as { blocks: { columns: { rows: unknown[] }[] }[] };
    const unknownInLayout = structuredClone(form);
    (unknownInLayout['layout'] as typeof layout).blocks[0]?.columns[0]?.rows.push({
      segments: [{ kind: 'check', fieldId: 'ghost' }],
    });
    expect(FormSchemaSchema.safeParse(unknownInLayout).success).toBe(false);
    expect(
      FormSchemaSchema.safeParse({
        ...form,
        sections: [{ id: 'main', title: 'Главное', fieldIds: ['ghost'] }],
      }).success,
    ).toBe(false);
    const unprinted = structuredClone(form);
    (unprinted['layout'] as typeof layout).blocks[0]?.columns[0]?.rows.splice(0, 1, {
      segments: [{ kind: 'text', text: 'Фамилия' }],
    });
    expect(FormSchemaSchema.safeParse(unprinted).success).toBe(false);
  });

  it('accepts only date fields with notAfter and valid patterns', () => {
    expect(
      FormSchemaSchema.safeParse(withField(minimalForm(), { notAfter: 'today' })).success,
    ).toBe(false);
    expect(FormSchemaSchema.safeParse(withField(minimalForm(), { pattern: '([' })).success).toBe(
      false,
    );
  });

  describe('layout extensions of the sanatorium cards and the talon', () => {
    function withBlocks(blocks: unknown[]): unknown {
      const form = minimalForm();
      const layout = form['layout'] as Record<string, unknown>;
      return { ...form, layout: { ...layout, blocks } };
    }
    const nameRow = {
      segments: [{ kind: 'field', fieldId: 'name', length: 30, lines: 3 }],
    };

    it('accepts a page break, a frame, ruled lines and a table whose cells are fields or captions', () => {
      const parsed = FormSchemaSchema.safeParse(
        withBlocks([
          {
            id: 'front',
            columns: [{ widthPercent: 100, rows: [nameRow] }],
          },
          {
            id: 'back',
            pageBreakBefore: true,
            framed: true,
            columns: [
              {
                widthPercent: 100,
                rows: [
                  {
                    segments: [
                      {
                        kind: 'table',
                        header: [],
                        rows: [[{ text: '25. Даты посещений' }, 'name']],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      );
      expect(parsed.success).toBe(true);
    });

    it('rejects a table that cites a field the form does not have', () => {
      const bad = withBlocks([
        {
          id: 'back',
          columns: [
            {
              widthPercent: 100,
              rows: [
                { segments: [{ kind: 'table', header: [[{ text: 'Дата' }]], rows: [['ghost']] }] },
              ],
            },
          ],
        },
        { id: 'front', columns: [{ widthPercent: 100, rows: [nameRow] }] },
      ]);
      expect(FormSchemaSchema.safeParse(bad).success).toBe(false);
    });

    it('rejects zero ruled lines', () => {
      const oneLine = withBlocks([
        {
          id: 'front',
          columns: [
            {
              widthPercent: 100,
              rows: [{ segments: [{ kind: 'field', fieldId: 'name', length: 30, lines: 0 }] }],
            },
          ],
        },
      ]);
      expect(FormSchemaSchema.safeParse(oneLine).success).toBe(false);
    });

    it('accepts a words binding on a full name and records captions confirmed on the scan', () => {
      const form = withField(minimalForm(), {
        prefill: { sources: ['patient.fullName'], words: { from: 1, count: 1 } },
      }) as Record<string, unknown>;
      const source = form['source'] as Record<string, unknown>;
      const extraction = source['extraction'] as Record<string, unknown>;
      const parsed = FormSchemaSchema.safeParse({
        ...form,
        source: { ...source, extraction: { ...extraction, captionsReviewedOnScan: ['дом'] } },
      });
      expect(parsed.success).toBe(true);
      expect(
        FormSchemaSchema.safeParse(
          withField(minimalForm(), {
            prefill: { sources: ['patient.fullName'], words: { from: -1 } },
          }),
        ).success,
      ).toBe(false);
    });

    it('knows the citizenship and workplace bindings', () => {
      for (const path of ['patient.citizenship', 'patient.workplace']) {
        expect(
          FormSchemaSchema.safeParse(withField(minimalForm(), { prefill: { sources: [path] } }))
            .success,
        ).toBe(true);
      }
    });
  });
});
