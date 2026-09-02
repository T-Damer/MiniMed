import type {
  QueryParserCanonicalEntity,
  QueryParserContextExpectation,
  QueryParserContextField,
  QueryParserFixture,
  QueryParserFixtureSet,
  QueryParserForbiddenFactExpectation,
} from './query-parser-scoring';
import { validateQueryParserFixtures } from './query-parser-scoring';

export const QUERY_PARSER_GENERATED_CI_SEED = 20_260_831;
export const QUERY_PARSER_CASES_PER_SCENARIO = 8;

export type QueryParserMutationKind =
  | 'word-order'
  | 'spacing'
  | 'punctuation'
  | 'case'
  | 'yo-fold'
  | 'decimal-separator'
  | 'abbreviation'
  | 'inflection'
  | 'common-typo'
  | 'polite-filler'
  | 'irrelevant-number'
  | 'irrelevant-measurement';

interface FactBlueprint
  extends Omit<QueryParserContextExpectation, 'raw' | 'range' | 'normalizedValue'> {
  readonly normalizedValue: string;
}

interface SurfaceFact extends FactBlueprint {
  readonly raw: string;
}

interface SurfaceVariant {
  readonly text: string;
  readonly facts: readonly SurfaceFact[];
  readonly mutations?: readonly QueryParserMutationKind[];
}

interface ScenarioPart {
  readonly id: string;
  readonly variants: readonly SurfaceVariant[];
  readonly caseSafe?: boolean;
}

interface SemanticScenario {
  readonly id: string;
  readonly intent: QueryParserFixture['intent'];
  readonly parts: readonly ScenarioPart[];
  readonly canonicalExtras?: readonly QueryParserCanonicalEntity[];
  readonly forbidden?: readonly QueryParserForbiddenFactExpectation[];
  readonly negation?: boolean;
  readonly mutations?: readonly QueryParserMutationKind[];
}

interface RawQueryParserFixture {
  readonly query_id: string;
  readonly query: string;
  readonly intent: QueryParserFixture['intent'];
  readonly canonical_entities: readonly Record<string, unknown>[];
  readonly critical_context: readonly Record<string, unknown>[];
  readonly forbidden_facts: readonly Record<string, unknown>[];
  negation?: {
    readonly expected: readonly Record<string, unknown>[];
    readonly forbidden: readonly Record<string, unknown>[];
  };
}

export interface QueryParserSemanticScenarioSummary {
  readonly id: string;
  readonly intent: QueryParserFixture['intent'];
  readonly expectedFacts: readonly FactBlueprint[];
  readonly canonicalExtras: readonly QueryParserCanonicalEntity[];
  readonly forbidden: readonly QueryParserForbiddenFactExpectation[];
  readonly negation: boolean;
}

export interface GeneratedQueryParserCase {
  readonly queryId: string;
  readonly scenarioId: string;
  readonly split: QueryParserFixture['split'];
  readonly mutations: readonly QueryParserMutationKind[];
}

export interface GeneratedQueryParserCorpus {
  readonly seed: number;
  readonly scenarioCount: number;
  readonly caseCount: number;
  readonly uniqueQueryCount: number;
  readonly semanticScenarios: readonly QueryParserSemanticScenarioSummary[];
  readonly cases: readonly GeneratedQueryParserCase[];
  readonly mutationCounts: Readonly<Record<QueryParserMutationKind, number>>;
  readonly fixtures: QueryParserFixtureSet;
}

const positiveFact = (
  field: QueryParserContextField,
  kind: QueryParserContextExpectation['kind'],
  raw: string,
  normalizedValue: string,
  unit: string | null = null,
): SurfaceFact => ({ field, kind, raw, normalizedValue, unit, polarity: 'positive' });

const negativeFact = (
  field: QueryParserContextField,
  kind: QueryParserContextExpectation['kind'],
  raw: string,
  normalizedValue: string,
): SurfaceFact => ({
  field,
  kind,
  raw,
  normalizedValue,
  unit: null,
  polarity: 'negative',
});

const variant = (
  text: string,
  facts: readonly SurfaceFact[] = [],
  mutations: readonly QueryParserMutationKind[] = [],
): SurfaceVariant => ({ text, facts, mutations });

