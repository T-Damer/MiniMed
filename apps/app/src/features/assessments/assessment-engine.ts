import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentRecord,
  AssessmentResponseValue,
  AssessmentScaleScore,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';

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

function roundedPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function temperamentHeadline(scores: readonly AssessmentScaleScore[]): string {
  const extraversion = scores.find((score) => score.scaleId === 'extraversion')?.percent ?? 50;
  const stability = scores.find((score) => score.scaleId === 'emotional-stability')?.percent ?? 50;
  if (extraversion >= 50 && stability >= 50) {
    return 'Классический ориентир: сангвинический профиль';
  }
  if (extraversion >= 50 && stability < 50) {
    return 'Классический ориентир: холерический профиль';
  }
  if (extraversion < 50 && stability >= 50) {
    return 'Классический ориентир: флегматический профиль';
  }
  return 'Классический ориентир: меланхолический профиль';
}

function genericHeadline(scores: readonly AssessmentScaleScore[]): string {
  const leading = scores.slice(0, 2).map((score) => score.label);
  return leading.length > 1
    ? `Наиболее выражены: ${leading.join(' и ')}`
    : `Наиболее выражена шкала: ${leading[0] ?? 'нет данных'}`;
}

function buildSummary(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
): string {
  const top = scores.slice(0, Math.min(3, scores.length));
  const scoreText = top.map((score) => `${score.shortLabel} — ${score.percent}%`).join('; ');
  if (definition.slug === 'temperament-profile') {
    return `${temperamentHeadline(scores)}. По двум измерениям: ${scoreText}. Значения отражают ответы в момент прохождения и не являются клиническим заключением.`;
  }
  return `${genericHeadline(scores)}. Нормированные показатели: ${scoreText}. Профиль показывает относительную выраженность шкал внутри этого опросника, а не сравнение с популяционной нормой.`;
}

export function scoreAssessment(
  definition: AssessmentDefinition,
  answers: AssessmentAnswers,
  completedAt = new Date().toISOString(),
): AssessmentScoringResult {
  const values = definition.responseOptions.map((option) => option.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum === maximum) {
    return { ok: false, error: 'У опросника неверно настроена шкала ответов.' };
  }

  const validValues = new Set(values);
  const totals = new Map<string, { rawScore: number; count: number }>();
  for (const question of definition.questions) {
    const answer = answers[question.id];
    if (answer === undefined) {
      return { ok: false, error: `Не заполнен пункт: «${question.prompt}».` };
    }
    if (!validValues.has(answer)) {
      return { ok: false, error: `Недопустимое значение ответа для пункта ${question.id}.` };
    }
    if (!definition.scales.some((scale) => scale.id === question.scaleId)) {
      return { ok: false, error: `Пункт ${question.id} ссылается на неизвестную шкалу.` };
    }
    const current = totals.get(question.scaleId) ?? { rawScore: 0, count: 0 };
    totals.set(question.scaleId, {
      rawScore:
        current.rawScore + scoreForResponse(answer, question.reverse === true, minimum, maximum),
      count: current.count + 1,
    });
  }

  const scores = definition.scales
    .map((scale): AssessmentScaleScore => {
      const total = totals.get(scale.id) ?? { rawScore: 0, count: 0 };
      const minimumScore = total.count * minimum;
      const maximumScore = total.count * maximum;
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
  const headline =
    definition.slug === 'temperament-profile'
      ? temperamentHeadline(scores)
      : genericHeadline(scores);

  return {
    ok: true,
    value: {
      assessmentId: definition.id,
      completedAt,
      scores,
      primaryScaleIds,
      headline,
      summary: buildSummary(definition, scores),
      disclaimer: definition.disclaimer,
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
    'Шкалы:',
    scores,
    '',
    `Ограничение: ${result.disclaimer}`,
    `Версия: ${definition.id}`,
  ].join('\n');
}

export function formatBlankAssessment(definition: AssessmentDefinition): string {
  const options = definition.responseOptions
    .map((option) => `${option.value} — ${option.label}`)
    .join('; ');
  const questions = definition.questions
    .map((question, index) => `${index + 1}. ${question.prompt}  [ 1  2  3  4  5 ]`)
    .join('\n');
  return [
    definition.title,
    definition.description,
    '',
    `Инструкция: оцените, насколько каждое утверждение похоже на вас. ${options}.`,
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
  return formatCompletedAssessment(definition, record.result, record.subjectLabel);
}
