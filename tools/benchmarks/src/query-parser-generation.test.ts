import { analyzeClinicalQuery } from '@localmed/search-lexical';
import { describe, expect, it } from 'vitest';

import {
  generateQueryParserCorpus,
  QUERY_PARSER_GENERATED_CI_SEED,
} from './query-parser-generation';
import { predictionFromAnalysis, scoreQueryParserFixtures } from './query-parser-scoring';

function semanticProjection(corpus: ReturnType<typeof generateQueryParserCorpus>): string {
  return JSON.stringify(corpus.semanticScenarios);
}

describe('structured query parser generation', () => {
  it('renders byte-identical cases for the same seed', () => {
    const first = generateQueryParserCorpus(QUERY_PARSER_GENERATED_CI_SEED);
    const second = generateQueryParserCorpus(QUERY_PARSER_GENERATED_CI_SEED);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('changes surfaces but preserves semantic scenarios for another seed', () => {
    const first = generateQueryParserCorpus(QUERY_PARSER_GENERATED_CI_SEED);
    const second = generateQueryParserCorpus(QUERY_PARSER_GENERATED_CI_SEED + 1);
    const firstQueries = [...first.fixtures.fixed, ...first.fixtures.heldout].map(
      (fixture) => fixture.query,
    );
    const secondQueries = [...second.fixtures.fixed, ...second.fixtures.heldout].map(
      (fixture) => fixture.query,
    );

    expect(secondQueries).not.toEqual(firstQueries);
    expect(semanticProjection(second)).toBe(semanticProjection(first));
  });

  it('derives every expected range from a valid rendered substring', () => {
    const corpus = generateQueryParserCorpus();

    for (const fixture of [...corpus.fixtures.fixed, ...corpus.fixtures.heldout]) {
      for (const fact of [...fixture.criticalContext, ...(fixture.negation?.expected ?? [])]) {
        expect(fact.range.start).toBeGreaterThanOrEqual(0);
        expect(fact.range.end).toBeLessThanOrEqual(fixture.query.length);
        expect(fact.range.end).toBeGreaterThan(fact.range.start);
        expect(fixture.query.slice(fact.range.start, fact.range.end)).toBe(fact.raw);
      }
    }
  });

  it('keeps a degree-less temperature exact before spaced punctuation', () => {
    const corpus = generateQueryParserCorpus();
    const fixture = [...corpus.fixtures.fixed, ...corpus.fixtures.heldout].find((item) =>
      /температура 39[,.]2\s+[;:—/]/iu.test(item.query),
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const temperature = analyzeClinicalQuery(fixture.query, [], false).analysis.facts.find(
      (fact) => fact.kind === 'temperature' && fact.value.startsWith('температура'),
    );
    expect(temperature).toBeDefined();
    if (!temperature) return;

    expect(fixture.query.slice(temperature.range.start, temperature.range.end)).toBe(
      temperature.value,
    );
    expect(temperature.value).toMatch(/39[,.]2$/u);
  });

  it('covers every required seeded mutation family with diverse surfaces', () => {
    const corpus = generateQueryParserCorpus();

    expect(corpus.scenarioCount).toBeGreaterThanOrEqual(8);
    expect(corpus.caseCount).toBeGreaterThanOrEqual(64);
    expect(corpus.uniqueQueryCount).toBe(corpus.caseCount);
    for (const count of Object.values(corpus.mutationCounts)) expect(count).toBeGreaterThan(0);
  });

  it('passes the existing parser gates for the fixed CI seed', () => {
    const corpus = generateQueryParserCorpus();
    const predictions = [...corpus.fixtures.fixed, ...corpus.fixtures.heldout].map((fixture) =>
      predictionFromAnalysis(
        fixture.queryId,
        fixture.split,
        analyzeClinicalQuery(fixture.query, [], false).analysis,
      ),
    );
    const report = scoreQueryParserFixtures(corpus.fixtures, predictions);

    expect(report.passed).toBe(true);
    expect(report.metrics.fixed.gatePassed).toBe(true);
    expect(report.metrics.heldout.gatePassed).toBe(true);
  });
});
