// Prints the snippets of the first groups with their marked words (debug aid for SRCH1).
//   bun tools/benchmarks/src/probe-highlight.ts "query" [scope]
import {
  ScopedMedicalCore,
  type SearchScope,
} from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { openRealCorpus } from './real-corpus';

const [query, scope = 'all'] = process.argv.slice(2);
const { core } = await openRealCorpus({ companions: false });
const response = await new ScopedMedicalCore(core, scope as SearchScope).search({
  query: query ?? '',
  mode: 'lexical',
  analysisMode: 'lookup',
  filters: {},
  limit: 4,
  includeSuggestions: false,
});
if (response.ok) {
  for (const group of response.value.groups.slice(0, 4)) {
    const result = group.results[0];
    if (!result) continue;
    const marked = result.highlightedRanges.map((r) => `[${result.snippet.slice(r.start, r.end)}]`);
    console.log(
      `${group.title.slice(0, 70)}\n   terms=${result.matchedTerms.join(',')}\n   marks=${marked.join(' ')}\n   ${result.snippet.slice(0, 160).replaceAll('\n', ' ')}`,
    );
  }
}
await core.close();
