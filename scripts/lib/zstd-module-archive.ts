/**
 * Framed zstd archives of module indexes, shared by the repack and packaging scripts: a plain
 * concatenation of independent frames of at most 64 MiB of decoded data, each made by
 * `zstd -19 --long=26` from a file (so every frame declares its content size). The result is decoded
 * again with the app's own reader and compared with the SQLite's SHA-256 before it is accepted.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createDecodedIndexReader } from '../../apps/app/src/features/modules/encoded-index-reader';
import { ZSTD_FRAME_CONTENT_BYTES } from '../../apps/app/src/features/modules/zstd-frames';

export const ZSTD_ARGS = ['-19', '--long=26', '-T0', '-q', '-f'];
export { ZSTD_FRAME_CONTENT_BYTES };

export function fileSha256(path: string): string {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
    for (let read = readSync(descriptor, buffer, 0, buffer.length, null); read > 0; ) {
      hash.update(buffer.subarray(0, read));
      read = readSync(descriptor, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(descriptor);
  }
  return `sha256:${hash.digest('hex')}`;
}

/** Frames of at most 64 MiB, each compressed from a file so that it declares its content size. */
export function encodeFramed(sourcePath: string, targetPath: string): void {
  const size = statSync(sourcePath).size;
  const scratch = `${targetPath}.parts`;
  mkdirSync(scratch, { recursive: true });
  const input = openSync(sourcePath, 'r');
  try {
    for (let offset = 0, index = 0; offset < size; offset += ZSTD_FRAME_CONTENT_BYTES, index += 1) {
      const length = Math.min(ZSTD_FRAME_CONTENT_BYTES, size - offset);
      const slice = Buffer.allocUnsafe(length);
      if (readSync(input, slice, 0, length, offset) !== length) throw new Error('Short read.');
      const slicePath = join(scratch, `slice-${index}`);
      writeFileSync(slicePath, slice);
      const result = spawnSync('zstd', [...ZSTD_ARGS, '-o', `${slicePath}.zst`, slicePath], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      rmSync(slicePath);
      if (result.status !== 0) throw new Error(`zstd failed on ${sourcePath}.`);
      appendFileSync(targetPath, readFileSync(`${slicePath}.zst`));
      rmSync(`${slicePath}.zst`);
    }
  } finally {
    closeSync(input);
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function verifyFramed(
  archivePath: string,
  decodedBytes: number,
  decodedSha256: string,
): Promise<void> {
  const read = createDecodedIndexReader({
    bytes: new Uint8Array(readFileSync(archivePath)),
    decodedSizeBytes: decodedBytes,
    decodedSha256,
  });
  // The reader throws at the end of the stream on any size or checksum difference.
  while ((await read()) !== undefined) {
    // Drain.
  }
}
