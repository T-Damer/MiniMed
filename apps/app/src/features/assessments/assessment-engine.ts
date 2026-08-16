import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentQuestion,
  AssessmentRecord,
  AssessmentResponseOption,
  AssessmentResponseValue,
  AssessmentScaleScore,
  ScoredAssessment,
} from '@/features/assessments/assessment-types';

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

interface ClinicalInterpretation {
  readonly headline: string;
  readonly summary: string;
}

function apgarInterpretation(scores: readonly AssessmentScaleScore[]): ClinicalInterpretation {
  const raw = scores.find((score) => score.scaleId === 'apgar-total')?.rawScore ?? 0;
  if (raw >= 7) {
    return {
      headline: `Показатели в пределах нормы: ${raw} из 10`,
      summary:
        '7–10 баллов по принятой интерпретации соответствуют удовлетворительной адаптации новорождённого. Оценка не заменяет полный клинический осмотр и стандартный протокол повторной оценки на 1-й и 5-й минутах.',
    };
  }
  if (raw >= 4) {
    return {
      headline: `Умеренное угнетение адаптации: ${raw} из 10`,
      summary:
        '4–6 баллов по принятой интерпретации указывают на умеренное угнетение и могут потребовать дополнительной помощи по действующему протоколу реанимации новорождённых. Оценивайте вместе с полной клинической картиной.',
    };
  }
  return {
    headline: `Значительное угнетение: ${raw} из 10`,
    summary:
      '0–3 балла соответствуют выраженному угнетению состояния и обычно требуют немедленных реанимационных мероприятий по действующему протоколу. Оценивайте вместе с полной клинической картиной.',
  };
}

function epdsInterpretation(
  scores: readonly AssessmentScaleScore[],
  answers: AssessmentAnswers,
): ClinicalInterpretation {
  const raw = scores.find((score) => score.scaleId === 'epds-total')?.rawScore ?? 0;
  const selfHarmAnswer = answers['postnatal-mood-epds-10'] ?? 0;
  const safetyNote =
    selfHarmAnswer > 0
      ? ' Ответ на пункт о мыслях о причинении себе вреда — выше нуля: рекомендуется как можно скорее обратиться к врачу, а при непосредственной опасности — вызвать скорую помощь.'
      : '';
  if (raw >= 13) {
    return {
      headline: `Результат указывает на вероятный депрессивный эпизод: ${raw} из 30`,
      summary: `13 баллов и более по принятой интерпретации соответствуют высокой вероятности депрессивного эпизода и являются поводом для консультации специалиста.${safetyNote} EPDS — скрининговый, а не диагностический инструмент.`,
    };
  }
  if (raw >= 10) {
    return {
      headline: `Пограничный результат: ${raw} из 30`,
      summary: `10–12 баллов — пограничная зона; рекомендуется повторная оценка через 2 недели или консультация специалиста при сохранении симптомов.${safetyNote} EPDS — скрининговый, а не диагностический инструмент.`,
    };
  }
  return {
    headline: `Низкая вероятность депрессивного эпизода: ${raw} из 30`,
    summary: `Менее 10 баллов обычно не указывает на депрессивный эпизод, но не исключает его полностью.${safetyNote} EPDS — скрининговый, а не диагностический инструмент.`,
  };
}

function ferrimanGallweyInterpretation(
  scores: readonly AssessmentScaleScore[],
): ClinicalInterpretation {
  const raw = scores.find((score) => score.scaleId === 'fg-total')?.rawScore ?? 0;
  if (raw >= 8) {
    return {
      headline: `Результат соответствует критериям гирсутизма: ${raw} из 36`,
      summary:
        'Порог 8 баллов и выше по модифицированной шкале Ферримана–Голлвея принят как критерий клинического гирсутизма в большинстве популяций. Оценивайте вместе с другими признаками (нарушения цикла, акне, лабораторные данные) при решении о дальнейшем обследовании.',
    };
  }
  return {
    headline: `Признаков гирсутизма не выявлено: ${raw} из 36`,
    summary:
      'Результат ниже принятого порога (8 баллов) для модифицированной шкалы Ферримана–Голлвея.',
  };
}

