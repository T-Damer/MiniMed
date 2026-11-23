import { readFile, writeFile } from 'node:fs/promises';

import { ContentModuleCatalogSchema } from '@localmed/contracts';

import { ModuleCatalogShellSchema } from '../apps/app/src/features/modules/module-catalog-shell-schema';
import { deriveModuleCatalogShell } from '../apps/app/src/features/modules/module-catalog-shell-source';

const catalogPath = 'apps/app/src/features/modules/catalog.preview.json';
const shellPath = 'apps/app/src/features/modules/catalog.shell.json';

const catalog = ContentModuleCatalogSchema.parse(JSON.parse(await readFile(catalogPath, 'utf8')));
const shell = ModuleCatalogShellSchema.parse(deriveModuleCatalogShell(catalog));
// Compact JSON keeps the `?raw` startup import free of indentation whitespace, matching the other
// bundled catalogs (`catalog.preview.json`, `catalog.terminology.json`, `catalog.clinical-editions.json`).
await writeFile(shellPath, `${JSON.stringify(shell)}\n`);
console.log(`Module catalog shell: core ${shell.coreModule.version}, ${shell.tools.length} tools.`);
