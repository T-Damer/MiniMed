import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  ContentModuleCatalogSchema,
  ToolCatalogEntrySchema,
  ToolDefinitionRecordSchema,
} from '@localmed/contracts';
import { z } from 'zod';

const catalogPath = 'apps/app/src/features/modules/catalog.preview.json';
const catalog = ContentModuleCatalogSchema.parse(JSON.parse(await readFile(catalogPath, 'utf8')));
const moduleSchema = z.object({
  id: z.string(),
  version: z.string(),
  tools: z.array(ToolDefinitionRecordSchema),
});
const sourceModules = await Promise.all(
  (await readdir('content/tool-modules'))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(async (name) =>
      moduleSchema.parse(JSON.parse(await readFile(`content/tool-modules/${name}`, 'utf8'))),
    ),
);
const seenIds = new Set<string>();
for (const source of sourceModules) {
  const module = catalog.modules.find((entry) => entry.id === source.id);
  if (!module || module.version !== source.version) {
    throw new Error(`Missing or outdated catalog module: ${source.id}@${source.version}`);
  }
  module.tools = source.tools.map((record) => {
    if (seenIds.has(record.id)) throw new Error(`Duplicate tool: ${record.id}`);
    seenIds.add(record.id);
    const definition =
      record.kind === 'calculator'
        ? CalculatorSchemaSchema.parse(record.definition)
        : AssessmentDefinitionSchema.parse(record.definition);
    if (definition.id !== record.id || definition.slug !== record.slug) {
      throw new Error(`Tool identity mismatch: ${record.id}`);
    }
    return ToolCatalogEntrySchema.parse({ ...record, preview: definition });
  });
  if (module.toolCount !== module.tools.length) {
    throw new Error(`Tool count mismatch: ${source.id}`);
  }
}
// Preserve unrelated catalog fields; only tool-module metadata is generated here.
const rawCatalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
  modules: Array<{ id: string; tools?: unknown }>;
};
for (const source of sourceModules) {
  const rawModule = rawCatalog.modules.find((entry) => entry.id === source.id);
  const module = catalog.modules.find((entry) => entry.id === source.id);
  if (rawModule && module) rawModule.tools = module.tools;
}
ContentModuleCatalogSchema.parse(rawCatalog);
const formatted = execFileSync(
  'bunx',
  ['--no-install', 'biome', 'format', `--stdin-file-path=${catalogPath}`],
  {
    input: `${JSON.stringify(rawCatalog, null, 2)}\n`,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
);
await writeFile(catalogPath, formatted);
console.log(`Core tool catalog: ${seenIds.size} tools in ${sourceModules.length} modules.`);
