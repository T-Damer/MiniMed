import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CalculatorSchemaSchema, FormFillResultSchema, parseFormSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import {
  acceptedFormFillValues,
  buildFormFillResult,
  decideFormFillValue,
  emptyFormFillReview,
  type FormFillModel,
  type FormFillModelRequest,
  fillFormWithCues,
  fillFormWithModel,
  formFillChunks,
  formFillFromAssessment,
  formFillFromCalculator,
  formFillFromOfficialForm,
  formFillHasCues,
  formFillOverlayFor,
  formFillReviewItems,
  formFillValueLabel,
  mentionsNumber,
  russianNumberWords,
  speakerOfLine,
  spokenNumbers,
} from './index';

const ROOT = resolve(import.meta.dirname, '../../../..');
const readJson = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as unknown;

function toolDefinition(module: string, id: string): unknown {
  const pack = readJson(`content/tool-modules/${module}.json`) as {
    readonly tools: readonly { readonly id: string; readonly definition: unknown }[];
  };
  const tool = pack.tools.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`no tool ${id}`);
  return tool.definition;
}

const cha2ds2 = formFillFromCalculator(
  CalculatorSchemaSchema.parse(toolDefinition('core-clinical', 'minimed.calculator.cha2ds2-vasc')),
  formFillOverlayFor('minimed.calculator.cha2ds2-vasc'),
);
const form070 = formFillFromOfficialForm(
  parseFormSchema(readJson('apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json')),
  formFillOverlayFor('ru.minzdrav.274n.070u'),
);

/** Synthetic conversation written for the test (no patient data). */
const AF_VISIT = [
  'Врач: Здравствуйте. Сколько вам лет?',
  'Пациент: Семьдесят два.',
  'Врач: Давление повышается?',
  'Пациент: Да, гипертония лет десять, пью лизиноприл.',
  'Врач: Сахарный диабет есть?',
  'Пациент: Нет.',
  'Врач: Инсульты, микроинсульты были?',
  'Пациент: Не было. У мамы был инсульт в восемьдесят.',
  'Врач: Инфаркт переносили?',
  'Пациент: Нет, сердце не болит.',
];

describe('spoken numbers', () => {
  it('reads Russian number words and digits', () => {
    expect(spokenNumbers('Мне семьдесят два года').map((n) => n.value)).toEqual([72]);
    expect(spokenNumbers('давление сто пятьдесят на девяносто').map((n) => n.value)).toEqual([
      150, 90,
    ]);
    expect(spokenNumbers('в две тысячи двадцать шестом').map((n) => n.value)[0]).toBe(2020);
    expect(spokenNumbers('две тысячи двадцать шесть').map((n) => n.value)).toEqual([2026]);
    expect(spokenNumbers('температура 37,2').map((n) => n.value)).toEqual([37.2]);
    expect(spokenNumbers('пять шесть раз').map((n) => n.value)).toEqual([5, 6]);
    expect(spokenNumbers('двадцать пятнадцать').map((n) => n.value)).toEqual([20, 15]);
    expect(mentionsNumber('Пациент: Семьдесят два.', 72)).toBe(true);
    expect(mentionsNumber('Пациент: Семьдесят.', 72)).toBe(false);
  });

  it('spells whole numbers for the line check', () => {
    expect(russianNumberWords(72)).toBe('семьдесят два');
    expect(russianNumberWords(115)).toBe('сто пятнадцать');
    expect(russianNumberWords(1000)).toBeNull();
    const age = cha2ds2.form.fields[0];
    const diabetes = cha2ds2.form.fields[3];
    if (!age || !diabetes) throw new Error('fields');
    expect(formFillValueLabel(age, 72.5)).toBe('72,5');
    expect(formFillValueLabel(diabetes, false)).toBe('Нет');
  });
});

describe('speakers', () => {
  it('reads the label a line starts with', () => {
    expect(speakerOfLine('Врач: Как вы?')).toEqual({ label: 'Врач', role: 'clinician' });
    expect(speakerOfLine('[00:12] Пациентка: Плохо.')).toEqual({
      label: 'Пациентка',
      role: 'patient',
    });
    expect(speakerOfLine('Мама: Кашляет ночью.')).toEqual({ label: 'Мама', role: 'companion' });
    expect(speakerOfLine('Спикер 2: да')).toEqual({ label: 'Спикер 2', role: 'unknown' });
    expect(speakerOfLine('Кашляет ночью.')).toEqual({ label: null, role: 'unknown' });
  });
});

