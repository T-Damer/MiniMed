import { Database } from 'bun:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBunFileMedicalStore } from './src/bun-sqlite-medical-store';

const [dbPath, baselinePath, currentPath, output, commit] = process.argv.slice(2);
if (!dbPath || !baselinePath || !currentPath || !output || !/^[a-f0-9]{40}$/.test(commit ?? '')) {
  throw new Error('DB BASELINE_CORE CURRENT_CORE OUTPUT CHECKED_COMMIT');
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const normalize = (value) =>
  value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
const db = new Database(dbPath, { readonly: true });
const databaseSha256 = hash(readFileSync(dbPath));
const documents = db.query('SELECT id, title FROM documents').all();
const medicationDocuments = db
  .query(
    "SELECT id, title FROM documents WHERE json_extract(metadata_json, '$.catalogFamily') = 'medication'",
  )
  .all();
const aliases = db.query('SELECT alias, canonical_term, category FROM aliases').all();
const known = new Set([
  ...documents.map((row) => normalize(row.title)),
  ...aliases.flatMap((row) => [normalize(row.alias), normalize(row.canonical_term)]),
]);
const targets = new Map();
for (const row of medicationDocuments) {
  const name = normalize(row.title);
  const ids = targets.get(name) ?? [];
  ids.push(row.id);
  targets.set(name, ids);
}
for (const ids of targets.values()) ids.sort();
const owners = [...targets.keys()]
  .filter((name) => /^[а-я]{7,30}$/u.test(name))
  .map((name) => ({ name, seed: hash(`medication-spelling-v1\0${name}`) }))
  .sort((a, b) => a.seed.localeCompare(b.seed));
// Independent, mechanical corruption; never use the production matcher to choose passing cases.
const replacements = new Map();
for (const pair of ['ие', 'дт', 'ео', 'зс', 'жш', 'ао']) {
  for (const [a, b] of [
    [pair[0], pair[1]],
    [pair[1], pair[0]],
  ]) {
    const values = replacements.get(a) ?? [];
    values.push(b);
    replacements.set(a, values);
  }
}
function corrupt(name, family, seed) {
  const letters = [...name];
  const at = Number.parseInt(seed.slice(0, 8), 16) % (letters.length - 1);
  if (family === 'transposition') [letters[at], letters[at + 1]] = [letters[at + 1], letters[at]];
  else if (family === 'deletion') letters.splice(at, 1);
  else if (family === 'insertion') letters.splice(at, 0, letters[at]);
  else if (family === 'substitution') letters[at] = letters[at] === 'х' ? 'ц' : 'х';
  else {
    const required = Number(family.slice(-1));
    if (required === 3 && name.length < 10) return null;
    let changed = 0;
    for (let offset = 0; offset < letters.length && changed < required; offset += 1) {
      const position = (at + offset) % letters.length;
      const alternatives = replacements.get(letters[position]);
      if (!alternatives?.length) continue;
      letters[position] =
        alternatives[Number.parseInt(seed.slice(8, 10), 16) % alternatives.length];
      changed += 1;
    }
    if (changed !== required) return null;
  }
  return letters.join('');
}
const cases = [];
const seen = new Set();
let knownNameCollisionsExcluded = 0;
for (const family of [
  'transposition',
  'deletion',
  'insertion',
  'substitution',
  'confusion-1',
  'confusion-2',
  'confusion-3',
]) {
  let count = 0;
  for (const owner of owners) {
    const query = corrupt(owner.name, family, owner.seed);
    if (!query || query === owner.name || seen.has(query)) continue;
    if (known.has(query)) {
      knownNameCollisionsExcluded += 1;
      continue;
    }
    seen.add(query);
    cases.push({
      id: `${family}.${count}`,
      family,
      query,
      sourceName: owner.name,
      expected: targets.get(owner.name),
    });
    count += 1;
    if (count === 20) break;
  }
  assert.equal(count, 20, `Insufficient corpus names for ${family}`);
}
const authored = [
  ['парацетомол', 'парацетамол'],
  ['парацитамол', 'парацетамол'],
  ['парацитамолл', 'парацетамол'],
  ['парацетмаол', 'парацетамол'],
  ['парацтамол', 'парацетамол'],
  ['паарацетамол', 'парацетамол'],
  ['парацктамол', 'парацетамол'],
  ['пароцитамол', 'парацетамол'],
  ['цефтреаксон', 'цефтриаксон'],
  ['цефтриакзон', 'цефтриаксон'],
  ['цефазалин', 'цефазолин'],
  ['амоксицилин', 'амоксициллин'],
  ['омепрозол', 'омепразол'],
  ['азетромецин', 'азитромицин'],
  ['ациклавир', 'ацикловир'],
  ['резперидон', 'рисперидон'],
  ['энолоприл', 'эналаприл'],
  ['тиклофенак', 'диклофенак'],
  ['ацетилсалициловая кислата', 'ацетилсалициловая кислота'],
  ['парацитамол 500 мг', 'парацетамол'],
  ['инструкция к парацитамол', 'парацетамол'],
  ['препарат амоксицилин', 'амоксициллин'],
].map(([query, name], i) => ({
  id: `authored.${i}`,
  family: 'authored',
  query,
  sourceName: name,
  expected: targets.get(name) ?? [],
}));
cases.push(...authored);
const exactQueries = [
  ...new Set([
    ...owners.slice(0, 100).map((row) => row.name),
    ...authored.map((row) => row.sourceName),
    'кеторол',
    'кетонал',
    'клозапин',
    'клоназепам',
  ]),
];
const controls = [
  'АД',
  'F20',
  '123456',
  'космический мармелад',
  'не парацитомол',
  'аллергия на парацитомол',
];
db.close();

async function sample(path) {
  const { createMedicalCore } = await import(pathToFileURL(resolve(path)).href);
  const store = await createBunFileMedicalStore(dbPath);
  const core = createMedicalCore({ store });
  const initialized = await core.initialize();
  assert(initialized.ok);
  const search = async (query, filters = {}) => {
    const result = await core.search({
      query,
      analysisMode: 'lookup',
      mode: 'lexical',
      limit: 20,
      filters,
    });
    assert(result.ok, JSON.stringify(result));
    assert.equal(result.value.analysis.originalQuery, query);
    assert.equal(result.value.analysis.facts.length, 0);
    assert.equal(result.value.analysis.calculation, undefined);
    assert(result.value.groups.length <= 20);
    return result.value;
  };
  const cold = await search('Парацетамол');
  const outcomes = [];
  let contextChecks = 0;
  try {
    for (const item of cases) {
      const result = await search(item.query);
      const position = result.groups.findIndex((group) => item.expected.includes(group.documentId));
      const hit = position < 0 ? undefined : result.groups[position]?.results[0];
      if (hit) {
        const context = await core.getSearchResultContext(hit, 0);
        assert(context.ok);
        assert.equal(context.value.document.id, hit.documentId);
        assert.equal(context.value.focusChunkId, hit.chunkId);
        assert(
          context.value.chunks.some(
            (chunk) => chunk.id === hit.chunkId && chunk.anchor === hit.anchor,
          ),
        );
        contextChecks += 1;
      }
      outcomes.push({
        ...item,
        corpusMissing: item.expected.length === 0,
        rank: position < 0 ? null : position + 1,
        elapsedMs: result.elapsedMs,
        alternatives: result.analysis.branches
          .filter((branch) => branch.id.startsWith('medication-spelling-'))
          .map((branch) => branch.label),
        top: result.groups
          .slice(0, 5)
          .map((group) => ({ id: group.documentId, title: group.title })),
      });
    }
    const exact = {};
    for (const query of exactQueries) exact[query] = (await search(query)).groups;
    const negatives = [];
    for (const query of controls) {
      const result = await search(query);
      negatives.push({
        query,
        spellingBranches: result.analysis.branches.filter((branch) =>
          branch.id.startsWith('medication-spelling-'),
        ).length,
        ids: result.groups.map((group) => group.documentId),
      });
    }
    const excluded = await search('парацитомол', { documentIds: ['fixture.uninstalled-medicine'] });
    assert.equal(excluded.groups.length, 0);
    const target = targets.get('парацетамол');
    assert(target?.length);
    const scoped = await search('парацитомол', { documentIds: target });
    assert(scoped.groups.every((group) => target.includes(group.documentId)));
    const analyses = [];
    for (const query of ['парацитомол', 'парацитамол 500 мг', 'аллергия на парацитомол']) {
      const result = await core.analyzeQuery({ query, includeSuggestions: true });
      assert(result.ok);
      analyses.push(result.value);
    }
    return {
      outcomes,
      exact,
      negatives,
      contextChecks,
      coldMs: cold.elapsedMs,
      documentFilterChecks: 2,
      analyses,
    };
  } finally {
    await core.close();
  }
}
const before = await sample(baselinePath);
const after = await sample(currentPath);
const summarize = (sample, family) => {
  const rows = sample.outcomes.filter((row) => row.family === family && !row.corpusMissing);
  const times = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
  return {
    total: rows.length,
    top1: rows.filter((row) => row.rank === 1).length,
    top5: rows.filter((row) => row.rank !== null && row.rank <= 5).length,
    top20: rows.filter((row) => row.rank !== null).length,
    p50Ms: times[Math.floor(times.length / 2)] ?? null,
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] ?? null,
  };
};
const exactChanges = exactQueries.filter(
  (query) => JSON.stringify(before.exact[query]) !== JSON.stringify(after.exact[query]),
);
const regressions = after.outcomes
  .filter(
    (row, i) =>
      before.outcomes[i].rank !== null && (row.rank === null || row.rank > before.outcomes[i].rank),
  )
  .map((row) => row.id);
