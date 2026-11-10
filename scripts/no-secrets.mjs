import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
const textExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.py',
  '.html',
  '.css',
]);
const patterns = [
  /AIza[0-9A-Za-z_-]{30,}/g,
  // Provider keys mix case and digits; a lowercase slug such as `sk-score2-coefficients-2022` is not one.
  /\bsk-(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"'\s]{16,}["']/giu,
];
const findings = [];

/**
 * Personal values in a published `*.env` file (the repository is public): an e-mail address, or a
 * non-empty variable named like a credential or an e-mail. `mailto:` values (the operator contact a
 * push service needs) and `*.example` files are fine; real values go into ignored `*.local.env`.
 */
const envEmail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
const envCredential =
  /^\s*(?:export\s+)?[A-Z0-9_]*(?:EMAIL|PASSWORD|SECRET|TOKEN|API_KEY)[A-Z0-9_]*\s*=\s*["']?([^"'\s#]+)/u;
function envProblem(content) {
  for (const line of content.split('\n')) {
    if (/^\s*#/u.test(line)) continue;
    if (envCredential.test(line)) return true;
    const value = line.replace(/^[^=]*=/u, '');
    if (envEmail.test(value.replaceAll(/mailto:[^\s"';,]+/gu, ''))) return true;
  }
  return false;
}

// Scan publishable source, including new files, without traversing ignored build caches.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    cwd: root,
    encoding: 'utf8',
  },
).split('\0');
for (const file of new Set(files)) {
  const published =
    /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]+\.env)$/u.test(file) && !file.endsWith('.example');
  if (!published && !textExtensions.has(extname(file))) continue;
  const path = join(root, file);
  const stat = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return undefined; // A tracked deletion is not published.
    throw error;
  });
  if (!stat?.isFile()) continue;
  const content = await readFile(path, 'utf8');
  if (published && envProblem(content)) findings.push(file);
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(file);
  }
}
if (findings.length > 0) {
  console.error(`possible secrets found:\n${[...new Set(findings)].join('\n')}`);
  process.exit(1);
}
console.log('no obvious committed secrets found');