const scenarios: readonly SemanticScenario[] = [
  {
    id: 'pediatric-dose-context',
    intent: 'medication',
    mutations: ['irrelevant-measurement'],
    canonicalExtras: [{ kind: 'measurement', normalizedValue: '30 кг' }],
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Препарат'), variant('Лекарство')],
      },
      {
        id: 'condition',
        caseSafe: true,
        variants: [variant('при бронхите')],
      },
      {
        id: 'age',
        variants: [
          variant('ребёнок 12 лет', [
            positiveFact('age', 'age', 'ребёнок 12 лет', '12 лет', 'лет'),
          ]),
          variant(
            'подросток 12 лет',
            [positiveFact('age', 'age', 'подросток 12 лет', '12 лет', 'лет')],
            ['inflection'],
          ),
          variant(
            '12-летнему ребёнку',
            [positiveFact('age', 'age', '12-летнему', '12 лет', 'лет')],
            ['inflection'],
          ),
          variant('возраст 12 лет', [
            positiveFact('age', 'age', 'возраст 12 лет', '12 лет', 'лет'),
          ]),
        ],
      },
      {
        id: 'weight',
        variants: [
          variant('30 кг', [positiveFact('weight', 'weight', '30 кг', '30 кг', 'кг')]),
          variant('30кг', [positiveFact('weight', 'weight', '30кг', '30 кг', 'кг')], ['spacing']),
          variant(
            '30  кг',
            [positiveFact('weight', 'weight', '30  кг', '30 кг', 'кг')],
            ['spacing'],
          ),
          variant('30 кг.', [positiveFact('weight', 'weight', '30 кг.', '30 кг', 'кг')]),
        ],
      },
      {
        id: 'route',
        variants: [
          variant(
            'в/м',
            [positiveFact('route', 'route', 'в/м', 'внутримышечно')],
            ['abbreviation'],
          ),
          variant('вм', [positiveFact('route', 'route', 'вм', 'внутримышечно')], ['abbreviation']),
          variant('внутримышечно', [
            positiveFact('route', 'route', 'внутримышечно', 'внутримышечно'),
          ]),
          variant('внутримышечно.', [
            positiveFact('route', 'route', 'внутримышечно', 'внутримышечно'),
          ]),
        ],
      },
      {
        id: 'form',
        variants: [
          variant('сироп', [positiveFact('doseForm', 'dose-form', 'сироп', 'сироп')]),
          variant(
            'сиропом',
            [positiveFact('doseForm', 'dose-form', 'сиропом', 'сироп')],
            ['inflection'],
          ),
          variant(
            'спироп',
            [positiveFact('doseForm', 'dose-form', 'спироп', 'сироп')],
            ['common-typo'],
          ),
          variant(
            'спиропом',
            [positiveFact('doseForm', 'dose-form', 'спиропом', 'сироп')],
            ['common-typo', 'inflection'],
          ),
        ],
      },
      {
        id: 'strength',
        variants: [
          variant('100 мг/5 мл', [
            positiveFact('strength', 'strength', '100 мг/5 мл', '100 мг/5 мл', 'мг/5 мл'),
          ]),
          variant(
            '100мг/5мл',
            [positiveFact('strength', 'strength', '100мг/5мл', '100 мг/5 мл', 'мг/5 мл')],
            ['spacing'],
          ),
          variant('100 мг в 5 мл', [
            positiveFact('strength', 'strength', '100 мг в 5 мл', '100 мг/5 мл', 'мг/5 мл'),
          ]),
          variant(
            '100  мг / 5  мл',
            [positiveFact('strength', 'strength', '100  мг / 5  мл', '100 мг/5 мл', 'мг/5 мл')],
            ['spacing'],
          ),
        ],
      },
      {
        id: 'frequency',
        variants: [
          variant('2 раза в день', [
            positiveFact('frequency', 'frequency', '2 раза в день', '2 раза в сутки', 'раз/сут'),
          ]),
          variant('дважды в сутки', [
            positiveFact('frequency', 'frequency', 'дважды в сутки', '2 раза в сутки', 'раз/сут'),
          ]),
          variant(
            '2раза в день',
            [positiveFact('frequency', 'frequency', '2раза в день', '2 раза в сутки', 'раз/сут')],
            ['spacing'],
          ),
          variant('два раза в сутки', [
            positiveFact('frequency', 'frequency', 'два раза в сутки', '2 раза в сутки', 'раз/сут'),
          ]),
        ],
      },
      {
        id: 'irrelevant-blood-pressure',
        variants: [
          variant('АД 120/80', [
            positiveFact('measurements', 'measurement', 'АД 120/80', '120/80', 'мм рт. ст.'),
          ]),
          variant('АД 120 на 80', [
            positiveFact('measurements', 'measurement', 'АД 120 на 80', '120/80', 'мм рт. ст.'),
          ]),
          variant('120/80', [
            positiveFact('measurements', 'measurement', '120/80', '120/80', 'мм рт. ст.'),
          ]),
          variant(
            'АД 120 / 80',
            [positiveFact('measurements', 'measurement', 'АД 120 / 80', '120/80', 'мм рт. ст.')],
            ['spacing'],
          ),
        ],
      },
    ],
  },
  {
    id: 'diagnosis-vitals',
    intent: 'diagnosis',
    canonicalExtras: [{ kind: 'investigation', normalizedValue: 'сатурация' }],
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('как диагностировать дальше'), variant('какие анализы')],
      },
      {
        id: 'patient',
        variants: [
          variant('мальчик 5 лет', [
            positiveFact('sex', 'sex', 'мальчик', 'мужской'),
            positiveFact('age', 'age', 'мальчик 5 лет', '5 лет', 'лет'),
          ]),
          variant(
            'мальчику 5 лет',
            [
              positiveFact('sex', 'sex', 'мальчику', 'мужской'),
              positiveFact('age', 'age', 'мальчику 5 лет', '5 лет', 'лет'),
            ],
            ['inflection'],
          ),
        ],
      },
      {
        id: 'temperature',
        variants: [
          variant(
            'температура 39,2°',
            [positiveFact('positiveFindings', 'temperature', 'температура 39,2°', '39.2', '°C')],
            ['decimal-separator'],
          ),
          variant(
            'температура 39.2 °C',
            [positiveFact('positiveFindings', 'temperature', 'температура 39.2 °C', '39.2', '°C')],
            ['decimal-separator', 'spacing'],
          ),
          variant(
            'температура 39,2',
            [positiveFact('positiveFindings', 'temperature', 'температура 39,2', '39.2', '°C')],
            ['decimal-separator'],
          ),
          variant(
            'температура 39.2',
            [positiveFact('positiveFindings', 'temperature', 'температура 39.2', '39.2', '°C')],
            ['decimal-separator'],
          ),
        ],
      },
      {
        id: 'pressure',
        variants: [
          variant('АД 200/120', [
            positiveFact('measurements', 'measurement', 'АД 200/120', '200/120', 'мм рт. ст.'),
          ]),
          variant('АД 200 на 120', [
            positiveFact('measurements', 'measurement', 'АД 200 на 120', '200/120', 'мм рт. ст.'),
          ]),
        ],
      },
      {
        id: 'pulse',
        variants: [
          variant('пульс 130', [
            positiveFact('measurements', 'measurement', 'пульс 130', '130', 'в мин'),
          ]),
          variant(
            'ЧСС 130',
            [positiveFact('measurements', 'measurement', 'ЧСС 130', '130', 'в мин')],
            ['abbreviation'],
          ),
        ],
      },
      {
        id: 'respiratory-rate',
        variants: [
          variant(
            'ЧДД 40',
            [positiveFact('measurements', 'measurement', 'ЧДД 40', '40', 'в мин')],
            ['abbreviation'],
          ),
          variant('частота дыхания 40', [
            positiveFact('measurements', 'measurement', 'частота дыхания 40', '40', 'в мин'),
          ]),
        ],
      },
      {
        id: 'saturation',
        variants: [
          variant('сатурация 91%', [
            positiveFact('measurements', 'measurement', 'сатурация 91%', '91', '%'),
          ]),
        ],
      },
      {
        id: 'duration',
        variants: [
          variant('5–7 суток', [
            positiveFact('duration', 'duration', '5–7 суток', '5-7 суток', 'суток'),
          ]),
          variant(
            '5 - 7 суток',
            [positiveFact('duration', 'duration', '5 - 7 суток', '5-7 суток', 'суток')],
            ['spacing'],
          ),
          variant('5—7 суток', [
            positiveFact('duration', 'duration', '5—7 суток', '5-7 суток', 'суток'),
          ]),
          variant('5−7 суток', [
            positiveFact('duration', 'duration', '5−7 суток', '5-7 суток', 'суток'),
          ]),
        ],
      },
      {
        id: 'symptom',
        variants: [
          variant('кашель', [positiveFact('positiveFindings', 'symptom', 'кашель', 'кашель')]),
        ],
      },
    ],
  },
  {
    id: 'administration-timing',
    intent: 'treatment',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Лечение при пневмонии')],
      },
      {
        id: 'before-food',
        variants: [variant('до еды', [positiveFact('duration', 'duration', 'до еды', 'до еды')])],
      },
      {
        id: 'after-food',
        variants: [
          variant('после еды', [positiveFact('duration', 'duration', 'после еды', 'после еды')]),
        ],
      },
      {
        id: 'since-birth',
        variants: [
          variant('с рождения', [positiveFact('duration', 'duration', 'с рождения', 'с рождения')]),
        ],
      },
      {
        id: 'frequency',
        variants: [
          variant('утром и вечером', [
            positiveFact('frequency', 'frequency', 'утром и вечером', 'утром и вечером'),
          ]),
        ],
      },
    ],
  },
  {
    id: 'positive-clinical-context',
    intent: 'disease-reference',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Что такое пневмония')],
      },
      {
        id: 'pregnancy',
        variants: [
          variant('беременность 20 недель', [
            positiveFact('pregnancy', 'pregnancy', 'беременность 20 недель', 'беременность'),
            positiveFact('gestationalAge', 'gestational-age', '20 недель', '20 недель', 'недель'),
          ]),
        ],
      },
      {
        id: 'allergy',
        variants: [
          variant('аллергия на пенициллин', [
            positiveFact(
              'allergies',
              'allergy',
              'аллергия на пенициллин',
              'аллергия на пенициллин',
            ),
          ]),
        ],
      },
      {
        id: 'organ-function',
        variants: [
          variant('почечная недостаточность', [
            positiveFact(
              'organFunction',
              'organ-function',
              'почечная недостаточность',
              'почечная недостаточность',
            ),
          ]),
        ],
      },
      {
        id: 'medicine',
        variants: [
          variant('уже принимает амоксициллин', [
            positiveFact('currentMedicines', 'medication', 'амоксициллин', 'амоксициллин'),
          ]),
        ],
      },
    ],
  },
  {
    id: 'negation-and-failure',
    intent: 'treatment',
    negation: true,
    forbidden: [
      {
        field: 'pregnancy',
        kind: 'pregnancy',
        normalizedValue: 'беременность',
        raw: null,
        unit: null,
        polarity: 'positive',
      },
      {
        field: 'allergies',
        kind: 'allergy',
        normalizedValue: 'аллергия',
        raw: null,
        unit: null,
        polarity: 'positive',
      },
      {
        field: 'organFunction',
        kind: 'organ-function',
        normalizedValue: 'почечная недостаточность',
        raw: null,
        unit: null,
        polarity: 'positive',
      },
    ],
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Лечение состояния')],
      },
      {
        id: 'pregnancy',
        variants: [
          variant('не беременна', [
            negativeFact('pregnancy', 'pregnancy', 'не беременна', 'беременность'),
          ]),
        ],
      },
      {
        id: 'allergy',
        variants: [
          variant('аллергии нет', [
            negativeFact('allergies', 'allergy', 'аллергии нет', 'аллергия'),
            negativeFact('negativeFindings', 'negative-finding', 'аллергии', 'аллергии'),
          ]),
        ],
      },
      {
        id: 'organ-function',
        variants: [
          variant('без почечной недостаточности', [
            negativeFact(
              'organFunction',
              'organ-function',
              'без почечной недостаточности',
              'почечная недостаточность',
            ),
            negativeFact(
              'negativeFindings',
              'negative-finding',
              'почечной недостаточности',
              'почечной недостаточности',
            ),
          ]),
        ],
      },
      {
        id: 'not-taken',
        variants: [
          variant('антибиотики не принимал', [
            negativeFact('negativeFindings', 'negative-finding', 'антибиотики', 'антибиотики'),
          ]),
        ],
      },
      {
        id: 'failed-treatment',
        variants: [
          variant('парацетамол не помог', [
            negativeFact('negativeFindings', 'negative-finding', 'парацетамол', 'парацетамол'),
          ]),
        ],
      },
    ],
  },
  {
    id: 'infant-age',
    intent: 'care-guidance',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Питание ребёнка')],
      },
      {
        id: 'age',
        variants: [
          variant(
            '6 мес',
            [positiveFact('age', 'age', '6 мес', '6 месяцев', 'месяцев')],
            ['abbreviation'],
          ),
          variant(
            '6 мес.',
            [positiveFact('age', 'age', '6 мес.', '6 месяцев', 'месяцев')],
            ['abbreviation'],
          ),
          variant('ребёнок 6 месяцев', [
            positiveFact('age', 'age', 'ребёнок 6 месяцев', '6 месяцев', 'месяцев'),
          ]),
          variant(
            'ребенку 6 месяцев',
            [positiveFact('age', 'age', 'ребенку 6 месяцев', '6 месяцев', 'месяцев')],
            ['inflection'],
          ),
        ],
      },
    ],
  },
  {
    id: 'newborn-age',
    intent: 'care-guidance',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Питание ребёнка')],
      },
      {
        id: 'age',
        variants: [
          variant('новорождённый', [
            positiveFact('age', 'age', 'новорождённый', 'неонатальный период'),
          ]),
          variant(
            'новорожденный',
            [positiveFact('age', 'age', 'новорожденный', 'неонатальный период')],
            ['yo-fold'],
          ),
        ],
      },
    ],
  },
  {
    id: 'approximate-written-weight',
    intent: 'medication',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Препарат')],
      },
      {
        id: 'weight',
        variants: [
          variant('примерно двадцать килограмм', [
            positiveFact('weight', 'weight', 'примерно двадцать килограмм', '20 кг', 'кг'),
          ]),
          variant('приблизительно двадцать килограмм', [
            positiveFact('weight', 'weight', 'приблизительно двадцать килограмм', '20 кг', 'кг'),
          ]),
        ],
      },
    ],
  },
  {
    id: 'gestational-age-abbreviation',
    intent: 'unknown',
    parts: [
      {
        id: 'intent',
        caseSafe: true,
        variants: [variant('Проверить')],
      },
      {
        id: 'gestational-age',
        variants: [
          variant('34 недели гестации', [
            positiveFact(
              'gestationalAge',
              'gestational-age',
              '34 недели гестации',
              '34 недели',
              'недели',
            ),
          ]),
          variant(
            '34 нед. гестации',
            [
              positiveFact(
                'gestationalAge',
                'gestational-age',
                '34 нед. гестации',
                '34 недели',
                'недели',
              ),
            ],
            ['abbreviation'],
          ),
        ],
      },
    ],
  },
] as const;