describe('adapters', () => {
  it('turns the CHA₂DS₂-VASc inputs into typed fields with a way back', () => {
    const types = Object.fromEntries(cha2ds2.form.fields.map((field) => [field.id, field.type]));
    expect(types).toEqual({
      ageYears: 'number',
      heartFailure: 'boolean',
      hypertension: 'boolean',
      diabetes: 'boolean',
      strokeTia: 'boolean',
      vascularDisease: 'boolean',
      femaleSex: 'boolean',
    });
    expect(cha2ds2.form.fields[0]).toMatchObject({ minimum: 18, maximum: 120 });
    expect(cha2ds2.toSourceValue('hypertension', true)).toBe(1);
    expect(cha2ds2.toSourceValue('hypertension', false)).toBe(0);
    expect(cha2ds2.toSourceValue('ageYears', 72)).toBe(72);
  });

  it('keeps the conversation fields of 070/у and maps them back to the blank', () => {
    const byId = new Map(form070.form.fields.map((field) => [field.id, field]));
    expect([...byId.keys()]).toEqual([
      'escort',
      'diagnosis',
      'comorbidities',
      'disabilityCause',
      'noContraindications',
      'treatmentSetting',
      'preferredPlace',
      'seasons',
    ]);
    expect(byId.get('seasons')?.type).toBe('multi-choice');
    expect(byId.get('escort')?.type).toBe('boolean');
    expect(byId.get('treatmentSetting')?.options?.map((option) => option.value)).toEqual([
      '1',
      '2',
    ]);
    expect(form070.toSourceValue('escort', true)).toBe('1');
    expect(form070.toSourceValue('seasons', ['2', '3'])).toEqual(['2', '3']);
    expect(form070.form.sections.map((section) => section.id)).toEqual([
      'social',
      'diagnoses',
      'recommendation',
    ]);
  });

  it('turns a questionnaire into one choice per question', () => {
    const phq9 = formFillFromAssessment(
      toolDefinition('psychology', 'minimed.assessment.phq-9') as never,
      formFillOverlayFor('minimed.assessment.phq-9'),
    );
    expect(phq9.form.fields).toHaveLength(10);
    expect(phq9.form.fields[0]?.options?.map((option) => option.label)).toEqual([
      'Ни разу',
      'Несколько дней',
      'Более недели',
      'Почти каждый день',
    ]);
    expect(phq9.toSourceValue('phq9-01', '3')).toBe(3);
    expect(formFillChunks(phq9.form).map((chunk) => chunk.length)).toEqual([4, 4, 1, 1]);
    // The conversation entry is offered only where the fallback can fill something.
    expect(formFillHasCues(phq9.form)).toBe(true);
    expect(formFillHasCues(cha2ds2.form)).toBe(true);
    expect(formFillHasCues(form070.form)).toBe(true);
  });

  it('does not let a shared answer scale tie an answer to another question', () => {
    const phq9 = formFillFromAssessment(
      toolDefinition('psychology', 'minimed.assessment.phq-9') as never,
      formFillOverlayFor('minimed.assessment.phq-9'),
    );
    const lines = [
      'Врач: Как часто вам не хотелось ничего делать?',
      'Пациент: Почти каждый день, ничего не радует.',
      'Врач: Мысли, что лучше было бы умереть?',
      'Пациент: Нет, ни разу.',
    ];
    const result = buildFormFillResult(
      phq9.form,
      lines,
      [
        {
          fieldId: 'phq9-01',
          value: 'Почти каждый день',
          citation: { kind: 'lines', lines: [1, 2] },
        },
        // The scale's wording matches line 2, but line 2 is not about item 9.
        { fieldId: 'phq9-09', value: 'Почти каждый день', citation: { kind: 'lines', lines: [2] } },
        // The question alone, unanswered in the quote.
        { fieldId: 'phq9-09', value: 'Несколько дней', citation: { kind: 'lines', lines: [3] } },
        { fieldId: 'phq9-09', value: 'Ни разу', citation: { kind: 'lines', lines: [3, 4] } },
      ],
      'model',
    );
    expect(result.fields['phq9-01']?.value).toBe('3');
    expect(result.fields['phq9-09']?.value).toBe('0');
    expect(result.rejected).toEqual([
      { fieldId: 'phq9-09', code: 'line-unrelated' },
      { fieldId: 'phq9-09', code: 'value-not-in-quote' },
    ]);
  });
});

