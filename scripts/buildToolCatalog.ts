import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';

import {
  AssessmentDefinitionSchema,
  CalculatorSchemaSchema,
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
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
    return ToolCatalogEntrySchema.parse({
      ...record,
      ageScope: definition.ageScope,
      preview: definition,
    });
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
await writeFile(catalogPath, serializeContentModuleCatalog(rawCatalog));
console.log(`Core tool catalog: ${seenIds.size} tools in ${sourceModules.length} modules.`);
// Startup reads tools and the core descriptor from the small shell derived from this catalog.
execFileSync('bun', ['scripts/build-module-catalog-shell.ts'], { stdio: 'inherit' });
