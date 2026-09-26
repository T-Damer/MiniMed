import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { analyzeClinicalQuery } from '@localmed/search-lexical';

import {
  generateQueryParserCorpus,
  QUERY_PARSER_GENERATED_CI_SEED,
} from './query-parser-generation';
import {
  predictionFromAnalysis,
  type QueryParserFixture,
  validateQueryParserFixtures,
} from './query-parser-scoring';

/**
 * Exports every parser benchmark query with its gold labels and the deterministic parser's
 * prediction, so the throwaway LLM/NER comparison in `parser_llm_poc.py` scores all systems
 * with one relaxed metric. It never writes into a content pack.
 */

const benchmarkRoot = resolve(import.meta.dirname, '..');
const outputPath = resolve(
  process.cwd(),
  process.argv[2] ?? resolve(benchmarkRoot, '../../data/build/parser-llm-poc/cases.jsonl'),
);
if (!outputPath.endsWith('.jsonl')) throw new Error('Output must be a .jsonl file.');

interface OodCase {
  readonly id: string;
  readonly query: string;
  readonly intent: string;
  readonly facts: readonly Record<string, unknown>[];
}

function regexPrediction(query: string) {
  const plan = analyzeClinicalQuery(query, [], false);
  const prediction = predictionFromAnalysis('regex', 'fixed', plan.analysis);
  return { intent: prediction.intent, facts: prediction.facts };
}

function fixtureRow(set: string, fixture: QueryParserFixture) {
  return {
    id: fixture.queryId,
    set,
    split: fixture.split,
    query: fixture.query,
    gold: {
      format: 'parser-fixture',
      intent: fixture.intent,
      criticalContext: fixture.criticalContext,
      negation: fixture.negation?.expected ?? [],
      forbidden: [...fixture.forbiddenFacts, ...(fixture.negation?.forbidden ?? [])],
    },
    regex: regexPrediction(fixture.query),
  };
}

const fixtureSet = validateQueryParserFixtures(
  JSON.parse(readFileSync(resolve(benchmarkRoot, 'query-parser-fixtures.json'), 'utf8')),
);
const generated = generateQueryParserCorpus(QUERY_PARSER_GENERATED_CI_SEED);
const ood = JSON.parse(
  readFileSync(resolve(benchmarkRoot, 'parser-llm-ood-cases.json'), 'utf8'),
) as { readonly cases: readonly OodCase[] };

const rows = [
  ...[...fixtureSet.fixed, ...fixtureSet.heldout].map((fixture) => fixtureRow('fixtures', fixture)),
  ...[...generated.fixtures.fixed, ...generated.fixtures.heldout].map((fixture) =>
    fixtureRow('generated', fixture),
  ),
  ...ood.cases.map((item) => ({
    id: item.id,
    set: 'ood',
    split: 'heldout',
    query: item.query,
    gold: { format: 'coarse', intent: item.intent, facts: item.facts },
    regex: regexPrediction(item.query),
  })),
];

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
process.stdout.write(`${rows.length} cases → ${outputPath}\n`);
