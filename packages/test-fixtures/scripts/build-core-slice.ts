// Builds src/generated/core-slice.json: a small, deterministic slice of the released corpus for
// unit tests. Every record is copied from a released database (core.db, its companion packs and
// three released clinical-recommendation modules); nothing is written by hand and nothing here is
// shipped to users. Run with Bun from the repository root:
//
//   bun packages/test-fixtures/scripts/build-core-slice.ts
//
// Documents are chosen by id, never sampled. Clinical recommendations keep, of each section type
// (definition, clinical picture, diagnostics, treatment, …), the SECTIONS_PER_TYPE sections with
// the most text, and their ancestors; every document keeps at most CHUNKS_PER_SECTION chunks per
// section, in source order. Embeddings use the portable feature-hash profile over the text the
// content builder embeds.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ContentPackSeedSchema } from '@localmed/contracts';
import { embedPortableText, PORTABLE_HASH_PROFILE } from '@localmed/search-semantic';

interface Statement<Row> {
  get(...params: string[]): Row | null;
  all(...params: string[]): Row[];
}
interface Database {
  query<Row>(sql: string): Statement<Row>;
  close(): void;
}
// Typed locally, as in tools/benchmarks: the workspace compiles against Node types.
const { Database } = (await import('bun:sqlite' as string)) as unknown as {
  readonly Database: new (path: string, options: { readonly readonly: boolean }) => Database;
};

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTENT = resolve(ROOT, 'apps/app/public/content');
const RELEASE_CLINICAL = resolve(ROOT, 'release-clinical');
const OUTPUT = resolve(ROOT, 'packages/test-fixtures/src/generated/core-slice.json');
const CHUNKS_PER_SECTION = 2;
/** Typed sections kept per section type in a clinical recommendation. */
const SECTIONS_PER_TYPE = 2;

/** Released clinical-recommendation modules, by official id. */
const CLINICAL_RECOMMENDATIONS = ['714_2', '64_2', '281_3'];
/** Catalog pointers in core.db, by the document they stand for. */
const POINTER_TARGETS = [
  'kr.rf.714_2',
  'kr.rf.654_2',
  'kr.rf.64_2',
  'kr.rf.281_3',
  'esklp.mnn.амоксициллин-клавулановая-кислота',
  'esklp.mnn.ибупрофен',
  'rls.mkb.node.j18',
  'rls.mkb.node.k35',
  'rls.mkb.node.n39-0',
];
/**
 * A core.db clinical-recommendation summary that a released full module supersedes
 * (minimed-respiratory-pediatrics-full carries kr.rf.714_2.pneumonia.full).
 */
const CORE_DOCUMENTS = ['kr.rf.714_2.pneumonia'];
const COMPANION_DOCUMENTS: readonly (readonly [file: string, ids: readonly string[]])[] = [
  ['medications.db', ['drug.allmed.3324', 'drug.allmed.11']],
  ['mkb.db', ['rls.mkb.node.j18', 'rls.mkb.node.k35', 'rls.mkb.node.n39-0']],
  ['regulatory.db', ['regulatory.rf.minzdravsoc.521n-2012', 'regulatory.rf.minzdravsoc.366n-2012']],
];

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly short_title: string | null;
  readonly source_type: string;
  readonly status: string;
  readonly specialty_json: string;
  readonly metadata_json: string;
  readonly version_id: string;
  readonly version_label: string;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly source_checksum: string;
  readonly extracted_at: string;
}
interface SectionRow {
  readonly id: string;
  readonly parent_section_id: string | null;
  readonly title: string;
  readonly normalized_title: string;
  readonly section_type: string | null;
  readonly depth: number;
  readonly order_index: number;
  readonly page_start: number | null;
  readonly page_end: number | null;
  readonly anchor: string;
  readonly path_json: string;
}
interface ChunkRow {
  readonly id: string;
  readonly section_id: string;
  readonly order_index: number;
  readonly original_text: string;
  readonly normalized_text: string;
  readonly page_start: number | null;
  readonly page_end: number | null;
  readonly char_start: number | null;
  readonly char_end: number | null;
  readonly anchor: string;
  readonly metadata_json: string;
}

const sha256 = (value: string | Uint8Array) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;
const record = (json: string) => JSON.parse(json) as Record<string, unknown>;

