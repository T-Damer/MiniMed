// Ad-hoc search probe: prints the first groups of each query through ScopedMedicalCore over the
// released corpus (MINIMED_CONTENT_DIR names the main checkout's apps/app/public/content).
//   bun tools/benchmarks/src/probe-search.ts [--scope=all|medications|...] [--limit=8] "query" …
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SearchResultGroup } from '@localmed/contracts';

import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus, REPOSITORY_ROOT } from './real-corpus';

const args = process.argv.slice(2);
const scope = (args.find((a) => a.startsWith('--scope='))?.slice(8) ?? 'all') as SearchScope;
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? 8);
const queries = args.filter((a) => !a.startsWith('--'));
/** `--tools` mounts the newest shipped `minimed-tools-*` module of each family (calculators, assessments). */
function toolModules(): { moduleId: string; path: string }[] {
  const directory = resolve(REPOSITORY_ROOT, 'apps/app/public/content/modules');
  const latest = new Map<string, string>();
  for (const name of readdirSync(directory).toSorted()) {
    if (!/^minimed-tools-.*\.db$/u.test(name)) continue;
    latest.set(name.replace(/-\d[\w.-]*\.db$/u, ''), name);
  }
  return [...latest.values()].map((name) => ({
    moduleId: name.replace(/\.db$/u, ''),
    path: resolve(directory, name),
  }));
}
const { core } = await openRealCorpus({
  companions: !args.includes('--core-only'),
  ...(args.includes('--tools') ? { installedModules: toolModules() } : {}),
});
const scoped = new ScopedMedicalCore(core, scope);
for (const query of queries) {
  const started = performance.now();
  const response = await scoped.search({
    query,
    mode: 'lexical',
    analysisMode: 'lookup',
    filters: {},
    limit,
    includeSuggestions: false,
  });
  if (!response.ok) {
    console.log(`${query}: ERROR ${response.error.message}`);
    continue;
  }
  const v = response.value;
  console.log(
    `\n«${query}» [${scope}] ${Math.round(performance.now() - started)} ms` +
      `${v.queryRewrite ? ` rewrite=${JSON.stringify(v.queryRewrite)}` : ''}` +
      `${v.queryCorrection ? ` correction=${JSON.stringify(v.queryCorrection)}` : ''}`,
  );
  if (v.drugClass) {
    console.log(
      `  class: ${v.drugClass.label} · ${v.drugClass.drugCount} (listed ${v.drugClass.listed}) · ${v.drugClass.groups
        .map((g) => `${g.code} ${g.name} ×${g.drugCount}`)
        .join('; ')}`,
    );
  }
  v.groups.slice(0, limit).forEach((g: SearchResultGroup, i: number) => {
    console.log(`  ${i + 1}. ${g.title} | ${g.documentId} | ${g.contentKind ?? ''}`);
  });
}
await core.close();
