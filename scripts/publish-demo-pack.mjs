import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['data/build/core-demo.db', 'apps/app/public/content/core-demo.db'],
  ['data/build/core-demo-report.json', 'apps/app/public/content/core-demo-report.json'],
];

for (const [source, target] of targets) {
  const targetPath = resolve(root, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(resolve(root, source), targetPath);
}

console.log('Published compiled demo content pack to apps/app/public/content.');
