import { readFileSync, writeFileSync } from 'node:fs';

import {
  type ContentModuleCatalog,
  ContentModuleCatalogSchema,
} from '../packages/contracts/src/content-modules';

interface ClinicalSnapshotFragment {
  readonly snapshotId: string;
  readonly publishedAt: string;
  readonly categories: ContentModuleCatalog['categories'];
  readonly modules: ContentModuleCatalog['modules'];
}

export function mergeClinicalSnapshotCatalog(
  base: unknown,
  fragment: ClinicalSnapshotFragment,
): ContentModuleCatalog {
  const catalog = ContentModuleCatalogSchema.parse(base);
  return ContentModuleCatalogSchema.parse({
    ...catalog,
    catalogVersion: fragment.snapshotId,
    publishedAt: fragment.publishedAt,
    categories: fragment.categories,
    modules: [
      ...catalog.modules.filter((module) => !module.tags.includes('individual-recommendation')),
      ...fragment.modules,
    ],
  });
}

if (import.meta.main) {
  const [basePath, fragmentPath, outputPath] = process.argv.slice(2);
  if (!basePath || !fragmentPath || !outputPath) {
    throw new Error('Usage: bun scripts/merge-clinical-snapshot-catalog.ts BASE FRAGMENT OUTPUT');
  }
  const base: unknown = JSON.parse(readFileSync(basePath, 'utf8'));
  const fragment = JSON.parse(readFileSync(fragmentPath, 'utf8')) as ClinicalSnapshotFragment;
  writeFileSync(
    outputPath,
    `${JSON.stringify(mergeClinicalSnapshotCatalog(base, fragment), null, 2)}\n`,
  );
}
