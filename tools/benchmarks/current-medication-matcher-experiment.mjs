import { Database } from 'bun:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createMedicationSpellingMatcher } from '../../packages/search-lexical/src/medication-spelling';

const [dbPath, casePath, output] = process.argv.slice(2);
if (!dbPath || !casePath || !output) throw new Error('Expected DB CASES OUTPUT');

const db = new Database(dbPath, { readonly: true });
const aliases = db
  .query("SELECT rowid AS id, alias, canonical_term FROM aliases WHERE category = 'medication'")
  .all()
  .map((row) => ({
    id: `rapidfuzz-experiment.${row.id}`,
    alias: String(row.alias),
    canonicalTerm: String(row.canonical_term),
    category: 'medication',
    weight: 1,
  }));
db.close();

const normalize = (value) => value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();
const payload = JSON.parse(readFileSync(casePath, 'utf8'));
const matcher = createMedicationSpellingMatcher(aliases);
const started = performance.now();
const outcomes = payload.cases.map((row) => {
  const candidates = matcher(row.query);
  const target = normalize(row.target);
  const rankIndex = candidates.findIndex(
    (candidate) =>
      normalize(candidate.name) === target ||
      candidate.canonicalTerms.some((term) => normalize(term) === target),
  );
  return {
    id: row.id,
    family: row.family,
    query: row.query,
    target,
    rank: rankIndex < 0 ? null : rankIndex + 1,
    candidateCount: candidates.length,
    candidates: candidates.map((candidate) => candidate.name),
  };
});
const elapsedMs = performance.now() - started;
const byFamily = Object.fromEntries(
  [...new Set(outcomes.map((row) => row.family))].sort().map((family) => {
    const rows = outcomes.filter((row) => row.family === family);
    return [
      family,
      {
        total: rows.length,
        top1: rows.filter((row) => row.rank === 1).length,
        top5: rows.filter((row) => row.rank !== null && row.rank <= 5).length,
        top8: rows.filter((row) => row.rank !== null).length,
      },
    ];
  }),
);
const exactGuardFailures = payload.exactControls.filter((query) => matcher(query).length > 0);
const negativeControls = payload.negativeControls.map((query) => ({
  query,
  candidates: matcher(query).map((candidate) => candidate.name),
}));
const report = {
  implementation: 'MiniMed weighted banded OSA',
  cases: outcomes.length,
  elapsedMs,
  microsecondsPerCase: (elapsedMs * 1000) / Math.max(1, outcomes.length),
  top1: outcomes.filter((row) => row.rank === 1).length,
  top5: outcomes.filter((row) => row.rank !== null && row.rank <= 5).length,
  top8: outcomes.filter((row) => row.rank !== null).length,
  byFamily,
  exactControls: payload.exactControls.length,
  exactGuardFailures,
  negativeControls,
  misses: outcomes.filter((row) => row.rank === null).slice(0, 50),
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, misses: undefined }, null, 2));
if (exactGuardFailures.length) throw new Error('Current matcher changed exact known names');
