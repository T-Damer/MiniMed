/** Deterministic native fixtures from the released store; no source prose is duplicated. */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openRealCorpus, REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';
import { CoreIdentityHitSchema, normalizeCoreIdentityName } from '@localmed/contracts';
import { z } from 'zod';

const corePath = resolve(REPOSITORY_ROOT, 'apps/app/public/content/core.db');
const output = resolve(
  REPOSITORY_ROOT,
  'native/shared/src/commonTest/resources/core-identities-golden.json',
);
const moduleName = 'bun:sqlite';
const sqlite: {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => {
    query(sql: string): { all(): unknown[] };
    close(): void;
  };
} = await import(moduleName);
const database = new sqlite.Database(corePath, { readonly: true });
const names = z.array(z.object({ name: z.string().min(1) }));
let samples: readonly string[];
try {
  // Cover every declared kind plus ambiguous literal names, using the shipped index itself.
  const rows = database
    .query(`WITH named AS (
    SELECT n.name,t.kind,ROW_NUMBER() OVER (PARTITION BY t.kind ORDER BY n.name,t.target_id) AS ordinal
    FROM core_identities n JOIN core_identity_targets t ON t.target_id=n.target_id AND t.module_id=n.module_id
  ) SELECT name FROM named WHERE ordinal<=8
  UNION SELECT name FROM (SELECT name FROM core_identities GROUP BY normalized_name
    HAVING COUNT(DISTINCT target_id)>1 ORDER BY normalized_name LIMIT 16)
  ORDER BY name`)
    .all();
  samples = names.parse(rows).map((row) => row.name);
} finally {
  database.close();
}

const lookup = z
  .object({ queries: z.array(z.object({ query: z.string() })) })
  .parse(
    JSON.parse(
      await readFile(
        resolve(REPOSITORY_ROOT, 'native/shared/src/commonTest/resources/search-golden.json'),
        'utf8',
      ),
    ),
  );
const queries = [
  ...new Set([
    ...samples,
    ...samples.slice(0, 12).map((name) => `  ${name.toUpperCase()}\t`),
    ...lookup.queries.map((item) => item.query),
    'Ａ００',
    'Ёж',
    'PHQ–9',
    'minimed-negative-identity-2026-09-30',
  ]),
];
const hash = createHash('sha256');
for await (const bytes of createReadStream(corePath)) hash.update(bytes);
const { core, store } = await openRealCorpus({ companions: false });
const cases = [];
try {
  for (const query of queries)
    cases.push({
      query,
      normalized: normalizeCoreIdentityName(query),
      hits: z.array(CoreIdentityHitSchema).parse(await store.lookupCoreIdentities(query)),
    });
} finally {
  await core.close();
}
const types = new Set(cases.flatMap((item) => item.hits.map((hit) => hit.target.type)));
if (!types.has('document') || !types.has('definition'))
  throw new Error('Identity fixture lacks a target family');
await writeFile(
  output,
  `${JSON.stringify({ contract: 1, coreSha256: hash.digest('hex'), cases })}\n`,
);
console.log(
  JSON.stringify({
    cases: cases.length,
    positive: cases.filter((item) => item.hits.length).length,
    ambiguous: cases.filter((item) => item.hits.length > 1).length,
    targetFamilies: [...types].sort(),
  }),
);