describe('cue fallback', () => {
  it('fills CHA₂DS₂-VASc from questions, answers and statements, each on its quote', () => {
    const result = fillFormWithCues(cha2ds2.form, AF_VISIT);
    expect(FormFillResultSchema.parse(result)).toEqual(result);
    const values = Object.fromEntries(
      Object.entries(result.fields).map(([id, proposal]) => [id, proposal?.value ?? null]),
    );
    expect(values).toEqual({
      ageYears: 72,
      heartFailure: null,
      hypertension: true,
      diabetes: false,
      // «Не было» answers the question. The mother's stroke after it is not taken: its line opens
      // with that «Не было».
      strokeTia: false,
      vascularDisease: false,
      femaleSex: null,
    });
    expect(result.fields['ageYears']?.evidence[0]).toMatchObject({
      quote: { startLine: 0, endLine: 1, text: 'Сколько вам лет? Пациент: Семьдесят два' },
      speaker: { label: 'Пациент', role: 'patient' },
    });
    expect(result.rejected).toContainEqual({ fieldId: 'strokeTia', code: 'value-not-in-quote' });
    for (const proposal of Object.values(result.fields)) {
      for (const { quote } of proposal?.evidence ?? []) {
        const source = AF_VISIT.slice(quote.startLine, quote.endLine + 1).join('\n');
        expect(source.replaceAll('\n', ' ')).toContain(quote.text);
      }
    }
  });

  it('fills a questionnaire item only with an answer about its topic', () => {
    const phq9 = formFillFromAssessment(
      toolDefinition('psychology', 'minimed.assessment.phq-9') as never,
      formFillOverlayFor('minimed.assessment.phq-9'),
    );
    const lines = [
      'Врач: Как часто за две недели было плохое настроение?',
      'Пациент: Почти каждый день.',
      'Врач: Со сном что?',
      'Пациент: Засыпаю плохо, но это несколько дней было, не постоянно.',
      'Пациент: Аппетит нормальный, ни разу не пропадал.',
      'Врач: Мысли о смерти бывали?',
      'Пациент: Не знаю, сложно сказать.',
    ];
    const result = fillFormWithCues(phq9.form, lines);
    const values = Object.fromEntries(
      Object.entries(result.fields).flatMap(([id, proposal]) =>
        proposal ? [[id, proposal.value]] : [],
      ),
    );
    // «не постоянно» is not «постоянно»; item 9 got no frequency, so it stays empty.
    expect(values).toEqual({ 'phq9-02': '3', 'phq9-03': '1', 'phq9-05': '0' });
    expect(result.fields['phq9-02']?.evidence[0]?.quote.text).toBe(
      'Как часто за две недели было плохое настроение? Пациент: Почти каждый день',
    );
  });

  it('fills 070/у text, choice and multi-choice fields', () => {
    const lines = [
      'Врач: Диагноз: гипертоническая болезнь второй стадии.',
      'Врач: Сопутствующие: остеохондроз поясничного отдела.',
      'Врач: Противопоказаний нет. Рекомендую амбулаторно, курсовку.',
      'Пациент: Хотела бы в Кисловодск.',
      'Врач: Лучше весной или осенью, летом там жарко.',
    ];
    const result = fillFormWithCues(form070.form, lines);
    const values = Object.fromEntries(
      Object.entries(result.fields).map(([id, proposal]) => [id, proposal?.value ?? null]),
    );
    expect(values).toMatchObject({
      diagnosis: 'гипертоническая болезнь второй стадии',
      comorbidities: 'остеохондроз поясничного отдела',
      noContraindications: true,
      treatmentSetting: '2',
      preferredPlace: 'Кисловодск',
      escort: null,
    });
    // «летом там жарко» is said too: the cue matcher takes it as a season — the doctor turns it down.
    expect(values['seasons']).toEqual(['2', '3', '4']);
  });
});

