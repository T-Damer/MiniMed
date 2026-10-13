// Pages deploy step: keep the previous build's scripts and styles reachable next to the new build
// (see apps/app/src/dev-server/carry-previous-assets.ts for why and how much).
//
//   bun scripts/carry-previous-build-assets.ts <live app URL> <new app build directory>
//
// Best effort by design: a missing manifest (first deploy, site down) or a failed file never fails
// the deploy.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  carryAssets,
  parsePreviousBuildManifest,
  selectCarriedAssets,
} from '../apps/app/src/dev-server/carry-previous-assets';

const [siteArgument, directoryArgument] = process.argv.slice(2);
if (!siteArgument || !directoryArgument) {
  throw new Error('Usage: carry-previous-build-assets.ts <live app URL> <new build directory>');
}
const site = siteArgument.replace(/\/?$/u, '/');

const manifestResponse = await fetch(new URL('build-manifest.json', site)).catch(
  (cause: unknown) => {
    console.warn('The live site could not be reached; nothing to carry.', cause);
    return undefined;
  },
);
if (!manifestResponse?.ok) {
  console.log(
    `No previous build manifest (${manifestResponse?.status ?? 'unreachable'}); nothing to carry.`,
  );
  process.exit(0);
}
const previous = parsePreviousBuildManifest(await manifestResponse.json().catch(() => null));
if (!previous) {
  console.log('The previous build manifest is not readable; nothing to carry.');
  process.exit(0);
}

const wanted = selectCarriedAssets(previous, (path) => existsSync(join(directoryArgument, path)));
const result = await carryAssets(
  wanted,
  async (path) => {
    const response = await fetch(new URL(path, site));
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  },
  async (path, bytes) => {
    const target = join(directoryArgument, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },
);
console.log(
  `Carried ${result.carried.length} of ${wanted.length} files of the previous build ` +
    `(${(result.bytes / 1024 / 1024).toFixed(1)} MiB); skipped ${result.skipped.length}.`,
);
