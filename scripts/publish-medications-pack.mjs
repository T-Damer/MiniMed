import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'apps/app/public/content/medications.db');

await mkdir(dirname(target), { recursive: true });
await copyFile(resolve(root, 'data/build/medications.db'), target);
