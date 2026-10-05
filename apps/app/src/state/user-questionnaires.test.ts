import { describe, expect, it } from 'vitest';

import { scoreAssessment } from '@/features/assessments/assessment-engine';
import {
  userQuestionnaireIssues,
  userQuestionnaireReadinessError,
} from '@/state/user-questionnaire-rules';
import {
  duplicateUserQuestionnaireQuestion,
  parseUserQuestionnaire,
  type StoredUserQuestionnaire,
  type UserQuestionnaire,
  userQuestionnaireAgeScope,
  userQuestionnaireToAssessmentDefinition,
  withQuestionnaireImportDefaults,
} from '@/state/user-questionnaires';

describe('user questionnaires', () => {
  it('validates local data and maps its text, images, and weights into an assessment', () => {
    const questionnaire = parseUserQuestionnaire({
      format: 'minimed-questionnaire',
      version: 2,
      title: 'Опросник с изображением',
      population: { group: 'adults' },
      description: 'Короткое пояснение.',
      disclaimer: 'Не является диагнозом.',
      images: [{ id: 'cover', name: 'Общая схема', dataUrl: 'data:image/png;base64,aA==' }],
      questions: [
        {
          id: 'question-1',
          prompt: 'Как вы себя чувствуете?',
          text: 'Выберите один ответ.',
          images: [{ id: 'question-image', name: 'Шкала', dataUrl: 'data:image/png;base64,aA==' }],
          options: [
            { id: 'no', label: 'Плохо', weight: -1 },
            { id: 'yes', label: 'Хорошо', weight: 2 },
          ],
        },
      ],
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    });
    const stored = {
      file: {
        id: 'questionnaire-file',
        contentVersion: '1',
        title: questionnaire.title,
        fileName: 'Опросник с изображением.minimed-questionnaire',
        mimeType: 'application/vnd.minimed.questionnaire+json',
        byteLength: 1,
        pageCount: 0,
        nativeTextPages: 0,
        ocrDonePages: 0,
        ocrNeededPages: 0,
        status: 'ready',
        folderId: 'user-folder-questionnaires',
        createdAt: questionnaire.createdAt,
        updatedAt: questionnaire.updatedAt,
      },
      questionnaire,
    } satisfies StoredUserQuestionnaire;

    const definition = userQuestionnaireToAssessmentDefinition(stored);

    expect(userQuestionnaireReadinessError(questionnaire)).toBeNull();
    expect(definition.images).toHaveLength(1);
    expect(definition.questions[0]).toMatchObject({
      text: 'Выберите один ответ.',
      images: [{ alt: 'Шкала' }],
      responseOptions: [
        { label: 'Плохо', value: -1 },
        { label: 'Хорошо', value: 2 },
      ],
    });

    const original = questionnaire.questions[0];
    if (!original) throw new Error('Не создан тестовый вопрос.');
    const duplicate = duplicateUserQuestionnaireQuestion(original);
    expect(duplicate).toMatchObject({
      prompt: original.prompt,
      text: original.text,
      options: [
        { label: 'Плохо', weight: -1 },
        { label: 'Хорошо', weight: 2 },
      ],
    });
    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.images[0]?.id).not.toBe(original.images[0]?.id);
    expect(duplicate.options[0]?.id).not.toBe(original.options[0]?.id);
  });

  it('accepts questionnaires without weights and records their selected answers', () => {
    const questionnaire = parseUserQuestionnaire({
      format: 'minimed-questionnaire',
      version: 2,
      title: 'Опросник без баллов',
      population: { group: 'children', neonates: true, maxAge: { value: 7, unit: 'years' } },
      description: '',
      disclaimer: 'Не является диагнозом.',
      images: [],
      questions: [
        {
          id: 'question-1',
          prompt: 'Как вы себя чувствуете?',
          text: '',
          images: [],
          options: [
            { id: 'no', label: 'Плохо' },
            { id: 'yes', label: 'Хорошо' },
          ],
        },
      ],
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    });
    const stored = {
      file: {
        id: 'questionnaire-file-no-scores',
        contentVersion: '1',
        title: questionnaire.title,
        fileName: 'Опросник без баллов.minimed-questionnaire',
        mimeType: 'application/vnd.minimed.questionnaire+json',
        byteLength: 1,
        pageCount: 0,
        nativeTextPages: 0,
        ocrDonePages: 0,
        ocrNeededPages: 0,
        status: 'ready',
        folderId: 'user-folder-questionnaires',
        createdAt: questionnaire.createdAt,
        updatedAt: questionnaire.updatedAt,
      },
      questionnaire,
    } satisfies StoredUserQuestionnaire;

    const definition = userQuestionnaireToAssessmentDefinition(stored);

    expect(userQuestionnaireReadinessError(questionnaire)).toBeNull();
    expect(definition.scoringMode).toBe('responses-only');
    expect(definition.scales).toEqual([]);
    expect(definition.questions[0]?.responseOptions).toEqual([
      { label: 'Плохо', value: 0, hideValue: true },
      { label: 'Хорошо', value: 1, hideValue: true },
    ]);
  });
});

