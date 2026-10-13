// Local release check (not part of the fast suite): the module artifacts built on this machine
// (clinical recommendations, ЕСКЛП, ГРЛС/Allmed instructions, ICD-11, RLS, krasotaimedicina, ...) are the
// ones the catalog describes, and each decodes to a valid pack whose documents are the catalog's membership.
//
//   MINIMED_RELEASE_DATA=1 MINIMED_MODULE_DIRS=/abs/dir1:/abs/dir2 bun run test:data:release
//
// Files are matched to catalog artifacts by exact size first, then SHA-256, so file names do not matter.
// Without the environment variables, or without any matching file, the suite skips. See docs/DATA_TESTS.md.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const ENABLED = process.env['MINIMED_RELEASE_DATA'] === '1';
const DIRS = (process.env['MINIMED_MODULE_DIRS'] ?? '').split(':').filter((dir) => dir.length > 0);
const MAX_DECODED_BYTES = 400 * 1024 * 1024;

interface Artifact {
  readonly id: string;
  readonly kind: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly compression?: string;
  readonly decodedSha256?: string;
  readonly decodedSizeBytes?: number;
}
interface Module {
  readonly id: string;
  readonly kind: string;
  readonly artifacts: readonly Artifact[];
  readonly documents?: readonly { readonly documentId: string }[];
  readonly previewDocumentCount?: number;
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}

const catalog = JSON.parse(
  readFileSync(join(ROOT, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
) as {
  modules: readonly Module[];
};
const bySize = new Map<number, { module: Module; artifact: Artifact }[]>();
for (const module of catalog.modules) {
  for (const artifact of module.artifacts) {
    if (artifact.kind !== 'index') continue;
    bySize.set(artifact.sizeBytes, [
      ...(bySize.get(artifact.sizeBytes) ?? []),
      { module, artifact },
    ]);
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'minimed-release-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const found: { module: Module; artifact: Artifact; path: string }[] = [];
if (ENABLED) {
  for (const path of DIRS.flatMap(filesUnder)) {
    const candidates = bySize.get(statSync(path).size);
    if (!candidates) continue;
    const digest = await fileSha256(path);
    for (const candidate of candidates) {
      if (candidate.artifact.sha256 === digest) found.push({ ...candidate, path });
    }
  }
}

describe.skipIf(!ENABLED || found.length === 0)(
  'locally built module artifacts equal the catalog',
  () => {
    it.each(found.map((entry) => [entry.module.id, entry] as const))(
      '%s decodes to the declared pack',
      (_id, entry) => {
        const { module, artifact, path } = entry;
        const raw = readFileSync(path);
        let decoded = raw;
        if (artifact.compression === 'zstd' || artifact.compression === 'gzip') {
          if ((artifact.decodedSizeBytes ?? 0) > MAX_DECODED_BYTES) return;
          decoded = artifact.compression === 'zstd' ? zstdDecompressSync(raw) : gunzipSync(raw);
          expect(decoded.length).toBe(artifact.decodedSizeBytes);
          expect(`sha256:${createHash('sha256').update(decoded).digest('hex')}`).toBe(
            artifact.decodedSha256,
          );
        }
        const target = join(scratch, `${module.id}.${artifact.id.replace(/[^a-z0-9]/gi, '_')}.db`);
        writeFileSync(target, decoded);
        const db = new DatabaseSync(target, { readOnly: true });
        try {
          const one = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
          expect(db.prepare('PRAGMA quick_check(1)').all()).toEqual([{ quick_check: 'ok' }]);
          expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
          expect(one('SELECT count(*) c FROM content_packs')).toBeGreaterThan(0);
          const documents = one('SELECT count(*) c FROM documents');
          expect(documents).toBeGreaterThan(0);
          if (module.documents && module.documents.length > 0) {
            const ids = new Set(
              (db.prepare('SELECT id FROM documents').all() as { id: string }[]).map(
                (row) => row.id,
              ),
            );
            for (const member of module.documents)
              expect(ids.has(member.documentId), `${module.id}/${member.documentId}`).toBe(true);
            expect(documents).toBeGreaterThanOrEqual(module.documents.length);
          }
          if (module.previewDocumentCount) expect(documents).toBe(module.previewDocumentCount);
        } finally {
          db.close();
          rmSync(target, { force: true });
        }
      },
      120_000,
    );
  },
);
