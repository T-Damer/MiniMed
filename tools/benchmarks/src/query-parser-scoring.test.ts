import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { QueryParserFixture, QueryParserPrediction } from './query-parser-scoring';
import { scoreQueryParserFixtures, validateQueryParserFixtures } from './query-parser-scoring';

const FIXTURE_VALUE: unknown = JSON.parse(
  readFileSync(new URL('../query-parser-fixtures.json', import.meta.url), 'utf8'),
);
const FIXTURES = validateQueryParserFixtures(FIXTURE_VALUE);
const ALL_FIXTURES = [...FIXTURES.fixed, ...FIXTURES.heldout];

function perfectPrediction(fixture: QueryParserFixture): QueryParserPrediction {
  const criticalFacts = fixture.criticalContext.map((fact) => ({
    field: fact.field,
    kind: fact.kind,
    value: fact.raw,
    normalizedValue: fact.normalizedValue,
    unit: fact.unit,
    polarity: fact.polarity,
    range: fact.range,
  }));
  const criticalEntityKeys = new Set(
    criticalFacts.map((fact) => `${fact.kind}\u0000${fact.normalizedValue}`),
  );
  const canonicalOnlyFacts = fixture.canonicalEntities
    .filter((entity) => !criticalEntityKeys.has(`${entity.kind}\u0000${entity.normalizedValue}`))
    .map((entity) => ({
      field: null,
      kind: entity.kind,
      value: '',
      normalizedValue: entity.normalizedValue,
      unit: null,
      polarity: 'uncertain' as const,
      range: { start: 0, end: 0 },
    }));
  return {
    queryId: fixture.queryId,
    split: fixture.split,
    intent: fixture.intent,
    facts: [...criticalFacts, ...canonicalOnlyFacts],
  };
}

const PERFECT_PREDICTIONS = ALL_FIXTURES.map(perfectPrediction);

describe('query parser scoring', () => {
  it('reports perfect metrics and passes every split gate', () => {
    const report = scoreQueryParserFixtures(FIXTURES, PERFECT_PREDICTIONS);

    expect(report.passed).toBe(true);
    expect(report.metrics.overall).toMatchObject({
      fixtureCount: ALL_FIXTURES.length,
      negationFixtureCount: ALL_FIXTURES.filter((fixture) => fixture.negation !== null).length,
      intentMacroF1: 1,
      canonicalEntityMacroF1: 1,
      criticalExactMatchRate: 1,
      negationExactMatchRate: 1,
      forbiddenFactViolations: 0,
      gatePassed: true,
    });
    expect(report.metrics.fixed.gatePassed).toBe(true);
    expect(report.metrics.heldout.gatePassed).toBe(true);
  });

  it('lowers metrics and fails gates for deliberately corrupted predictions', () => {
    const negationFixture = ALL_FIXTURES.find((fixture) => fixture.negation !== null);
    if (!negationFixture) throw new Error('A negation fixture is required for this test.');
    const corrupted: QueryParserPrediction[] = PERFECT_PREDICTIONS.map((prediction, index) =>
      index === 0 || prediction.queryId === negationFixture.queryId
        ? { ...prediction, intent: 'unknown', facts: [] }
        : prediction,
    );
    const report = scoreQueryParserFixtures(FIXTURES, corrupted);

    expect(report.passed).toBe(false);
    expect(report.metrics.overall.intentMacroF1).toBeLessThan(1);
    expect(report.metrics.overall.canonicalEntityMacroF1).toBeLessThan(1);
    expect(report.metrics.overall.criticalExactMatchRate).toBeLessThan(1);
    expect(report.metrics.overall.negationExactMatchRate).toBeLessThan(1);
    expect(report.metrics.fixed.gatePassed).toBe(false);
  });

  it('uses the actual swapped intent labels in macro-F1', () => {
    const medication = PERFECT_PREDICTIONS.find((prediction) => prediction.intent === 'medication');
    const diagnosis = PERFECT_PREDICTIONS.find((prediction) => prediction.intent === 'diagnosis');
    if (!medication || !diagnosis) throw new Error('Fixture intents for this test are missing.');

    const swapped = PERFECT_PREDICTIONS.map((prediction) => {
      if (prediction.queryId === medication.queryId) {
        return { ...prediction, intent: diagnosis.intent };
      }
      if (prediction.queryId === diagnosis.queryId) {
        return { ...prediction, intent: medication.intent };
      }
      return prediction;
    });
    const report = scoreQueryParserFixtures(FIXTURES, swapped);

    expect(report.metrics.overall.intentMacroF1).toBeLessThan(1);
    expect(report.metrics.overall.canonicalEntityMacroF1).toBe(1);
    expect(report.metrics.overall.criticalExactMatchRate).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('rejects a fixture set missing required semantic coverage', () => {
    type MutableFixture = { critical_context: Array<{ field: string }> };
    type MutableFixtureSet = { fixed: MutableFixture[]; heldout: MutableFixture[] };
    const invalidFixtureValue = structuredClone(FIXTURE_VALUE) as MutableFixtureSet;
    for (const fixture of [...invalidFixtureValue.fixed, ...invalidFixtureValue.heldout]) {
      fixture.critical_context = fixture.critical_context.filter(
        (context) => context.field !== 'doseForm',
      );
    }

    expect(() => validateQueryParserFixtures(invalidFixtureValue)).toThrow(/doseForm/iu);
  });

  it('rejects a critical raw value that is absent from the query', () => {
    type MutableFixture = { critical_context: Array<{ raw: string }> };
    type MutableFixtureSet = { fixed: MutableFixture[] };
    const invalidFixtureValue = structuredClone(FIXTURE_VALUE) as MutableFixtureSet;
    const firstContext = invalidFixtureValue.fixed[0]?.critical_context[0];
    if (!firstContext) throw new Error('A critical context fixture is required for this test.');
    firstContext.raw = 'значение отсутствует в запросе';

    expect(() => validateQueryParserFixtures(invalidFixtureValue)).toThrow(/does not occur/iu);
  });
});
