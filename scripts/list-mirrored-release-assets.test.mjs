import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const result = spawnSync(process.execPath, ['scripts/list-mirrored-release-assets.ts'], {
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr);
const lines = result.stdout.trim().split('\n');
const formats = new Set();
for (const path of [
  'apps/app/src/features/modules/catalog.preview.json',
  'apps/app/src/features/modules/catalog.terminology.json',
]) {
  const catalog = JSON.parse(readFileSync(path, 'utf8'));
  for (const module of Array.isArray(catalog) ? catalog : catalog.modules) {
    for (const artifact of module.artifacts ?? []) {
      const match =
        /^https:\/\/github\.com\/T-Damer\/MiniMed\/releases\/download\/((?:terminology|definition-reference|reference-krasotaimedicina|reference-rls-mkb)-[^/]+)\/([^/]+\.db\.(gz|zst))$/u.exec(
          artifact.url ?? '',
        );
      if (!match) continue;
      const [, tag, file, format] = match;
      formats.add(format);
      assert(lines.includes(`${tag}\t${file}\t${artifact.sizeBytes}\t${artifact.sha256.slice(7)}`));
    }
  }
}
assert.deepEqual([...formats].sort(), ['gz', 'zst']);
console.log('All advertised gzip and zstd indexes have verified Pages mirror entries.');
