import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

import { ContentModuleCatalogSchema } from '@localmed/contracts';

import { deriveModuleCatalogShell } from '../apps/app/src/features/modules/module-catalog-shell-source';

const catalogPath = 'apps/app/src/features/modules/catalog.preview.json';
const shellPath = 'apps/app/src/features/modules/catalog.shell.json';

const catalog = ContentModuleCatalogSchema.parse(JSON.parse(await readFile(catalogPath, 'utf8')));
const shell = deriveModuleCatalogShell(catalog);
const formatted = execFileSync(
  'bunx',
  ['--no-install', 'biome', 'format', `--stdin-file-path=${shellPath}`],
  { input: `${JSON.stringify(shell, null, 2)}\n`, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
await writeFile(shellPath, formatted);
console.log(`Module catalog shell: core ${shell.coreModule.version}, ${shell.tools.length} tools.`);