const report = {
  baselineCommit: '06b3c68de2725f124d15140daf317dc5400d199b',
  checkedCommit: commit,
  databaseSha256,
  caseSha256: hash(JSON.stringify(cases)),
  sameDatabaseForBoth: databaseSha256 === hash(readFileSync(dbPath)),
  corpus: {
    documents: documents.length,
    medicationDocuments: medicationDocuments.length,
    medicationAliases: aliases.filter((row) => row.category === 'medication').length,
    eligibleMechanicalNames: owners.length,
  },
  cases: after.outcomes.map((row, i) => ({ ...row, beforeRank: before.outcomes[i].rank })),
  byFamily: Object.fromEntries(
    [...new Set(cases.map((row) => row.family))].map((family) => [
      family,
      { before: summarize(before, family), after: summarize(after, family) },
    ]),
  ),
  exactChecked: exactQueries.length,
  exactChanges,
  regressions,
  knownNameCollisionsExcluded,
  missingTargets: authored.filter((row) => row.expected.length === 0),
  coldLookupMs: { before: before.coldMs, after: after.coldMs },
  contextChecks: { before: before.contextChecks, after: after.contextChecks },
  controls: { before: before.negatives, after: after.negatives },
  clinicalParserUnchanged: JSON.stringify(before.analyses) === JSON.stringify(after.analyses),
  documentFilterChecks: after.documentFilterChecks,
  limitations:
    '140 deterministically corrupted real medication names plus 22 authored development queries, not independent clinician typo logs or diagnostic validation. Catalog pointers are navigation records, not full drug instructions. Existing-name collisions excluded from the mechanical set are disclosed and protected by separate exact-name tests. Single Linux host run; no Android/WebView latency claim. No gold-derived aliases, medication substitution, dosage correction, corpus edits or model downloads.',
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, cases: undefined, controls: undefined }, null, 2));
assert(report.sameDatabaseForBoth);
assert.equal(exactChanges.length, 0);
assert(report.clinicalParserUnchanged);
assert(after.negatives.every((row) => row.spellingBranches === 0));
assert(
  after.outcomes.filter((row) => row.rank !== null).length >
    before.outcomes.filter((row) => row.rank !== null).length,
);
