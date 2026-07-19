import {
  type ContentPackSeed,
  type EmbeddingProfile,
  EmbeddingProfileSchema,
  type SearchFilters,
} from '@localmed/contracts';
import {
  type AliasRecord,
  type ChunkRecord,
  type DocumentRecord,
  parseJsonObject,
  parseJsonStringArray,
  type SectionRecord,
} from '@localmed/domain';
import type {
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from '@localmed/storage';

import {
  LocalMedDatabase,
  type LocalMedDatabasePlugin,
  type NativeDatabaseHealth,
  type NativeSqlRow,
  type NativeSqlValue,
  type OpenPackOptions,
} from './plugin';

function readString(row: NativeSqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Expected string column: ${column}`);
  return value;
}

function readNumber(row: NativeSqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected number column: ${column}`);
  }
  return value;
}

function readNullableString(row: NativeSqlRow, column: string): string | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Expected nullable string column: ${column}`);
  return value;
}

function readNullableNumber(row: NativeSqlRow, column: string): number | null {
  const value = row[column];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected nullable number column: ${column}`);
  }
  return value;
}

function toDocument(row: NativeSqlRow): DocumentRecord {
  return {
    id: readString(row, 'id'),
    contentPackId: readString(row, 'content_pack_id'),
    title: readString(row, 'title'),
    shortTitle: readNullableString(row, 'short_title'),
    sourceType: readString(row, 'source_type'),
    status: readString(row, 'status'),
    specialties: parseJsonStringArray(readString(row, 'specialty_json')),
    metadata: parseJsonObject(readString(row, 'metadata_json')),
    version: {
      id: readString(row, 'version_id'),
      documentId: readString(row, 'id'),
      versionLabel: readString(row, 'version_label'),
      effectiveFrom: readNullableString(row, 'effective_from'),
      effectiveTo: readNullableString(row, 'effective_to'),
      sourceChecksum: readString(row, 'source_checksum'),
      extractedAt: readString(row, 'extracted_at'),
    },
  };
}

function toSection(row: NativeSqlRow): SectionRecord {
  return {
    id: readString(row, 'section_id'),
    documentVersionId: readString(row, 'document_version_id'),
    parentSectionId: readNullableString(row, 'parent_section_id'),
    title: readString(row, 'section_title'),
    normalizedTitle: readString(row, 'normalized_title'),
    sectionType: readNullableString(row, 'section_type'),
    depth: readNumber(row, 'depth'),
    orderIndex: readNumber(row, 'section_order_index'),
    pageStart: readNullableNumber(row, 'section_page_start'),
    pageEnd: readNullableNumber(row, 'section_page_end'),
    anchor: readString(row, 'section_anchor'),
    sectionPath: parseJsonStringArray(readString(row, 'path_json')),
  };
}

function toEmbeddingProfile(row: NativeSqlRow): EmbeddingProfile {
  return EmbeddingProfileSchema.parse({
    id: readString(row, 'id'),
    dimensions: readNumber(row, 'dimensions'),
    vectorFormat: readString(row, 'vector_format'),
    normalization: readString(row, 'normalization'),
    generator: readString(row, 'generator'),
    generatorVersion: readString(row, 'generator_version'),
    fingerprint: readString(row, 'fingerprint'),
    metadata: parseJsonObject(readString(row, 'metadata_json')),
  });
}

