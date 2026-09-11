import { Database } from 'bun:sqlite';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { compressModuleIndex } from './compress-module-index.mjs';

test('packages a real SQLite database without changing bytes and rejects non-SQLite input', async () => {
  await mkdir('playwright', { recursive: true });
  const directory = await mkdtemp(resolve('playwright/compression-test-'));
  try {
    const input = `${directory}/sample.db`;
    const output = `${input}.gz`;
    const db = new Database(input);
    db.exec("CREATE TABLE source(text TEXT); INSERT INTO source VALUES ('Исходный текст');");
    db.close();
    const original = await readFile(input);
    const artifact = await compressModuleIndex(input, output);
    const archive = await readFile(output);
    assert.deepEqual(gunzipSync(archive), original);
    assert.deepEqual(await readFile(input), original);
    assert.equal(artifact.sizeBytes, archive.length);
    assert.equal(artifact.decodedSizeBytes, original.length);
    assert.equal(artifact.sha256, `sha256:${createHash('sha256').update(archive).digest('hex')}`);
    await writeFile(`${directory}/bad.db`, 'not sqlite');
    await assert.rejects(compressModuleIndex(`${directory}/bad.db`, output), /SQLite/);
    assert.deepEqual(await readFile(output), archive);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
