import type {
  QueryAnalysis,
  QueryFact,
  QueryFactKind,
  QueryFactPolarity,
  SearchIntentKind,
  TextRange,
} from '@localmed/contracts';

export type QueryParserSplit = 'fixed' | 'heldout';

export type QueryParserContextField =
  | 'age'
  | 'gestationalAge'
  | 'sex'
  | 'duration'
  | 'weight'
  | 'route'
  | 'doseForm'
  | 'strength'
  | 'frequency'
  | 'measurements'
  | 'positiveFindings'
  | 'negativeFindings'
  | 'currentMedicines'
  | 'pregnancy'
  | 'organFunction'
  | 'allergies';

export interface QueryParserCanonicalEntity {
  readonly kind: QueryFactKind;
  readonly normalizedValue: string;
}

export interface QueryParserContextExpectation extends QueryParserCanonicalEntity {
  readonly field: QueryParserContextField;
  readonly raw: string;
  readonly unit: string | null;
  readonly polarity: QueryFactPolarity;
  readonly range: TextRange;
}

export interface QueryParserForbiddenFactExpectation extends QueryParserCanonicalEntity {
  readonly field: QueryParserContextField | null;
  readonly raw: string | null;
  readonly unit: string | null;
  readonly polarity: QueryFactPolarity | null;
}

export interface QueryParserNegationFixture {
  readonly expected: readonly QueryParserContextExpectation[];
  readonly forbidden: readonly QueryParserForbiddenFactExpectation[];
}

export interface QueryParserFixture {
  readonly queryId: string;
  readonly split: QueryParserSplit;
  readonly query: string;
  readonly intent: SearchIntentKind;
  /** A benchmark entity is exactly the kind + normalizedValue pair exposed by facts/context. */
  readonly canonicalEntities: readonly QueryParserCanonicalEntity[];
  readonly criticalContext: readonly QueryParserContextExpectation[];
  readonly forbiddenFacts: readonly QueryParserForbiddenFactExpectation[];
  readonly negation: QueryParserNegationFixture | null;
}

export interface QueryParserFixtureSet {
  readonly schemaVersion: 1;
  readonly dataset: string;
  readonly canonicalEntityDefinition: string;
  readonly fixed: readonly QueryParserFixture[];
  readonly heldout: readonly QueryParserFixture[];
}

export interface QueryParserFactPrediction extends QueryParserCanonicalEntity {
  readonly field: QueryParserContextField | null;
  readonly value: string;
  readonly unit: string | null;
  readonly polarity: QueryFactPolarity;
  readonly range: TextRange;
}

export interface QueryParserPrediction {
  readonly queryId: string;
  readonly split: QueryParserSplit;
  readonly intent: SearchIntentKind;
  readonly facts: readonly QueryParserFactPrediction[];
}

export interface QueryParserSliceMetrics {
  readonly fixtureCount: number;
  readonly negationFixtureCount: number;
  readonly intentMacroF1: number;
  readonly canonicalEntityMacroF1: number;
  readonly criticalExactMatchRate: number;
  readonly negationExactMatchRate: number;
  readonly forbiddenFactViolations: number;
  readonly gatePassed: boolean;
}

export interface QueryParserScoreReport {
  readonly schemaVersion: 1;
  readonly dataset: string;
  readonly canonicalEntityDefinition: string;
  readonly fixtureCount: number;
  readonly metrics: {
    readonly overall: QueryParserSliceMetrics;
    readonly fixed: QueryParserSliceMetrics;
    readonly heldout: QueryParserSliceMetrics;
  };
  readonly gates: {
    readonly intentMacroF1: number;
    readonly canonicalEntityMacroF1: number;
    readonly criticalExactMatchRate: number;
    readonly negationExactMatchRate: number;
  };
  readonly passed: boolean;
}

export const QUERY_PARSER_GATE_THRESHOLDS = {
  intentMacroF1: 0.95,
  canonicalEntityMacroF1: 0.95,
  criticalExactMatchRate: 1,
  negationExactMatchRate: 1,
} as const;

