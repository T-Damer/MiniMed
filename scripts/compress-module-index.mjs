import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { createGunzip, createGzip } from 'node:zlib';

async function identity(stream) {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const bytes of stream) {
    hash.update(bytes);
    sizeBytes += bytes.length;
  }
  return { sha256: `sha256:${hash.digest('hex')}`, sizeBytes };
}

/** Produces transport metadata; never changes the input database or a released catalog. */
export async function compressModuleIndex(input, output) {
  if (resolve(input) === resolve(output)) throw new Error('Use a separate archive output.');
  const file = await open(input, 'r');
  try {
    const header = Buffer.alloc(16);
    await file.read(header, 0, 16, 0);
    if (header.toString() !== 'SQLite format 3\0') throw new Error('Expected a SQLite database.');
  } finally {
    await file.close();
  }
  const original = await identity(createReadStream(input));
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.compressing`;
  try {
    await pipeline(
      createReadStream(input),
      createGzip({ level: 9 }),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    const hash = createHash('sha256');
    let decodedSizeBytes = 0;
    await pipeline(
      createReadStream(temporary),
      createGunzip(),
      new Writable({
        write(bytes, _encoding, callback) {
          hash.update(bytes);
          decodedSizeBytes += bytes.length;
          callback();
        },
      }),
    );
    const decodedSha256 = `sha256:${hash.digest('hex')}`;
    if (decodedSha256 !== original.sha256 || decodedSizeBytes !== original.sizeBytes) {
      throw new Error('Compressed index failed round-trip verification.');
    }
    const current = await identity(createReadStream(input));
    if (current.sha256 !== original.sha256) throw new Error('Source changed while compressing.');
    const archive = await identity(createReadStream(temporary));
    await rename(temporary, output);
    return { compression: 'gzip', ...archive, decodedSha256, decodedSizeBytes };
  } finally {
    await rm(temporary, { force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      report: { type: 'string' },
    },
  });
  if (!values.input || !values.output || !values.report) {
    throw new Error(
      'Usage: bun scripts/compress-module-index.mjs --input pack.db --output pack.db.gz --report artifact.json',
    );
  }
  if ([values.input, values.output].some((path) => resolve(path) === resolve(values.report))) {
    throw new Error('Report must be separate from the database and archive.');
  }
  const artifact = await compressModuleIndex(values.input, values.output);
  await mkdir(dirname(values.report), { recursive: true });
  await writeFile(values.report, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact));
}
