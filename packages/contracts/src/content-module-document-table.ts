import { z } from 'zod';

/**
 * Compact catalog encoding of a module's document membership.
 *
 * Every document of a module normally shares one index artifact and the `active` status, and its
 * version id is `<documentId>@<suffix>`. Writing those per document made membership most of the
 * catalog's size, so the catalog stores rows instead:
 * `[documentId, versionId, sourceChecksumHex, title, overrides?]`, where a version id starting
 * with `@` is appended to the document id and overrides carry any field that differs from the
 * table's shared values. Parsing expands the table back into `documents` in the same order.
 */
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const DocumentTableOverridesSchema = z
  .object({
    status: z.enum(['active', 'superseded', 'historical']),
    indexArtifactId: z.string().min(1),
    sourceAssetArtifactId: z.string().min(1),
  })
  .partial()
  .strict();

const DocumentTableRowSchema = z.union([
  z.tuple([z.string().min(1), z.string().min(1), Sha256HexSchema, z.string().min(1).nullable()]),
  z.tuple([
    z.string().min(1),
    z.string().min(1),
    Sha256HexSchema,
    z.string().min(1).nullable(),
    DocumentTableOverridesSchema,
  ]),
]);

export const ContentModuleDocumentTableSchema = z
  .object({
    indexArtifactId: z.string().min(1),
    rows: z.array(DocumentTableRowSchema).min(1),
  })
  .strict();

export type ContentModuleDocumentTable = z.infer<typeof ContentModuleDocumentTableSchema>;

interface ExpandedDocument {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sourceChecksum: string;
  readonly status: 'active' | 'superseded' | 'historical';
  readonly indexArtifactId: string;
  readonly sourceAssetArtifactId: string | null;
  readonly title: string | null;
}

export function expandDocumentTable(table: ContentModuleDocumentTable): ExpandedDocument[] {
  return table.rows.map(([documentId, version, checksum, title, overrides]) => ({
    documentId,
    documentVersionId: version.startsWith('@') ? `${documentId}${version}` : version,
    sourceChecksum: `sha256:${checksum}`,
    status: overrides?.status ?? 'active',
    indexArtifactId: overrides?.indexArtifactId ?? table.indexArtifactId,
    sourceAssetArtifactId: overrides?.sourceAssetArtifactId ?? null,
    title,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Schema preprocessing for one catalog entry: a module carries either `documents` or a
 * `documentTable`, never both; a malformed table is reported instead of silently dropped.
 */
export function expandModuleDocumentTable(value: unknown, context: z.RefinementCtx): unknown {
  if (!isRecord(value) || !('documentTable' in value)) return value;
  const { documentTable, ...module } = value;
  if ('documents' in module) {
    context.addIssue({
      code: 'custom',
      path: ['documentTable'],
      message: 'A module lists either documents or a documentTable, not both.',
    });
    return value;
  }
  const parsed = ContentModuleDocumentTableSchema.safeParse(documentTable);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: 'custom',
        path: ['documentTable', ...issue.path.map(String)],
        message: issue.message,
      });
    }
    return value;
  }
  return { ...module, documents: expandDocumentTable(parsed.data) };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Catalog document is missing ${key}.`);
  }
  return value;
}

function compactDocuments(documents: readonly unknown[]): ContentModuleDocumentTable {
  const records = documents.map((document) => {
    if (!isRecord(document)) throw new Error('Catalog document must be an object.');
    return document;
  });
  const indexCounts = new Map<string, number>();
  for (const record of records) {
    const indexArtifactId = stringField(record, 'indexArtifactId');
    indexCounts.set(indexArtifactId, (indexCounts.get(indexArtifactId) ?? 0) + 1);
  }
  const [sharedIndex] = [...indexCounts.entries()].reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
  const rows = records.map((record): ContentModuleDocumentTable['rows'][number] => {
    const documentId = stringField(record, 'documentId');
    const versionId = stringField(record, 'documentVersionId');
    const checksum = stringField(record, 'sourceChecksum');
    if (!checksum.startsWith('sha256:')) {
      throw new Error(`Catalog document ${documentId} has a non-sha256 checksum.`);
    }
    const title = typeof record['title'] === 'string' && record['title'] ? record['title'] : null;
    const status = stringField(record, 'status');
    const indexArtifactId = stringField(record, 'indexArtifactId');
    const sourceAsset = record['sourceAssetArtifactId'];
    const overrides: Record<string, string> = {};
    if (status !== 'active') overrides['status'] = status;
    if (indexArtifactId !== sharedIndex) overrides['indexArtifactId'] = indexArtifactId;
    if (typeof sourceAsset === 'string' && sourceAsset) {
      overrides['sourceAssetArtifactId'] = sourceAsset;
    }
    const version = versionId.startsWith(`${documentId}@`)
      ? versionId.slice(documentId.length)
      : versionId;
    const hex = checksum.slice('sha256:'.length);
    return Object.keys(overrides).length > 0
      ? [documentId, version, hex, title, overrides]
      : [documentId, version, hex, title];
  });
  return { indexArtifactId: sharedIndex, rows };
}

/**
 * Writes a raw catalog (as read from disk and edited by a script) in the compact form. A
 * non-empty `documents` array is the authoritative membership and replaces any older table; the
 * other fields are kept exactly as given, in their original order.
 */
export function compactCatalogDocuments(catalog: unknown): unknown {
  if (!isRecord(catalog) || !Array.isArray(catalog['modules'])) {
    throw new Error('Catalog must contain a modules array.');
  }
  return {
    ...catalog,
    modules: catalog['modules'].map((module: unknown) => {
      if (!isRecord(module)) throw new Error('Catalog module must be an object.');
      const documents = module['documents'];
      if (!Array.isArray(documents)) return module;
      const compacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(module)) {
        if (key === 'documentTable') continue;
        if (key !== 'documents') {
          compacted[key] = value;
        } else if (documents.length > 0) {
          compacted['documentTable'] = compactDocuments(documents);
        }
      }
      return compacted;
    }),
  };
}