describe('result builder', () => {
  const form = cha2ds2.form;
  const build = (candidates: Parameters<typeof buildFormFillResult>[2]) =>
    buildFormFillResult(form, AF_VISIT, candidates, 'model');

  it('keeps a typed value on its cited lines and says who said it', () => {
    const result = build([
      { fieldId: 'hypertension', value: true, citation: { kind: 'lines', lines: [3, 4] } },
      { fieldId: 'diabetes', value: false, citation: { kind: 'lines', lines: [5, 6] } },
    ]);
    expect(result.fields['hypertension']).toMatchObject({
      value: true,
      origin: 'model',
      evidence: [{ quote: { startLine: 2, endLine: 3 }, speaker: { role: 'patient' } }],
    });
    expect(result.fields['diabetes']?.value).toBe(false);
    expect(result.rejected).toEqual([]);
  });

  it('drops values that do not fit or that the quote does not carry', () => {
    const result = build([
      { fieldId: 'ageYears', value: 70, citation: { kind: 'lines', lines: [1, 2] } },
      { fieldId: 'ageYears', value: 7, citation: { kind: 'lines', lines: [2] } },
      { fieldId: 'diabetes', value: true, citation: { kind: 'lines', lines: [10] } },
      { fieldId: 'diabetes', value: 'может быть', citation: { kind: 'lines', lines: [5] } },
      { fieldId: 'strokeTia', value: false, citation: { kind: 'lines', lines: [1] } },
      { fieldId: 'vascularDisease', value: true, citation: { kind: 'lines', lines: [99] } },
      { fieldId: 'heartFailure', value: true, citation: { kind: 'lines', lines: undefined } },
      { fieldId: 'pulse', value: 80, citation: { kind: 'lines', lines: [1] } },
      {
        fieldId: 'hypertension',
        value: true,
        citation: { kind: 'quote', quote: 'гипертония лет десять' },
      },
      {
        fieldId: 'hypertension',
        value: false,
        citation: { kind: 'quote', quote: 'Давление повышается' },
      },
    ]);
    expect(result.rejected).toEqual([
      { fieldId: 'ageYears', code: 'value-not-in-quote' },
      { fieldId: 'ageYears', code: 'out-of-range' },
      { fieldId: 'diabetes', code: 'line-unrelated' },
      { fieldId: 'diabetes', code: 'invalid-value' },
      { fieldId: 'strokeTia', code: 'line-unrelated' },
      { fieldId: 'vascularDisease', code: 'line-not-found' },
      { fieldId: 'heartFailure', code: 'missing-citation' },
      { code: 'unknown-field' },
      // «нет» on words that hold no negation.
      { fieldId: 'hypertension', code: 'value-not-in-quote' },
    ]);
    expect(result.fields['hypertension']?.evidence[0]?.quote.text).toBe('гипертония лет десять');
    expect(result.fields['ageYears']).toBeNull();
  });

  it('does not take a denial as the positive value', () => {
    const result = build([
      { fieldId: 'vascularDisease', value: true, citation: { kind: 'lines', lines: [9, 10] } },
    ]);
    expect(result.rejected).toEqual([{ fieldId: 'vascularDisease', code: 'value-not-in-quote' }]);
  });

  it('maps option labels to values and merges multi-choice answers', () => {
    const lines = ['Врач: Рекомендую весной.', 'Врач: Можно и осенью.', 'Врач: Амбулаторно.'];
    const result = buildFormFillResult(
      form070.form,
      lines,
      [
        { fieldId: 'seasons', value: ['весна'], citation: { kind: 'lines', lines: [1] } },
        { fieldId: 'seasons', value: ['Осень'], citation: { kind: 'lines', lines: [2] } },
        {
          fieldId: 'treatmentSetting',
          value: 'амбулаторно',
          citation: { kind: 'lines', lines: [3] },
        },
        { fieldId: 'treatmentSetting', value: 'дома', citation: { kind: 'lines', lines: [3] } },
      ],
      'model',
    );
    expect(result.fields['seasons']?.value).toEqual(['2', '4']);
    expect(result.fields['seasons']?.evidence).toHaveLength(2);
    expect(result.fields['treatmentSetting']?.value).toBe('2');
    expect(result.rejected).toEqual([{ fieldId: 'treatmentSetting', code: 'option-not-allowed' }]);
  });
});

