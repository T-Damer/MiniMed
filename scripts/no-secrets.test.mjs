import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

{
  const root = await mkdtemp(join(tmpdir(), 'minimed-secret-scan-'));
  const scanner = resolve(import.meta.dirname, 'no-secrets.mjs');
  // Real keys mix case and digits; a lowercase slug such as `sk-score2-coefficients-2022` is not a key.
  const secret = ['sk', 'aB3'.repeat(10)].join('-');
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
    await writeFile(
      join(root, 'slug.js'),
      `const id = '${['sk', 'score2', 'coefficients', '2022'].join('-')}';`,
    );
    assert.equal(scan().status, 0);
    await writeFile(join(root, 'source.js'), secret);
    const untracked = scan();
    assert.equal(untracked.status, 1);
    assert.match(untracked.stderr, /source\.js/);
    assert.ok(!untracked.stderr.includes(secret));
    execFileSync('git', ['add', 'source.js'], { cwd: root });
    assert.equal(scan().status, 1);
    await rm(join(root, 'source.js'));
    execFileSync('git', ['rm', '-q', '--cached', 'source.js'], { cwd: root });
    assert.equal(scan().status, 0);
    // Published *.env files: ids and an operator mailto are fine; a personal address is not.
    const address = ['owner', 'clinic.example'].join('@');
    const deploy = join(root, 'deploy.env');
    await writeFile(
      deploy,
      'FOLDER=b1g123\nPUSH_SUBJECT=mailto:admin@operator.example\nADMIN_EMAILS=""\n# ADMIN_EMAILS="you@x.org"\n',
    );
    assert.equal(scan().status, 0);
    await writeFile(deploy, `ADMIN_EMAILS="${address}"\n`);
    const personal = scan();
    assert.equal(personal.status, 1);
    assert.match(personal.stderr, /deploy\.env/);
    assert.ok(!personal.stderr.includes(address));
    await writeFile(deploy, `NOTE=${address}\n`);
    assert.equal(scan().status, 1);
    await writeFile(deploy, 'FOLDER=b1g123\n');
    await writeFile(join(root, 'deploy.local.env.example'), 'ADMIN_EMAILS="you@example.org"\n');
    assert.equal(scan().status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.log('secret scanner regression check passed');
