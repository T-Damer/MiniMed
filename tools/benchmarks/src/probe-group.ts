// Prints the raw first groups of one query (debug aid for SRCH1).
//   bun tools/benchmarks/src/probe-group.ts "query" [scope]
import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const [query, scope = 'medications'] = process.argv.slice(2);
const { core } = await openRealCorpus({ companions: false });
const response = await new ScopedMedicalCore(core, scope as SearchScope).search({
  query: query ?? '',
  mode: 'lexical',
  analysisMode: 'lookup',
  filters: {},
  limit: 3,
  includeSuggestions: false,
});
if (response.ok)
  console.log(JSON.stringify(response.value.groups.slice(0, 2), null, 1).slice(0, 6000));
await core.close();