const QUERY_INTENTS: readonly SearchIntentKind[] = [
  'diagnosis',
  'treatment',
  'medication',
  'disease-reference',
  'care-guidance',
  'administrative-reference',
  'mixed',
  'unknown',
];

const QUERY_FACT_KINDS: readonly QueryFactKind[] = [
  'age',
  'sex',
  'duration',
  'temperature',
  'measurement',
  'symptom',
  'investigation',
  'medication',
  'location',
  'epidemiology',
  'negative-finding',
  'weight',
  'route',
  'dose-form',
  'strength',
  'frequency',
  'gestational-age',
  'pregnancy',
  'organ-function',
  'allergy',
];

const CONTEXT_FIELDS: readonly QueryParserContextField[] = [
  'age',
  'gestationalAge',
  'sex',
  'duration',
  'weight',
  'route',
  'doseForm',
  'strength',
  'frequency',
  'measurements',
  'positiveFindings',
  'negativeFindings',
  'currentMedicines',
  'pregnancy',
  'organFunction',
  'allergies',
];

const REQUIRED_CONTEXT_COVERAGE: readonly QueryParserContextField[] = [
  'age',
  'gestationalAge',
  'duration',
  'weight',
  'route',
  'doseForm',
  'strength',
  'frequency',
  'measurements',
  'pregnancy',
  'organFunction',
  'allergies',
];

const POLARITIES: readonly QueryFactPolarity[] = ['positive', 'negative', 'uncertain'];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordAt(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}

function recordProperty(record: JsonRecord, key: string): unknown {
  return record[key];
}

function requiredString(record: JsonRecord, key: string, path: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path}.${key} must be a non-empty string.`);
  }
  return value;
}

function nullableString(record: JsonRecord, key: string, path: string): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${path}.${key} must be a string or null.`);
  return value;
}

