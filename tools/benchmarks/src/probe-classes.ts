// Which class words the shared vocabulary (drug-interactions/class-phrases.ts) already reads (debug aid for SRCH1).
//   bun tools/benchmarks/src/probe-classes.ts "макролиды" "статины" …

import { deriveClassPhrases } from '../../../apps/app/src/features/drug-interactions/class-phrases';
import { nameStems } from '../../../apps/app/src/features/drug-interactions/mention-matcher';
import atcNames from '../../../apps/app/src/features/medications/atc-names.json';

const { phrases, report } = deriveClassPhrases(
  (atcNames as { names: Record<string, string> }).names,
);
console.log(
  `phrases ${report.phrases}, from names ${report.fromNames}, aliases ${report.fromAliases}`,
);
const byKey = new Map<string, typeof phrases>();
for (const phrase of phrases) {
  const key = phrase.stems.join(' ');
  byKey.set(key, [...(byKey.get(key) ?? []), phrase]);
}
for (const query of process.argv.slice(2)) {
  const key = nameStems(query).join(' ');
  const found = byKey.get(key) ?? [];
  console.log(
    `${query} [${key}] → ${found.length === 0 ? '—' : found.map((p) => `${p.origin}:${p.codes.join(',')}`).join(' | ')}`,
  );
}
