import type { ToolEvaluation } from '@localmed/contracts';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentEvaluation,
  AssessmentQuestion,
  AssessmentRecord,
  AssessmentResponseOption,
  AssessmentResponseValue,
  AssessmentScaleScore,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';
import {
  type CalculatorValue,
  evaluateCalculatorExpression,
} from '@/features/calculators/calculator-expression';
import {
  type CalculatorChartSpec,
  evaluateCalculatorVisual,
} from '@/features/calculators/calculator-schema-engine';

function questionResponseOptions(
  definition: AssessmentDefinition,
  question: AssessmentQuestion,
): readonly AssessmentResponseOption[] {
  return question.responseOptions ?? definition.responseOptions;
}

export type AssessmentScoringResult =
  | { readonly ok: true; readonly value: ScoredAssessment }
  | { readonly ok: false; readonly error: string };

function scoreForResponse(
  value: AssessmentResponseValue,
  reverse: boolean,
  minimum: number,
  maximum: number,
): number {
  return reverse ? minimum + maximum - value : value;
}

function definitionEvaluation(definition: AssessmentDefinition): ToolEvaluation {
  return (
    definition.evaluation ?? {
      status: 'unavailable',
      rules: [],
      missingContext: [],
      reason: 'Для этого опросника не объявлен проверенный референс.',
      sourceIds: [],
    }
  );
}

function assessmentEvaluation(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
): AssessmentEvaluation {
  const declared = definitionEvaluation(definition);
  const base: AssessmentEvaluation = {
    status: declared.status,
    missingContext: declared.missingContext,
    sourceIds: declared.sourceIds,
    ...(declared.reason ? { reason: declared.reason } : {}),
  };
  // Interpretation copy can explain a result, but only an evaluated declarative rule can create
  // a persisted reference verdict. Presentation strings are never part of this decision.
  if (declared.status !== 'verdict') return base;
  if (declared.rules.length === 0) {
    return {
      ...base,
      status: 'unavailable',
      reason: base.reason ?? 'Для этого результата не объявлено вычисляемое правило оценки.',
    };
  }
  const scope = assessmentScoreScope(scores);
  for (const rule of declared.rules) {
    let match: CalculatorValue;
    try {
      match = evaluateCalculatorExpression(rule.when, scope);
    } catch {
      return {
        ...base,
        status: 'unavailable',
        reason: 'Правило оценки ссылается на недоступный балл.',
      };
    }
    if (match === 1) {
      return {
        ...base,
        status: 'verdict',
        verdict: rule.verdict,
        sourceIds: rule.verdict.sourceIds.length > 0 ? rule.verdict.sourceIds : declared.sourceIds,
      };
    }
  }
  return {
    ...base,
    status: 'unavailable',
    reason: 'Ни одно объявленное правило оценки не подошло к рассчитанным баллам.',
  };
}

function assessmentScoreScope(
  scores: readonly AssessmentScaleScore[],
  answers: AssessmentAnswers = {},
): Readonly<Record<string, number>> {
  const scope: Record<string, number> = {};
  for (const score of scores) {
    const stableId = score.scaleId.replaceAll('-', '_');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(score.scaleId)) scope[score.scaleId] = score.rawScore;
    scope[stableId] = score.rawScore;
    scope[`score_${stableId}`] = score.rawScore;
    scope[`percent_${stableId}`] = score.percent;
  }
  for (const [questionId, answer] of Object.entries(answers)) {
    scope[`answer_${questionId.replaceAll('-', '_')}`] = answer;
  }
  if (scores.length === 1) {
    const only = scores[0];
    if (only) {
      Object.assign(scope, { score: only.rawScore, total: only.rawScore });
    }
  }
  return scope;
}

function roundedPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function genericHeadline(scores: readonly AssessmentScaleScore[]): string {
  const leading = scores.slice(0, 2).map((score) => score.label);
  return leading.length > 1
    ? `Наиболее выражены: ${leading.join(' и ')}`
    : `Наиболее выражена шкала: ${leading[0] ?? 'нет данных'}`;
}

interface ClinicalInterpretation {
  readonly headline: string;
  readonly summary: string;
}

function resolveScaleRawScore(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
  scaleId?: string,
): number | undefined {
  const resolvedScaleId = scaleId ?? definition.scales[0]?.id;
  if (!resolvedScaleId) return undefined;
  return scores.find((score) => score.scaleId === resolvedScaleId)?.rawScore;
}

