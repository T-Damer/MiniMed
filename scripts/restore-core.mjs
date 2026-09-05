import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export async function restoreCore(archive, target, expectedChecksum) {
  try {
    if ((await checksum(target)) === expectedChecksum) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.restoring`;
  try {
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(temporary));
    if ((await checksum(temporary)) !== expectedChecksum) {
      throw new Error('Bundled core checksum mismatch; existing database preserved.');
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '..');
  const report = JSON.parse(
    await readFile(`${root}/apps/app/public/content/core-report.json`, 'utf8'),
  );
  await restoreCore(
    `${root}/content/bundled/core.db.gz`,
    `${root}/apps/app/public/content/core.db`,
    report.outputChecksum,
  );
}
