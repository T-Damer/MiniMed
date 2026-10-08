import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { E2E_ASSET_ORIGIN } from '@localmed/app/e2e/mount-built-app';
import { ContentModuleCatalogEntrySchema } from '@localmed/contracts';
import type { Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '../../..');
const DIRECTORY = resolve(ROOT, 'playwright/core-identities-fixture');
const MODULE_ID = 'minimed.definition.reference.ru';
const EDITION_ID = 'minimed.definition.reference.e2e';
const MODULE_URL = `${E2E_ASSET_ORIGIN}/core-identities/reference.db`;

const BUILD_FIXTURE = `
import json, sqlite3, sys
from pathlib import Path
from localmed_ingest.core_identity_index import _source_database, build_core_identity_index
from localmed_ingest.definition_reference_pack import encoded
from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference
from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.sqlite_builder import write_sqlite_pack
from localmed_ingest.models import ContentPack
from copy import deepcopy
root, directory = map(Path, sys.argv[1:])
source = root / 'data/build/definition-reference/2026.9.30/minimed.definition.reference.2026.9.30.db.gz'
entries, blocks, sources, expected = [], [], [], []
# Ranking signals: the first meaning is a rare traumatology one, the second the widely used one.
senses = [
    {'field': 'traumatology', 'fieldLabel': 'травматология', 'documents': 1, 'authority': 3,
     'usage': 2, 'termUsage': 40},
    {'field': 'psychiatry', 'fieldLabel': 'психиатрия', 'documents': 1, 'authority': 1,
     'usage': 30, 'termUsage': 40},
]
def take(db, rows, signals):
    for identity, title, kind, coverage, sense in rows:
        ordinal = len(entries) + 1
        text, raw_source, raw_span = db.execute("""SELECT c.original_text,d.metadata_json,c.metadata_json
          FROM definition_reference_links l JOIN definition_reference_chunks c ON c.id=l.chunk_id
          JOIN documents d ON d.id=l.document_id WHERE l.entity_id=?
          AND l.link_type='reference:definition' ORDER BY l.id LIMIT 1""", (identity,)).fetchone()
        source_descriptor = json.loads(raw_source)['source']
        sources.append({'id': ordinal, **source_descriptor})
        blocks.append({**json.loads(raw_span), 'id': ordinal, 'source': ordinal, 'text': text})
        entries.append({'id': identity, 'title': title, 'kind': kind, 'aliases': [],
                        'coverage': coverage, 'blockIds': [ordinal], 'note': '',
                        'sense': signals(sense, len(entries))})
        expected.append({'id': identity, 'title': title, 'text': text,
                         'locator': json.loads(raw_span)['locator']})

with _source_database(source) as db:
    rows = db.execute("""SELECT e.id,e.canonical_name,e.entity_type,
        json_extract(e.metadata_json,'$.coverage'), NULL FROM knowledge_entities e
        JOIN knowledge_names n ON n.entity_id=e.id
        WHERE n.normalized_name='на' ORDER BY e.id LIMIT 2""").fetchall()
    if len(rows) != 2:
        raise ValueError('Real source must provide two distinct НА meanings')
    take(db, rows, lambda _, index: senses[index])
# The candidate edition's real «Депрессия» senses (КР fracture pattern, mood disorder of the site),
# with the ranking signals the build measured, when that local edition exists.
candidate = root / 'data/build/definitions-ux13/2026.10.08/minimed.definition.reference.2026.10.08.db'
if candidate.exists():
    with _source_database(candidate) as db:
        rows = db.execute("""SELECT e.id,e.canonical_name,e.entity_type,
            json_extract(e.metadata_json,'$.coverage'), json_extract(e.metadata_json,'$.sense')
            FROM knowledge_entities e WHERE e.normalized_name='депрессия'
            AND json_extract(e.metadata_json,'$.coverage')='explicit-definition'
            AND EXISTS (SELECT 1 FROM definition_reference_links l JOIN definition_reference_chunks c
              ON c.id=l.chunk_id WHERE l.entity_id=e.id AND l.link_type='reference:definition'
              AND json_extract(c.metadata_json,'$.locator') IS NOT NULL) ORDER BY e.id""").fetchall()
        take(db, [row[:4] + (json.loads(row[4]),) for row in rows], lambda sense, _: sense)
payload = {'version': 3, 'id': 'e2e.exact-source-names', 'reviewStatus': 'requires-review',
           'publicationState': 'local-dev', 'textKind': 'source-excerpt',
           'sources': sources, 'blocks': blocks, 'terms': entries}
(directory / 'source.json').write_text(encoded(payload))
build_compact_definition_reference((Path('source.json'),), directory / 'reference.db',
    input_root=directory, edition_id='minimed.definition.reference.e2e', version='2026.9.30',
    built_at='2026-09-30', publication_state='experimental-preview')
slice = json.loads((root / 'packages/test-fixtures/src/generated/core-slice.json').read_text())
doc = next(d for d in slice['documents'] if d['id']=='regulatory.rf.minzdravsoc.521n-2012')
pack = {'manifest': {**slice['manifest'], 'id': 'e2e.exact-regulatory'}, 'documents': [doc]}
write_sqlite_pack(ContentPack.model_validate(pack), directory / 'regulatory.db')
wrong = deepcopy(pack)
wrong['documents'][0]['version']['sourceChecksum'] = 'sha256:' + '0'*64
wrong['manifest']['id'] = 'e2e.exact-identities-core'
write_sqlite_pack(ContentPack.model_validate(wrong), directory / 'discovery.db')
missing = {'manifest': {**pack['manifest'], 'id': 'e2e.exact-identities-core'},
           'documents': [next(d for d in slice['documents'] if d['id'] != doc['id'])]}
write_sqlite_pack(ContentPack.model_validate(missing), directory / 'missing.db')
(directory / 'document.json').write_text(json.dumps({
    'id': doc['id'], 'title': doc['title'], 'versionId': doc['version']['id'],
    'checksum': doc['version']['sourceChecksum'],
    'anchor': doc['sections'][0]['chunks'][0]['anchor'], 'status': doc['status']
}, ensure_ascii=False))
(directory / 'expected.json').write_text(json.dumps(expected, ensure_ascii=False))
`;