function schemaDrivenInterpretation(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
  answers: AssessmentAnswers,
): ClinicalInterpretation | undefined {
  const interpretations = definition.interpretations;
  if (!interpretations || interpretations.length === 0) return undefined;
  const scope = assessmentScoreScope(scores, answers);
  for (const band of interpretations) {
    if (band.when) {
      if (evaluateCalculatorExpression(band.when, scope) === 1) {
        return { headline: band.headline, summary: band.message };
      }
      continue;
    }
    const rawScore = resolveScaleRawScore(definition, scores, band.scaleId);
    if (rawScore === undefined || band.minScore === undefined || band.maxScore === undefined)
      continue;
    if (rawScore >= band.minScore && rawScore <= band.maxScore) {
      return { headline: band.headline, summary: band.message };
    }
  }
  return undefined;
}

function resolveClinicalInterpretation(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
  answers: AssessmentAnswers,
): ClinicalInterpretation | undefined {
  return schemaDrivenInterpretation(definition, scores, answers);
}

function buildSummary(
  scores: readonly AssessmentScaleScore[],
  clinical: ClinicalInterpretation | undefined,
): string {
  if (clinical) return clinical.summary;
  const top = scores.slice(0, Math.min(3, scores.length));
  const scoreText = top.map((score) => `${score.shortLabel} — ${score.percent}%`).join('; ');
  return `${genericHeadline(scores)}. Нормированные показатели: ${scoreText}. Профиль показывает относительную выраженность шкал внутри этого опросника, а не сравнение с популяционной нормой.`;
}

export function scoreAssessment(
  definition: AssessmentDefinition,
  answers: AssessmentAnswers,
  completedAt = new Date().toISOString(),
): AssessmentScoringResult {
  if (definition.scoringMode === 'responses-only') {
    for (const question of definition.questions) {
      const values = questionResponseOptions(definition, question).map((option) => option.value);
      if (
        values.length < 2 ||
        values.some((value) => !Number.isFinite(value)) ||
        new Set(values).size !== values.length
      ) {
        return { ok: false, error: 'У опросника неверно настроены варианты ответов.' };
      }
      const answer = answers[question.id];
      if (answer === undefined) {
        return { ok: false, error: `Не заполнен пункт: «${question.prompt}».` };
      }
      if (!values.includes(answer)) {
        return { ok: false, error: `Недопустимое значение ответа для пункта ${question.id}.` };
      }
    }
    return {
      ok: true,
      value: {
        assessmentId: definition.id,
        completedAt,
        scores: [],
        primaryScaleIds: [],
        headline: 'Опросник заполнен',
        summary: 'Выбранные ответы сохранены без подсчёта баллов.',
        disclaimer: definition.disclaimer,
        evaluation: assessmentEvaluation(definition, []),
      },
    };
  }
  const totals = new Map<
    string,
    { rawScore: number; minimumScore: number; maximumScore: number }
  >();
  for (const question of definition.questions) {
    const values = questionResponseOptions(definition, question).map((option) => option.value);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum === maximum) {
      return { ok: false, error: 'У опросника неверно настроена шкала ответов.' };
    }
    const answer = answers[question.id];
    if (answer === undefined) {
      return { ok: false, error: `Не заполнен пункт: «${question.prompt}».` };
    }
    if (!values.includes(answer)) {
      return { ok: false, error: `Недопустимое значение ответа для пункта ${question.id}.` };
    }
    if (!definition.scales.some((scale) => scale.id === question.scaleId)) {
      return { ok: false, error: `Пункт ${question.id} ссылается на неизвестную шкалу.` };
    }
    const current = totals.get(question.scaleId) ?? {
      rawScore: 0,
      minimumScore: 0,
      maximumScore: 0,
    };
    totals.set(question.scaleId, {
      rawScore:
        current.rawScore + scoreForResponse(answer, question.reverse === true, minimum, maximum),
      minimumScore: current.minimumScore + minimum,
      maximumScore: current.maximumScore + maximum,
    });
  }

  const scores = definition.scales
    .map((scale): AssessmentScaleScore => {
      const total = totals.get(scale.id) ?? { rawScore: 0, minimumScore: 0, maximumScore: 0 };
      const { minimumScore, maximumScore } = total;
      const percent =
        maximumScore === minimumScore
          ? 0
          : roundedPercent(((total.rawScore - minimumScore) / (maximumScore - minimumScore)) * 100);
      return {
        scaleId: scale.id,
        label: scale.label,
        shortLabel: scale.shortLabel,
        rawScore: total.rawScore,
        minimumScore,
        maximumScore,
        percent,
      };
    })
    .toSorted(
      (left, right) => right.percent - left.percent || left.label.localeCompare(right.label),
    );

  const highest = scores[0]?.percent ?? 0;
  const primaryScaleIds = scores
    .filter((score) => highest - score.percent <= 5)
    .slice(0, 2)
    .map((score) => score.scaleId);
  let clinical: ClinicalInterpretation | undefined;
  try {
    clinical = resolveClinicalInterpretation(definition, scores, answers);
  } catch {
    return { ok: false, error: 'В схеме опросника неверно настроено правило интерпретации.' };
  }
  const visuals: CalculatorChartSpec[] = [];
  for (const visual of definition.visuals ?? []) {
    const evaluated = evaluateCalculatorVisual(visual, assessmentScoreScope(scores, answers));
    if (!evaluated.ok) return { ok: false, error: evaluated.error };
    if (evaluated.output) visuals.push(evaluated.output.chart);
  }

  return {
    ok: true,
    value: {
      assessmentId: definition.id,
      completedAt,
      scores,
      primaryScaleIds,
      headline: clinical?.headline ?? genericHeadline(scores),
      summary: buildSummary(scores, clinical),
      disclaimer: definition.disclaimer,
      ...(visuals.length > 0 ? { visuals } : {}),
      evaluation: assessmentEvaluation(definition, scores),
    },
  };
}

