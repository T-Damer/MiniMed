import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { restoreCore } from './restore-core.mjs';

const directory = await mkdtemp(join(tmpdir(), 'minimed-core-'));
try {
  const archive = join(directory, 'core.gz');
  const target = join(directory, 'core.db');
  const payload = Buffer.from('verified core fixture');
  const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
  await writeFile(archive, gzipSync(payload));
  await restoreCore(archive, target, digest);
  assert.deepEqual(await readFile(target), payload);
  await writeFile(archive, gzipSync('corrupted replacement'));
  await restoreCore(archive, target, digest);
  assert.deepEqual(await readFile(target), payload);
  await assert.rejects(restoreCore(archive, target, 'sha256:wrong'), /checksum mismatch/);
  assert.deepEqual(await readFile(target), payload);
  console.log('core restoration regression check passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