const mutationKinds: readonly QueryParserMutationKind[] = [
  'word-order',
  'spacing',
  'punctuation',
  'case',
  'yo-fold',
  'decimal-separator',
  'abbreviation',
  'inflection',
  'common-typo',
  'polite-filler',
  'irrelevant-number',
  'irrelevant-measurement',
];

const separators = [', ', '; ', ' ;  ', ': ', ' — ', ',  ', ':  ', ' / '] as const;

function uint32(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Query parser generator seed must be an unsigned 32-bit integer.');
  }
  return value >>> 0;
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function factSignature(fact: FactBlueprint): string {
  return [fact.field, fact.kind, fact.normalizedValue, fact.unit ?? '', fact.polarity].join(
    '\u0000',
  );
}

function assertStablePartSemantics(scenario: SemanticScenario): void {
  for (const part of scenario.parts) {
    const expected = part.variants[0]?.facts.map(factSignature).toSorted().join('\u0001');
    if (expected === undefined) throw new Error(`${scenario.id}.${part.id} has no variants.`);
    for (const item of part.variants.slice(1)) {
      const actual = item.facts.map(factSignature).toSorted().join('\u0001');
      if (actual !== expected) {
        throw new Error(`${scenario.id}.${part.id} variants do not preserve semantic facts.`);
      }
    }
  }
}