export async function cleanupCoreIdentityFixture(): Promise<void> {
  await rm(DIRECTORY, { recursive: true, force: true });
}

export async function prepareCoreIdentityFixture() {
  await cleanupCoreIdentityFixture();
  await mkdir(DIRECTORY, { recursive: true });
  const script = resolve(DIRECTORY, 'build-fixture.py');
  await writeFile(script, BUILD_FIXTURE);
  const run = promisify(execFile);
  const environment = {
    HOME: '/Users/d',
    PATH: '/Users/d/.bun/bin:/Users/d/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    TMPDIR: '/tmp',
    LANG: 'en_US.UTF-8',
  };
  await run(
    'uv',
    ['run', '--project', resolve(ROOT, 'tools/ingest'), 'python', script, ROOT, DIRECTORY],
    { env: environment },
  );
  const database = await readFile(resolve(DIRECTORY, 'reference.db'));
  const hash = `sha256:${createHash('sha256').update(database).digest('hex')}`;
  const raw: { modules: Record<string, unknown>[] } = JSON.parse(
    await readFile(resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
  );
  const original = raw.modules.find((module) => module['id'] === MODULE_ID);
  if (!original) throw new Error('Definition module missing from bundled catalog');
  const sourceSetDigest = `sha256:${createHash('sha256')
    .update(await readFile(resolve(DIRECTORY, 'source.json')))
    .digest('hex')}`;
  const expectedEntries: { id: string; title: string; text: string; locator: string }[] =
    JSON.parse(await readFile(resolve(DIRECTORY, 'expected.json'), 'utf8'));
  const module = ContentModuleCatalogEntrySchema.parse({
    ...original,
    title: 'Проверочная редакция словаря',
    sourceSetDigest,
    sizes: { downloadBytes: database.length, installedBytes: database.length, precision: 'exact' },
    compatibility: { ...(original['compatibility'] as Record<string, unknown>), schemaVersion: 7 },
    artifacts: [
      {
        id: 'reference-index',
        kind: 'index',
        required: true,
        url: MODULE_URL,
        sha256: hash,
        sizeBytes: database.length,
        compression: 'none',
        sourceSetDigest,
      },
    ],
    documents: [],
    definitionReference: { contract: 1, editionId: EDITION_ID, entries: expectedEntries.length },
  });
  const document: {
    id: string;
    title: string;
    versionId: string;
    checksum: string;
    anchor: string;
    status: string;
  } = JSON.parse(await readFile(resolve(DIRECTORY, 'document.json'), 'utf8'));
  const documentDatabase = await readFile(resolve(DIRECTORY, 'regulatory.db'));
  const documentHash = `sha256:${createHash('sha256').update(documentDatabase).digest('hex')}`;
  const originalDocumentModule = raw.modules.find(
    (entry) => entry['id'] === 'minimed.regulatory.pediatrics.ru',
  );
  if (!originalDocumentModule) throw new Error('Regulatory module missing from catalog');
  const documentBase = { ...originalDocumentModule };
  delete documentBase['documentTable'];
  const documentModule = ContentModuleCatalogEntrySchema.parse({
    ...documentBase,
    sourceSetDigest: documentHash,
    sizes: {
      downloadBytes: documentDatabase.length,
      installedBytes: documentDatabase.length,
      precision: 'exact',
    },
    artifacts: [
      {
        id: 'e2e-regulatory-index',
        kind: 'index',
        required: true,
        url: `${E2E_ASSET_ORIGIN}/core-identities/regulatory.db`,
        sha256: documentHash,
        sizeBytes: documentDatabase.length,
        compression: 'none',
        sourceSetDigest: documentHash,
      },
    ],
    documents: [
      {
        documentId: document.id,
        documentVersionId: document.versionId,
        sourceChecksum: document.checksum,
        status: document.status,
        indexArtifactId: 'e2e-regulatory-index',
        title: document.title,
      },
    ],
  });
  raw.modules = raw.modules.map((entry) =>
    entry['id'] === MODULE_ID ? module : entry['id'] === documentModule.id ? documentModule : entry,
  );

  await writeFile(resolve(DIRECTORY, 'catalog.json'), JSON.stringify(raw));
  for (const databaseName of ['discovery.db', 'missing.db'])
    await run(
      'uv',
      [
        'run',
        '--project',
        resolve(ROOT, 'tools/ingest'),
        'python',
        '-m',
        'localmed_ingest.core_identity_index',
        '--core',
        resolve(DIRECTORY, databaseName),
        '--catalog',
        resolve(DIRECTORY, 'catalog.json'),
        '--definitions',
        resolve(DIRECTORY, 'reference.db'),
        '--document-source',
        resolve(DIRECTORY, 'regulatory.db'),
      ],
      { env: environment },
    );
  const expected = expectedEntries;
  return {
    database,
    documentDatabase,
    discovery: await readFile(resolve(DIRECTORY, 'discovery.db')),
    missing: await readFile(resolve(DIRECTORY, 'missing.db')),
    original,
    module,
    expected,
    document,
    originalDocumentModule,
    documentModule,
  };
}

export async function routeCoreIdentityFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof prepareCoreIdentityFixture>>,
  missingDocument = false,
) {
  await page.route(
    (url) => /\/assets\/module-catalog-[A-Za-z0-9_-]{8}\.js$/u.test(url.pathname),
    async (route) => {
      // A navigation (the mount's reload) can dispose the request while this handler still reads
      // the original asset; that request is gone and the reloaded page asks again.
      let response: Awaited<ReturnType<typeof route.fetch>>;
      let script: string;
      try {
        response = await route.fetch();
        script = await response.text();
      } catch (cause) {
        if (cause instanceof Error && /disposed|closed/iu.test(cause.message)) return;
        throw cause;
      }
      for (const [before, after] of [
        [fixture.original, fixture.module],
        [fixture.originalDocumentModule, fixture.documentModule],
      ]) {
        const encodedBefore = JSON.stringify(JSON.stringify(before)).slice(1, -1);
        const encodedAfter = JSON.stringify(JSON.stringify(after)).slice(1, -1);
        const original = script.includes(encodedBefore) ? encodedBefore : JSON.stringify(before);
        if (!script.includes(original))
          throw new Error('Fixture descriptor missing from lazy catalog asset.');
        script = script.replace(
          original,
          original === encodedBefore ? encodedAfter : JSON.stringify(after),
        );
      }
      await route.fulfill({ response, body: script });
    },
  );
  await page.route(`${E2E_ASSET_ORIGIN}/content/core.db`, (route) =>
    route.fulfill({
      body: missingDocument ? fixture.missing : fixture.discovery,
      contentType: 'application/octet-stream',
    }),
  );
  await page.route(`${E2E_ASSET_ORIGIN}/content/reference.db`, (route) => route.abort());
  await page.route(MODULE_URL, (route) =>
    route.fulfill({ body: fixture.database, contentType: 'application/octet-stream' }),
  );
  await page.route(`${E2E_ASSET_ORIGIN}/core-identities/regulatory.db`, (route) =>
    route.fulfill({ body: fixture.documentDatabase, contentType: 'application/octet-stream' }),
  );
}