function encodeSignedInt8(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length);
  for (const [index, value] of values.entries()) {
    if (!Number.isInteger(value) || value < -127 || value > 127) {
      throw new RangeError(`Invalid signed int8 value at index ${index}: ${value}`);
    }
    bytes[index] = value < 0 ? value + 256 : value;
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function toChunk(row: NativeSqlRow): ChunkRecord {
  return {
    id: readString(row, 'chunk_id'),
    documentVersionId: readString(row, 'document_version_id'),
    sectionId: readString(row, 'section_id'),
    orderIndex: readNumber(row, 'chunk_order_index'),
    originalText: readString(row, 'original_text'),
    normalizedText: readString(row, 'normalized_text'),
    pageStart: readNullableNumber(row, 'chunk_page_start'),
    pageEnd: readNullableNumber(row, 'chunk_page_end'),
    charStart: readNullableNumber(row, 'char_start'),
    charEnd: readNullableNumber(row, 'char_end'),
    previousChunkId: readNullableString(row, 'previous_chunk_id'),
    nextChunkId: readNullableString(row, 'next_chunk_id'),
    anchor: readString(row, 'chunk_anchor'),
    metadata: parseJsonObject(readString(row, 'chunk_metadata_json')),
  };
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.content_pack_id, d.title, d.short_title, d.source_type, d.status,
    d.specialty_json, d.metadata_json, dv.id AS version_id, dv.version_label,
    dv.effective_from, dv.effective_to, dv.source_checksum, dv.extracted_at
  FROM documents d
  JOIN document_versions dv ON dv.id = d.current_version_id
`;

const SECTION_SELECT = `
  SELECT s.id AS section_id, s.document_version_id, s.parent_section_id,
    s.title AS section_title, s.normalized_title, s.section_type, s.depth,
    s.order_index AS section_order_index, s.page_start AS section_page_start,
    s.page_end AS section_page_end, s.anchor AS section_anchor, s.path_json
  FROM sections s
`;

const CHUNK_SELECT = `
  SELECT c.id AS chunk_id, c.document_version_id, c.section_id,
    c.order_index AS chunk_order_index, c.original_text, c.normalized_text,
    c.page_start AS chunk_page_start, c.page_end AS chunk_page_end,
    c.char_start, c.char_end, c.previous_chunk_id, c.next_chunk_id,
    c.anchor AS chunk_anchor, c.metadata_json AS chunk_metadata_json
  FROM chunks c
`;

const VECTOR_HIT_SELECT = `
  SELECT
    c.id AS chunk_id, c.document_version_id, c.section_id,
    c.order_index AS chunk_order_index, c.original_text, c.normalized_text,
    c.page_start AS chunk_page_start, c.page_end AS chunk_page_end,
    c.char_start, c.char_end, c.previous_chunk_id, c.next_chunk_id,
    c.anchor AS chunk_anchor, c.metadata_json AS chunk_metadata_json,
    s.parent_section_id, s.title AS section_title, s.normalized_title,
    s.section_type, s.depth, s.order_index AS section_order_index,
    s.page_start AS section_page_start, s.page_end AS section_page_end,
    s.anchor AS section_anchor, s.path_json,
    d.id, d.content_pack_id, d.title, d.short_title, d.source_type, d.status,
    d.specialty_json, d.metadata_json,
    dv.id AS version_id, dv.version_label, dv.effective_from, dv.effective_to,
    dv.source_checksum, dv.extracted_at
  FROM chunks c
  JOIN sections s ON s.id = c.section_id
  JOIN document_versions dv ON dv.id = c.document_version_id
  JOIN documents d ON d.id = dv.document_id
`;

function metadataStrings(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = metadata[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function intersects(left: readonly string[], right: readonly string[] | undefined): boolean {
  if (!right || right.length === 0) return true;
  const expected = new Set(right);
  return left.some((value) => expected.has(value));
}

function matchesPostFilters(document: DocumentRecord, filters: SearchFilters): boolean {
  return (
    intersects(document.specialties, filters.specialties) &&
    intersects(metadataStrings(document.metadata, 'ageGroups'), filters.ageGroups)
  );
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export interface CapacitorMedicalStoreOptions extends OpenPackOptions {
  readonly plugin?: LocalMedDatabasePlugin;
}

export class CapacitorMedicalStore implements MedicalStore {
  private readonly plugin: LocalMedDatabasePlugin;
  private initialized = false;
  private nativeHealth: NativeDatabaseHealth | undefined;

  public constructor(private readonly options: CapacitorMedicalStoreOptions) {
    this.plugin = options.plugin ?? LocalMedDatabase;
  }

  public async initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    if (seed) {
      throw new Error('The native SQLite store accepts compiled content packs only.');
    }
    if (!this.initialized) {
      this.nativeHealth = await this.plugin.openPack({
        assetPath: this.options.assetPath,
        databaseName: this.options.databaseName,
        expectedSha256: this.options.expectedSha256,
      });
      this.initialized = true;
    }
    return this.getHealth();
  }

  public async getHealth(): Promise<StorageHealth> {
    this.assertInitialized();
    const health = this.nativeHealth;
    if (!health) throw new Error('Native SQLite health is unavailable.');
    return {
      schemaVersion: health.schemaVersion,
      sqliteVersion: health.sqliteVersion,
      fts5Available: health.fts5Available,
      contentPackIds: health.contentPackIds,
      documentCount: health.documentCount,
      backend: 'sqlite-native',
      persistent: true,
      installation: health.copied ? 'copied' : 'reused',
      sizeBytes: health.sizeBytes,
    };
  }

  public async listDocuments(): Promise<readonly DocumentRecord[]> {
    return (await this.query(`${DOCUMENT_SELECT} ORDER BY d.title COLLATE NOCASE`)).map(toDocument);
  }

  public async getDocument(id: string): Promise<DocumentRecord | null> {
    const row = (await this.query(`${DOCUMENT_SELECT} WHERE d.id = ? LIMIT 1`, [id]))[0];
    return row ? toDocument(row) : null;
  }

  public async getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    const row = (await this.query(`${DOCUMENT_SELECT} WHERE dv.id = ? LIMIT 1`, [versionId]))[0];
    return row ? toDocument(row) : null;
  }

  public async getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    return (
      await this.query(
        `${SECTION_SELECT}
         JOIN document_versions dv ON dv.id = s.document_version_id
         WHERE dv.document_id = ?
         ORDER BY s.order_index`,
        [documentId],
      )
    ).map(toSection);
  }

  public async getSection(id: string): Promise<SectionRecord | null> {
    const row = (await this.query(`${SECTION_SELECT} WHERE s.id = ? LIMIT 1`, [id]))[0];
    return row ? toSection(row) : null;
  }

  public async getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]> {
    return (
      await this.query(`${CHUNK_SELECT} WHERE c.section_id = ? ORDER BY c.order_index`, [sectionId])
    ).map(toChunk);
  }

  public async getChunk(id: string): Promise<ChunkRecord | null> {
    const row = (await this.query(`${CHUNK_SELECT} WHERE c.id = ? LIMIT 1`, [id]))[0];
    return row ? toChunk(row) : null;
  }

  public async getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]> {
    const focus = await this.getChunk(chunkId);
    if (!focus) return [];
    return (
      await this.query(
        `${CHUNK_SELECT}
         WHERE c.document_version_id = ? AND c.order_index BETWEEN ? AND ?
         ORDER BY c.order_index`,
        [
          focus.documentVersionId,
          Math.max(0, focus.orderIndex - radius),
          focus.orderIndex + radius,
        ],
      )
    ).map(toChunk);
  }

  public async listAliases(): Promise<readonly AliasRecord[]> {
    return (
      await this.query(
        'SELECT id, canonical_term, alias, category, weight FROM aliases ORDER BY alias',
      )
    ).map((row) => ({
      id: readString(row, 'id'),
      canonicalTerm: readString(row, 'canonical_term'),
      alias: readString(row, 'alias'),
      category: readNullableString(row, 'category'),
      weight: readNumber(row, 'weight'),
    }));
  }

  public async listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]> {
    this.assertInitialized();
    if (typeof this.plugin.searchVectors !== 'function') return [];
    return (
      await this.query(
        `SELECT id, dimensions, vector_format, normalization, generator,
          generator_version, fingerprint, metadata_json
         FROM embedding_profiles
         ORDER BY id`,
      )
    ).map(toEmbeddingProfile);
  }

  public async searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    this.assertInitialized();
    if (typeof this.plugin.searchVectors !== 'function') return [];

    const nativeResult = await this.plugin.searchVectors({
      profileId: request.profileId,
      vectorBase64: encodeSignedInt8(request.vector),
      vectorNorm: request.norm,
      // Native code scans all matching vectors. Request a wider result window because specialty
      // and age-group metadata are deliberately post-filtered through the portable domain mapper.
      limit: Math.min(500, Math.max(request.limit * 10, 100)),
      ...(request.filters.documentIds?.length ? { documentIds: request.filters.documentIds } : {}),
      ...(request.filters.sectionTypes?.length
        ? { sectionTypes: request.filters.sectionTypes }
        : {}),
    });
    if (nativeResult.hits.length === 0) return [];

    const scoreByChunk = new Map(nativeResult.hits.map((hit) => [hit.chunkId, hit.score]));
    const chunkIds = [...scoreByChunk.keys()];
    const rows = await this.query(
      `${VECTOR_HIT_SELECT} WHERE c.id IN (${placeholders(chunkIds.length)})`,
      chunkIds,
    );

    return rows
      .map((row): VectorHit | null => {
        const chunk = toChunk(row);
        const score = scoreByChunk.get(chunk.id);
        if (score === undefined) return null;
        return {
          chunk,
          section: toSection(row),
          document: toDocument(row),
          score,
        };
      })
      .filter((hit): hit is VectorHit => hit !== null)
      .filter((hit) => matchesPostFilters(hit.document, request.filters))
      .toSorted(
        (left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id),
      )
      .slice(0, request.limit);
  }

  public async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    const clauses = ['chunks_fts MATCH ?'];
    const bind: NativeSqlValue[] = [request.ftsQuery];

    if (request.filters.documentIds?.length) {
      clauses.push(`d.id IN (${placeholders(request.filters.documentIds.length)})`);
      bind.push(...request.filters.documentIds);
    }
    if (request.filters.sectionTypes?.length) {
      clauses.push(`s.section_type IN (${placeholders(request.filters.sectionTypes.length)})`);
      bind.push(...request.filters.sectionTypes);
    }
    bind.push(Math.max(request.limit * 5, 50));

    const rows = await this.query(
      `SELECT
        c.id AS chunk_id, c.document_version_id, c.section_id,
        c.order_index AS chunk_order_index, c.original_text, c.normalized_text,
        c.page_start AS chunk_page_start, c.page_end AS chunk_page_end,
        c.char_start, c.char_end, c.previous_chunk_id, c.next_chunk_id,
        c.anchor AS chunk_anchor, c.metadata_json AS chunk_metadata_json,
        s.parent_section_id, s.title AS section_title, s.normalized_title,
        s.section_type, s.depth, s.order_index AS section_order_index,
        s.page_start AS section_page_start, s.page_end AS section_page_end,
        s.anchor AS section_anchor, s.path_json,
        d.id, d.content_pack_id, d.title, d.short_title, d.source_type, d.status,
        d.specialty_json, d.metadata_json,
        dv.id AS version_id, dv.version_label, dv.effective_from, dv.effective_to,
        dv.source_checksum, dv.extracted_at,
        bm25(chunks_fts, 0, 0, 0, 0, 0, 8.0, 4.0, 1.0) AS bm25_rank
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.chunk_id
      JOIN sections s ON s.id = c.section_id
      JOIN documents d ON d.id = chunks_fts.document_id
      JOIN document_versions dv ON dv.id = c.document_version_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY bm25_rank
      LIMIT ?`,
      bind,
    );

    return rows
      .map((row): LexicalHit => {
        const rawRank = readNumber(row, 'bm25_rank');
        return {
          chunk: toChunk(row),
          section: toSection(row),
          document: toDocument(row),
          rank: rawRank < 0 ? -rawRank : 1 / (1 + rawRank),
        };
      })
      .filter((hit) => matchesPostFilters(hit.document, request.filters))
      .slice(0, request.limit);
  }

  public async close(): Promise<void> {
    if (this.initialized) await this.plugin.close();
    this.nativeHealth = undefined;
    this.initialized = false;
  }

  private async query(sql: string, args: readonly NativeSqlValue[] = []): Promise<NativeSqlRow[]> {
    this.assertInitialized();
    const result = await this.plugin.query({
      sql,
      ...(args.length > 0 ? { argsJson: JSON.stringify(args) } : {}),
    });
    return [...result.rows];
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Native SQLite medical store is not initialized.');
  }
}