describe('questionnaire import defaults', () => {
  it('accepts the minimal hand-written format shown in the import dialog', () => {
    const parsed = parseUserQuestionnaire(
      withQuestionnaireImportDefaults({
        format: 'minimed-questionnaire',
        version: 1,
        title: 'Мой опросник',
        questions: [
          {
            prompt: 'Вопрос 1',
            options: [
              { label: 'Нет', weight: 0 },
              { label: 'Да', weight: 1 },
            ],
          },
        ],
      }),
    );
    expect(parsed.title).toBe('Мой опросник');
    expect(parsed.questions[0]?.options.map((option) => option.weight)).toEqual([0, 1]);
    expect(new Set(parsed.questions[0]?.options.map((option) => option.id)).size).toBe(2);
  });
});

function stored(questionnaire: UserQuestionnaire): StoredUserQuestionnaire {
  return {
    file: {
      id: 'file-1',
      contentVersion: '1',
      title: questionnaire.title,
      fileName: `${questionnaire.title}.minimed-questionnaire`,
      mimeType: 'application/vnd.minimed.questionnaire+json',
      byteLength: 1,
      pageCount: 0,
      nativeTextPages: 0,
      ocrDonePages: 0,
      ocrNeededPages: 0,
      status: 'ready',
      folderId: 'user-folder-questionnaires',
      createdAt: questionnaire.createdAt,
      updatedAt: questionnaire.updatedAt,
    },
    questionnaire,
  };
}

const option = (id: string, label: string, weight?: number) => ({
  id,
  label,
  ...(weight === undefined ? {} : { weight }),
});

function sectioned(overrides: Record<string, unknown> = {}): UserQuestionnaire {
  return parseUserQuestionnaire({
    format: 'minimed-questionnaire',
    version: 2,
    title: 'Тревога и депрессия',
    description: '',
    disclaimer: 'Не является диагнозом.',
    population: { group: 'adults' },
    sections: [
      { id: 'anx', title: 'Тревога', description: 'Как вы чувствовали себя на этой неделе' },
      { id: 'dep', title: 'Депрессия', description: '' },
    ],
    questions: [
      {
        id: 'q1',
        prompt: 'Чувствую напряжение',
        sectionId: 'anx',
        options: [option('a', 'Нет', 0), option('b', 'Да', 2)],
      },
      {
        id: 'q2',
        prompt: 'Потерял интерес',
        sectionId: 'dep',
        options: [option('c', 'Нет', 0), option('d', 'Да', 3)],
      },
    ],
    scoreBySection: true,
    bands: [
      { id: 'b1', scope: 'anx', min: 0, max: 0, headline: 'Норма', message: '' },
      {
        id: 'b2',
        scope: 'anx',
        min: 1,
        max: 2,
        headline: 'Повышена',
        message: 'Обсудите с врачом.',
      },
      { id: 'b3', scope: 'dep', min: 0, max: 1, headline: 'Норма', message: '' },
      { id: 'b4', scope: 'dep', min: 2, max: 3, headline: 'Выражена', message: 'Нужна оценка.' },
    ],
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  });
}

