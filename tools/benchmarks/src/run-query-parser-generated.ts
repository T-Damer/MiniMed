import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { analyzeClinicalQuery } from '@localmed/search-lexical';

import {
  generateQueryParserCorpus,
  QUERY_PARSER_GENERATED_CI_SEED,
} from './query-parser-generation';
import { predictionFromAnalysis, scoreQueryParserFixtures } from './query-parser-scoring';

interface RunnerOptions {
  readonly seed: number;
  readonly outputPath: string | null;
}

function runnerOptions(args: readonly string[]): RunnerOptions {
  let seed = QUERY_PARSER_GENERATED_CI_SEED;
  let outputPath: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || (option !== '--seed' && option !== '--output')) {
      throw new Error('Usage: benchmark:parser:generated [--seed uint32] [--output path].');
    }
    if (option === '--seed') {
      seed = Number(value);
      continue;
    }
    outputPath = resolve(process.cwd(), value);
    if (outputPath.toLowerCase().endsWith('.db')) {
      throw new Error('Parser benchmark output must not be a SQLite database.');
    }
  }
  return { seed, outputPath };
}

const options = runnerOptions(process.argv.slice(2));
const corpus = generateQueryParserCorpus(options.seed);
const predictions = [...corpus.fixtures.fixed, ...corpus.fixtures.heldout].map((fixture) => {
  const plan = analyzeClinicalQuery(fixture.query, [], false);
  return predictionFromAnalysis(fixture.queryId, fixture.split, plan.analysis);
});
const score = scoreQueryParserFixtures(corpus.fixtures, predictions);
const report = {
  schemaVersion: 1,
  seed: corpus.seed,
  scenarioCount: corpus.scenarioCount,
  caseCount: corpus.caseCount,
  uniqueQueryCount: corpus.uniqueQueryCount,
  mutationCounts: corpus.mutationCounts,
  score,
  passed: score.passed,
};
const serialized = JSON.stringify(report);

if (options.outputPath) {
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} else {
  process.stdout.write(`${serialized}\n`);
}

process.exitCode = report.passed ? 0 : 1;
