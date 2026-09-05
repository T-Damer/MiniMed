/** Derive catalog membership only from bytes already identified by an artifact checksum. */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import {
  type ContentModuleCatalog,
  ContentModuleCatalogSchema,
} from '../packages/contracts/src/content-modules';

const DocumentRow = z.object({
  documentId: z.string(),
  documentVersionId: z.string(),
  title: z.string(),
  sourceChecksum: z.string(),
  status: z.enum(['active', 'superseded', 'historical']),
});

export function hydrateCatalogMembership(
  catalog: ContentModuleCatalog,
  checksum: string,
  rows: readonly unknown[],
): ContentModuleCatalog {
  const documents = rows.map((row) => DocumentRow.parse(row));
  return ContentModuleCatalogSchema.parse({
    ...catalog,
    modules: catalog.modules.map((module) => {
      const artifact = module.artifacts.find(
        (item) => item.kind === 'index' && item.compression === 'none' && item.sha256 === checksum,
      );
      if (!artifact) return module;
      const membership = [
        ...module.documents.filter((document) => document.indexArtifactId !== artifact.id),
        ...documents.map((document) => ({
          ...document,
          indexArtifactId: artifact.id,
          sourceAssetArtifactId:
            module.documents.find((old) => old.documentVersionId === document.documentVersionId)
              ?.sourceAssetArtifactId ?? null,
        })),
      ].sort((a, b) =>
        a.documentVersionId < b.documentVersionId
          ? -1
          : a.documentVersionId > b.documentVersionId
            ? 1
            : 0,
      );
      return {
        ...module,
        documents: membership,
        previewDocumentCount: new Set(membership.map((document) => document.documentId)).size,
      };
    }),
  });
}

if (import.meta.main) {
  const [catalogPath, outputPath, ...paths] = process.argv.slice(2);
  if (!catalogPath || !outputPath || !paths.length)
    throw new Error('Usage: bun scripts/hydrate-catalog-membership.ts CATALOG OUTPUT PACK.db ...');
  const original = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(catalogPath, 'utf8')));
  const originalModules = z
    .array(z.object({ id: z.string() }).passthrough())
    .parse(original['modules']);
  let catalog = ContentModuleCatalogSchema.parse(original);
  const updated = new Set<string>();
  const sqlite = (await import('bun:sqlite' as string)) as {
    Database: new (
      path: string,
      options: { readonly: boolean },
    ) => {
      query(sql: string): { all(): unknown[] };
      close(): void;
    };
  };
  let matched = 0;
  for (const path of paths) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const checksum = `sha256:${hash.digest('hex')}`;
    if (
      !catalog.modules.some((module) =>
        module.artifacts.some(
          (artifact) =>
            artifact.kind === 'index' &&
            artifact.compression === 'none' &&
            artifact.sha256 === checksum,
        ),
      )
    ) {
      console.log(`No catalog artifact matches: ${path}`);
      continue;
    }
    for (const module of catalog.modules) {
      if (
        module.artifacts.some(
          (artifact) =>
            artifact.kind === 'index' &&
            artifact.compression === 'none' &&
            artifact.sha256 === checksum,
        )
      )
        updated.add(module.id);
    }
    const database = new sqlite.Database(path, { readonly: true });
    try {
      catalog = hydrateCatalogMembership(
        catalog,
        checksum,
        database
          .query(`
        SELECT d.id AS documentId, v.id AS documentVersionId, d.title,
          v.source_checksum AS sourceChecksum, d.status
        FROM documents d LEFT JOIN document_versions v ON v.id = d.current_version_id
        ORDER BY d.id
      `)
          .all(),
      );
      matched += 1;
    } finally {
      database.close();
    }
  }
  if (!matched) throw new Error('No verified artifacts; catalog was not written.');
  const output = {
    ...original,
    modules: originalModules.map((module) => {
      if (!updated.has(module.id)) return module;
      const generated = catalog.modules.find((entry) => entry.id === module.id);
      if (!generated) throw new Error(`Missing generated module ${module.id}`);
      return {
        ...module,
        documents: generated.documents,
        previewDocumentCount: generated.previewDocumentCount,
      };
    }),
  };
  ContentModuleCatalogSchema.parse(output);
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Verified artifact files: ${matched}`);
}
