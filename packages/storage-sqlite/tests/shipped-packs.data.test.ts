// Data-type test: every SQLite pack that ships in the repository (or is restored from it) keeps the
// content-pack shape, internal references and the sidecar reports/catalog it is published with.
// One generic check per pack, not per document. See docs/DATA_TESTS.md.
//
// Heavy gitignored companion packs (mkb.db, medications.db, ambulatory.db) run only with
// MINIMED_RELEASE_DATA=1 (`bun run test:data:release`), and skip cleanly when the file is absent.
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const CONTENT = join(ROOT, 'apps/app/public/content');
const MODULES = join(CONTENT, 'modules');
// Gitignored companion packs live in the main checkout, not in a worktree.
const COMPANION_DIR = process.env['MINIMED_COMPANION_DIR'] ?? CONTENT;
const RELEASE_DATA = process.env['MINIMED_RELEASE_DATA'] === '1';

type Row = Record<string, unknown>;

const scratch = mkdtempSync(join(tmpdir(), 'minimed-pack-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function openPack(path: string): DatabaseSync {
  if (path.endsWith('.gz')) {
    const target = join(scratch, `${basename(path)}.db`);
    if (!existsSync(target)) writeFileSync(target, gunzipSync(readFileSync(path)));
    return new DatabaseSync(target, { readOnly: true });
  }
  return new DatabaseSync(path, { readOnly: true });
}

function rows(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all() as Row[];
}

function count(db: DatabaseSync, sql: string): number {
  return Number((rows(db, sql)[0] as Row)['c']);
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return (
    rows(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0
  );
}

/** Shape and reference integrity every content pack must keep, whatever its kind. */
function expectPackIntegrity(db: DatabaseSync, label: string): void {
  expect(rows(db, 'PRAGMA quick_check(1)'), `${label} quick_check`).toEqual([
    { quick_check: 'ok' },
  ]);
  expect(rows(db, 'PRAGMA foreign_key_check'), `${label} foreign keys`).toEqual([]);

  const packs = rows(db, 'SELECT id, version, schema_version, checksum FROM content_packs');
  expect(packs.length, `${label} content_packs`).toBeGreaterThan(0);
  for (const pack of packs) {
    expect(String(pack['id']), label).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(String(pack['version']).length, label).toBeGreaterThan(0);
    expect(pack['schema_version'], label).toBe(2);
    expect(String(pack['checksum']), label).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(
    count(db, 'SELECT max(version) c FROM schema_migrations'),
    `${label} migrations`,
  ).toBeGreaterThanOrEqual(2);

  if (count(db, 'SELECT count(*) c FROM documents') === 0) return;

  // Every document names an existing pack and a version of its own.
  expect(
    count(
      db,
      `SELECT count(*) c FROM documents d
       LEFT JOIN document_versions v ON v.id = d.current_version_id AND v.document_id = d.id
       WHERE v.id IS NULL`,
    ),
    `${label} documents without their current version`,
  ).toBe(0);
  expect(
    count(
      db,
      "SELECT count(*) c FROM documents WHERE trim(title) = '' OR content_pack_id NOT IN (SELECT id FROM content_packs)",
    ),
    `${label} untitled or orphan documents`,
  ).toBe(0);
  // Every current version has text to read.
  expect(
    count(
      db,
      `SELECT count(*) c FROM documents d
       WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.document_version_id = d.current_version_id)`,
    ),
    `${label} documents without a chunk`,
  ).toBe(0);
  expect(
    count(db, "SELECT count(*) c FROM chunks WHERE trim(original_text) = ''"),
    `${label} empty chunks`,
  ).toBe(0);
  // Chunk chains are doubly linked: next(previous(x)) = x.
  expect(
    count(
      db,
      `SELECT count(*) c FROM chunks a JOIN chunks b ON b.id = a.next_chunk_id
       WHERE b.previous_chunk_id IS NOT a.id`,
    ),
    `${label} broken chunk chain`,
  ).toBe(0);
  expect(
    count(db, "SELECT count(*) c FROM aliases WHERE trim(alias) = '' OR trim(canonical_term) = ''"),
    `${label} empty aliases`,
  ).toBe(0);
  // Embeddings point at existing chunks and declared profiles.
  if (count(db, 'SELECT count(*) c FROM chunk_embeddings') > 0) {
    expect(
      count(db, 'SELECT count(*) c FROM embedding_profiles'),
      `${label} embedding profiles`,
    ).toBeGreaterThan(0);
  }
}

interface PackReport {
  readonly documents: number;
  readonly sections: number;
  readonly chunks: number;
  readonly aliases: number;
  readonly embeddings: number;
  readonly sqliteIntegrity: string;
  readonly foreignKeyViolations: number;
  readonly outputChecksum: string;
}

function expectReportMatches(db: DatabaseSync, report: PackReport, label: string): void {
  expect(
    {
      documents: count(db, 'SELECT count(*) c FROM documents'),
      sections: count(db, 'SELECT count(*) c FROM sections'),
      chunks: count(db, 'SELECT count(*) c FROM chunks'),
      aliases: count(db, 'SELECT count(*) c FROM aliases'),
      embeddings: count(db, 'SELECT count(*) c FROM chunk_embeddings'),
    },
    `${label} counts vs report`,
  ).toEqual({
    documents: report.documents,
    sections: report.sections,
    chunks: report.chunks,
    aliases: report.aliases,
    embeddings: report.embeddings,
  });
  expect(report.sqliteIntegrity).toBe('ok');
  expect(report.foreignKeyViolations).toBe(0);
}

describe('bundled core.db (restored from content/bundled/core.db.gz)', () => {
  const corePath = join(CONTENT, 'core.db');
  const report = readJson<
    PackReport & {
      coreBuildVersion: string;
      distributions: { browser: { compressedChecksum: string; compressedSizeBytes: number } };
      coreIdentityIndex: { identities: number; targets: number };
    }
  >(join(CONTENT, 'core-report.json'));

  it('keeps the bundled archive equal to the transfer checksum recorded in core-report.json', () => {
    const archive = readFileSync(join(ROOT, 'content/bundled/core.db.gz'));
    expect(sha256(archive)).toBe(report.distributions.browser.compressedChecksum);
    expect(archive.length).toBe(report.distributions.browser.compressedSizeBytes);
  });

  it.skipIf(!existsSync(corePath))(
    'is a valid content pack whose counts and version match core-report.json',
    () => {
      const db = openPack(corePath);
      try {
        expectPackIntegrity(db, 'core.db');
        expectReportMatches(db, report, 'core.db');
        expect(rows(db, 'SELECT version FROM content_packs')).toEqual([
          { version: report.coreBuildVersion },
        ]);
        // Identity index (exact lookup) is complete: counts as reported, every target names an identity.
        expect(count(db, 'SELECT count(*) c FROM core_identities')).toBe(
          report.coreIdentityIndex.identities,
        );
        expect(count(db, 'SELECT count(*) c FROM core_identity_targets')).toBe(
          report.coreIdentityIndex.targets,
        );
        // Exact-lookup targets: every target has a name, a typed pointer and a known kind.
        expect(
          count(
            db,
            'SELECT count(*) c FROM (SELECT DISTINCT target_id, module_id FROM core_identities)',
          ),
          'targets with an identity (foreign key makes the identities a subset)',
        ).toBe(report.coreIdentityIndex.targets);
        expect(
          count(
            db,
            `SELECT count(*) c FROM core_identity_targets
           WHERE json_extract(target_json, '$.moduleId') IS NULL
              OR json_extract(target_json, '$.type') NOT IN ('definition', 'document')
              OR (json_extract(target_json, '$.type') = 'definition' AND json_extract(target_json, '$.entityId') IS NULL)
              OR (json_extract(target_json, '$.type') = 'document' AND json_extract(target_json, '$.documentId') IS NULL)`,
          ),
          'malformed target pointers',
        ).toBe(0);
        expect(
          count(db, 'SELECT count(DISTINCT kind) c FROM core_identity_targets'),
        ).toBeGreaterThanOrEqual(5);
        // One representative name resolves.
        expect(
          count(db, "SELECT count(*) c FROM core_identities WHERE normalized_name = 'пневмония'"),
        ).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    },
    60_000,
  );
});

/** One representative content assertion per pack family: a source type and a title that must exist. */
const REPRESENTATIVE: readonly {
  readonly file: RegExp;
  readonly sourceType: string;
  readonly title: RegExp;
}[] = [
  { file: /reference\.diets/, sourceType: 'medical_reference', title: /диет/i },
  { file: /medical-services/, sourceType: 'code_reference', title: /^Услуга A\d\d\.\d\d\.\d{3}/ },
  {
    file: /^regulatory\.db$|regulatory-pediatrics/,
    sourceType: 'regulatory_act_summary',
    title: /приказ|закон/i,
  },
  { file: /respiratory-pediatrics/, sourceType: 'clinical_recommendation', title: /пневмони/i },
  {
    file: /^reference\.db$|reference-pediatrics/,
    sourceType: 'medical_reference',
    title: /диета|референс/i,
  },
];

function expectRepresentativeContent(db: DatabaseSync, file: string): void {
  for (const family of REPRESENTATIVE.filter((candidate) => candidate.file.test(file))) {
    const titles = rows(
      db,
      `SELECT title FROM documents WHERE source_type = '${family.sourceType}'`,
    ).map((row) => String(row['title']));
    expect(titles.length, `${file} ${family.sourceType}`).toBeGreaterThan(0);
    expect(
      titles.some((title) => family.title.test(title)),
      `${file} has a title like ${family.title}`,
    ).toBe(true);
  }
}

describe('small committed packs (public/content and public/content/modules)', () => {
  const reports: Record<string, string> = {
    'reference.db': 'reference-report.json',
    'regulatory.db': 'regulatory-report.json',
  };

  for (const file of ['reference.db', 'regulatory.db']) {
    it(`${file} is a valid content pack and matches its sidecar report checksum`, () => {
      const path = join(CONTENT, file);
      const report = readJson<PackReport>(join(CONTENT, reports[file] as string));
      expect(sha256(readFileSync(path))).toBe(report.outputChecksum);
      const db = openPack(path);
      try {
        expectPackIntegrity(db, file);
        expect(count(db, 'SELECT count(*) c FROM documents')).toBeGreaterThan(5);
        expectRepresentativeContent(db, file);
      } finally {
        db.close();
      }
    });
  }

  it('regulatory.db counts equal regulatory-report.json', () => {
    const db = openPack(join(CONTENT, 'regulatory.db'));
    try {
      expectReportMatches(
        db,
        readJson<PackReport>(join(CONTENT, 'regulatory-report.json')),
        'regulatory.db',
      );
    } finally {
      db.close();
    }
  });

  // DEFECT (docs/DATA_TESTS.md): reference-report.json says 10 documents / 40 sections, the checksum-matching
  // reference.db holds 18 documents / 94 sections — the sidecar was not regenerated with the pack.
  it.fails('reference.db counts equal reference-report.json', () => {
    const db = openPack(join(CONTENT, 'reference.db'));
    try {
      expectReportMatches(
        db,
        readJson<PackReport>(join(CONTENT, 'reference-report.json')),
        'reference.db',
      );
    } finally {
      db.close();
    }
  });

  const modulePacks = readdirSync(MODULES)
    .filter((file) => file.endsWith('.db') || file.endsWith('.db.gz'))
    .sort();

  it('ships at least the tool, regulatory, reference, diet and medical-services packs', () => {
    expect(modulePacks.some((file) => file.startsWith('minimed-tools-'))).toBe(true);
    expect(modulePacks.some((file) => file.includes('regulatory'))).toBe(true);
    expect(modulePacks.some((file) => file.includes('reference.diets'))).toBe(true);
    expect(modulePacks.some((file) => file.includes('medical-services'))).toBe(true);
  });

  it.each(modulePacks)('%s is a valid content pack', (file) => {
    const db = openPack(join(MODULES, file));
    try {
      expectPackIntegrity(db, file);
      // A pack carries documents (reader content) or tools (calculators/questionnaires), never neither.
      const documents = count(db, 'SELECT count(*) c FROM documents');
      const tools = hasTable(db, 'tool_definitions')
        ? count(db, 'SELECT count(*) c FROM tool_definitions')
        : 0;
      expect(documents + tools, file).toBeGreaterThan(0);
      expectRepresentativeContent(db, file);
    } finally {
      db.close();
    }
  });
});

interface CatalogArtifact {
  readonly kind: string;
  readonly url?: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly compression?: string;
  readonly decodedSha256?: string;
  readonly decodedSizeBytes?: number;
}
interface CatalogModule {
  readonly id: string;
  readonly version: string;
  readonly artifacts: readonly CatalogArtifact[];
}

describe('catalog descriptors of the packs that ship in the repository', () => {
  const catalog = readJson<{ modules: readonly CatalogModule[] }>(
    join(ROOT, 'apps/app/src/features/modules/catalog.preview.json'),
  );
  const shipped = new Set(readdirSync(MODULES));
  const located = catalog.modules.flatMap((module) =>
    module.artifacts
      .map((artifact) => ({
        module,
        artifact,
        file: basename((artifact.url ?? '').split('?')[0] ?? ''),
      }))
      .filter((entry) => shipped.has(entry.file)),
  );

  it('finds a shipped file for every tool module, the diet pack and the medical-services pack', () => {
    const ids = new Set(located.map((entry) => entry.module.id));
    expect(ids.has('minimed.reference.diets.ru')).toBe(true);
    expect(ids.has('minimed.reference.medical-services.ru')).toBe(true);
    const toolModules = catalog.modules.filter((module) => module.id.startsWith('minimed.tools.'));
    expect(toolModules.length).toBeGreaterThanOrEqual(16);
    for (const module of toolModules) expect(ids.has(module.id), module.id).toBe(true);
  });

  it('keeps size, SHA-256 and decoded SHA-256 of every shipped artifact equal to its catalog entry', () => {
    for (const { module, artifact, file } of located) {
      const bytes = readFileSync(join(MODULES, file));
      expect(bytes.length, `${module.id} size`).toBe(artifact.sizeBytes);
      expect(sha256(bytes), `${module.id} sha256`).toBe(artifact.sha256);
      if (artifact.compression === 'gzip') {
        const decoded = gunzipSync(bytes);
        expect(sha256(decoded), `${module.id} decoded sha256`).toBe(artifact.decodedSha256);
        expect(decoded.length, `${module.id} decoded size`).toBe(artifact.decodedSizeBytes);
      }
    }
  });

  it('opens every shipped catalog artifact as a pack whose id names the module for tool modules', () => {
    for (const { module, artifact, file } of located) {
      if (artifact.kind !== 'index') continue;
      const db = openPack(join(MODULES, file));
      try {
        const packs = rows(db, 'SELECT id, version FROM content_packs');
        expect(packs.length, `${module.id} packs`).toBeGreaterThan(0);
        if (module.id.startsWith('minimed.tools.')) {
          expect(packs, module.id).toEqual([{ id: module.id, version: module.version }]);
        }
      } finally {
        db.close();
      }
    }
  });
});

describe('tool modules: authored JSON, catalog entry and shipped pack agree', () => {
  interface AuthoredTool {
    readonly id: string;
    readonly kind: string;
    readonly slug: string;
    readonly definition: unknown;
    readonly sources: readonly unknown[];
  }
  const toolDir = join(ROOT, 'content/tool-modules');
  const catalog = readJson<{ modules: readonly CatalogModule[] }>(
    join(ROOT, 'apps/app/src/features/modules/catalog.preview.json'),
  );
  const files = readdirSync(toolDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  it('has one authored file per tool module in the catalog', () => {
    const authored = files.map((file) => readJson<{ id: string }>(join(toolDir, file)).id).sort();
    const cataloged = catalog.modules
      .filter((module) => module.id.startsWith('minimed.tools.'))
      .map((module) => module.id)
      .sort();
    expect(authored).toEqual(cataloged);
  });

  it('keeps tool ids and slugs unique across all modules', () => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    for (const file of files) {
      for (const tool of readJson<{ tools: readonly AuthoredTool[] }>(join(toolDir, file)).tools) {
        expect(ids.has(tool.id), `duplicate id ${tool.id}`).toBe(false);
        expect(slugs.has(tool.slug), `duplicate slug ${tool.slug}`).toBe(false);
        ids.add(tool.id);
        slugs.add(tool.slug);
      }
    }
    expect(ids.size).toBeGreaterThan(100);
  });

  it.each(files)(
    '%s: catalog version and shipped pack carry exactly the authored tools',
    (file) => {
      const authored = readJson<{ id: string; version: string; tools: readonly AuthoredTool[] }>(
        join(toolDir, file),
      );
      const module = catalog.modules.find((candidate) => candidate.id === authored.id);
      expect(module, `${authored.id} in catalog`).toBeDefined();
      expect(module?.version, `${authored.id} catalog version`).toBe(authored.version);
      expect(
        (module as (CatalogModule & { sourceSetDigest?: string }) | undefined)?.sourceSetDigest,
        `${authored.id} sourceSetDigest is the SHA-256 of the authored file`,
      ).toBe(sha256(readFileSync(join(toolDir, file))));
      const artifactFile = basename(
        module?.artifacts.find((artifact) => artifact.kind === 'index')?.url ?? '',
      );
      const path = join(MODULES, artifactFile);
      expect(existsSync(path), `${authored.id} pack ${artifactFile}`).toBe(true);
      const db = openPack(path);
      try {
        expect(
          rows(db, 'SELECT checksum FROM content_packs'),
          `${authored.id} pack checksum`,
        ).toEqual([{ checksum: sha256(readFileSync(join(toolDir, file))) }]);
        const stored = rows(
          db,
          'SELECT id, kind, slug, definition_json FROM tool_definitions ORDER BY id',
        );
        expect(stored.map((row) => row['id'])).toEqual(
          authored.tools.map((tool) => tool.id).sort(),
        );
        const byId = new Map(authored.tools.map((tool) => [tool.id, tool]));
        for (const row of stored) {
          const tool = byId.get(String(row['id'])) as AuthoredTool;
          expect(row['kind'], tool.id).toBe(tool.kind);
          expect(row['slug'], tool.id).toBe(tool.slug);
          expect(JSON.parse(String(row['definition_json'])), `${tool.id} definition`).toEqual(
            tool.definition,
          );
        }
        expect(count(db, 'SELECT count(*) c FROM tool_sources')).toBe(
          authored.tools.reduce((sum, tool) => sum + tool.sources.length, 0),
        );
      } finally {
        db.close();
      }
    },
  );
});

describe.skipIf(!RELEASE_DATA)(
  'gitignored companion packs (local release check, MINIMED_RELEASE_DATA=1)',
  () => {
    for (const [file, minimumDocuments] of [
      ['mkb.db', 1000],
      ['medications.db', 1000],
      ['ambulatory.db', 5],
    ] as const) {
      const path = join(COMPANION_DIR, file);
      it.skipIf(!existsSync(path))(
        `${file} is a valid content pack`,
        () => {
          const db = openPack(path);
          try {
            expectPackIntegrity(db, file);
            expect(count(db, 'SELECT count(*) c FROM documents')).toBeGreaterThan(minimumDocuments);
          } finally {
            db.close();
          }
        },
        120_000,
      );
    }
  },
);
