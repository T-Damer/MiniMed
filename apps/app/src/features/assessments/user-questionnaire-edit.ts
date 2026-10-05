import {
  bandsInScope,
  orderedQuestions,
  questionnaireScoreRange,
} from '@/state/user-questionnaire-rules';
import {
  createUserQuestionnaireBand,
  createUserQuestionnaireQuestion,
  createUserQuestionnaireSection,
  duplicateUserQuestionnaireQuestion,
  MAX_USER_BANDS_PER_SCOPE,
  MAX_USER_QUESTIONS,
  MAX_USER_SECTIONS,
  type UserQuestionnaire,
  type UserQuestionnaireBand,
  type UserQuestionnaireOption,
  type UserQuestionnaireQuestion,
  type UserQuestionnaireSection,
} from '@/state/user-questionnaires';

/**
 * Pure edits of a questionnaire draft. Every function returns a new draft and keeps one rule: the
 * questions array is always in display order (no section first, then each section in turn), so the
 * editor, the runner and the printed blank show the same sequence.
 */

function inDisplayOrder(questionnaire: UserQuestionnaire): UserQuestionnaire {
  return { ...questionnaire, questions: orderedQuestions(questionnaire) };
}

function swap<T>(items: readonly T[], from: number, to: number): readonly T[] {
  const next = [...items];
  const moved = next[from];
  const target = next[to];
  if (moved === undefined || target === undefined) return items;
  next[from] = target;
  next[to] = moved;
  return next;
}

export function canAddQuestion(questionnaire: UserQuestionnaire): boolean {
  return questionnaire.questions.length < MAX_USER_QUESTIONS;
}

export function addQuestion(
  questionnaire: UserQuestionnaire,
  sectionId?: string,
): UserQuestionnaire {
  if (!canAddQuestion(questionnaire)) return questionnaire;
  const question = createUserQuestionnaireQuestion();
  return inDisplayOrder({
    ...questionnaire,
    questions: [...questionnaire.questions, sectionId ? { ...question, sectionId } : question],
  });
}

export function updateQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
  update: (question: UserQuestionnaireQuestion) => UserQuestionnaireQuestion,
): UserQuestionnaire {
  return {
    ...questionnaire,
    questions: questionnaire.questions.map((question) =>
      question.id === questionId ? update(question) : question,
    ),
  };
}

export function updateOption(
  question: UserQuestionnaireQuestion,
  optionId: string,
  update: (option: UserQuestionnaireOption) => UserQuestionnaireOption,
): UserQuestionnaireQuestion {
  return {
    ...question,
    options: question.options.map((option) => (option.id === optionId ? update(option) : option)),
  };
}

export function removeQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
): UserQuestionnaire {
  return {
    ...questionnaire,
    questions: questionnaire.questions.filter((question) => question.id !== questionId),
  };
}

export function duplicateQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
): UserQuestionnaire {
  if (!canAddQuestion(questionnaire)) return questionnaire;
  return {
    ...questionnaire,
    questions: questionnaire.questions.flatMap((question) =>
      question.id === questionId
        ? [question, duplicateUserQuestionnaireQuestion(question)]
        : [question],
    ),
  };
}

/** Moves a question one place up or down inside its own section (or the unsectioned group). */
export function moveQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
  direction: -1 | 1,
): UserQuestionnaire {
  const ordered = orderedQuestions(questionnaire);
  const index = ordered.findIndex((question) => question.id === questionId);
  const question = ordered[index];
  const neighbour = ordered[index + direction];
  if (!question || !neighbour || neighbour.sectionId !== question.sectionId) return questionnaire;
  return { ...questionnaire, questions: swap(ordered, index, index + direction) };
}

export function canMoveQuestion(
  questionnaire: UserQuestionnaire,
  questionId: string,
  direction: -1 | 1,
): boolean {
  const ordered = orderedQuestions(questionnaire);
  const index = ordered.findIndex((question) => question.id === questionId);
  const question = ordered[index];
  const neighbour = ordered[index + direction];
  return Boolean(question && neighbour && neighbour.sectionId === question.sectionId);
}

/** Puts the question at the end of another section, or outside every section. */
export function moveQuestionToSection(
  questionnaire: UserQuestionnaire,
  questionId: string,
  sectionId: string | undefined,
): UserQuestionnaire {
  const question = questionnaire.questions.find((item) => item.id === questionId);
  if (!question || question.sectionId === sectionId) return questionnaire;
  const { sectionId: _previous, ...rest } = question;
  const moved = sectionId ? { ...rest, sectionId } : rest;
  return inDisplayOrder({
    ...questionnaire,
    questions: [...questionnaire.questions.filter((item) => item.id !== questionId), moved],
  });
}