describe('questionnaire sections, scores and ranges', () => {
  it('opens a version 1 file but asks for the population before it can run', () => {
    const questionnaire = parseUserQuestionnaire({
      format: 'minimed-questionnaire',
      version: 1,
      title: 'Старый опросник',
      description: '',
      disclaimer: 'Не является диагнозом.',
      images: [],
      questions: [
        {
          id: 'q1',
          prompt: 'Вопрос',
          text: '',
          images: [],
          options: [option('a', 'Нет'), option('b', 'Да')],
        },
      ],
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:00.000Z',
    });
    expect(questionnaire.version).toBe(2);
    expect(questionnaire.sections).toEqual([]);
    expect(questionnaire.bands).toEqual([]);
    expect(userQuestionnaireReadinessError(questionnaire)).toBe(
      'Укажите, для кого инструмент: дети, взрослые или любой возраст.',
    );
  });

  it('turns the author population into the age scope the filter reads', () => {
    expect(userQuestionnaireAgeScope(sectioned()).groups).toEqual(['adults']);
    const children = sectioned({
      population: { group: 'children', neonates: true, maxAge: { value: 7, unit: 'years' } },
    });
    expect(userQuestionnaireAgeScope(children).groups).toEqual(['neonates', 'children']);
    expect(() =>
      sectioned({ population: { group: 'adults', minAge: { value: 12, unit: 'years' } } }),
    ).toThrow('Для взрослых нижняя граница возраста');
    expect(() =>
      sectioned({
        population: { group: 'children', neonates: true, minAge: { value: 2, unit: 'months' } },
      }),
    ).toThrow('Уберите «Включая новорождённых»');
  });

  it('scores each section on its own and explains every section result', () => {
    const questionnaire = sectioned();
    expect(userQuestionnaireReadinessError(questionnaire)).toBeNull();
    const definition = userQuestionnaireToAssessmentDefinition(stored(questionnaire));
    expect(definition.scales.map((scale) => scale.label)).toEqual(['Тревога', 'Депрессия']);
    expect(definition.sections?.map((section) => section.title)).toEqual(['Тревога', 'Депрессия']);
    expect(definition.questions.map((question) => question.sectionId)).toEqual(['anx', 'dep']);
    expect(definition.interpretationMode).toBe('per-scale');
    const scored = scoreAssessment(definition, {
      q1: 2,
      q2: 0,
    });
    if (!scored.ok) throw new Error(scored.error);
    expect(scored.value.headline).toBe('Результаты по разделам');
    expect(scored.value.summary).toBe('Тревога: Повышена. Обсудите с врачом.\nДепрессия: Норма');
  });

  it('keeps one total with section headings when scores are not split', () => {
    const questionnaire = sectioned({
      scoreBySection: false,
      bands: [
        { id: 't1', scope: 'total', min: 0, max: 2, headline: 'Низкий', message: 'Всё спокойно.' },
        { id: 't2', scope: 'total', min: 3, max: 5, headline: 'Высокий', message: 'Нужна оценка.' },
      ],
    });
    expect(userQuestionnaireReadinessError(questionnaire)).toBeNull();
    const definition = userQuestionnaireToAssessmentDefinition(stored(questionnaire));
    expect(definition.scales.map((scale) => scale.id)).toEqual(['total']);
    expect(definition.sections).toHaveLength(2);
    const scored = scoreAssessment(definition, { q1: 2, q2: 3 });
    if (!scored.ok) throw new Error(scored.error);
    expect(scored.value.headline).toBe('Высокий');
    expect(scored.value.summary).toBe('Нужна оценка.');
  });

  it('reports problems in plain Russian with the question and section named', () => {
    const empty = sectioned({
      questions: [
        {
          id: 'q1',
          prompt: '',
          sectionId: 'anx',
          options: [option('a', 'Нет', 1), option('b', 'Да', 1)],
        },
        { id: 'q2', prompt: 'Второй', sectionId: 'dep', options: [option('c', 'Единственный', 0)] },
      ],
    });
    const message = userQuestionnaireReadinessError(empty);
    expect(message).toBe('Вопрос 1 (раздел «Тревога»): напишите формулировку вопроса.');
  });

  it('rejects overlapping ranges and warns about scores no range covers', () => {
    const overlapping = sectioned({
      scoreBySection: false,
      bands: [
        { id: 't1', scope: 'total', min: 0, max: 3, headline: 'Низкий', message: '' },
        { id: 't2', scope: 'total', min: 3, max: 5, headline: 'Высокий', message: '' },
      ],
    });
    expect(userQuestionnaireReadinessError(overlapping)).toContain('пересекаются');
    const gap = sectioned({
      scoreBySection: false,
      bands: [{ id: 't1', scope: 'total', min: 0, max: 1, headline: 'Низкий', message: '' }],
    });
    expect(userQuestionnaireReadinessError(gap)).toBeNull();
    // Scores run 0–5; the range 0–1 leaves 2–5 without an explanation.
    expect(userQuestionnaireIssues(gap).map((issue) => issue.message)).toContain(
      'Баллы 2–5 не входят ни в один диапазон: для них результат останется без пояснения.',
    );
    const unreachable = sectioned({
      scoreBySection: false,
      bands: [{ id: 't1', scope: 'total', min: 20, max: 30, headline: 'Высокий', message: '' }],
    });
    expect(userQuestionnaireIssues(unreachable).map((issue) => issue.severity)).toContain(
      'warning',
    );
    expect(userQuestionnaireReadinessError(unreachable)).toBeNull();
  });

  it('refuses a question that points at a section the file does not have', () => {
    expect(() =>
      sectioned({
        questions: [
          {
            id: 'q1',
            prompt: 'Вопрос',
            sectionId: 'missing',
            options: [option('a', 'a'), option('b', 'b')],
          },
        ],
      }),
    ).toThrow('раздел, которого нет');
  });
});
