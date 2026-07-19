import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ignored = new Set(['.git', 'node_modules', 'dist', 'data', '.venv']);
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

const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name)) || entry.name === '.env.example') continue;
    const content = await readFile(path, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) findings.push(relative(root, path));
    }
  }
};

await walk(root);
if (findings.length > 0) {
  console.error(`possible secrets found:\n${[...new Set(findings)].join('\n')}`);
  process.exit(1);
}
console.log('no obvious committed secrets found');
