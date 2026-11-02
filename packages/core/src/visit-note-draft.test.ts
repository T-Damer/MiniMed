import { VisitNoteDraftSchema } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { buildVisitNoteDraft, VISIT_NOTE_LIMITS } from './visit-note-draft';
import { findRemoteExamFindings } from './visit-note-remote-exam';

const TRANSCRIPT = [
  'Пациент: Давит в груди, особенно при ходьбе. Уже недели две.',
  'Врач: Лекарства какие-то принимаете?',
  'Пациент: Аспирин по утрам. И на пенициллин у меня аллергия, сыпь была.',
  'Пациент: Не болит голова совсем.',
];
const PRIOR = ['Диагноз: гипертоническая болезнь II стадии.'];

function field(draft: ReturnType<typeof buildVisitNoteDraft>, id: string) {
  return draft.fields.find((candidate) => candidate.field === id);
}

describe('buildVisitNoteDraft', () => {
  it('keeps only quotes found in the sources and files them by where the text is', () => {
    const draft = buildVisitNoteDraft(
      {
        fields: {
          complaints: {
            text: 'Давящие боли за грудиной при ходьбе в течение двух недель.',
            quotes: ['давит в груди, особенно при ходьбе', 'боль отдаёт в левую руку'],
          },
          anamnesisVitae: {
            text: 'Гипертоническая болезнь II стадии.',
            quotes: ['гипертоническая болезнь II стадии'],
          },
          allergies: { text: 'Пенициллин (сыпь).', quotes: ['на пенициллин у меня аллергия'] },
          diagnoses: { text: 'ИБС: стенокардия напряжения.', quotes: [] },
        },
      },
      { transcript: TRANSCRIPT, priorRecord: PRIOR, remote: false },
    );

    expect(VisitNoteDraftSchema.parse(draft)).toEqual(draft);
    expect(field(draft, 'complaints')).toMatchObject({
      status: 'supported',
      quotes: [{ source: 'transcript', text: 'Давит в груди, особенно при ходьбе' }],
    });
    expect(field(draft, 'anamnesisVitae')?.quotes[0]?.source).toBe('prior-record');
    expect(field(draft, 'allergies')?.status).toBe('supported');
    expect(field(draft, 'diagnoses')?.status).toBe('unsupported');
    expect(field(draft, 'plan')).toEqual({ field: 'plan', text: '', status: 'empty', quotes: [] });
    expect(draft.rejected).toEqual([
      { item: 'field-quote', field: 'complaints', code: 'quote-not-found' },
    ]);
  });

  it('does not let a negated statement support a complaint', () => {
    const draft = buildVisitNoteDraft(
      {
        fields: {
          complaints: { text: 'Головная боль.', quotes: ['болит голова совсем', 'голова болит.'] },
        },
      },
      { transcript: TRANSCRIPT, remote: false },
    );
    expect(field(draft, 'complaints')?.status).toBe('unsupported');
    expect(draft.rejected.map((rejection) => rejection.code)).toEqual([
      'quote-negated',
      'quote-not-found',
    ]);
  });

  it('drops duplicate quotes, caps the quotes per field and reports unknown fields', () => {
    const quote = 'давит в груди';
    const draft = buildVisitNoteDraft(
      {
        fields: {
          complaints: {
            text: 'Давящие боли.',
            quotes: [
              quote,
              `${quote}!`,
              'особенно при ходьбе',
              'уже недели две',
              'аспирин по утрам',
              7,
            ],
          },
          mood: { text: 'Тревожен.', quotes: [] },
        },
      },
      { transcript: TRANSCRIPT, remote: false },
    );
    expect(field(draft, 'complaints')?.quotes).toHaveLength(VISIT_NOTE_LIMITS.quotesPerField);
    expect(draft.rejected.map((rejection) => rejection.code)).toEqual([
      'unknown-field',
      'duplicate-quote',
      'too-many',
      'not-an-object',
    ]);
  });

  it('keeps an omission only with a transcript quote and a suggestion the note lacks', () => {
    const draft = buildVisitNoteDraft(
      {
        fields: {
          medications: { text: 'Аспирин по утрам.', quotes: ['аспирин по утрам'] },
        },
        omissions: [
          {
            category: 'allergy',
            field: 'allergies',
            quote: 'на пенициллин у меня аллергия',
            suggestion: 'Аллергия на пенициллин (сыпь).',
          },
          {
            category: 'medication',
            field: 'medications',
            quote: 'аспирин по утрам',
            suggestion: 'аспирин по утрам',
          },
          {
            category: 'diagnosis',
            field: 'diagnoses',
            quote: 'гипертоническая болезнь II стадии',
            suggestion: 'Гипертоническая болезнь.',
          },
          { category: 'timing', field: 'complaints', quote: 'уже недели две', suggestion: '' },
          { category: 'vague', field: 'plan', quote: 'давит в груди', suggestion: 'ЭКГ.' },
          { category: 'other', field: 'mood', quote: 'давит в груди', suggestion: 'Тревога.' },
          'не объект',
        ],
      },
      { transcript: TRANSCRIPT, priorRecord: PRIOR, remote: false },
    );
    expect(draft.omissions).toEqual([
      expect.objectContaining({ category: 'allergy', field: 'allergies' }),
      expect.objectContaining({ category: 'other', field: 'plan', suggestion: 'ЭКГ.' }),
    ]);
    expect(draft.rejected).toEqual([
      { item: 'omission', field: 'medications', code: 'already-in-note' },
      { item: 'omission', field: 'diagnoses', code: 'quote-not-found' },
      { item: 'omission', field: 'complaints', code: 'missing-suggestion' },
      { item: 'omission', code: 'unknown-field' },
      { item: 'omission', code: 'not-an-object' },
    ]);
  });

  it('survives proposals of the wrong shape', () => {
    for (const proposal of [null, 'текст', [], { fields: [], omissions: {} }]) {
      const draft = buildVisitNoteDraft(proposal, { transcript: TRANSCRIPT, remote: true });
      expect(draft.fields.every((candidate) => candidate.status === 'empty')).toBe(true);
      expect(draft.omissions).toEqual([]);
    }
  });

  it('lists hands-on findings only for a remote visit', () => {
    const proposal = {
      fields: {
        examination: { text: 'Живот мягкий, безболезненный. Дыхание везикулярное, хрипов нет.' },
      },
    };
    const remote = buildVisitNoteDraft(proposal, { transcript: TRANSCRIPT, remote: true });
    expect(remote.remoteExamFindings.map((finding) => finding.text)).toEqual([
      'Живот мягкий',
      'Дыхание везикулярное',
      'хрипов',
    ]);
    expect(
      buildVisitNoteDraft(proposal, { transcript: TRANSCRIPT, remote: false }).remoteExamFindings,
    ).toEqual([]);
  });
});

describe('findRemoteExamFindings', () => {
  it('finds hands-on findings with their source spans', () => {
    const text = 'При пальпации печень у края. Симптом Пастернацкого отрицательный с обеих сторон.';
    const findings = findRemoteExamFindings(text);
    expect(findings.map((finding) => finding.kind)).toEqual([
      'palpation',
      'liver',
      'costovertebral-tap',
    ]);
    for (const finding of findings) {
      expect(text.slice(finding.start, finding.end)).toBe(finding.text);
    }
  });

  it('leaves what a patient can report or a camera can show', () => {
    expect(
      findRemoteExamFindings('Температура 37,2 °C, АД 130/85 со слов. Голос хриплый, кожа чистая.'),
    ).toEqual([]);
  });
});