function requiredArray(record: JsonRecord, key: string, path: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${path}.${key} must be an array.`);
  return value;
}

function enumValue<T extends string>(
  record: JsonRecord,
  key: string,
  allowed: readonly T[],
  path: string,
): T {
  const value = requiredString(record, key, path);
  if (!allowed.includes(value as T)) {
    throw new Error(`${path}.${key} has unsupported value: ${value}.`);
  }
  return value as T;
}

function optionalEnum<T extends string>(
  record: JsonRecord,
  key: string,
  allowed: readonly T[],
  path: string,
): T | null {
  if (record[key] === undefined || record[key] === null) return null;
  return enumValue(record, key, allowed, path);
}

function uniqueRawRange(query: string, raw: string, path: string): TextRange {
  const start = query.indexOf(raw);
  if (start < 0) throw new Error(`${path}.raw does not occur in its query.`);
  if (query.indexOf(raw, start + raw.length) >= 0) {
    throw new Error(`${path}.raw must have one unambiguous occurrence in its query.`);
  }
  return { start, end: start + raw.length };
}

function parseContextExpectation(
  value: unknown,
  query: string,
  path: string,
): QueryParserContextExpectation {
  const record = recordAt(value, path);
  const raw = requiredString(record, 'raw', path);
  return {
    field: enumValue(record, 'field', CONTEXT_FIELDS, path),
    kind: enumValue(record, 'kind', QUERY_FACT_KINDS, path),
    raw,
    normalizedValue: requiredString(record, 'normalized_value', path),
    unit: nullableString(record, 'unit', path),
    polarity: enumValue(record, 'polarity', POLARITIES, path),
    range: uniqueRawRange(query, raw, path),
  };
}

function parseCanonicalEntity(value: unknown, path: string): QueryParserCanonicalEntity {
  const record = recordAt(value, path);
  return {
    kind: enumValue(record, 'kind', QUERY_FACT_KINDS, path),
    normalizedValue: requiredString(record, 'normalized_value', path),
  };
}

function parseForbiddenFact(value: unknown, path: string): QueryParserForbiddenFactExpectation {
  const record = recordAt(value, path);
  const fieldValue = recordProperty(record, 'field');
  const field =
    fieldValue === undefined || fieldValue === null
      ? null
      : enumValue(record, 'field', CONTEXT_FIELDS, path);
  return {
    field,
    kind: enumValue(record, 'kind', QUERY_FACT_KINDS, path),
    normalizedValue: requiredString(record, 'normalized_value', path),
    raw: nullableString(record, 'raw', path),
    unit: nullableString(record, 'unit', path),
    polarity: optionalEnum(record, 'polarity', POLARITIES, path),
  };
}

function parseForbiddenFacts(
  record: JsonRecord,
  query: string,
  key: string,
  path: string,
): readonly QueryParserForbiddenFactExpectation[] {
  return requiredArray(record, key, path).map((value, index) => {
    const forbidden = parseForbiddenFact(value, `${path}.${key}[${index}]`);
    if (forbidden.raw !== null) uniqueRawRange(query, forbidden.raw, `${path}.${key}[${index}]`);
    return forbidden;
  });
}

function parseFixture(value: unknown, split: QueryParserSplit, index: number): QueryParserFixture {
  const path = `${split}[${index}]`;
  const record = recordAt(value, path);
  const query = requiredString(record, 'query', path);
  const criticalContext = requiredArray(record, 'critical_context', path).map((item, itemIndex) =>
    parseContextExpectation(item, query, `${path}.critical_context[${itemIndex}]`),
  );
  if (criticalContext.length === 0) throw new Error(`${path}.critical_context must not be empty.`);

  const canonicalEntities = requiredArray(record, 'canonical_entities', path).map(
    (item, itemIndex) => parseCanonicalEntity(item, `${path}.canonical_entities[${itemIndex}]`),
  );
  if (canonicalEntities.length === 0) {
    throw new Error(`${path}.canonical_entities must not be empty.`);
  }

  const negationValue = recordProperty(record, 'negation');
  let negation: QueryParserNegationFixture | null = null;
  if (negationValue !== undefined) {
    const negationRecord = recordAt(negationValue, `${path}.negation`);
    const expected = requiredArray(negationRecord, 'expected', `${path}.negation`).map(
      (item, itemIndex) =>
        parseContextExpectation(item, query, `${path}.negation.expected[${itemIndex}]`),
    );
    if (expected.length === 0) throw new Error(`${path}.negation.expected must not be empty.`);
    if (expected.some((item) => item.polarity !== 'negative')) {
      throw new Error(`${path}.negation.expected must contain only negative facts.`);
    }
    const forbidden = parseForbiddenFacts(negationRecord, query, 'forbidden', `${path}.negation`);
    negation = { expected, forbidden };
  }

  return {
    queryId: requiredString(record, 'query_id', path),
    split,
    query,
    intent: enumValue(record, 'intent', QUERY_INTENTS, path),
    canonicalEntities,
    criticalContext,
    forbiddenFacts: parseForbiddenFacts(record, query, 'forbidden_facts', path),
    negation,
  };
}

export function validateQueryParserFixtures(value: unknown): QueryParserFixtureSet {
  const record = recordAt(value, 'fixtures');
  if (recordProperty(record, 'schema_version') !== 1) {
    throw new Error('fixtures.schema_version must be 1.');
  }
  const fixed = requiredArray(record, 'fixed', 'fixtures').map((item, index) =>
    parseFixture(item, 'fixed', index),
  );
  const heldout = requiredArray(record, 'heldout', 'fixtures').map((item, index) =>
    parseFixture(item, 'heldout', index),
  );
  if (fixed.length === 0 || heldout.length === 0) {
    throw new Error('fixtures.fixed and fixtures.heldout must both be non-empty.');
  }

  const allFixtures = [...fixed, ...heldout];
  const coveredContextFields = new Set(
    allFixtures.flatMap((fixture) => fixture.criticalContext.map((context) => context.field)),
  );
  const missingContextFields = REQUIRED_CONTEXT_COVERAGE.filter(
    (field) => !coveredContextFields.has(field),
  );
  if (missingContextFields.length > 0) {
    throw new Error(`Missing critical_context coverage: ${missingContextFields.join(', ')}.`);
  }
  const distinctIntents = new Set(allFixtures.map((fixture) => fixture.intent));
  if (distinctIntents.size < 3) {
    throw new Error('fixtures must contain at least 3 distinct intents.');
  }
  const ids = new Set<string>();
  for (const fixture of allFixtures) {
    if (ids.has(fixture.queryId)) throw new Error(`Duplicate query_id: ${fixture.queryId}.`);
    ids.add(fixture.queryId);
  }
  for (const split of ['fixed', 'heldout'] as const) {
    if (!allFixtures.some((fixture) => fixture.split === split && fixture.negation !== null)) {
      throw new Error(`${split} must contain at least one negation fixture.`);
    }
  }

  return {
    schemaVersion: 1,
    dataset: requiredString(record, 'dataset', 'fixtures'),
    canonicalEntityDefinition: requiredString(record, 'canonical_entity_definition', 'fixtures'),
    fixed,
    heldout,
  };
}

function contextFieldForLegacyKind(kind: QueryFactKind): QueryParserContextField | null {
  switch (kind) {
    case 'age':
      return 'age';
    case 'sex':
      return 'sex';
    case 'duration':
      return 'duration';
    case 'measurement':
      return 'measurements';
    case 'symptom':
    case 'temperature':
      return 'positiveFindings';
    case 'negative-finding':
      return 'negativeFindings';
    case 'medication':
      return 'currentMedicines';
    default:
      return null;
  }
}

function factPrediction(
  fact: QueryParserFactPrediction,
  field: QueryParserContextField | null,
): QueryParserFactPrediction {
  return { ...fact, field };
}

export function predictionFromAnalysis(
  queryId: string,
  split: QueryParserSplit,
  analysis: QueryAnalysis,
): QueryParserPrediction {
  const facts: QueryParserFactPrediction[] = analysis.facts.map((fact) =>
    factPrediction(
      {
        kind: fact.kind,
        normalizedValue: fact.normalizedValue,
        value: fact.value,
        unit: fact.unit,
        polarity: fact.polarity,
        range: fact.range,
        field: null,
      },
      contextFieldForLegacyKind(fact.kind),
    ),
  );

  const context = analysis.clinicalContext;
  if (context) {
    const contextFacts: readonly [QueryParserContextField, readonly QueryFact<QueryFactKind>[]][] =
      [
        ['age', context.age],
        ['gestationalAge', context.gestationalAge],
        ['sex', context.sex],
        ['duration', context.duration],
        ['weight', context.weight],
        ['route', context.route],
        ['doseForm', context.doseForm],
        ['strength', context.strength],
        ['frequency', context.frequency],
        ['measurements', context.measurements],
        ['positiveFindings', context.positiveFindings],
        ['negativeFindings', context.negativeFindings],
        ['currentMedicines', context.currentMedicines],
        ['pregnancy', context.pregnancy],
        ['organFunction', context.organFunction],
        ['allergies', context.allergies],
      ];
    for (const [field, fieldFacts] of contextFacts) {
      for (const fact of fieldFacts) {
        facts.push(
          factPrediction(
            {
              kind: fact.kind,
              normalizedValue: fact.normalizedValue,
              value: fact.value,
              unit: fact.unit,
              polarity: fact.polarity,
              range: fact.range,
              field,
            },
            field,
          ),
        );
      }
    }
  }

  const uniqueFacts = new Map<string, QueryParserFactPrediction>();
  for (const fact of facts) {
    const key = [
      fact.field ?? '',
      fact.kind,
      fact.value,
      fact.normalizedValue,
      fact.unit ?? '',
      fact.polarity,
      fact.range.start,
      fact.range.end,
    ].join('\u0000');
    uniqueFacts.set(key, fact);
  }
  return {
    queryId,
    split,
    intent: analysis.intent?.primary ?? 'unknown',
    facts: [...uniqueFacts.values()],
  };
}

function entityKey(entity: QueryParserCanonicalEntity): string {
  return `${entity.kind}\u0000${entity.normalizedValue}`;
}

function entitySet(entities: readonly QueryParserCanonicalEntity[]): ReadonlySet<string> {
  return new Set(entities.map(entityKey));
}

function macroF1(
  expected: readonly (ReadonlySet<string> | string)[],
  predicted: readonly (ReadonlySet<string> | string)[],
): number {
  const labels = new Set<string>();
  for (const value of expected) {
    if (typeof value === 'string') labels.add(value);
    else for (const label of value) labels.add(label);
  }
  for (const value of predicted) {
    if (typeof value === 'string') labels.add(value);
    else for (const label of value) labels.add(label);
  }
  if (labels.size === 0) return 1;

  const scores: number[] = [];
  for (const label of labels) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const expectedValue = expected[index];
      const predictedValue = predicted[index];
      if (expectedValue === undefined || predictedValue === undefined) {
        throw new Error('Metric inputs must have equal lengths.');
      }
      const expectedHas =
        typeof expectedValue === 'string' ? expectedValue === label : expectedValue.has(label);
      const predictedHas =
        typeof predictedValue === 'string' ? predictedValue === label : predictedValue.has(label);
      if (expectedHas && predictedHas) truePositive += 1;
      else if (!expectedHas && predictedHas) falsePositive += 1;
      else if (expectedHas && !predictedHas) falseNegative += 1;
    }
    const denominator = 2 * truePositive + falsePositive + falseNegative;
    scores.push(denominator === 0 ? 0 : (2 * truePositive) / denominator);
  }
  return scores.reduce((total, score) => total + score, 0) / scores.length;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function matchesContext(
  expected: QueryParserContextExpectation,
  facts: readonly QueryParserFactPrediction[],
): boolean {
  return facts.some(
    (fact) =>
      fact.field === expected.field &&
      fact.kind === expected.kind &&
      fact.value === expected.raw &&
      fact.normalizedValue === expected.normalizedValue &&
      fact.unit === expected.unit &&
      fact.polarity === expected.polarity &&
      fact.range.start === expected.range.start &&
      fact.range.end === expected.range.end,
  );
}

function matchesForbidden(
  expected: QueryParserForbiddenFactExpectation,
  facts: readonly QueryParserFactPrediction[],
): boolean {
  return facts.some(
    (fact) =>
      (expected.field === null || fact.field === expected.field) &&
      fact.kind === expected.kind &&
      fact.normalizedValue === expected.normalizedValue &&
      (expected.raw === null || fact.value === expected.raw) &&
      (expected.unit === null || fact.unit === expected.unit) &&
      (expected.polarity === null || fact.polarity === expected.polarity),
  );
}

interface FixtureEvaluation {
  readonly fixture: QueryParserFixture;
  readonly predictedEntities: ReadonlySet<string>;
  readonly predictedIntent: SearchIntentKind;
  readonly criticalExact: boolean;
  readonly negationExact: boolean | null;
  readonly forbiddenFactViolations: number;
}

function evaluateFixture(
  fixture: QueryParserFixture,
  prediction: QueryParserPrediction,
): FixtureEvaluation {
  const predictedEntities = entitySet(prediction.facts);
  const forbidden = fixture.forbiddenFacts.filter((item) =>
    matchesForbidden(item, prediction.facts),
  );
  const criticalExact =
    fixture.criticalContext.every((item) => matchesContext(item, prediction.facts)) &&
    forbidden.length === 0;
  const negationExact =
    fixture.negation === null
      ? null
      : fixture.negation.expected.every((item) => matchesContext(item, prediction.facts)) &&
        fixture.negation.forbidden.every((item) => !matchesForbidden(item, prediction.facts));
  const negationForbidden =
    fixture.negation?.forbidden.filter((item) => matchesForbidden(item, prediction.facts)).length ??
    0;
  return {
    fixture,
    predictedEntities,
    predictedIntent: prediction.intent,
    criticalExact,
    negationExact,
    forbiddenFactViolations: forbidden.length + negationForbidden,
  };
}

function aggregateSlice(rows: readonly FixtureEvaluation[]): QueryParserSliceMetrics {
  const negationRows = rows.filter((row) => row.negationExact !== null);
  const expectedIntents = rows.map((row) => row.fixture.intent);
  const predictedIntents = rows.map((row) => row.predictedIntent);
  const expectedEntities = rows.map((row) => entitySet(row.fixture.canonicalEntities));
  const predictedEntities = rows.map((row) => row.predictedEntities);
  const intentMacroF1 = macroF1(expectedIntents, predictedIntents);
  const canonicalEntityMacroF1 = macroF1(expectedEntities, predictedEntities);
  const criticalExactMatchRate = mean(rows.map((row) => Number(row.criticalExact)));
  const negationExactMatchRate =
    negationRows.length === 0 ? 0 : mean(negationRows.map((row) => Number(row.negationExact)));
  const metricsWithoutGate = {
    fixtureCount: rows.length,
    negationFixtureCount: negationRows.length,
    intentMacroF1,
    canonicalEntityMacroF1,
    criticalExactMatchRate,
    negationExactMatchRate,
    forbiddenFactViolations: rows.reduce((total, row) => total + row.forbiddenFactViolations, 0),
  };
  return {
    ...metricsWithoutGate,
    gatePassed:
      intentMacroF1 >= QUERY_PARSER_GATE_THRESHOLDS.intentMacroF1 &&
      canonicalEntityMacroF1 >= QUERY_PARSER_GATE_THRESHOLDS.canonicalEntityMacroF1 &&
      criticalExactMatchRate >= QUERY_PARSER_GATE_THRESHOLDS.criticalExactMatchRate &&
      negationRows.length > 0 &&
      negationExactMatchRate >= QUERY_PARSER_GATE_THRESHOLDS.negationExactMatchRate,
  };
}

export function scoreQueryParserFixtures(
  fixtures: QueryParserFixtureSet,
  predictions: readonly QueryParserPrediction[],
): QueryParserScoreReport {
  const predictionsById = new Map<string, QueryParserPrediction>();
  for (const prediction of predictions) {
    if (predictionsById.has(prediction.queryId)) {
      throw new Error(`Duplicate prediction query_id: ${prediction.queryId}.`);
    }
    predictionsById.set(prediction.queryId, prediction);
  }
  const fixtureList = [...fixtures.fixed, ...fixtures.heldout];
  if (predictions.length !== fixtureList.length) {
    throw new Error(
      `Prediction count ${predictions.length} does not match fixture count ${fixtureList.length}.`,
    );
  }
  const rows = fixtureList.map((fixture) => {
    const prediction = predictionsById.get(fixture.queryId);
    if (!prediction) throw new Error(`Missing prediction for ${fixture.queryId}.`);
    if (prediction.split !== fixture.split) {
      throw new Error(`Prediction split mismatch for ${fixture.queryId}.`);
    }
    return evaluateFixture(fixture, prediction);
  });
  const fixed = aggregateSlice(rows.filter((row) => row.fixture.split === 'fixed'));
  const heldout = aggregateSlice(rows.filter((row) => row.fixture.split === 'heldout'));
  const overall = aggregateSlice(rows);
  return {
    schemaVersion: 1,
    dataset: fixtures.dataset,
    canonicalEntityDefinition: fixtures.canonicalEntityDefinition,
    fixtureCount: rows.length,
    metrics: { overall, fixed, heldout },
    gates: QUERY_PARSER_GATE_THRESHOLDS,
    passed: overall.gatePassed && fixed.gatePassed && heldout.gatePassed,
  };
}
