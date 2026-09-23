import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBunFileMedicalStore } from './src/bun-sqlite-medical-store';

const [dbPath, baselinePath, output, checkedCommit] = process.argv.slice(2);
if (!dbPath || !baselinePath || !output || !/^[a-f0-9]{40}$/u.test(checkedCommit ?? ''))
  throw new Error('Expected DB BASELINE_CORE OUTPUT CHECKED_COMMIT');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) => value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').trim();
const databaseSha256 = hash(readFileSync(dbPath));
const db = new Database(dbPath, { readonly: true });
const aliases = db.query("SELECT alias, canonical_term FROM aliases WHERE category = 'medication'").all();
const documents = db.query('SELECT id, title FROM documents').all();
const byTitle = new Map();
for (const document of documents) {
  const key = normalize(document.title);
  byTitle.set(key, [...(byTitle.get(key) ?? []), document.id]);
}
const byName = new Map();
for (const alias of aliases) {
  const key = normalize(alias.alias);
  const ids = byTitle.get(normalize(alias.canonical_term)) ?? [];
  byName.set(key, [...new Set([...(byName.get(key) ?? []), ...ids])].sort());
}
const prior = JSON.parse(readFileSync('docs/research/medication-spelling-2026-09-23.json', 'utf8'));
assert.equal(databaseSha256, prior.databaseSha256, 'Frozen regression corpus changed');
const cases = prior.cases.map(({ query, expected, sourceName, id }) => ({
  id: `prior.${id}`, family: 'prior-162', query, expected, sourceName,
}));
const userQueries = ['канефрно', 'канифрон', 'конифрон', 'конефрно', 'канефронн', 'канефро', 'канефром', 'канефрн', 'канифрно', 'канифрон н'];
for (const [i, query] of userQueries.entries())
  cases.push({ id: `user.${i}`, family: 'user-kanephron', query, expected: byName.get('канефрон н') ?? [], sourceName: 'Канефрон Н' });
const marked = [...byName].filter(([name, ids]) => /^[а-я]{7,48}[ -][а-я]$/u.test(name) && ids.length)
  .map(([name, ids]) => ({ name, ids, key: hash(`suffix-audit-v1:${name}`) }))
  .sort((a, b) => a.key.localeCompare(b.key));
let exactCollisionsExcluded = 0;
for (const [i, item] of marked.slice(0, 20).entries()) {
  const stem = item.name.slice(0, -2);
  const mutations = {
    'last-swap': `${stem.slice(0, -2)}${stem.at(-1)}${stem.at(-2)}`,
    'last-delete': stem.slice(0, -1),
    'last-double': `${stem}${stem.at(-1)}`,
    'first-swap': `${stem[1]}${stem[0]}${stem.slice(2)}`,
  };
  for (const [family, query] of Object.entries(mutations)) {
    if (query === stem || byName.has(query) || byTitle.has(query)) { exactCollisionsExcluded += 1; continue; }
    cases.push({ id: `marked.${i}.${family}`, family, query, expected: item.ids, sourceName: item.name });
  }
}
assert(cases.every((row) => row.expected.length), 'Do not hide missing corpus targets');
const exact = [...new Set([
  ...prior.cases.map((row) => row.sourceName),
  ...marked.map((row) => row.name),
  'кеторол', 'кетонал', 'клозапин', 'клоназепам', 'нурофен', 'амоксиклав',
])];
db.close();

