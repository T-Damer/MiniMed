import { describe, expect, it } from 'vitest';

import {
  duplicateUserQuestionnaireQuestion,
  parseUserQuestionnaire,
  type StoredUserQuestionnaire,
  userQuestionnaireReadinessError,
  userQuestionnaireToAssessmentDefinition,
} from '@/state/user-questionnaires';

describe('user questionnaires', () => {
  it('validates local data and maps its text, images, and weights into an assessment', () => {
    const questionnaire = parseUserQuestionnaire({
      format: 'minimed-questionnaire',
      version: 1,
      title: 'Опросник с изображением',
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
      version: 1,
      title: 'Опросник без баллов',
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