function semanticSummary(scenario: SemanticScenario): QueryParserSemanticScenarioSummary {
  assertStablePartSemantics(scenario);
  return {
    id: scenario.id,
    intent: scenario.intent,
    expectedFacts: scenario.parts.flatMap(
      (part) => part.variants[0]?.facts.map(({ raw: _raw, ...fact }) => fact) ?? [],
    ),
    canonicalExtras: scenario.canonicalExtras ?? [],
    forbidden: scenario.forbidden ?? [],
    negation: scenario.negation ?? false,
  };
}

function transformVariant(
  item: SurfaceVariant,
  transform: (value: string) => string,
): SurfaceVariant {
  return {
    ...item,
    text: transform(item.text),
    facts: item.facts.map((fact) => ({ ...fact, raw: transform(fact.raw) })),
  };
}

function rotate<T>(values: readonly T[], offset: number): readonly T[] {
  if (values.length < 2) return [...values];
  const start = offset % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function canonicalEntities(
  facts: readonly SurfaceFact[],
  extras: readonly QueryParserCanonicalEntity[],
): readonly QueryParserCanonicalEntity[] {
  const entities = new Map<string, QueryParserCanonicalEntity>();
  for (const fact of facts) {
    const entity = { kind: fact.kind, normalizedValue: fact.normalizedValue };
    entities.set(`${entity.kind}\u0000${entity.normalizedValue}`, entity);
  }
  for (const entity of extras) {
    entities.set(`${entity.kind}\u0000${entity.normalizedValue}`, entity);
  }
  return [...entities.values()];
}

function snakeContext(fact: SurfaceFact): Record<string, unknown> {
  return {
    field: fact.field,
    kind: fact.kind,
    raw: fact.raw,
    normalized_value: fact.normalizedValue,
    unit: fact.unit,
    polarity: fact.polarity,
  };
}

function snakeForbidden(fact: QueryParserForbiddenFactExpectation): Record<string, unknown> {
  return {
    field: fact.field,
    kind: fact.kind,
    normalized_value: fact.normalizedValue,
    raw: fact.raw,
    unit: fact.unit,
    polarity: fact.polarity,
  };
}

function renderCase(
  scenario: SemanticScenario,
  scenarioIndex: number,
  caseIndex: number,
  seed: number,
): { readonly fixture: RawQueryParserFixture; readonly metadata: GeneratedQueryParserCase } {
  const scenarioSeed = (seed ^ hashText(scenario.id)) >>> 0;
  const selected = scenario.parts.map((part, partIndex) => {
    const index = (scenarioSeed + caseIndex + partIndex * 3) % part.variants.length;
    const selectedVariant = part.variants[index];
    if (!selectedVariant) throw new Error(`${scenario.id}.${part.id} has no selected variant.`);
    return { part, variant: selectedVariant };
  });
  const mutations = new Set<QueryParserMutationKind>(scenario.mutations ?? []);

  for (const item of selected) {
    for (const mutation of item.variant.mutations ?? []) mutations.add(mutation);
  }

  const caseTarget = selected.find((item) => item.part.caseSafe);
  if ((scenarioSeed + caseIndex) % 4 === 1 && caseTarget) {
    caseTarget.variant = transformVariant(caseTarget.variant, (value) => value.toUpperCase());
    mutations.add('case');
  }

  if ((scenarioSeed + caseIndex) % 3 === 0) {
    for (const item of selected) {
      const transformed = transformVariant(item.variant, (value) => value.replaceAll('ё', 'е'));
      if (transformed.text !== item.variant.text) {
        item.variant = transformed;
        mutations.add('yo-fold');
      }
    }
  }

  const orderOffset = (scenarioSeed + caseIndex * 3 + scenarioIndex) % selected.length;
  const ordered = rotate(selected, orderOffset);
  if (orderOffset !== 0) mutations.add('word-order');

  const separator = separators[(scenarioSeed + caseIndex) % separators.length] ?? ', ';
  mutations.add('punctuation');
  if (/\s{2}|\s[;,:/]\s/u.test(separator)) mutations.add('spacing');

  const fragments = ordered.map((item) => item.variant.text);
  if ((scenarioSeed + caseIndex) % 4 === 2) {
    fragments.unshift((scenarioSeed + caseIndex) % 8 === 2 ? 'Пожалуйста' : 'Подскажите');
    mutations.add('polite-filler');
  }
  if ((scenarioSeed + caseIndex) % 4 === 3) {
    fragments.push('карта 214');
    mutations.add('irrelevant-number');
  }

  const facts = ordered.flatMap((item) => item.variant.facts);
  const query = fragments.join(separator);
  const split = caseIndex < QUERY_PARSER_CASES_PER_SCENARIO / 2 ? 'fixed' : 'heldout';
  const queryId = `GEN-${split === 'fixed' ? 'F' : 'H'}-${String(scenarioIndex + 1).padStart(2, '0')}-${String(caseIndex + 1).padStart(2, '0')}`;
  const forbidden = scenario.forbidden ?? [];
  const fixture: RawQueryParserFixture = {
    query_id: queryId,
    query,
    intent: scenario.intent,
    canonical_entities: canonicalEntities(facts, scenario.canonicalExtras ?? []).map((entity) => ({
      kind: entity.kind,
      normalized_value: entity.normalizedValue,
    })),
    critical_context: facts.map(snakeContext),
    forbidden_facts: forbidden.map(snakeForbidden),
  };
  if (scenario.negation) {
    fixture.negation = {
      expected: facts.filter((fact) => fact.polarity === 'negative').map(snakeContext),
      forbidden: forbidden.map(snakeForbidden),
    };
  }
  for (const fact of facts) {
    const first = query.indexOf(fact.raw);
    const second = first < 0 ? -1 : query.indexOf(fact.raw, first + fact.raw.length);
    if (first < 0 || second >= 0) {
      throw new Error(
        `${queryId} expected raw ${JSON.stringify(fact.raw)} must occur exactly once in ${JSON.stringify(query)}.`,
      );
    }
  }
  return {
    fixture,
    metadata: {
      queryId,
      scenarioId: scenario.id,
      split,
      mutations: [...mutations].toSorted(),
    },
  };
}

export function generateQueryParserCorpus(
  requestedSeed = QUERY_PARSER_GENERATED_CI_SEED,
): GeneratedQueryParserCorpus {
  const seed = uint32(requestedSeed);
  const semanticScenarios = scenarios.map(semanticSummary);
  const rendered = scenarios.flatMap((scenario, scenarioIndex) =>
    Array.from({ length: QUERY_PARSER_CASES_PER_SCENARIO }, (_, caseIndex) =>
      renderCase(scenario, scenarioIndex, caseIndex, seed),
    ),
  );
  const fixed = rendered
    .filter((item) => item.metadata.split === 'fixed')
    .map((item) => item.fixture);
  const heldout = rendered
    .filter((item) => item.metadata.split === 'heldout')
    .map((item) => item.fixture);
  const fixtures = validateQueryParserFixtures({
    schema_version: 1,
    dataset: `minimed-query-parser-generated-seed-${seed}`,
    canonical_entity_definition:
      'kind+normalizedValue rendered from a semantic scenario before parser execution',
    fixed,
    heldout,
  });
  const mutationCounts = Object.fromEntries(
    mutationKinds.map((kind) => [
      kind,
      rendered.filter((item) => item.metadata.mutations.includes(kind)).length,
    ]),
  ) as Record<QueryParserMutationKind, number>;

  return {
    seed,
    scenarioCount: scenarios.length,
    caseCount: rendered.length,
    uniqueQueryCount: new Set([...fixtures.fixed, ...fixtures.heldout].map((item) => item.query))
      .size,
    semanticScenarios,
    cases: rendered.map((item) => item.metadata),
    mutationCounts,
    fixtures,
  };
}