async function sample(corePath) {
  const { createMedicalCore } = await import(pathToFileURL(resolve(corePath)).href);
  const core = createMedicalCore({ store: await createBunFileMedicalStore(dbPath) });
  assert((await core.initialize()).ok);
  const search = async (query, filters = {}) => {
    const result = await core.search({ query, analysisMode: 'lookup', mode: 'lexical', limit: 20, filters });
    assert(result.ok, JSON.stringify(result));
    assert.equal(result.value.analysis.originalQuery, query);
    assert.deepEqual(result.value.analysis.facts, []);
    assert.equal(result.value.analysis.calculation, undefined);
    return result.value;
  };
  const outcomes = [];
  const exactResults = {};
  let contextChecks = 0;
  try {
    await search('Парацетамол');
    for (const row of cases) {
      const result = await search(row.query);
      const index = result.groups.findIndex((group) => row.expected.includes(group.documentId));
      const rank = index < 0 ? null : index + 1;
      if (index >= 0) {
        const hit = result.groups[index].results[0];
        const context = await core.getSearchResultContext(hit, 0);
        assert(context.ok);
        assert.equal(context.value.document.id, hit.documentId);
        assert(context.value.chunks.some((chunk) => chunk.id === hit.chunkId && chunk.anchor === hit.anchor));
        contextChecks += 1;
      }
      outcomes.push({ ...row, rank, elapsedMs: result.elapsedMs,
        warnings: result.analysis.warnings,
        top: result.groups.slice(0, 3).map((group) => ({ id: group.documentId, title: group.title })),
      });
    }
    for (const query of exact) exactResults[query] = (await search(query)).groups;
    const filterCases = [{ documentIds: ['missing-document'] }, { sectionTypes: ['missing-section'] }, { specialties: ['missing-specialty'] }, { ageGroups: ['missing-age'] }];
    for (const filters of filterCases) assert.equal((await search('канефрно', filters)).groups.length, 0);
    const analyses = [];
    for (const query of ['конифрон', 'не канифрон', 'аллергия на канефрно']) {
      const analysis = await core.analyzeQuery({ query, includeSuggestions: true });
      assert(analysis.ok);
      analyses.push(analysis.value);
    }
    return { outcomes, exactResults, contextChecks, filterChecks: filterCases.length, analyses };
  } finally { await core.close(); }
}
const before = await sample(baselinePath);
const after = await sample('packages/core/src/create-medical-core.ts');
const exactChanges = exact.filter((query) => JSON.stringify(before.exactResults[query]) !== JSON.stringify(after.exactResults[query]));
const regressions = after.outcomes.filter((row, i) => before.outcomes[i].rank !== null && (row.rank === null || row.rank > before.outcomes[i].rank)).map((row) => row.id);
function summary(rows, family) {
  const selected = rows.filter((row) => row.family === family);
  const times = selected.map((row) => row.elapsedMs).sort((a, b) => a - b);
  return { total: selected.length, top1: selected.filter((row) => row.rank === 1).length,
    top5: selected.filter((row) => row.rank !== null && row.rank <= 5).length,
    top20: selected.filter((row) => row.rank !== null).length,
    p50Ms: times[Math.floor(times.length / 2)], p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
  };
}
const report = { baselineCommit: '4c66e84f31632f3847c735a300ce15b1ca596019', checkedCommit,
  databaseSha256, sameDatabaseForBoth: databaseSha256 === hash(readFileSync(dbPath)),
  caseSha256: hash(JSON.stringify(cases)), markedSourceNames: marked.length, exactCollisionsExcluded,
  byFamily: Object.fromEntries([...new Set(cases.map((row) => row.family))].map((family) => [family, { before: summary(before.outcomes, family), after: summary(after.outcomes, family) }])),
  exactChecked: exact.length, exactChanges, regressions, contextChecks: after.contextChecks, filterChecks: after.filterChecks,
  clinicalParserUnchanged: JSON.stringify(before.analyses) === JSON.stringify(after.analyses),
  cases: after.outcomes.map((row, i) => ({ ...row, beforeRank: before.outcomes[i].rank })),
  limitations: 'Retained 162 development regressions, user examples and independent mechanical boundary edits from actual marked aliases. Not independent clinician logs, all possible suffixes, clinical validation or device latency. Full source variants remain separate; result existence does not establish a medication substitution.',
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
assert(report.sameDatabaseForBoth && report.clinicalParserUnchanged);
assert.equal(exactChanges.length, 0);
assert.equal(regressions.filter((id) => id.startsWith('prior.')).length, 0);
assert(after.outcomes.filter((row) => row.family === 'user-kanephron').every((row) => row.rank !== null && row.rank <= 5));
