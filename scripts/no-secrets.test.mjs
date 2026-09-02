import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

{
  const root = await mkdtemp(join(tmpdir(), 'minimed-secret-scan-'));
  const scanner = resolve(import.meta.dirname, 'no-secrets.mjs');
  const secret = ['sk', 'x'.repeat(28)].join('-');
  const scan = () => spawnSync(process.execPath, [scanner, root], { encoding: 'utf8' });
  try {
    execFileSync('git', ['init', '-q', root]);
    await writeFile(join(root, '.gitignore'), 'cache/\n');
    await mkdir(join(root, 'cache'));
    await writeFile(join(root, 'cache/generated.js'), secret);
    await symlink('cache/generated.js', join(root, 'external.js'));
    await writeFile(join(root, 'deleted.js'), secret);
    execFileSync('git', ['add', 'deleted.js'], { cwd: root });
    await rm(join(root, 'deleted.js'));
    assert.equal(scan().status, 0);
    await writeFile(join(root, 'source.js'), secret);
    const untracked = scan();
    assert.equal(untracked.status, 1);
    assert.match(untracked.stderr, /source\.js/);
    assert.ok(!untracked.stderr.includes(secret));
    execFileSync('git', ['add', 'source.js'], { cwd: root });
    assert.equal(scan().status, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.log('secret scanner regression check passed');
