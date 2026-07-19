import {
  type ContentPackSeed,
  ContentPackSeedSchema,
  type EmbeddingProfile,
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
import sqlite3InitModule, {
  type BindableValue,
  type BindingSpec,
  type Database,
  type PreparedStatement,
  type Sqlite3Static,
  type SqlValue,
} from '@sqlite.org/sqlite-wasm';

import { SCHEMA_SQL } from './generated/schema';
import {
  readBlob,
  readNullableNumber,
  readNullableString,
  readNumber,
  readString,
  type SqlRow,
} from './row-readers';

let sqliteModulePromise: Promise<Sqlite3Static> | undefined;

async function getSqliteModule(): Promise<Sqlite3Static> {
  sqliteModulePromise ??= sqlite3InitModule();
  return sqliteModulePromise;
}

function queryRows(database: Database, sql: string, bind?: BindingSpec): SqlRow[] {
  const resultRows: Record<string, SqlValue>[] = [];
  if (bind === undefined) {
    database.exec(sql, { rowMode: 'object', resultRows });
  } else {
    database.exec(sql, { bind, rowMode: 'object', resultRows });
  }
  return resultRows;
}

function executeStatement(statement: PreparedStatement, values: readonly BindableValue[]): void {
  statement.bind(values).stepReset();
}

function toDocument(row: SqlRow): DocumentRecord {
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

function toSection(row: SqlRow): SectionRecord {
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

function toChunk(row: SqlRow): ChunkRecord {
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

function toInt8Blob(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values, (value) => (value < 0 ? value + 256 : value));
}

function fromInt8Blob(value: Uint8Array): readonly number[] {
  return Array.from(value, (byte) => (byte > 127 ? byte - 256 : byte));
}

function cosine(
  left: readonly number[],
  right: readonly number[],
  leftNorm: number,
  rightNorm: number,
): number {
  if (left.length !== right.length || leftNorm === 0 || rightNorm === 0) return 0;
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return Math.max(-1, Math.min(1, dot / (leftNorm * rightNorm)));
}

export interface SqliteIntegrityReport {
  readonly integrity: string;
  readonly foreignKeyViolations: number;
  readonly chunkCount: number;
  readonly ftsRowCount: number;
  readonly embeddingProfileCount: number;
  readonly embeddingCount: number;
}

export class SqliteMedicalStore implements MedicalStore {
  private initialized = false;

  private constructor(
    private readonly database: Database,
    private readonly sqliteVersion: string,
  ) {}

  public static async create(): Promise<SqliteMedicalStore> {
    const sqlite = await getSqliteModule();
    return new SqliteMedicalStore(new sqlite.oo1.DB(':memory:', 'c'), sqlite.version.libVersion);
  }

  public static async createFromBytes(bytes: Uint8Array): Promise<SqliteMedicalStore> {
    if (bytes.byteLength === 0) throw new Error('Cannot open an empty SQLite content pack.');
    const sqlite = await getSqliteModule();
    const database = new sqlite.oo1.DB(':memory:', 'c');
    const databasePointer = database.pointer;
    if (!databasePointer) {
      database.close();
      throw new Error('SQLite did not expose a database pointer.');
    }
    const dataPointer = sqlite.wasm.allocFromTypedArray(bytes);
    const flags =
      sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const resultCode = sqlite.capi.sqlite3_deserialize(
      databasePointer,
      'main',
      dataPointer,
      bytes.byteLength,
      bytes.byteLength,
      flags,
    );
    if (resultCode !== sqlite.capi.SQLITE_OK) {
      sqlite.wasm.dealloc(dataPointer);
      database.close();
      throw new Error(`Unable to deserialize SQLite content pack (code ${resultCode}).`);
    }
    return new SqliteMedicalStore(database, sqlite.version.libVersion);
  }

  public async initialize(untrustedSeed?: ContentPackSeed): Promise<StorageHealth> {
    if (!this.initialized) {
      this.database.exec(SCHEMA_SQL);
      const fts5Available = Number(
        this.database.selectValue(
          "SELECT EXISTS(SELECT 1 FROM pragma_module_list WHERE name = 'fts5')",
        ),
      );
      if (fts5Available !== 1) throw new Error('SQLite was built without FTS5 support.');
      this.initialized = true;
    }

    if (untrustedSeed) this.installSeed(ContentPackSeedSchema.parse(untrustedSeed));
    return this.getHealth();
  }

  private installSeed(seed: ContentPackSeed): void {
    const existingChecksum = this.database.selectValue(
      'SELECT checksum FROM content_packs WHERE id = ?',
      seed.manifest.id,
    );
    if (existingChecksum === seed.manifest.checksum) return;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec(
        'DELETE FROM chunks_fts; DELETE FROM aliases; DELETE FROM content_packs; DELETE FROM embedding_profiles;',
      );
      const profileStatement = this.database.prepare(`INSERT INTO embedding_profiles(
        id, dimensions, vector_format, normalization, generator, generator_version,
        fingerprint, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        for (const profile of seed.embeddingProfiles) {
          executeStatement(profileStatement, [
            profile.id,
            profile.dimensions,
            profile.vectorFormat,
            profile.normalization,
            profile.generator,
            profile.generatorVersion,
            profile.fingerprint,
            JSON.stringify(profile.metadata),
          ]);
        }
      } finally {
        profileStatement.finalize();
      }

      this.database.exec({
        sql: `INSERT INTO content_packs(
          id, version, schema_version, title, checksum, installed_at, enabled
        ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        bind: [
          seed.manifest.id,
          seed.manifest.version,
          seed.manifest.schemaVersion,
          seed.manifest.title,
          seed.manifest.checksum,
          seed.manifest.builtAt,
        ],
      });
      this.database.exec({
        sql: 'INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
        bind: [seed.manifest.schemaVersion, seed.manifest.builtAt],
      });
      this.database.exec({
        sql: "INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('schema_version', ?)",
        bind: [String(seed.manifest.schemaVersion)],
      });

      const documentStatement = this.database.prepare(`INSERT INTO documents(
        id, content_pack_id, title, short_title, source_type, status, specialty_json,
        metadata_json, current_version_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const versionStatement = this.database.prepare(`INSERT INTO document_versions(
        id, document_id, version_label, effective_from, effective_to, source_checksum, extracted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const sectionStatement = this.database.prepare(`INSERT INTO sections(
        id, document_version_id, parent_section_id, title, normalized_title, section_type,
        depth, order_index, page_start, page_end, anchor, path_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const chunkStatement = this.database.prepare(`INSERT INTO chunks(
        id, document_version_id, section_id, order_index, original_text, normalized_text,
        page_start, page_end, char_start, char_end, previous_chunk_id, next_chunk_id,
        anchor, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const ftsStatement = this.database.prepare(`INSERT INTO chunks_fts(
        chunk_id, document_id, document_version_id, section_id, anchor,
        title, section_path, normalized_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const aliasStatement = this.database.prepare(`INSERT INTO aliases(
        id, canonical_term, alias, category, weight
      ) VALUES (?, ?, ?, ?, ?)`);
      const embeddingStatement = this.database.prepare(`INSERT INTO chunk_embeddings(
        profile_id, chunk_id, vector, vector_norm
      ) VALUES (?, ?, ?, ?)`);

      try {
        for (const document of seed.documents) {
          executeStatement(documentStatement, [
            document.id,
            seed.manifest.id,
            document.title,
            document.shortTitle,
            document.sourceType,
            document.status,
            JSON.stringify(document.specialties),
            JSON.stringify(document.metadata),
            document.version.id,
          ]);
          executeStatement(versionStatement, [
            document.version.id,
            document.id,
            document.version.label,
            document.version.effectiveFrom,
            document.version.effectiveTo,
            document.version.sourceChecksum,
            document.version.extractedAt,
          ]);

          const orderedChunks = document.sections
            .flatMap((section) => section.chunks)
            .toSorted((left, right) => left.orderIndex - right.orderIndex);
          const neighbors = new Map(
            orderedChunks.map((chunk, index) => [
              chunk.id,
              {
                previous: orderedChunks[index - 1]?.id ?? null,
                next: orderedChunks[index + 1]?.id ?? null,
              },
            ]),
          );

          for (const section of document.sections.toSorted(
            (left, right) => left.orderIndex - right.orderIndex,
          )) {
            executeStatement(sectionStatement, [
              section.id,
              document.version.id,
              section.parentSectionId,
              section.title,
              section.normalizedTitle,
              section.sectionType,
              section.depth,
              section.orderIndex,
              section.pageStart,
              section.pageEnd,
              section.anchor,
              JSON.stringify(section.sectionPath),
            ]);
            for (const chunk of section.chunks) {
              const neighbor = neighbors.get(chunk.id);
              executeStatement(chunkStatement, [
                chunk.id,
                document.version.id,
                section.id,
                chunk.orderIndex,
                chunk.originalText,
                chunk.normalizedText,
                chunk.pageStart,
                chunk.pageEnd,
                chunk.charStart,
                chunk.charEnd,
                neighbor?.previous ?? null,
                neighbor?.next ?? null,
                chunk.anchor,
                JSON.stringify(chunk.metadata),
              ]);
              executeStatement(ftsStatement, [
                chunk.id,
                document.id,
                document.version.id,
                section.id,
                chunk.anchor,
                document.title,
                section.sectionPath.join(' '),
                chunk.normalizedText,
              ]);
            }
          }
        }

        for (const alias of seed.aliases) {
          executeStatement(aliasStatement, [
            alias.id,
            alias.canonicalTerm,
            alias.alias,
            alias.category,
            alias.weight,
          ]);
        }
        for (const embedding of seed.embeddings) {
          executeStatement(embeddingStatement, [
            embedding.profileId,
            embedding.chunkId,
            toInt8Blob(embedding.values),
            embedding.norm,
          ]);
        }
      } finally {
        documentStatement.finalize();
        versionStatement.finalize();
        sectionStatement.finalize();
        chunkStatement.finalize();
        ftsStatement.finalize();
        aliasStatement.finalize();
        embeddingStatement.finalize();
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public async getHealth(): Promise<StorageHealth> {
    this.assertInitialized();
    return {
      schemaVersion: Number(
        this.database.selectValue("SELECT value FROM app_metadata WHERE key = 'schema_version'"),
      ),
      sqliteVersion: this.sqliteVersion,
      fts5Available:
        Number(
          this.database.selectValue(
            "SELECT EXISTS(SELECT 1 FROM pragma_module_list WHERE name = 'fts5')",
          ),
        ) === 1,
      contentPackIds: queryRows(this.database, 'SELECT id FROM content_packs ORDER BY id').map(
        (row) => readString(row, 'id'),
      ),
      documentCount: Number(this.database.selectValue('SELECT count(*) FROM documents')),
      backend: 'sqlite-wasm',
      persistent: false,
      installation: 'memory',
      sizeBytes: null,
    };
  }

  public async listDocuments(): Promise<readonly DocumentRecord[]> {
    this.assertInitialized();
    return queryRows(this.database, `${DOCUMENT_SELECT} ORDER BY d.title COLLATE NOCASE`).map(
      toDocument,
    );
  }

  public async getDocument(id: string): Promise<DocumentRecord | null> {
    this.assertInitialized();
    const row = queryRows(this.database, `${DOCUMENT_SELECT} WHERE d.id = ? LIMIT 1`, id)[0];
    return row ? toDocument(row) : null;
  }

  public async getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    this.assertInitialized();
    const row = queryRows(
      this.database,
      `${DOCUMENT_SELECT} WHERE dv.id = ? LIMIT 1`,
      versionId,
    )[0];
    return row ? toDocument(row) : null;
  }

  public async getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    this.assertInitialized();
    return queryRows(
      this.database,
      `${SECTION_SELECT}
       JOIN document_versions dv ON dv.id = s.document_version_id
       WHERE dv.document_id = ?
       ORDER BY s.order_index`,
      documentId,
    ).map(toSection);
  }

  public async getSection(id: string): Promise<SectionRecord | null> {
    this.assertInitialized();
    const row = queryRows(this.database, `${SECTION_SELECT} WHERE s.id = ? LIMIT 1`, id)[0];
    return row ? toSection(row) : null;
  }

  public async getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]> {
    this.assertInitialized();
    return queryRows(
      this.database,
      `${CHUNK_SELECT} WHERE c.section_id = ? ORDER BY c.order_index`,
      sectionId,
    ).map(toChunk);
  }

  public async getChunk(id: string): Promise<ChunkRecord | null> {
    this.assertInitialized();
    const row = queryRows(this.database, `${CHUNK_SELECT} WHERE c.id = ? LIMIT 1`, id)[0];
    return row ? toChunk(row) : null;
  }

  public async getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]> {
    this.assertInitialized();
    const focus = await this.getChunk(chunkId);
    if (!focus) return [];
    return queryRows(
      this.database,
      `${CHUNK_SELECT}
       WHERE c.document_version_id = ? AND c.order_index BETWEEN ? AND ?
       ORDER BY c.order_index`,
      [focus.documentVersionId, Math.max(0, focus.orderIndex - radius), focus.orderIndex + radius],
    ).map(toChunk);
  }

  public async listAliases(): Promise<readonly AliasRecord[]> {
    this.assertInitialized();
    return queryRows(
      this.database,
      'SELECT id, canonical_term, alias, category, weight FROM aliases ORDER BY alias',
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
    return queryRows(
      this.database,
      `SELECT id, dimensions, vector_format, normalization, generator, generator_version,
        fingerprint, metadata_json
       FROM embedding_profiles
       ORDER BY id`,
    ).map((row) => ({
      id: readString(row, 'id'),
      dimensions: readNumber(row, 'dimensions'),
      vectorFormat: 'int8',
      normalization: 'l2',
      generator: readString(row, 'generator'),
      generatorVersion: readString(row, 'generator_version'),
      fingerprint: readString(row, 'fingerprint'),
      metadata: parseJsonObject(readString(row, 'metadata_json')),
    }));
  }

  public async searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    this.assertInitialized();
    const profile = (await this.listEmbeddingProfiles()).find(
      (candidate) => candidate.id === request.profileId,
    );
    if (!profile || profile.dimensions !== request.vector.length) return [];

    const rows = queryRows(
      this.database,
      `SELECT
        ce.vector, ce.vector_norm,
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
      FROM chunk_embeddings ce
      JOIN chunks c ON c.id = ce.chunk_id
      JOIN sections s ON s.id = c.section_id
      JOIN documents d ON d.current_version_id = c.document_version_id
      JOIN document_versions dv ON dv.id = c.document_version_id
      WHERE ce.profile_id = ?`,
      request.profileId,
    );

    return rows
      .flatMap((row): VectorHit[] => {
        const chunk = toChunk(row);
        const section = toSection(row);
        const document = toDocument(row);
        if (!matchesPostFilters(document, request.filters)) return [];
        if (
          request.filters.documentIds?.length &&
          !request.filters.documentIds.includes(document.id)
        ) {
          return [];
        }
        if (
          request.filters.sectionTypes?.length &&
          !request.filters.sectionTypes.includes(section.sectionType ?? '')
        ) {
          return [];
        }
        const storedVector = fromInt8Blob(readBlob(row, 'vector'));
        return [
          {
            chunk,
            section,
            document,
            score: cosine(
              request.vector,
              storedVector,
              request.norm,
              readNumber(row, 'vector_norm'),
            ),
          },
        ];
      })
      .toSorted((left, right) => right.score - left.score)
      .slice(0, request.limit);
  }

  public async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.assertInitialized();
    const clauses = ['chunks_fts MATCH ?'];
    const bind: BindableValue[] = [request.ftsQuery];

    if (request.filters.documentIds?.length) {
      clauses.push(`d.id IN (${placeholders(request.filters.documentIds.length)})`);
      bind.push(...request.filters.documentIds);
    }
    if (request.filters.sectionTypes?.length) {
      clauses.push(`s.section_type IN (${placeholders(request.filters.sectionTypes.length)})`);
      bind.push(...request.filters.sectionTypes);
    }
    bind.push(Math.max(request.limit * 5, 50));

    const rows = queryRows(
      this.database,
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

  public async inspectIntegrity(): Promise<SqliteIntegrityReport> {
    this.assertInitialized();
    return {
      integrity: String(this.database.selectValue('PRAGMA integrity_check')),
      foreignKeyViolations: queryRows(this.database, 'PRAGMA foreign_key_check').length,
      chunkCount: Number(this.database.selectValue('SELECT count(*) FROM chunks')),
      ftsRowCount: Number(this.database.selectValue('SELECT count(*) FROM chunks_fts')),
      embeddingProfileCount: Number(
        this.database.selectValue('SELECT count(*) FROM embedding_profiles'),
      ),
      embeddingCount: Number(this.database.selectValue('SELECT count(*) FROM chunk_embeddings')),
    };
  }

  public async close(): Promise<void> {
    if (this.database.isOpen()) this.database.close();
    this.initialized = false;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('SQLite medical store is not initialized.');
  }
}