function whooleyInterpretation(scores: readonly AssessmentScaleScore[]): ClinicalInterpretation {
  const raw = scores.find((score) => score.scaleId === 'whooley-total')?.rawScore ?? 0;
  if (raw > 0) {
    return {
      headline: 'Положительный результат скрининга',
      summary:
        'Положительный ответ хотя бы на один из вопросов — повод для более подробного разговора о настроении и, при необходимости, использования развёрнутого инструмента (например, EPDS) или консультации специалиста.',
    };
  }
  return {
    headline: 'Отрицательный результат скрининга',
    summary:
      'Отрицательные ответы на все вопросы связаны с низкой вероятностью текущего депрессивного эпизода, но не исключают его полностью.',
  };
}

function pucaiInterpretation(scores: readonly AssessmentScaleScore[]): ClinicalInterpretation {
  const raw = scores.find((score) => score.scaleId === 'pucai-total')?.rawScore ?? 0;
  if (raw < 10) {
    return {
      headline: `Клиническая ремиссия по PUCAI: ${raw} из 85`,
      summary:
        'Менее 10 баллов соответствует ремиссии по принятой градации PUCAI. Индекс не заменяет клиническое наблюдение и оценку других данных.',
    };
  }
  if (raw < 35) {
    return {
      headline: `Лёгкая активность по PUCAI: ${raw} из 85`,
      summary:
        '10–34 балла соответствуют лёгкой активности язвенного колита по принятой градации PUCAI.',
    };
  }
  if (raw < 65) {
    return {
      headline: `Умеренная активность по PUCAI: ${raw} из 85`,
      summary:
        '35–64 балла соответствуют умеренной активности язвенного колита по принятой градации PUCAI.',
    };
  }
  return {
    headline: `Тяжёлая активность по PUCAI: ${raw} из 85`,
    summary:
      '65–85 баллов соответствуют тяжёлой активности язвенного колита по принятой градации PUCAI; нужна клиническая оценка срочности помощи по действующему протоколу.',
  };
}

const CLINICAL_INTERPRETERS: Readonly<
  Record<
    string,
    (scores: readonly AssessmentScaleScore[], answers: AssessmentAnswers) => ClinicalInterpretation
  >
> = {
  'apgar-newborn-score': (scores) => apgarInterpretation(scores),
  'postnatal-mood-epds': (scores, answers) => epdsInterpretation(scores, answers),
  'ferriman-gallwey-hirsutism': (scores) => ferrimanGallweyInterpretation(scores),
  'perinatal-mood-whooley': (scores) => whooleyInterpretation(scores),
  'pediatric-ulcerative-colitis-activity-index': (scores) => pucaiInterpretation(scores),
};

function buildSummary(
  definition: AssessmentDefinition,
  scores: readonly AssessmentScaleScore[],
  answers: AssessmentAnswers,
): string {
  const clinical = CLINICAL_INTERPRETERS[definition.slug]?.(scores, answers);
  if (clinical) return clinical.summary;
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
  const clinical = CLINICAL_INTERPRETERS[definition.slug]?.(scores, answers);
  const headline =
    clinical?.headline ??
    (definition.slug === 'temperament-profile'
      ? temperamentHeadline(scores)
      : genericHeadline(scores));

  return {
    ok: true,
    value: {
      assessmentId: definition.id,
      completedAt,
      scores,
      primaryScaleIds,
      headline,
      summary: buildSummary(definition, scores, answers),
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
  const hasPerQuestionOptions = definition.questions.some(
    (question) => question.responseOptions !== undefined,
  );
  const sharedOptionsText = definition.responseOptions
    .map((option) => `${option.value} — ${option.label}`)
    .join('; ');
  const questions = definition.questions
    .map((question, index) => {
      const options = questionResponseOptions(definition, question);
      const bracket = `[ ${options.map((option) => option.value).join('  ')} ]`;
      if (!question.responseOptions) return `${index + 1}. ${question.prompt}  ${bracket}`;
      const optionsText = options.map((option) => `${option.value} — ${option.label}`).join('; ');
      return `${index + 1}. ${question.prompt}  ${bracket}\n   ${optionsText}`;
    })
    .join('\n');
  const instruction = hasPerQuestionOptions
    ? 'Инструкция: для каждого пункта отметьте подходящий вариант ответа (значения указаны рядом с пунктом).'
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
