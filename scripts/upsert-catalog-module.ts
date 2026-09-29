/**
 * Insert or replace one release-generated module descriptor in a module catalog, by module id.
 * The descriptor is never edited here: the whole catalog is re-validated before it is written.
 *
 *   bun scripts/upsert-catalog-module.ts CATALOG.json ENTRY.catalog-entry.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

import {
  ContentModuleCatalogEntrySchema,
  ContentModuleCatalogSchema,
  serializeContentModuleCatalog,
} from '../packages/contracts/src/content-modules';

export function upsertCatalogModule(catalog: unknown, entry: unknown): Record<string, unknown> {
  const original = z.record(z.string(), z.unknown()).parse(catalog);
  const modules = z.array(z.object({ id: z.string() }).passthrough()).parse(original['modules']);
  const module = z.object({ id: z.string() }).passthrough().parse(entry);
  ContentModuleCatalogEntrySchema.parse(module);
  const index = modules.findIndex((candidate) => candidate.id === module.id);
  const next = {
    ...original,
    modules:
      index === -1
        ? [...modules, module]
        : modules.map((item, at) => (at === index ? module : item)),
  };
  ContentModuleCatalogSchema.parse(next);
  return next;
}

if (import.meta.main) {
  const [catalogPath, entryPath] = process.argv.slice(2);
  if (!catalogPath || !entryPath)
    throw new Error('Usage: bun scripts/upsert-catalog-module.ts CATALOG.json ENTRY.json');
  const next = upsertCatalogModule(
    JSON.parse(readFileSync(catalogPath, 'utf8')),
    JSON.parse(readFileSync(entryPath, 'utf8')),
  );
  writeFileSync(catalogPath, serializeContentModuleCatalog(next));
  console.log(`Catalog ${catalogPath}: ${(next.modules as unknown[]).length} modules.`);
}
