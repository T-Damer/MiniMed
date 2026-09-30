/** Fixed released public source for native/Web reader visual comparison; readonly input. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const root = resolve(import.meta.dirname, '..');
const corePath = resolve(root, 'apps/app/public/content/core.db');
const coreSha256 = '13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f';
const documentId = 'kr.rf.714_2.pneumonia';
const versionId = 'kr.rf.714_2.pneumonia@714_2-2025';
const output = resolve(
  root,
  'native/shared/src/wasmJsMain/composeResources/files/native-visual-document.json',
);
const digest = createHash('sha256');
for await (const bytes of createReadStream(corePath)) digest.update(bytes);
if (digest.digest('hex') !== coreSha256)
  throw new Error('Visual input is not the exact released core');
const integer = z.number().int().min(-2147483648).max(2147483647);
const nullableInteger = integer.nullable();
const headerSchema = z.object({
  title: z.string(),
  sourceType: z.string(),
  metadataJson: z.string(),
  documentVersionId: z.literal(versionId),
  sourceChecksum: z.string(),
  versionLabel: z.string(),
  effectiveFrom: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  status: z.string(),
});
const sectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  anchor: z.string(),
  depth: integer,
  orderIndex: integer,
  parentSectionId: z.string().nullable(),
  sectionType: z.string().nullable(),
  pathJson: z.string(),
  pageStart: nullableInteger,
  pageEnd: nullableInteger,
});
const chunkSchema = z.object({
  id: z.string(),
  anchor: z.string(),
  originalText: z.string(),
  orderIndex: integer,
  metadataJson: z.string(),
  pageStart: nullableInteger,
  pageEnd: nullableInteger,
  charStart: nullableInteger,
  charEnd: nullableInteger,
});
const moduleName = 'bun:sqlite';
const sqlite: {
  Database: new (
    path: string,
    options: { readonly: boolean },
  ) => {
    query(sql: string): { all(...bindings: (string | number | null)[]): unknown[] };
    close(): void;
  };
} = await import(moduleName);
const database = new sqlite.Database(corePath, { readonly: true });
type VisualSourceDocument = Omit<
  z.infer<typeof headerSchema>,
  'documentVersionId' | 'sourceChecksum'
> & {
  target: {
    documentId: string;
    documentVersionId: string;
    sourceChecksum: string;
    anchor: null;
    moduleId: null;
    moduleVersion: null;
  };
  sections: (z.infer<typeof sectionSchema> & { chunks: z.infer<typeof chunkSchema>[] })[];
};
let document: VisualSourceDocument;
try {
  const rows = z.array(headerSchema).parse(
    database
      .query(`SELECT d.title,d.source_type AS sourceType,
    d.metadata_json AS metadataJson,v.id AS documentVersionId,v.source_checksum AS sourceChecksum,
    v.version_label AS versionLabel,v.effective_from AS effectiveFrom,v.effective_to AS effectiveTo,d.status
    FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.id=? AND v.id=?`)
      .all(documentId, versionId),
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('Exact public visual source is absent');
  const header = rows[0];
  const metadata = z
    .object({
      publicPilot: z.literal(true),
      syntheticFixture: z.literal(false),
      contentMode: z.literal('source_linked_paraphrase'),
    })
    .parse(JSON.parse(header.metadataJson));
  if (!metadata.publicPilot) throw new Error('Visual source is not public');
  const sections = z
    .array(sectionSchema)
    .parse(
      database
        .query(`SELECT id,title,anchor,depth,order_index AS orderIndex,
    parent_section_id AS parentSectionId,section_type AS sectionType,path_json AS pathJson,page_start AS pageStart,page_end AS pageEnd
    FROM sections WHERE document_version_id=? ORDER BY order_index,id`)
        .all(versionId),
    )
    .map((section) => ({
      ...section,
      chunks: z.array(chunkSchema).parse(
        database
          .query(`SELECT id,anchor,original_text AS originalText,order_index AS orderIndex,
      metadata_json AS metadataJson,page_start AS pageStart,page_end AS pageEnd,char_start AS charStart,char_end AS charEnd
      FROM chunks WHERE section_id=? AND document_version_id=? ORDER BY order_index,id`)
          .all(section.id, versionId),
      ),
    }));
  const sourceChecksum = header.sourceChecksum.startsWith('sha256:')
    ? header.sourceChecksum
    : `sha256:${header.sourceChecksum}`;
  z.string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .parse(sourceChecksum);
  document = {
    target: {
      documentId,
      documentVersionId: versionId,
      sourceChecksum,
      anchor: null,
      moduleId: null,
      moduleVersion: null,
    },
    title: header.title,
    sourceType: header.sourceType,
    metadataJson: header.metadataJson,
    versionLabel: header.versionLabel,
    effectiveFrom: header.effectiveFrom,
    effectiveTo: header.effectiveTo,
    sections,
    status: header.status,
  };
} finally {
  database.close();
}
const encoded = `${JSON.stringify({ coreSha256, document }, null, 2)}\n`;
await mkdir(dirname(output), { recursive: true });
await writeFile(output, encoded);
console.log(
  JSON.stringify({
    coreSha256,
    sectionCount: document.sections.length,
    chunkCount: document.sections.reduce((sum, section) => sum + section.chunks.length, 0),
    bytes: Buffer.byteLength(encoded),
    sha256: createHash('sha256').update(encoded).digest('hex'),
  }),
);
