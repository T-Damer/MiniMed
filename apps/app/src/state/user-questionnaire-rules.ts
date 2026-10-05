import { userToolPopulationError } from '@/features/tools/user-tool-population';
import type {
  UserQuestionnaire,
  UserQuestionnaireBand,
  UserQuestionnaireQuestion,
  UserQuestionnaireSection,
} from '@/state/user-questionnaires';

/** Where a band applies: the whole questionnaire or one section scored on its own. */
export type QuestionnaireScoreScope = 'total' | string;

export interface QuestionnaireIssue {
  /** An error blocks running the questionnaire; a warning is advice that does not. */
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly questionId?: string;
  readonly sectionId?: string;
  readonly bandId?: string;
  /** The part of the editor the message is about, for scrolling to it. */
  readonly part?: 'population' | 'questions' | 'bands';
}

export interface ScoreRange {
  readonly min: number;
  readonly max: number;
}

export function questionnaireIsScored(questionnaire: UserQuestionnaire): boolean {
  return questionnaire.questions.some((question) =>
    question.options.some((option) => option.weight !== undefined),
  );
}

/** Scores are kept per section only when the author asked for it and sections exist. */
export function questionnaireScoresBySection(questionnaire: UserQuestionnaire): boolean {
  return (
    questionnaire.scoreBySection &&
    questionnaire.sections.length > 0 &&
    questionnaireIsScored(questionnaire)
  );
}

/** Questions in the order the doctor sees them: no section first, then each section in turn. */
export function orderedQuestions(
  questionnaire: Pick<UserQuestionnaire, 'questions' | 'sections'>,
): readonly UserQuestionnaireQuestion[] {
  const rank = (question: UserQuestionnaireQuestion): number => {
    const index = questionnaire.sections.findIndex((section) => section.id === question.sectionId);
    return index;
  };
  return questionnaire.questions
    .map((question, position) => ({ question, position, rank: rank(question) }))
    .toSorted((a, b) => a.rank - b.rank || a.position - b.position)
    .map((entry) => entry.question);
}

export function questionnaireSectionLabel(
  section: UserQuestionnaireSection,
  index: number,
): string {
  return section.title.trim() || `Раздел ${index + 1}`;
}

function questionWeights(question: UserQuestionnaireQuestion): readonly number[] {
  return question.options.flatMap((option) => (option.weight === undefined ? [] : [option.weight]));
}

/** The lowest and highest score the answers can add up to in a scope; undefined without weights. */
export function questionnaireScoreRange(
  questionnaire: UserQuestionnaire,
  scope: QuestionnaireScoreScope,
): ScoreRange | undefined {
  const questions =
    scope === 'total'
      ? questionnaire.questions
      : questionnaire.questions.filter((question) => question.sectionId === scope);
  let min = 0;
  let max = 0;
  let any = false;
  for (const question of questions) {
    const weights = questionWeights(question);
    if (weights.length === 0) continue;
    any = true;
    min += Math.min(...weights);
    max += Math.max(...weights);
  }
  return any ? { min, max } : undefined;
}

export function questionnaireScopes(
  questionnaire: UserQuestionnaire,
): readonly { readonly scope: QuestionnaireScoreScope; readonly label: string }[] {
  if (questionnaireScoresBySection(questionnaire)) {
    return questionnaire.sections.map((section, index) => ({
      scope: section.id,
      label: questionnaireSectionLabel(section, index),
    }));
  }
  return [{ scope: 'total', label: 'Общий балл' }];
}

export function bandsInScope(
  questionnaire: UserQuestionnaire,
  scope: QuestionnaireScoreScope,
): readonly UserQuestionnaireBand[] {
  return questionnaire.bands.filter((band) => band.scope === scope);
}

/** The band a score falls into, as the questionnaire's result would pick it. */
export function bandForScore(
  questionnaire: UserQuestionnaire,
  scope: QuestionnaireScoreScope,
  score: number,
): UserQuestionnaireBand | undefined {
  return bandsInScope(questionnaire, scope).find((band) => score >= band.min && score <= band.max);
}

