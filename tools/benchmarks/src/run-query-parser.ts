import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { analyzeClinicalQuery } from '@localmed/search-lexical';

import {
  predictionFromAnalysis,
  scoreQueryParserFixtures,
  validateQueryParserFixtures,
} from './query-parser-scoring';

const fixturePath = resolve(import.meta.dirname, '../query-parser-fixtures.json');

function outputPathFromArgs(args: readonly string[]): string | null {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== '--output' || !args[1]) {
    throw new Error('Usage: benchmark:parser [--output path].');
  }
  const outputPath = resolve(process.cwd(), args[1]);
  if (outputPath.toLowerCase().endsWith('.db')) {
    throw new Error('Parser benchmark output must not be a SQLite database.');
  }
  return outputPath;
}

const fixtureValue: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
const fixtures = validateQueryParserFixtures(fixtureValue);
const predictions = [...fixtures.fixed, ...fixtures.heldout].map((fixture) => {
  const plan = analyzeClinicalQuery(fixture.query, [], false);
  return predictionFromAnalysis(fixture.queryId, fixture.split, plan.analysis);
});
const report = scoreQueryParserFixtures(fixtures, predictions);
const serialized = JSON.stringify(report);
const outputPath = outputPathFromArgs(process.argv.slice(2));

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
} else {
  process.stdout.write(`${serialized}\n`);
}

process.exitCode = report.passed ? 0 : 1;
