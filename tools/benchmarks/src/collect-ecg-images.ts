import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { loadEcgImageDataset } from './ecg-image-dataset';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function imageExtension(bytes: Uint8Array): 'gif' | 'jpg' | 'png' {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  const header = new TextDecoder().decode(bytes.slice(0, 6));
  if (header === 'GIF87a' || header === 'GIF89a') return 'gif';
  throw new Error('Downloaded ECG fixture is not a supported PNG, JPEG, or GIF image.');
}

async function download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MiniMed ECG research fixture collector' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ECG fixture download failed with HTTP ${response.status}.`);
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('ECG fixture exceeds the 25 MB limit.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('ECG fixture is empty or exceeds the 25 MB limit.');
  }
  return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

const output = resolve(argument('--output') ?? '/tmp/minimed-ecg-eval');
const relativeToProject = relative(PROJECT_ROOT, output);
if (!relativeToProject.startsWith('..') && !isAbsolute(relativeToProject)) {
  throw new Error('ECG images must be collected outside the repository.');
}
if (existsSync(output)) throw new Error(`Output already exists: ${output}`);

const dataset = loadEcgImageDataset();
const sourceById = new Map(dataset.sources.map((source) => [source.source_id, source]));
const acceptsLinkOnly = process.argv.includes('--accept-link-only');
if (!acceptsLinkOnly && dataset.sources.some((source) => !source.redistribution_allowed)) {
  throw new Error('Pass --accept-link-only to download sources without redistribution permission.');
}

const staging = `${output}.partial-${process.pid}`;
mkdirSync(staging, { recursive: false });
try {
  const collected = [];
  for (const fixture of dataset.cases) {
    const source = sourceById.get(fixture.source_id);
    if (!source) throw new Error(`Unknown ECG fixture source: ${fixture.source_id}`);
    const { bytes, contentType } = await download(fixture.image_url);
    const extension = imageExtension(bytes);
    const localFile = `${fixture.case_id}.${extension}`;
    writeFileSync(resolve(staging, localFile), bytes);
    collected.push({
      ...fixture,
      source: {
        name: source.name,
        source_url: source.source_url,
        license: source.license,
        rights_status: source.rights_status,
        redistribution_allowed: source.redistribution_allowed,
      },
      local_file: localFile,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      file_bytes: bytes.length,
      content_type: contentType,
    });
  }
  writeFileSync(
    resolve(staging, 'manifest.json'),
    `${JSON.stringify({ ...dataset, collected_at: new Date().toISOString(), cases: collected }, null, 2)}\n`,
    'utf8',
  );
  renameSync(staging, output);
  console.log(JSON.stringify({ output, cases: collected.length }));
} catch (cause) {
  rmSync(staging, { recursive: true, force: true });
  throw cause;
}
