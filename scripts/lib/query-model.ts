/**
 * Fetch, verify and stage the KD1 query model for the Android build (owner decision 2026-10-15:
 * the meaning-search model ships inside the APK instead of being a 130 MB download).
 *
 * The pinned files, sizes and SHA-256 live in `apps/app/src/features/semantic/e5-model.ts` and
 * nowhere else; this module only reads them. The model is never committed: it is downloaded from
 * the `datasets/<revision>` mirror branch into a gitignored cache, every part and every joined
 * file is checked, and only verified bytes are copied into the web assets of the native project.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  E5_BUNDLED_DIR,
  E5_BUNDLED_MANIFEST,
  E5_MODEL_FILES,
  E5_MODEL_REVISION,
  type E5ModelFile,
  type E5ModelPart,
  e5FileUrl,
} from '../../apps/app/src/features/semantic/e5-model';

export interface QueryModelSpec {
  readonly revision: string;
  readonly files: readonly E5ModelFile[];
  /** Where a file (or one part of it) is downloaded from. */
  readonly url: (path: string) => string;
}

export const PINNED_QUERY_MODEL: QueryModelSpec = {
  revision: E5_MODEL_REVISION,
  files: E5_MODEL_FILES,
  url: e5FileUrl,
};

/** A downloaded or cached byte range that does not match its pinned size or checksum. */
export class QueryModelVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryModelVerificationError';
  }
}

export type DownloadBytes = (url: string) => Promise<Uint8Array>;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function verify(label: string, bytes: Uint8Array, expected: E5ModelFile | E5ModelPart): void {
  if (bytes.byteLength !== expected.sizeBytes) {
    throw new QueryModelVerificationError(
      `${label}: ${bytes.byteLength} bytes, expected ${expected.sizeBytes}`,
    );
  }
  const actual = sha256Hex(bytes);
  if (actual !== expected.sha256) {
    throw new QueryModelVerificationError(
      `${label}: SHA-256 ${actual} differs from the pinned ${expected.sha256}`,
    );
  }
}

export const downloadWithRetries: DownloadBytes = async (url) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      lastError = cause;
      if (attempt < 3) await new Promise((done) => setTimeout(done, attempt * 1000));
    }
  }
  throw new Error(`Cannot download ${url}: ${String(lastError)}`);
};

function writeAtomically(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The cached file when it still matches its pinned size and checksum, otherwise null. */
function readVerifiedCache(path: string, file: E5ModelFile): Uint8Array | null {
  if (!existsSync(path) || statSync(path).size !== file.sizeBytes) return null;
  const bytes = readFileSync(path);
  return sha256Hex(bytes) === file.sha256 ? bytes : null;
}

export interface FetchOptions {
  /** Directory that keeps the verified files between builds (gitignored). */
  readonly cacheDir: string;
  readonly spec?: QueryModelSpec;
  readonly download?: DownloadBytes;
  readonly log?: (line: string) => void;
}

/**
 * Makes sure every file of the model is in the cache, verified. Downloads only what is missing or
 * damaged, joins multi-part files, and throws `QueryModelVerificationError` (writing nothing for
 * the failed file) when a part or the joined file does not match the pinned checksum.
 * Returns the directory holding the verified files.
 */
export async function fetchQueryModel(options: FetchOptions): Promise<string> {
  const spec = options.spec ?? PINNED_QUERY_MODEL;
  const download = options.download ?? downloadWithRetries;
  const log = options.log ?? (() => undefined);
  const root = join(options.cacheDir, spec.revision);
  for (const file of spec.files) {
    const target = join(root, file.path);
    if (readVerifiedCache(target, file)) {
      log(`cached  ${file.path}`);
      continue;
    }
    let bytes: Uint8Array;
    if (file.parts) {
      const chunks: Uint8Array[] = [];
      for (const part of file.parts) {
        log(`fetch   ${part.path}`);
        const data = await download(spec.url(part.path));
        verify(part.path, data, part);
        chunks.push(data);
      }
      bytes = Buffer.concat(chunks);
    } else {
      log(`fetch   ${file.path}`);
      bytes = await download(spec.url(file.path));
    }
    verify(file.path, bytes, file);
    writeAtomically(target, bytes);
  }
  return root;
}

export interface Manifest {
  readonly revision: string;
  readonly files: readonly { path: string; sizeBytes: number; sha256: string }[];
}

export function manifestFor(spec: QueryModelSpec): Manifest {
  return {
    revision: spec.revision,
    files: spec.files.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
  };
}

export interface StageOptions {
  readonly cacheDir: string;
  /** The web-assets directory of the native project (the one `cap sync` fills). */
  readonly publicDir: string;
  readonly spec?: QueryModelSpec;
}

/**
 * Copies the verified cache into `<publicDir>/models/kd1-query-encoder`, replacing whatever was
 * there, hashes every copy again and writes the manifest last: the app treats the manifest as
 * proof of a complete copy. Throws when a cached file is missing or damaged.
 */
export function stageQueryModel(options: StageOptions): string {
  const spec = options.spec ?? PINNED_QUERY_MODEL;
  const source = join(options.cacheDir, spec.revision);
  const target = join(options.publicDir, E5_BUNDLED_DIR);
  rmSync(target, { recursive: true, force: true });
  for (const file of spec.files) {
    const bytes = readVerifiedCache(join(source, file.path), file);
    if (!bytes) {
      throw new QueryModelVerificationError(
        `${file.path} is missing or damaged in ${source}; run the fetch first`,
      );
    }
    const destination = join(target, file.path);
    writeAtomically(destination, bytes);
    verify(`staged ${file.path}`, readFileSync(destination), file);
  }
  writeFileSync(
    join(target, E5_BUNDLED_MANIFEST),
    `${JSON.stringify(manifestFor(spec), null, 2)}\n`,
  );
  return target;
}

/** `assets/public/` is where `cap sync android` puts the web app inside the APK. */
export const APK_PUBLIC_PREFIX = 'assets/public';

/**
 * Checks an `unzip -l` listing of an APK: every model file and the manifest must be present with
 * the pinned uncompressed size. Returns the problems found (empty when the APK carries the model).
 */
export function apkModelProblems(
  listing: string,
  spec: QueryModelSpec = PINNED_QUERY_MODEL,
): string[] {
  const sizes = new Map<string, number>();
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+\d{2,4}[-/]\d{2}[-/]\d{2,4}\s+\d{2}:\d{2}\s+(.+?)\s*$/u.exec(line);
    if (match?.[1] && match[2]) sizes.set(match[2], Number(match[1]));
  }
  const problems: string[] = [];
  const base = `${APK_PUBLIC_PREFIX}/${E5_BUNDLED_DIR}`;
  if (!sizes.has(`${base}/${E5_BUNDLED_MANIFEST}`))
    problems.push(`missing ${base}/${E5_BUNDLED_MANIFEST}`);
  for (const file of spec.files) {
    const actual = sizes.get(`${base}/${file.path}`);
    if (actual === undefined) problems.push(`missing ${base}/${file.path}`);
    else if (actual !== file.sizeBytes) {
      problems.push(`${base}/${file.path} is ${actual} bytes, expected ${file.sizeBytes}`);
    }
  }
  return problems;
}

/** Repository root: the directory above `scripts/`. */
export const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