function readDocument(database: Database, id: string, typedSectionsOnly: boolean) {
  const document = database
    .query<DocumentRow>(
      `SELECT d.id, d.title, d.short_title, d.source_type, d.status, d.specialty_json,
              d.metadata_json, v.id AS version_id, v.version_label, v.effective_from,
              v.effective_to, v.source_checksum, v.extracted_at
         FROM documents d JOIN document_versions v ON v.id = d.current_version_id
        WHERE d.id = ?`,
    )
    .get(id);
  if (!document) throw new Error(`Document ${id} is missing from its database.`);
  const sections = database
    .query<SectionRow>(
      `SELECT id, parent_section_id, title, normalized_title, section_type, depth, order_index,
              page_start, page_end, anchor, path_json
         FROM sections WHERE document_version_id = ? ORDER BY order_index, id`,
    )
    .all(document.version_id);
  const chunks = database
    .query<ChunkRow>(
      `SELECT id, section_id, order_index, original_text, normalized_text, page_start, page_end,
              char_start, char_end, anchor, metadata_json
         FROM chunks WHERE document_version_id = ? ORDER BY order_index, id`,
    )
    .all(document.version_id);

  const byId = new Map(sections.map((section) => [section.id, section]));
  const textLength = (sectionId: string) =>
    chunks
      .filter((chunk) => chunk.section_id === sectionId)
      .reduce((sum, chunk) => sum + chunk.original_text.length, 0);
  // Of each section type, the sections with the most text: a table-of-contents entry of the same
  // type would otherwise come first.
  const chosen = typedSectionsOnly
    ? [...new Set(sections.map((section) => section.section_type ?? 'other'))]
        .filter((type) => type !== 'other')
        .flatMap((type) =>
          sections
            .filter((section) => section.section_type === type)
            .map((section) => ({ section, length: textLength(section.id) }))
            .filter(({ length }) => length > 0)
            .toSorted(
              (left, right) =>
                right.length - left.length || left.section.order_index - right.section.order_index,
            )
            .slice(0, SECTIONS_PER_TYPE)
            .map(({ section }) => section),
        )
    : sections;
  const kept = new Set<string>();
  for (const section of chosen) {
    // Keep the ancestors, so the section tree and its paths stay intact.
    for (
      let current: SectionRow | undefined = section;
      current && !kept.has(current.id);
      current = current.parent_section_id ? byId.get(current.parent_section_id) : undefined
    )
      kept.add(current.id);
  }
  const keptSections = sections.filter((section) => kept.has(section.id));
  if (keptSections.length === 0) throw new Error(`Document ${id} has no section to keep.`);

  return {
    id: document.id,
    title: document.title,
    shortTitle: document.short_title,
    sourceType: document.source_type,
    status: document.status,
    specialties: JSON.parse(document.specialty_json) as string[],
    metadata: record(document.metadata_json),
    version: {
      id: document.version_id,
      label: document.version_label,
      effectiveFrom: document.effective_from,
      effectiveTo: document.effective_to,
      sourceChecksum: document.source_checksum,
      extractedAt: document.extracted_at,
    },
    sections: keptSections.map((section) => ({
      id: section.id,
      parentSectionId: section.parent_section_id,
      title: section.title,
      normalizedTitle: section.normalized_title,
      sectionType: section.section_type,
      depth: section.depth,
      orderIndex: section.order_index,
      pageStart: section.page_start,
      pageEnd: section.page_end,
      anchor: section.anchor,
      sectionPath: JSON.parse(section.path_json) as string[],
      chunks: chunks
        .filter((chunk) => chunk.section_id === section.id)
        .slice(0, CHUNKS_PER_SECTION)
        .map((chunk) => ({
          id: chunk.id,
          orderIndex: chunk.order_index,
          originalText: chunk.original_text,
          normalizedText: chunk.normalized_text,
          pageStart: chunk.page_start,
          pageEnd: chunk.page_end,
          charStart: chunk.char_start,
          charEnd: chunk.char_end,
          anchor: chunk.anchor,
          metadata: record(chunk.metadata_json),
        })),
    })),
  };
}

function open(path: string) {
  return new Database(path, { readonly: true });
}