export function canAddSection(questionnaire: UserQuestionnaire): boolean {
  return questionnaire.sections.length < MAX_USER_SECTIONS;
}

export function addSection(questionnaire: UserQuestionnaire, title = ''): UserQuestionnaire {
  if (!canAddSection(questionnaire)) return questionnaire;
  return {
    ...questionnaire,
    sections: [...questionnaire.sections, createUserQuestionnaireSection(title)],
  };
}

export function updateSection(
  questionnaire: UserQuestionnaire,
  sectionId: string,
  update: (section: UserQuestionnaireSection) => UserQuestionnaireSection,
): UserQuestionnaire {
  return {
    ...questionnaire,
    sections: questionnaire.sections.map((section) =>
      section.id === sectionId ? update(section) : section,
    ),
  };
}

/** Deleting a section keeps its questions, now outside every section, and drops its ranges. */
export function removeSection(
  questionnaire: UserQuestionnaire,
  sectionId: string,
): UserQuestionnaire {
  const sections = questionnaire.sections.filter((section) => section.id !== sectionId);
  return inDisplayOrder({
    ...questionnaire,
    sections,
    scoreBySection: questionnaire.scoreBySection && sections.length > 0,
    questions: questionnaire.questions.map((question) => {
      if (question.sectionId !== sectionId) return question;
      const { sectionId: _removed, ...rest } = question;
      return rest;
    }),
    bands: questionnaire.bands.filter((band) => band.scope !== sectionId),
  });
}

export function moveSection(
  questionnaire: UserQuestionnaire,
  sectionId: string,
  direction: -1 | 1,
): UserQuestionnaire {
  const index = questionnaire.sections.findIndex((section) => section.id === sectionId);
  if (index < 0 || index + direction < 0 || index + direction >= questionnaire.sections.length) {
    return questionnaire;
  }
  return inDisplayOrder({
    ...questionnaire,
    sections: swap(questionnaire.sections, index, index + direction),
  });
}

/** Switches between one total score and a score per section; ranges of the other mode are kept. */
export function setScoreBySection(
  questionnaire: UserQuestionnaire,
  scoreBySection: boolean,
): UserQuestionnaire {
  return { ...questionnaire, scoreBySection };
}

export function canAddBand(questionnaire: UserQuestionnaire, scope: string): boolean {
  return bandsInScope(questionnaire, scope).length < MAX_USER_BANDS_PER_SCOPE;
}

/**
 * A new range starts right after the last one (or at the lowest possible score), so the doctor
 * only has to type where it ends.
 */
export function addBand(questionnaire: UserQuestionnaire, scope: string): UserQuestionnaire {
  if (!canAddBand(questionnaire, scope)) return questionnaire;
  const existing = bandsInScope(questionnaire, scope);
  const range = questionnaireScoreRange(questionnaire, scope);
  const highest = existing.reduce<number | undefined>(
    (top, band) => (top === undefined || band.max > top ? band.max : top),
    undefined,
  );
  const start =
    highest === undefined ? (range?.min ?? 0) : Number.isInteger(highest) ? highest + 1 : highest;
  const end = range ? Math.max(start, range.max) : start;
  return {
    ...questionnaire,
    bands: [...questionnaire.bands, createUserQuestionnaireBand(scope, start, end)],
  };
}

export function updateBand(
  questionnaire: UserQuestionnaire,
  bandId: string,
  update: (band: UserQuestionnaireBand) => UserQuestionnaireBand,
): UserQuestionnaire {
  return {
    ...questionnaire,
    bands: questionnaire.bands.map((band) => (band.id === bandId ? update(band) : band)),
  };
}

export function removeBand(questionnaire: UserQuestionnaire, bandId: string): UserQuestionnaire {
  return { ...questionnaire, bands: questionnaire.bands.filter((band) => band.id !== bandId) };
}

/** A weight edit: an empty field clears the score, anything else must be a finite number. */
export function parseWeightInput(
  text: string,
): { readonly ok: true; readonly value: number | undefined } | { readonly ok: false } {
  const normalized = text.trim().replace(',', '.');
  if (!normalized) return { ok: true, value: undefined };
  const value = Number(normalized);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
