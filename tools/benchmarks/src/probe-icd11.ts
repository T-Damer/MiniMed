// Probe for the «МКБ-11» search section: top titles of ad-hoc queries through ScopedMedicalCore('icd11').
//
//   MINIMED_CONTENT_DIR=<main>/apps/app/public/content ICD11_DB=<decoded module db> \
//     bun tools/benchmarks/src/probe-icd11.ts "1A00" "инфаркт миокарда"

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const database = process.env['ICD11_DB'];
if (!database) throw new Error('ICD11_DB must name the decoded МКБ-11 module database.');
const { core } = await openRealCorpus({
  installedModules: [{ moduleId: 'minimed.reference.icd11.ru', path: database }],
});
const scoped = new ScopedMedicalCore(core, 'icd11');
for (const query of process.argv.slice(2)) {
  const result = await scoped.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit: 20,
    includeSuggestions: false,
  });
  if (!result.ok) throw new Error(`${query}: ${result.error.message}`);
  console.log(`\n${query}  (${result.value.groups.length} groups)`);
  for (const group of result.value.groups.slice(0, 6)) {
    console.log(`  ${group.title}  [${group.documentId}]`);
  }
}
await core.close();
