/**
 * Checks that a module artifact is what the catalog says it is: the transport SHA-256 and size of
 * the downloaded bytes, then the decoded SQLite (SHA-256 and size) through the app's own decoders.
 *
 *   bun scripts/verify-module-artifact.ts --module-id minimed.regulatory.pediatrics.ru \
 *     (--file PATH | --url https://raw.githubusercontent.com/…) \
 *     [--catalog apps/app/src/features/modules/catalog.preview.json|catalog-entry.json]
 *
 * `--url` downloads the file the way a browser would (plain GET, no credentials) and is the check
 * that a mirror branch serves the published bytes. Exit code 1 on any difference.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { createDecodedIndexReader } from '../apps/app/src/features/modules/encoded-index-reader';

const { values } = parseArgs({
  options: {
    'module-id': { type: 'string' },
    file: { type: 'string' },
    url: { type: 'string' },
    catalog: { type: 'string', default: 'apps/app/src/features/modules/catalog.preview.json' },
  },
});
const moduleId = values['module-id'];
if (!moduleId || (!values.file && !values.url) || (values.file && values.url)) {
  throw new Error('Usage: --module-id ID (--file PATH | --url URL) [--catalog FILE]');
}

interface Artifact {
  readonly kind: string;
  readonly url: string | null;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly compression?: string;
  readonly decodedSha256?: string;
  readonly decodedSizeBytes?: number;
}
interface Entry {
  readonly id: string;
  readonly artifacts: readonly Artifact[];
}

const raw = JSON.parse(readFileSync(values.catalog as string, 'utf8')) as
  | { modules: readonly Entry[] }
  | Entry;
const entry = 'modules' in raw ? raw.modules.find((module) => module.id === moduleId) : raw;
const artifact =
  entry?.id === moduleId ? entry.artifacts.find((item) => item.kind === 'index') : undefined;
if (!artifact) throw new Error(`No index artifact for ${moduleId} in ${values.catalog}.`);

let bytes: Uint8Array;
if (values.file) {
  bytes = new Uint8Array(readFileSync(values.file));
} else {
  const response = await fetch(values.url as string);
  if (!response.ok) throw new Error(`GET ${values.url} answered ${String(response.status)}.`);
  bytes = new Uint8Array(await response.arrayBuffer());
}

const sha256 = (data: Uint8Array): string =>
  `sha256:${createHash('sha256').update(data).digest('hex')}`;
const problems: string[] = [];
if (bytes.byteLength !== artifact.sizeBytes) {
  problems.push(`size ${String(bytes.byteLength)} != catalog ${String(artifact.sizeBytes)}`);
}
if (sha256(bytes) !== artifact.sha256)
  problems.push(`transport sha256 ${sha256(bytes)} != catalog`);

let decodedBytes = 0;
if (artifact.compression === 'zstd') {
  const read = createDecodedIndexReader({
    bytes,
    decodedSizeBytes: artifact.decodedSizeBytes as number,
    decodedSha256: artifact.decodedSha256 as string,
  });
  // The reader throws at the end of the stream on any size or checksum difference.
  try {
    for (let part = await read(); part !== undefined; part = await read()) {
      decodedBytes += part.byteLength;
    }
  } catch (cause) {
    problems.push(`zstd decode failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
} else if (artifact.compression === 'gzip') {
  const decoded = gunzipSync(bytes);
  decodedBytes = decoded.byteLength;
  if (sha256(decoded) !== artifact.decodedSha256) problems.push('decoded sha256 differs');
} else if (artifact.sha256 !== sha256(bytes)) {
  problems.push('uncompressed artifact differs');
}
if (artifact.decodedSizeBytes !== undefined && decodedBytes !== artifact.decodedSizeBytes) {
  problems.push(
    `decoded size ${String(decodedBytes)} != catalog ${String(artifact.decodedSizeBytes)}`,
  );
}

const report = {
  moduleId,
  source: values.file ?? values.url,
  transportBytes: bytes.byteLength,
  transportSha256: sha256(bytes),
  decodedBytes,
  ok: problems.length === 0,
  problems,
};
console.log(JSON.stringify(report, null, 2));
if (problems.length > 0) process.exit(1);
