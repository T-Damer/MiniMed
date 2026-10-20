import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { anyAgeScope, type ToolDefinitionRecord } from '@localmed/contracts';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearDownloadedAssessments,
  loadAssessmentDefinition,
  registerDownloadedAssessment,
} from '@/features/assessments/assessment-catalog';
import {
  answeredQuestionCount,
  formatCompletedAssessment,
  scoreAssessment,
} from '@/features/assessments/assessment-engine';
import type {
  AssessmentAnswers,
  AssessmentDefinition,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import { loadToolModuleRecords } from '@/features/calculators/tool-module-test-helpers';

beforeAll(() => {
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

afterEach(() => {
  clearDownloadedAssessments();
  for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
    if (record.kind === 'assessment') registerDownloadedAssessment(record);
  }
});

async function uniformAnswers(
  slug: string,
  value: AssessmentResponseValue,
): Promise<{
  readonly definition: AssessmentDefinition;
  readonly answers: AssessmentAnswers;
}> {
  const definition = await loadAssessmentDefinition(slug);
  return {
    definition,
    answers: Object.fromEntries(
      definition.questions.map((question) => [question.id, value]),
    ) as AssessmentAnswers,
  };
}

describe('assessment scoring', () => {
  it('requires every question to be answered', async () => {
    const definition = await loadAssessmentDefinition('paei-work-style');
    const result = scoreAssessment(definition, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Не заполнен пункт');
  });

  it('applies reverse-scored questions without exceeding normalized bounds', async () => {
    const { definition, answers } = await uniformAnswers('braverman-behavioral-profile', 5);
    const result = scoreAssessment(definition, answers, '2026-08-02T12:00:00.000Z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scores.every((score) => score.percent >= 0 && score.percent <= 100)).toBe(
      true,
    );
    expect(result.value.completedAt).toBe('2026-08-02T12:00:00.000Z');
  });

  it('derives the classical temperament shorthand from two dimensions', async () => {
    const definition = await loadAssessmentDefinition('temperament-profile');
    const answers = Object.fromEntries(
      definition.questions.map((question) => [question.id, question.reverse ? 1 : 5]),
    ) as AssessmentAnswers;
    const result = scoreAssessment(definition, answers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.headline).toContain('сангвинический');
      expect(result.value.visuals?.[0]).toMatchObject({
        type: 'scatter',
        datasets: [{ data: [{ x: 100, y: 100 }] }],
        annotations: [{ kind: 'quadrants' }, { kind: 'rings' }],
      });
    }
  });

  it.each([
    ['braverman-behavioral-profile', 'Ведущего паттерна нет', 'Ведущий паттерн'],
    ['paei-work-style', 'Ведущей функции нет', 'Ведущая функция'],
    ['personal-egogram', 'Одного наиболее выраженного эго-состояния нет', 'Наиболее выражено'],
    ['team-role-profile', 'Ведущей роли нет', 'Ведущая роль'],
  ])('%s names no leading scale when every scale is tied', async (slug, tied, leading) => {
    const { definition, answers } = await uniformAnswers(slug, 3);
    // 3 of 1–5 on every item, reversed or not: every scale ends at the same percentage.
    const equal = scoreAssessment(definition, answers);
    if (!equal.ok) throw new Error(equal.error);
    expect(new Set(equal.value.scores.map((score) => score.percent)).size).toBe(1);
    expect(equal.value.headline).toBe(tied);

    // One scale raised above the rest is a leader again.
    const first = definition.scales[0];
    if (!first) throw new Error('no scales');
    const raised = Object.fromEntries(
      definition.questions.map((question) => {
        const high = question.scaleId === first.id;
        const value = high === Boolean(question.reverse) ? 1 : 5;
        return [question.id, value];
      }),
    ) as AssessmentAnswers;
    const leader = scoreAssessment(definition, raised);
    if (!leader.ok) throw new Error(leader.error);
    expect(leader.value.headline).toContain(leading);
    expect(leader.value.headline).toContain(first.label.split(' ')[0] ?? first.label);
  });

  it('shows two equal top scales as no single leader, not as the first of them', async () => {
    const definition = await loadAssessmentDefinition('paei-work-style');
    const [one, two] = definition.scales;
    if (!one || !two) throw new Error('scales missing');
    const answers = Object.fromEntries(
      definition.questions.map((question) => {
        const high = question.scaleId === one.id || question.scaleId === two.id;
        return [question.id, high === Boolean(question.reverse) ? 1 : 5];
      }),
    ) as AssessmentAnswers;
    const result = scoreAssessment(definition, answers);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.headline).toBe('Ведущей функции нет');
  });

  it('writes the score list with the decimal comma and the same percent format as elsewhere', async () => {
    const { definition, answers } = await uniformAnswers('personal-egogram', 4);
    const result = scoreAssessment(definition, answers);
    if (!result.ok) throw new Error(result.error);
    const text = formatCompletedAssessment(definition, result.value);
    expect(text).not.toMatch(/\d\.\d%/u);
    expect(text).toMatch(/\d(?:,\d)? %/u);
  });

  it('reports questionnaire completion', async () => {
    const { definition, answers } = await uniformAnswers('personal-egogram', 3);
    expect(answeredQuestionCount(definition, answers)).toBe(definition.questions.length);
    expect(answeredQuestionCount(definition, {})).toBe(0);
  });

  it('scores the Golubovich EPDS adaptation with its source key and safety response', async () => {
    const epds = loadToolModuleRecords(['content/tool-modules/obstetrics-gynecology.json']).find(
      (record) => record.id === 'minimed.assessment.epds',
    );
    if (!epds) throw new Error('EPDS is missing from the obstetrics module.');
    registerDownloadedAssessment(epds);
    const definition = await loadAssessmentDefinition('postnatal-mood-epds');
    expect(definition.version).toBe('1.2.0');
    expect(definition.questions).toHaveLength(10);
    expect(definition.questions[0]?.prompt).toBe(
      'Я была готова смеяться и видеть светлую сторону происходящего',
    );
    expect(definition.questions[9]?.responseOptions?.[2]).toEqual({
      value: 1,
      label: 'Едва ли',
    });
    expect(definition.license.sourceUrl).toBe(
      'https://med.by/methods/pdf/full/158-1203.pdf#page=7',
    );
    // Golubovich 2003, p. 3: items 1, 2, 4 ascend; all other items descend.
    for (const [index, question] of definition.questions.entries()) {
      expect(question.reverse).toBeUndefined();
      expect(question.responseOptions?.map((option) => option.value)).toEqual(
        [0, 1, 3].includes(index) ? [0, 1, 2, 3] : [3, 2, 1, 0],
      );
    }
    for (const total of [0, 7, 8, 9, 10, 13, 21, 30]) {
      const answers = Object.fromEntries(
        definition.questions.map((question, index) => [
          question.id,
          Math.min(3, Math.max(0, total - index * 3)),
        ]),
      );
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.scores[0]).toMatchObject({
        rawScore: total,
        minimumScore: 0,
        maximumScore: 30,
      });
      expect(result.value.headline).toContain(total >= 8 ? 'достигает' : 'ниже');
      // The same band is named by the headline and by the declared verdict: one verdict.
      expect(result.value.evaluation?.verdict?.title).toBe(result.value.headline);
      expect(result.value.alerts !== undefined).toBe((answers['postnatal-mood-epds-10'] ?? 0) > 0);
      expect(result.value.summary).toContain('8–9 баллов');
    }
    for (const safetyAnswer of [0, 1, 2, 3]) {
      const answers = Object.fromEntries(definition.questions.map((question) => [question.id, 0]));
      answers['postnatal-mood-epds-10'] = safetyAnswer;
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      // Item 10 is a separate alert whatever the score; the band wording never carries it.
      expect(result.value.alerts?.map((alert) => alert.id) ?? []).toEqual(
        safetyAnswer > 0 ? ['epds-item-10'] : [],
      );
      expect(result.value.summary).not.toContain('пункт');
      if (safetyAnswer > 0) {
        expect(formatCompletedAssessment(definition, result.value)).toContain('ВАЖНО: Пункт 10');
      }
    }
    expect(scoreAssessment(definition, {}).ok).toBe(false);
  });

  it('scores PHQ-9 at every band boundary with its difficulty item apart and the item-9 alert', async () => {
    const definition = await loadAssessmentDefinition('phq-9');
    expect(definition.questions).toHaveLength(10);
    expect(definition.questions[0]?.prompt).toBe('Вам не хотелось ничего делать');
    const items = definition.questions.filter((question) => question.scaleId === 'phq9-total');
    expect(items).toHaveLength(9);
    // Kroenke, Spitzer, Williams 2001: 0–4, 5–9, 10–14, 15–19, 20–27.
    const bands: Array<[number, string]> = [
      [0, 'minimal'],
      [4, 'minimal'],
      [5, 'mild'],
      [9, 'mild'],
      [10, 'moderate'],
      [14, 'moderate'],
      [15, 'moderately-severe'],
      [19, 'moderately-severe'],
      [20, 'severe'],
      [27, 'severe'],
    ];
    for (const [total, rangeId] of bands) {
      // Item 9 stays 0 so only the total decides the band.
      const answers: Record<string, number> = { 'phq9-difficulty': 3, 'phq9-09': 0 };
      let left = total;
      for (const question of items.slice(0, 8)) {
        answers[question.id] = Math.min(3, left);
        left -= answers[question.id] ?? 0;
      }
      if (left > 0) answers['phq9-09'] = left;
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      const score = result.value.scores.find((candidate) => candidate.scaleId === 'phq9-total');
      expect(score).toMatchObject({ rawScore: total, minimumScore: 0, maximumScore: 27 });
      expect(result.value.evaluation?.verdict?.rangeId).toBe(rangeId);
      expect(result.value.evaluation?.verdict?.title).toBe(result.value.headline);
    }
    for (const safetyAnswer of [0, 1, 2, 3]) {
      const answers = Object.fromEntries(definition.questions.map((question) => [question.id, 0]));
      answers['phq9-09'] = safetyAnswer;
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      // Item 9 raises its alert whatever the total, even inside the minimal band.
      expect(result.value.alerts?.map((alert) => alert.id) ?? []).toEqual(
        safetyAnswer > 0 ? ['phq9-item-9'] : [],
      );
      expect(result.value.evaluation?.verdict?.rangeId).toBe('minimal');
    }
    const withoutDifficulty = Object.fromEntries(items.map((question) => [question.id, 1]));
    expect(scoreAssessment(definition, withoutDifficulty).ok).toBe(false);
  });

  it('scores GAD-7 at every band boundary', async () => {
    const definition = await loadAssessmentDefinition('gad-7');
    expect(definition.questions).toHaveLength(7);
    expect(definition.questions[0]?.prompt).toBe(
      'Вы нервничали, тревожились или испытывали сильный стресс',
    );
    expect(definition.alerts ?? []).toEqual([]);
    // Spitzer et al. 2006: 0–4, 5–9, 10–14, 15–21.
    const bands: Array<[number, string]> = [
      [0, 'minimal'],
      [4, 'minimal'],
      [5, 'mild'],
      [9, 'mild'],
      [10, 'moderate'],
      [14, 'moderate'],
      [15, 'severe'],
      [21, 'severe'],
    ];
    for (const [total, rangeId] of bands) {
      const answers: Record<string, number> = {};
      let left = total;
      for (const question of definition.questions) {
        answers[question.id] = Math.min(3, left);
        left -= answers[question.id] ?? 0;
      }
      const result = scoreAssessment(definition, answers);
      if (!result.ok) throw new Error(result.error);
      expect(result.value.scores[0]).toMatchObject({
        rawScore: total,
        minimumScore: 0,
        maximumScore: 21,
      });
      expect(result.value.evaluation?.verdict?.rangeId).toBe(rangeId);
      expect(result.value.evaluation?.verdict?.title).toBe(result.value.headline);
    }
  });

  it('scores the published SHAS form at every band boundary and rejects incomplete answers', async () => {
    const { definition, answers } = await uniformAnswers('asthenic-state-shas', 1);
    expect(definition.questions).toHaveLength(30);
    expect(definition.questions[0]?.prompt).toBe('Я работаю с большим напряжением');
    expect(definition.questions.every((question) => !question.reverse)).toBe(true);
    expect(definition.responseOptions.map((option) => option.value)).toEqual([1, 2, 3, 4]);
    expect(definition.license.notice).toContain('CC BY 4.0');
    // Shabrov et al. 2022, pp. 59–60: direct sum, four inclusive bands.
    for (const [total, rangeId, headline] of [
      [30, 'shas-absent', 'Отсутствие астении по ШАС'],
      [50, 'shas-absent', 'Отсутствие астении по ШАС'],
      [51, 'shas-mild', 'Слабая астения по ШАС'],
      [75, 'shas-mild', 'Слабая астения по ШАС'],
      [76, 'shas-moderate', 'Умеренная астения по ШАС'],
      [100, 'shas-moderate', 'Умеренная астения по ШАС'],
      [101, 'shas-marked', 'Выраженная астения по ШАС'],
      [120, 'shas-marked', 'Выраженная астения по ШАС'],
    ] as const) {
      const result = scoreAssessment(
        definition,
        Object.fromEntries(
          definition.questions.map((question, index) => [
            question.id,
            1 + Math.min(3, Math.max(0, total - 30 - index * 3)),
          ]),
        ),
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.value.scores[0]).toMatchObject({
        rawScore: total,
        minimumScore: 30,
        maximumScore: 120,
      });
      expect(result.value.headline).toBe(headline);
      expect(result.value.evaluation).toMatchObject({
        status: 'verdict',
        verdict: { rangeId, title: headline },
        sourceIds: ['shabrov-2022-shas'],
      });
    }
    expect(scoreAssessment(definition, {}).ok).toBe(false);
    for (const value of [0, 5]) {
      expect(scoreAssessment(definition, { ...answers, 'asthenic-state-shas-30': value }).ok).toBe(
        false,
      );
    }
  });

  it('records responses without a score when a local questionnaire has no weights', () => {
    const definition = {
      id: 'local-no-score',
      slug: 'local-no-score',
      title: 'Опросник без баллов',
      shortTitle: 'Без баллов',
      aliases: [],
      bankId: 'mine',
      bankLabel: 'Мои опросники',
      category: 'mine',
      description: 'Локальный опросник.',
      estimatedMinutes: 1,
      audience: 'Локальный файл',
      ageScope: anyAgeScope('Тест'),
      responseOptions: [],
      scales: [],
      scoringMode: 'responses-only',
      questions: [
        {
          id: 'question-1',
          prompt: 'Выберите ответ',
          scaleId: 'total',
          responseOptions: [
            { value: 0, label: 'Нет', hideValue: true },
            { value: 1, label: 'Да', hideValue: true },
          ],
        },
      ],
      disclaimer: 'Не является диагнозом.',
      evidenceNote: 'Локальный файл.',
      license: { kind: 'project-original', notice: 'Локальный пользовательский опросник.' },
    } satisfies AssessmentDefinition;

    const result = scoreAssessment(definition, { 'question-1': 1 }, '2026-08-29T12:00:00.000Z');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scores).toEqual([]);
    expect(result.value.summary).toBe('Выбранные ответы сохранены без подсчёта баллов.');
    expect(formatCompletedAssessment(definition, result.value)).not.toContain('Шкалы:');
  });

  describe('schema-driven interpretations', () => {
    afterEach(() => {
      for (const record of loadToolModuleRecords(['content/tool-modules/psychology.json'])) {
        if (record.kind === 'assessment') registerDownloadedAssessment(record);
      }
    });

    it('uses interpretation bands from a downloaded assessment definition', async () => {
      const record: ToolDefinitionRecord = {
        id: 'minimed.assessment.test-schema-interpretations',
        kind: 'assessment',
        version: '1.0.0',
        slug: 'test-schema-interpretations',
        title: 'Тестовая шкала интерпретаций',
        shortTitle: 'Тест интерпретаций',
        aliases: ['test schema interpretations'],
        bankId: 'neonatology',
        bankLabel: 'Неонатология',
        category: 'test',
        description: 'Минимальный опросник для проверки schema-driven интерпретаций.',
        estimatedMinutes: 1,
        audience: 'Тест',
        definition: {
          schemaVersion: 2,
          id: 'minimed.assessment.test-schema-interpretations',
          slug: 'test-schema-interpretations',
          title: 'Тестовая шкала интерпретаций',
          shortTitle: 'Тест интерпретаций',
          aliases: ['test schema interpretations'],
          bankId: 'neonatology',
          bankLabel: 'Неонатология',
          category: 'test',
          description: 'Минимальный опросник для проверки schema-driven интерпретаций.',
          estimatedMinutes: 1,
          audience: 'Тест',
          ageScope: anyAgeScope('Тест'),
          responseOptions: [
            { value: 0, label: '0' },
            { value: 1, label: '1' },
            { value: 2, label: '2' },
          ],
          scales: [
            {
              id: 'test-total',
              label: 'Итог',
              shortLabel: 'Итог',
              description: 'Сумма двух пунктов.',
            },
          ],
          questions: [
            { id: 'test-q1', prompt: 'Пункт 1', scaleId: 'test-total' },
            { id: 'test-q2', prompt: 'Пункт 2', scaleId: 'test-total' },
          ],
          disclaimer: 'Тестовый опросник не предназначен для клинического применения.',
          evidenceNote: 'Тестовые пороги: 0–1 низкий, 2–4 умеренный.',
          interpretations: [
            {
              minScore: 0,
              maxScore: 1,
              headline: 'Низкий результат',
              message: '0–1 балл: низкий результат по тестовой шкале.',
            },
            {
              minScore: 2,
              maxScore: 4,
              headline: 'Умеренный результат',
              message: '2–4 балла: умеренный результат по тестовой шкале.',
            },
          ],
          evaluation: {
            status: 'unavailable',
            rules: [],
            missingContext: [],
            reason: 'Тест проверяет только presentation-интерпретации.',
            sourceIds: [],
          },
          observationMappings: [
            { metricId: 'test-total', label: 'Итог', unit: 'баллы', scaleId: 'test-total' },
          ],
          license: {
            kind: 'project-original',
            notice: 'Тестовый опросник MiniMed для проверки schema-driven интерпретаций.',
          },
        },
        sources: [],
      };

      registerDownloadedAssessment(record);
      const definition = await loadAssessmentDefinition('test-schema-interpretations');
      const lowResult = scoreAssessment(definition, { 'test-q1': 0, 'test-q2': 1 });
      expect(lowResult.ok).toBe(true);
      if (!lowResult.ok) return;
      expect(lowResult.value.headline).toBe('Низкий результат');
      expect(lowResult.value.summary).toContain('низкий результат');

      const moderateResult = scoreAssessment(definition, { 'test-q1': 2, 'test-q2': 2 });
      expect(moderateResult.ok).toBe(true);
      if (!moderateResult.ok) return;
      expect(moderateResult.value.headline).toBe('Умеренный результат');
      expect(moderateResult.value.summary).toContain('умеренный результат');
    });

    it('scores NIPS from neonatology tool module with schema interpretation bands', async () => {
      const module = JSON.parse(
        readFileSync(resolve(process.cwd(), 'content/tool-modules/neonatology.json'), 'utf8'),
      ) as { tools: readonly ToolDefinitionRecord[] };
      const nips = module.tools.find((tool) => tool.slug === 'neonatal-infant-pain-scale');
      expect(nips).toBeDefined();
      if (!nips) return;

      registerDownloadedAssessment(nips);
      const definition = await loadAssessmentDefinition('neonatal-infant-pain-scale');
      const answers = Object.fromEntries(
        definition.questions.map((question) => [question.id, 0]),
      ) as AssessmentAnswers;
      const result = scoreAssessment(definition, answers);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.headline).toBe('Признаков боли по NIPS не выявлено');
      expect(result.value.summary).toContain('0–1 балл');
    });

    it('uses the declarative score rule even when interpretation copy disagrees', () => {
      const definition = {
        id: 'minimed.assessment.rule-copy-divergence',
        slug: 'rule-copy-divergence',
        title: 'Проверка правил',
        shortTitle: 'Правила',
        aliases: [],
        bankId: 'test',
        bankLabel: 'Тест',
        category: 'test',
        description: 'Проверка стабильной области баллов.',
        estimatedMinutes: 1,
        audience: 'Тест',
        ageScope: anyAgeScope('Тест'),
        responseOptions: [
          { value: 0, label: 'Нет' },
          { value: 1, label: 'Да' },
        ],
        scales: [
          {
            id: 'test-total',
            label: 'Итог',
            shortLabel: 'Итог',
            description: 'Сумма ответов.',
          },
        ],
        questions: [
          { id: 'test-q1', prompt: 'Пункт 1', scaleId: 'test-total' },
          { id: 'test-q2', prompt: 'Пункт 2', scaleId: 'test-total' },
        ],
        disclaimer: 'Только тест.',
        evidenceNote: 'Тестовое правило.',
        interpretations: [
          {
            minScore: 0,
            maxScore: 2,
            scaleId: 'test-total',
            headline: 'Текст говорит: низкий результат',
            message: 'Это presentation copy, а не источник вердикта.',
          },
        ],
        evaluation: {
          status: 'verdict' as const,
          rules: [
            {
              when: 'score_test_total >= 2',
              verdict: {
                rangeId: 'declared-rule',
                title: 'Вердикт из правила',
                explanation: 'Правило сопоставлено по стабильному score scope.',
                attentionLevel: 'moderate' as const,
                lowerInclusive: true,
                upperInclusive: true,
                sourceIds: ['test-source'],
              },
            },
          ],
          missingContext: [],
          sourceIds: ['test-source'],
        },
        observationMappings: [
          {
            metricId: 'test-total',
            label: 'Итог',
            unit: 'баллы',
            scaleId: 'test-total',
            method: 'assessment:rule-copy-divergence',
          },
        ],
        license: { kind: 'project-original' as const, notice: 'Тест.' },
      } satisfies AssessmentDefinition;

      const matched = scoreAssessment(definition, { 'test-q1': 1, 'test-q2': 1 });
      expect(matched.ok).toBe(true);
      if (!matched.ok) return;
      expect(matched.value.evaluation).toMatchObject({
        status: 'verdict',
        verdict: { title: 'Вердикт из правила' },
      });
      expect(matched.value.evaluation?.verdict?.title).not.toBe('Текст говорит: низкий результат');

      const notMatched = scoreAssessment(definition, { 'test-q1': 0, 'test-q2': 1 });
      expect(notMatched.ok).toBe(true);
      if (notMatched.ok) expect(notMatched.value.evaluation?.status).toBe('unavailable');
    });
  });
});