export function answeredQuestionCount(
  definition: AssessmentDefinition,
  answers: AssessmentAnswers,
): number {
  return definition.questions.filter((question) => answers[question.id] !== undefined).length;
}

export function formatCompletedAssessment(
  definition: AssessmentDefinition,
  result: ScoredAssessment,
  subjectLabel = '',
): string {
  const subject = subjectLabel.trim() ? `\nПациент / участник: ${subjectLabel.trim()}` : '';
  const date = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(result.completedAt));
  const scores = result.scores
    .map(
      (score) => `- ${score.label}: ${score.percent}% (${score.rawScore} из ${score.maximumScore})`,
    )
    .join('\n');
  return [
    definition.title,
    `Дата: ${date}${subject}`,
    '',
    result.headline,
    result.summary,
    '',
    ...(scores ? ['Шкалы:', scores, ''] : []),
    `Ограничение: ${result.disclaimer}`,
    `Версия: ${definition.id}`,
  ].join('\n');
}

export function formatBlankAssessment(definition: AssessmentDefinition): string {
  const hasPerQuestionOptions = definition.questions.some(
    (question) => question.responseOptions !== undefined,
  );
  const optionText = (option: AssessmentResponseOption): string =>
    option.hideValue ? option.label : `${option.value} — ${option.label}`;
  const showsValues = definition.questions.some((question) =>
    questionResponseOptions(definition, question).some((option) => !option.hideValue),
  );
  const sharedOptionsText = definition.responseOptions.map(optionText).join('; ');
  const questions = definition.questions
    .map((question, index) => {
      const options = questionResponseOptions(definition, question);
      const bracket = options.some((option) => !option.hideValue)
        ? `  [ ${options.map((option) => option.value).join('  ')} ]`
        : '';
      if (!question.responseOptions) return `${index + 1}. ${question.prompt}${bracket}`;
      const optionsText = options.map(optionText).join('; ');
      return `${index + 1}. ${question.prompt}${bracket}\n   ${optionsText}`;
    })
    .join('\n');
  const instruction = hasPerQuestionOptions
    ? showsValues
      ? 'Инструкция: для каждого пункта отметьте подходящий вариант ответа (значения указаны рядом с пунктом).'
      : 'Инструкция: для каждого пункта отметьте подходящий вариант ответа.'
    : `Инструкция: оцените, насколько каждое утверждение похоже на вас. ${sharedOptionsText}.`;
  return [
    definition.title,
    definition.description,
    '',
    instruction,
    '',
    questions,
    '',
    `Ограничение: ${definition.disclaimer}`,
    `Версия: ${definition.id}`,
  ].join('\n');
}

export function formatAssessmentRecord(
  definition: AssessmentDefinition,
  record: AssessmentRecord,
): string {
  if (record.kind === 'manual') {
    return [
      definition.title,
      record.subjectLabel ? `Пациент / участник: ${record.subjectLabel}` : '',
      `Дата записи: ${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(
        new Date(record.createdAt),
      )}`,
      '',
      record.text,
      '',
      'Источник записи: результат внесён вручную; версия опросника не проверялась.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (record.kind === 'incomplete') {
    return [
      definition.title,
      record.subjectLabel ? `Пациент / участник: ${record.subjectLabel}` : '',
      `Черновик: заполнено ${Object.keys(record.answers).length} из ${record.totalQuestions}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return formatCompletedAssessment(definition, record.result, record.subjectLabel);
}