/** The non-null branch of one field in a request's response schema. */
function schemaProperty(request: FormFillModelRequest | undefined, fieldId: string): unknown {
  if (!request) throw new Error('no request');
  const properties = request.responseSchema['properties'] as Record<string, { anyOf: unknown[] }>;
  return properties[fieldId]?.anyOf[1];
}

/** A scripted model: answers from a table keyed by the first field of each request. */
function scriptedModel(
  answers: Readonly<Record<string, unknown>>,
  seen: FormFillModelRequest[],
): FormFillModel {
  return {
    async complete(request) {
      seen.push(request);
      const first = (request.responseSchema['required'] as string[])[0] as string;
      return answers[first] ?? null;
    },
  };
}

describe('model pass', () => {
  it('asks a few fields at a time under a schema built from them', async () => {
    const seen: FormFillModelRequest[] = [];
    const run = await fillFormWithModel(
      scriptedModel(
        {
          ageYears: {
            ageYears: { value: 72, lines: [1, 2] },
            heartFailure: null,
            hypertension: { value: true, lines: [4] },
            diabetes: { value: true, lines: [5, 6] },
          },
          strokeTia: {
            strokeTia: { value: true, lines: [8] },
            vascularDisease: null,
            femaleSex: null,
          },
        },
        seen,
      ),
      cha2ds2.form,
      AF_VISIT,
      { fieldsPerCall: 4 },
    );
    expect(run.calls).toBe(2);
    expect(run.proposed).toBe(4);
    expect(seen[0]?.responseSchema).toMatchObject({
      required: ['ageYears', 'heartFailure', 'hypertension', 'diabetes'],
      additionalProperties: false,
    });
    const ageSchema = schemaProperty(seen[0], 'ageYears') as {
      properties: { value: unknown; lines: { items: { enum: number[] } } };
    };
    expect(ageSchema.properties.value).toEqual({ type: 'number', minimum: 18, maximum: 120 });
    expect(ageSchema.properties.lines.items.enum).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seen[0]?.systemPrompt).toContain('hypertension — Артериальная гипертензия');
    expect(seen[0]?.systemPrompt).not.toContain('strokeTia');
    expect(run.result.fields['ageYears']?.value).toBe(72);
    expect(run.result.fields['hypertension']?.value).toBe(true);
    // «Нет» to the diabetes question and «Не было» before the mother's stroke: both caught.
    expect(run.result.fields['diabetes']).toBeNull();
    expect(run.result.fields['strokeTia']).toBeNull();
    expect(run.result.rejected).toEqual([
      { fieldId: 'diabetes', code: 'value-not-in-quote' },
      { fieldId: 'strokeTia', code: 'value-not-in-quote' },
    ]);
  });

  it('builds choice enums from option labels and counts unreadable answers', async () => {
    const seen: FormFillModelRequest[] = [];
    const run = await fillFormWithModel(scriptedModel({}, seen), form070.form, [
      'Врач: Добрый день.',
    ]);
    expect(run.unreadableCalls).toBe(run.calls);
    const recommendation = seen.find((request) =>
      (request.responseSchema['required'] as string[]).includes('seasons'),
    );
    const seasons = schemaProperty(recommendation, 'seasons') as {
      properties: { value: { items: { enum: string[] } } };
    };
    expect(seasons.properties.value.items.enum).toEqual(['зима', 'весна', 'лето', 'осень']);
  });
});

describe('review', () => {
  it('lets only accepted values through', () => {
    const result = fillFormWithCues(cha2ds2.form, AF_VISIT);
    let review = emptyFormFillReview(result);
    review = decideFormFillValue(review, 'ageYears', 'accepted');
    review = decideFormFillValue(review, 'strokeTia', 'rejected');
    review = decideFormFillValue(review, 'hypertension', 'accepted');
    review = decideFormFillValue(review, 'hypertension', null);
    expect(
      formFillReviewItems(result, review).map((item) => [item.fieldId, item.decision]),
    ).toEqual([
      ['ageYears', 'accepted'],
      ['hypertension', null],
      ['diabetes', null],
      ['strokeTia', 'rejected'],
      ['vascularDisease', null],
    ]);
    expect([...acceptedFormFillValues(result, review)]).toEqual([['ageYears', 72]]);
  });
});
