import { describe, expect, it } from 'vitest';

import {
  addBand,
  addQuestion,
  addSection,
  canMoveQuestion,
  duplicateQuestion,
  moveQuestion,
  moveQuestionToSection,
  moveSection,
  parseWeightInput,
  removeSection,
  setScoreBySection,
  updateBand,
} from '@/features/assessments/user-questionnaire-edit';
import { orderedQuestions } from '@/state/user-questionnaire-rules';
import {
  createUserQuestionnaireDraft,
  type UserQuestionnaire,
  type UserQuestionnaireQuestion,
} from '@/state/user-questionnaires';

function question(id: string, sectionId?: string): UserQuestionnaireQuestion {
  return {
    id,
    prompt: `Вопрос ${id}`,
    text: '',
    images: [],
    options: [
      { id: `${id}-a`, label: 'Нет', weight: 0 },
      { id: `${id}-b`, label: 'Да', weight: 1 },
    ],
    ...(sectionId ? { sectionId } : {}),
  };
}

function draft(overrides: Partial<UserQuestionnaire> = {}): UserQuestionnaire {
  return {
    ...createUserQuestionnaireDraft(),
    sections: [
      { id: 's1', title: 'Первый', description: '' },
      { id: 's2', title: 'Второй', description: '' },
    ],
    questions: [question('free'), question('a', 's1'), question('b', 's1'), question('c', 's2')],
    ...overrides,
  };
}

const ids = (questionnaire: UserQuestionnaire): string[] =>
  questionnaire.questions.map((item) => item.id);

describe('questionnaire edit operations', () => {
  it('shows questions with no section first, then each section in turn', () => {
    const shuffled = draft({
      questions: [question('c', 's2'), question('a', 's1'), question('free'), question('b', 's1')],
    });
    expect(orderedQuestions(shuffled).map((item) => item.id)).toEqual(['free', 'a', 'b', 'c']);
  });

  it('adds a question to the end of its section and keeps display order', () => {
    const next = addQuestion(draft(), 's1');
    expect(ids(next).slice(0, 4)).toEqual(['free', 'a', 'b', next.questions[3]?.id]);
    expect(next.questions[3]?.sectionId).toBe('s1');
    expect(next.questions).toHaveLength(5);
  });

  it('moves a question inside its own section only', () => {
    const questionnaire = draft();
    expect(ids(moveQuestion(questionnaire, 'b', -1))).toEqual(['free', 'b', 'a', 'c']);
    expect(canMoveQuestion(questionnaire, 'a', -1)).toBe(false);
    expect(canMoveQuestion(questionnaire, 'b', 1)).toBe(false);
    expect(ids(moveQuestion(questionnaire, 'a', -1))).toEqual(ids(questionnaire));
  });

  it('moves a question to another section, or out of every section', () => {
    const toSecond = moveQuestionToSection(draft(), 'a', 's2');
    expect(ids(toSecond)).toEqual(['free', 'b', 'c', 'a']);
    expect(toSecond.questions.find((item) => item.id === 'a')?.sectionId).toBe('s2');
    const out = moveQuestionToSection(draft(), 'a', undefined);
    expect(ids(out)).toEqual(['free', 'a', 'b', 'c']);
    expect(out.questions.find((item) => item.id === 'a')).not.toHaveProperty('sectionId');
  });

  it('duplicates a question right after the original with new ids', () => {
    const next = duplicateQuestion(draft(), 'a');
    expect(next.questions).toHaveLength(5);
    const copy = next.questions[2];
    expect(copy?.prompt).toBe('Вопрос a');
    expect(copy?.id).not.toBe('a');
    expect(copy?.sectionId).toBe('s1');
    expect(copy?.options[0]?.id).not.toBe('a-a');
  });

  it('reorders sections and keeps their questions together', () => {
    const next = moveSection(draft(), 's2', -1);
    expect(next.sections.map((section) => section.id)).toEqual(['s2', 's1']);
    expect(ids(next)).toEqual(['free', 'c', 'a', 'b']);
  });

  it('deletes a section but keeps its questions and drops its ranges', () => {
    const questionnaire = draft({
      scoreBySection: true,
      bands: [
        { id: 'x', scope: 's1', min: 0, max: 1, headline: 'Норма', message: '' },
        { id: 'y', scope: 's2', min: 0, max: 1, headline: 'Норма', message: '' },
      ],
    });
    const next = removeSection(questionnaire, 's1');
    expect(next.sections.map((section) => section.id)).toEqual(['s2']);
    expect(ids(next)).toEqual(['free', 'a', 'b', 'c']);
    expect(next.questions.find((item) => item.id === 'a')).not.toHaveProperty('sectionId');
    expect(next.bands.map((band) => band.id)).toEqual(['y']);
    expect(next.scoreBySection).toBe(true);
    expect(removeSection(next, 's2').scoreBySection).toBe(false);
  });

  it('starts a new range right after the last one and ends it at the highest score', () => {
    const questionnaire = draft({ questions: [question('a'), question('b')] });
    const first = addBand(questionnaire, 'total');
    expect(first.bands[0]).toMatchObject({ scope: 'total', min: 0, max: 2 });
    const edited = updateBand(first, first.bands[0]?.id ?? '', (band) => ({ ...band, max: 0 }));
    const second = addBand(edited, 'total');
    expect(second.bands[1]).toMatchObject({ min: 1, max: 2 });
  });

  it('adds and switches the score-by-section mode and sections', () => {
    const withSection = addSection(createUserQuestionnaireDraft(), 'Тревога');
    expect(withSection.sections[0]?.title).toBe('Тревога');
    expect(setScoreBySection(withSection, true).scoreBySection).toBe(true);
  });

  it('reads a score the way a Russian keyboard types it', () => {
    expect(parseWeightInput('2,5')).toEqual({ ok: true, value: 2.5 });
    expect(parseWeightInput(' -1 ')).toEqual({ ok: true, value: -1 });
    expect(parseWeightInput('')).toEqual({ ok: true, value: undefined });
    expect(parseWeightInput('-')).toEqual({ ok: false });
    expect(parseWeightInput('abc')).toEqual({ ok: false });
  });
});
