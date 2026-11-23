import { ContentModuleCatalogEntrySchema, ToolCatalogEntrySchema } from '@localmed/contracts';
import { z } from 'zod';

import type { ModuleCatalogShell } from './module-catalog-shell-source';

/** Full schema for `catalog.shell.json`, enforced at build time and in unit tests. */
export const ModuleCatalogShellSchema: z.ZodType<ModuleCatalogShell> = z.object({
  catalogVersion: z.string().min(1),
  publishedAt: z.string().min(1),
  coreModule: ContentModuleCatalogEntrySchema,
  sectionDocumentCounts: z.object({
    conditions: z.number().int().nonnegative(),
    icd11: z.number().int().nonnegative(),
    guidelines: z.number().int().nonnegative(),
    medications: z.number().int().nonnegative(),
    legal: z.number().int().nonnegative(),
  }),
  tools: z.array(z.object({ moduleId: z.string().min(1), tool: ToolCatalogEntrySchema })),
});
