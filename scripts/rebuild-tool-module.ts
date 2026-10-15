/**
 * Rebuild the shipped pack of one or more authored tool modules and point the preview catalog at it.
 * Run after editing `content/tool-modules/<group>.json` and bumping its module `version`:
 *
 *   bun run tools:module:rebuild -- core-clinical emergency   # group = file name without .json
 *   bun run tools:module:rebuild -- --all
 *   bun run tools:module:rebuild -- --force metabolic-lab     # rebuild even if the pack looks current
 *
 * For each group it (1) builds `apps/app/public/content/modules/minimed-tools-<group>-<version>.db`
 * with `medbase build-tool-module` (skipped when that file already carries the source checksum),
 * (2) rewrites the module's catalog.preview.json entry (version, sourceSetDigest, sizes, index
 * artifact id/url/sha256), then (3) runs `scripts/buildToolCatalog.ts`, which re-derives every
 * module's `tools` and the catalog shell. Older .db files stay for older catalogs. Publishing the
 * files (GitHub release or branch) is a separate step and is not done here.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { serializeContentModuleCatalog } from '../packages/contracts/src/content-modules';

const root = resolve(import.meta.dirname, '..');
const sourceDirectory = join(root, 'content/tool-modules');
const modulesDirectory = join(root, 'apps/app/public/content/modules');
const catalogPath = join(root, 'apps/app/src/features/modules/catalog.preview.json');

interface CatalogEntry {
  id: string;
  version?: string;
  sourceSetDigest?: string;
  sizes?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The checksum a built pack recorded for its source file, or undefined when it cannot be read. */
async function recordedChecksum(pack: string): Promise<string | undefined> {
  const { Database } = await import('bun:sqlite');
  const database = new Database(pack, { readonly: true });
  try {
    const row = database.query('SELECT checksum FROM content_packs LIMIT 1').get() as {
      checksum?: string;
    } | null;
    return row?.checksum;
  } finally {
    database.close();
  }
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const all = args.includes('--all');
const groups = all
  ? readdirSync(sourceDirectory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/u, ''))
      .sort()
  : args.filter((arg) => !arg.startsWith('--'));
if (groups.length === 0) {
  throw new Error('Usage: bun run tools:module:rebuild -- [--force] <group>... | --all');
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { modules: CatalogEntry[] };
for (const group of groups) {
  const sourcePath = join(sourceDirectory, `${group}.json`);
  if (!existsSync(sourcePath)) throw new Error(`No tool module source: ${sourcePath}`);
  const bytes = readFileSync(sourcePath);
  const source = JSON.parse(bytes.toString('utf8')) as { id: string; version: string };
  const digest = sha256(bytes);
  const file = `minimed-tools-${group}-${source.version}.db`;
  const output = join(modulesDirectory, file);
  const current = existsSync(output) && (await recordedChecksum(output)) === digest;
  if (force || !current) {
    if (existsSync(output) && !force) {
      throw new Error(
        `${file} exists but was built from a different source: bump the version of ${group}.json (old packs stay for older catalogs) or pass --force.`,
      );
    }
    execFileSync(
      'uv',
      [
        'run',
        '--project',
        'tools/ingest',
        'medbase',
        'build-tool-module',
        '--source',
        sourcePath,
        '--output',
        output,
      ],
      { cwd: root, stdio: 'inherit' },
    );
  }
  const entry = catalog.modules.find((module) => module.id === source.id);
  const index = entry?.artifacts?.find((artifact) => artifact['kind'] === 'index');
  if (!entry || !index) throw new Error(`No catalog entry with an index artifact for ${source.id}`);
  const size = statSync(output).size;
  entry.version = source.version;
  entry.sourceSetDigest = digest;
  entry.sizes = { ...entry.sizes, downloadBytes: size, installedBytes: size };
  index['id'] = `${source.id}-index-${source.version}`;
  index['url'] = `${String(index['url']).replace(/[^/]+$/u, '')}${file}`;
  index['sha256'] = sha256(readFileSync(output));
  index['sizeBytes'] = size;
  index['sourceSetDigest'] = digest;
  console.log(`${source.id} ${source.version}: ${file} (${size} bytes)`);
}
writeFileSync(catalogPath, serializeContentModuleCatalog(catalog));
execFileSync('bun', ['scripts/buildToolCatalog.ts'], { cwd: root, stdio: 'inherit' });
