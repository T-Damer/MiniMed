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
  /sk-[A-Za-z0-9_-]{24,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"'\s]{16,}["']/giu,
];
const findings = [];

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
  if (!textExtensions.has(extname(file))) continue;
  const path = join(root, file);
  const stat = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return undefined; // A tracked deletion is not published.
    throw error;
  });
  if (!stat?.isFile()) continue;
  const content = await readFile(path, 'utf8');
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