function formatScore(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

export function formatScoreRange(min: number, max: number): string {
  return min === max ? formatScore(min) : `${formatScore(min)}–${formatScore(max)}`;
}

function bandLabel(band: UserQuestionnaireBand, index: number): string {
  return band.headline.trim() ? `«${band.headline.trim()}»` : `№${index + 1}`;
}

function questionName(
  questionnaire: UserQuestionnaire,
  question: UserQuestionnaireQuestion,
  number: number,
): string {
  const sectionIndex = questionnaire.sections.findIndex((item) => item.id === question.sectionId);
  const section = questionnaire.sections[sectionIndex];
  const where = section
    ? ` (раздел ${section.title.trim() ? `«${section.title.trim()}»` : sectionIndex + 1})`
    : '';
  return `Вопрос ${number}${where}`;
}

function bandIssues(
  questionnaire: UserQuestionnaire,
  scope: QuestionnaireScoreScope,
  scopeLabel: string,
  scored: boolean,
): readonly QuestionnaireIssue[] {
  const issues: QuestionnaireIssue[] = [];
  const bands = bandsInScope(questionnaire, scope);
  const where =
    scope === 'total' && !questionnaireScoresBySection(questionnaire) ? '' : ` в «${scopeLabel}»`;
  if (!scored) return issues;
  for (const [index, band] of bands.entries()) {
    const label = bandLabel(band, index);
    if (!band.headline.trim()) {
      issues.push({
        severity: 'error',
        message: `Диапазон ${index + 1}${where}: напишите название результата, например «Низкий уровень».`,
        bandId: band.id,
        part: 'bands',
      });
    }
    if (band.min > band.max) {
      issues.push({
        severity: 'error',
        message: `Диапазон ${label}${where}: «от» больше «до». Поменяйте границы местами.`,
        bandId: band.id,
        part: 'bands',
      });
    }
  }
  const valid = bands.filter((band) => band.min <= band.max);
  for (const [index, band] of valid.entries()) {
    for (const other of valid.slice(index + 1)) {
      if (band.min <= other.max && other.min <= band.max) {
        issues.push({
          severity: 'error',
          message: `Диапазоны ${bandLabel(band, 0)} (${formatScoreRange(band.min, band.max)}) и ${bandLabel(other, 0)} (${formatScoreRange(other.min, other.max)})${where} пересекаются: один и тот же балл попадёт в оба.`,
          bandId: other.id,
          part: 'bands',
        });
      }
    }
  }
  const range = questionnaireScoreRange(questionnaire, scope);
  if (range && valid.length > 0) {
    for (const band of valid) {
      if (band.max < range.min || band.min > range.max) {
        issues.push({
          severity: 'warning',
          message: `Диапазон ${bandLabel(band, 0)}${where} не достижим: баллы бывают от ${formatScore(range.min)} до ${formatScore(range.max)}.`,
          bandId: band.id,
          part: 'bands',
        });
      }
    }
    const integer = [range.min, range.max, ...valid.flatMap((band) => [band.min, band.max])].every(
      Number.isInteger,
    );
    if (integer && range.max - range.min <= 2000) {
      const uncovered: number[] = [];
      for (let score = range.min; score <= range.max; score += 1) {
        if (!valid.some((band) => score >= band.min && score <= band.max)) uncovered.push(score);
      }
      if (uncovered.length > 0) {
        const first = uncovered[0] ?? range.min;
        let last = first;
        for (const score of uncovered.slice(1)) {
          if (score !== last + 1) break;
          last = score;
        }
        issues.push({
          severity: 'warning',
          message: `Баллы ${formatScoreRange(first, last)}${where} не входят ни в один диапазон: для них результат останется без пояснения.`,
          part: 'bands',
        });
      }
    }
  }
  return issues;
}

/** Everything the doctor should fix (errors) or look at (warnings) before running the questionnaire. */
export function userQuestionnaireIssues(
  questionnaire: UserQuestionnaire,
): readonly QuestionnaireIssue[] {
  const issues: QuestionnaireIssue[] = [];
  const populationError = userToolPopulationError(questionnaire.population);
  if (populationError)
    issues.push({ severity: 'error', message: populationError, part: 'population' });
  if (questionnaire.questions.length === 0) {
    issues.push({ severity: 'error', message: 'Добавьте хотя бы один вопрос.', part: 'questions' });
  }
  const scored = questionnaireIsScored(questionnaire);
  const ordered = orderedQuestions(questionnaire);
  for (const [index, question] of ordered.entries()) {
    const name = questionName(questionnaire, question, index + 1);
    if (!question.prompt.trim()) {
      issues.push({
        severity: 'error',
        message: `${name}: напишите формулировку вопроса.`,
        questionId: question.id,
        part: 'questions',
      });
    }
    if (question.options.length < 2) {
      issues.push({
        severity: 'error',
        message: `${name}: добавьте минимум два варианта ответа.`,
        questionId: question.id,
        part: 'questions',
      });
    }
    if (question.options.some((option) => !option.label.trim())) {
      issues.push({
        severity: 'error',
        message: `${name}: у каждого варианта ответа должен быть текст.`,
        questionId: question.id,
        part: 'questions',
      });
    }
    if (!scored) continue;
    if (question.options.some((option) => option.weight === undefined)) {
      issues.push({
        severity: 'error',
        message: `${name}: укажите баллы у всех вариантов ответа или очистите их во всём опроснике.`,
        questionId: question.id,
        part: 'questions',
      });
    } else if (new Set(question.options.map((option) => option.weight)).size < 2) {
      issues.push({
        severity: 'error',
        message: `${name}: у вариантов ответа должны быть разные баллы, иначе вопрос ничего не меняет в результате.`,
        questionId: question.id,
        part: 'questions',
      });
    }
  }
  if (questionnaire.scoreBySection && scored) {
    if (questionnaire.sections.length === 0) {
      issues.push({
        severity: 'error',
        message: 'Чтобы считать баллы по разделам, добавьте хотя бы один раздел.',
        part: 'questions',
      });
    }
    for (const [number, question] of ordered.entries()) {
      if (!questionnaire.sections.some((section) => section.id === question.sectionId)) {
        issues.push({
          severity: 'error',
          message: `${questionName(questionnaire, question, number + 1)}: отнесите вопрос к разделу — баллы считаются по разделам.`,
          questionId: question.id,
          part: 'questions',
        });
      }
    }
  }
  for (const [index, section] of questionnaire.sections.entries()) {
    if (!section.title.trim()) {
      issues.push({
        severity: 'warning',
        message: `Раздел ${index + 1}: добавьте название — оно показывается над вопросами и в результате.`,
        sectionId: section.id,
        part: 'questions',
      });
    }
    if (!questionnaire.questions.some((question) => question.sectionId === section.id)) {
      issues.push({
        severity: 'warning',
        message: `${questionnaireSectionLabel(section, index)}: в разделе нет вопросов.`,
        sectionId: section.id,
        part: 'questions',
      });
    }
  }
  if (!scored && questionnaire.bands.length > 0) {
    issues.push({
      severity: 'warning',
      message:
        'Диапазоны результата заданы, но баллы у ответов не указаны: диапазоны не будут использоваться.',
      part: 'bands',
    });
  }
  for (const entry of questionnaireScopes(questionnaire)) {
    issues.push(...bandIssues(questionnaire, entry.scope, entry.label, scored));
  }
  const knownScopes = new Set(questionnaireScopes(questionnaire).map((entry) => entry.scope));
  if (scored && questionnaire.bands.some((band) => !knownScopes.has(band.scope))) {
    issues.push({
      severity: 'warning',
      message:
        'Есть диапазоны, привязанные к другому способу подсчёта: они не используются. Удалите их или верните прежний способ.',
      part: 'bands',
    });
  }
  return issues;
}

/** The first thing that blocks running the questionnaire, as one plain sentence; null when ready. */
export function userQuestionnaireReadinessError(questionnaire: UserQuestionnaire): string | null {
  return (
    userQuestionnaireIssues(questionnaire).find((issue) => issue.severity === 'error')?.message ??
    null
  );
}