const sources: { file: string; checksum: string; documents: string[] }[] = [];
const documents = [];
const corePath = resolve(CONTENT, 'core.db');
const core = open(corePath);
const pointerIds = POINTER_TARGETS.map((target) => {
  const row = core
    .query<{ id: string }>(
      `SELECT id FROM documents
        WHERE json_extract(metadata_json, '$.targetDocumentId') = ? ORDER BY id LIMIT 1`,
    )
    .get(target);
  if (!row) throw new Error(`core.db has no pointer to ${target}.`);
  return row.id;
});
for (const id of [...pointerIds, ...CORE_DOCUMENTS]) documents.push(readDocument(core, id, false));
sources.push({
  file: 'apps/app/public/content/core.db',
  checksum: sha256(readFileSync(corePath)),
  documents: [...pointerIds, ...CORE_DOCUMENTS],
});

for (const officialId of CLINICAL_RECOMMENDATIONS) {
  const file = readdirSync(RELEASE_CLINICAL)
    .filter((name) => name.startsWith(`clinical-${officialId}-`) && name.endsWith('.db'))
    .toSorted()
    .at(-1);
  if (!file) throw new Error(`release-clinical has no module for ${officialId}.`);
  const path = resolve(RELEASE_CLINICAL, file);
  const database = open(path);
  documents.push(readDocument(database, `kr.rf.${officialId}`, true));
  database.close();
  sources.push({
    file: `release-clinical/${file}`,
    checksum: sha256(readFileSync(path)),
    documents: [`kr.rf.${officialId}`],
  });
}

for (const [file, ids] of COMPANION_DOCUMENTS) {
  const path = resolve(CONTENT, file);
  const database = open(path);
  for (const id of ids) documents.push(readDocument(database, id, false));
  database.close();
  sources.push({
    file: `apps/app/public/content/${file}`,
    checksum: sha256(readFileSync(path)),
    documents: [...ids],
  });
}

// Clinical aliases that are not catalog titles (symptoms, investigations, …) and the aliases the
// selected pointers declare.
const aliases = core
  .query<{
    id: string;
    canonical_term: string;
    alias: string;
    category: string | null;
    weight: number;
  }>(
    `SELECT id, canonical_term, alias, category, weight FROM aliases
      WHERE category IN ('symptom', 'finding', 'investigation', 'measurement', 'treatment',
                         'classification')
         OR ${pointerIds.map(() => 'id LIKE ?').join(' OR ')}
      ORDER BY id`,
  )
  .all(...pointerIds.map((id) => `alias.${id}.%`))
  .map((alias) => ({
    id: alias.id,
    canonicalTerm: alias.canonical_term,
    alias: alias.alias,
    category: alias.category,
    weight: alias.weight,
  }));
core.close();

const embeddings = documents.flatMap((document) =>
  document.sections.flatMap((section) =>
    section.chunks.map((chunk) => {
      // Mirrors build_chunk_embedding in tools/ingest/src/localmed_ingest/builder.py.
      const projection = chunk.metadata['knowledgeProjectionText'];
      const text = [
        document.title,
        ...section.sectionPath,
        chunk.originalText,
        typeof projection === 'string' ? projection : '',
      ]
        .filter(Boolean)
        .join('\n');
      const vector = embedPortableText(text);
      return {
        profileId: vector.profileId,
        chunkId: chunk.id,
        values: vector.values,
        norm: vector.norm,
      };
    }),
  ),
);

const body = { documents, aliases, embeddingProfiles: [PORTABLE_HASH_PROFILE], embeddings };
const pack = {
  manifest: {
    id: 'localmed.core-slice',
    version: '1',
    schemaVersion: 2,
    title: 'MiniMed released-corpus slice for tests',
    checksum: sha256(JSON.stringify(body)),
    builtAt: '1970-01-01T00:00:00Z',
  },
  // Provenance only; the seed schema ignores this field.
  sources,
  ...body,
};
ContentPackSeedSchema.parse(pack);
// One line per embedding vector keeps the file reviewable without 384 lines per chunk.
const vectors: string[] = [];
const serialized = JSON.stringify(
  pack,
  (key, value: unknown) =>
    key === 'values' && Array.isArray(value)
      ? `\u0000vector:${vectors.push(JSON.stringify(value)) - 1}`
      : value,
  1,
).replace(/"\\u0000vector:(\d+)"/gu, (_, index: string) => vectors[Number(index)] ?? '[]');
writeFileSync(OUTPUT, `${serialized}\n`);
console.log(
  JSON.stringify({
    output: OUTPUT,
    documents: documents.length,
    sections: documents.reduce((sum, document) => sum + document.sections.length, 0),
    chunks: embeddings.length,
    aliases: aliases.length,
  }),
);
