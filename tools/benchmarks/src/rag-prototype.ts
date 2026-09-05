/**
 * THROWAWAY CLI prototype: local hybrid retrieval over LocalMed SQLite packs.
 * It never mutates source packs and is intentionally not imported by the app.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { AutoTokenizer, type PreTrainedTokenizer } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/wasm';

const ROOT = resolve(import.meta.dirname, '../../..');
const CACHE_DIR = resolve(ROOT, '.cache/rag-prototype');
const DEFAULT_INDEX = resolve(ROOT, 'data/build/rag-prototype.sqlite');
const MODEL_ID = 'Xenova/multilingual-e5-small';
const MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
const MODEL_FILE = resolve(CACHE_DIR, 'multilingual-e5-small-q8.onnx');
const TOKENIZER_DIR = resolve(CACHE_DIR, MODEL_ID, MODEL_REVISION);
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/onnx/model_quantized.onnx`;
const MODEL_SHA256 = 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193';
const DIMENSIONS = 384;
const RRF_K = 60;

type SqlValue = string | number | bigint | null | Uint8Array;

interface SqlStatement {
  all(...parameters: SqlValue[]): readonly unknown[];
  get(...parameters: SqlValue[]): unknown;
  run(...parameters: SqlValue[]): { readonly changes: number };
}

interface SqlDatabase {
  query(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}

interface BunSqliteModule {
  readonly Database: new (
    path: string,
    options?: { readonly readonly?: boolean; readonly create?: boolean },
  ) => SqlDatabase;
}

interface SourceChunk {
  readonly chunkId: string;
  readonly documentVersionId: string;
  readonly documentId: string;
  readonly contentPackId: string;
  readonly title: string;
  readonly sectionPath: string;
  readonly sectionType: string;
  readonly anchor: string;
  readonly pageStart: number | null;
  readonly pageEnd: number | null;
  readonly text: string;
}

interface IndexedChunk extends SourceChunk {
  readonly id: string;
  readonly sourceDb: string;
  readonly vector: Uint8Array;
  readonly vectorNorm: number;
}

interface SearchRow extends IndexedChunk {
  readonly score: number;
  readonly lexicalRank?: number;
  readonly semanticRank?: number;
}

function usage(): never {
  throw new Error(`Usage:
  bun run benchmark:rag-prototype -- self-test
  bun run benchmark:rag-prototype -- build --db <pack.db> [--db <pack.db>] [--index <rag.db>] [--limit <n>] [--batch-size <n>] [--offline] [--force]
  bun run benchmark:rag-prototype -- query --query <text> [--index <rag.db>] [--limit <n>] [--candidates <n>] [--offline] [--json]`);
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function valuesOf(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    values.push(value);
    index += 1;
  }
  return values;
}

function singleValue(args: readonly string[], flag: string): string | undefined {
  const values = valuesOf(args, flag);
  if (values.length > 1) throw new Error(`${flag} may be provided only once.`);
  return values[0];
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a SQLite object row.');
  }
  return value as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`Expected string column ${key}.`);
  return value;
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`Expected nullable integer column ${key}.`);
  }
  return value;
}

function blobField(row: Record<string, unknown>, key: string): Uint8Array {
  const value = row[key];
  if (!(value instanceof Uint8Array)) throw new TypeError(`Expected blob column ${key}.`);
  return value;
}

async function sqliteModule(): Promise<BunSqliteModule> {
  return (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function fileSha256(path: string): string {
  return sha256(readFileSync(path));
}

async function ensureModel(offline: boolean): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(MODEL_FILE) && fileSha256(MODEL_FILE) === MODEL_SHA256) return;
  if (offline) throw new Error(`Offline model is missing or invalid: ${MODEL_FILE}`);

  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== MODEL_SHA256) throw new Error('Downloaded model checksum mismatch.');
  writeFileSync(MODEL_FILE, bytes);
}

export class WasmEmbedder {
  private constructor(
    private readonly tokenizer: PreTrainedTokenizer,
    private readonly session: ort.InferenceSession,
  ) {}

  static async create(offline: boolean): Promise<WasmEmbedder> {
    await ensureModel(offline);
    const tokenizer = await AutoTokenizer.from_pretrained(offline ? TOKENIZER_DIR : MODEL_ID, {
      cache_dir: CACHE_DIR,
      local_files_only: offline,
      ...(offline ? {} : { revision: MODEL_REVISION }),
    });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = `${resolve(ROOT, 'node_modules/onnxruntime-web/dist')}/`;
    const session = await ort.InferenceSession.create(readFileSync(MODEL_FILE), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return new WasmEmbedder(tokenizer, session);
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const encoded = await this.tokenizer([...texts], {
      padding: true,
      truncation: true,
      max_length: 512,
    });
    const inputIds = encoded.input_ids;
    const attentionMask = encoded.attention_mask;
    if (!inputIds || !attentionMask || !(inputIds.data instanceof BigInt64Array)) {
      throw new Error('Tokenizer returned unsupported input tensors.');
    }
    if (!(attentionMask.data instanceof BigInt64Array)) {
      throw new Error('Tokenizer returned an unsupported attention mask.');
    }
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', inputIds.data, inputIds.dims),
      attention_mask: new ort.Tensor('int64', attentionMask.data, attentionMask.dims),
      token_type_ids: new ort.Tensor(
        'int64',
        new BigInt64Array(inputIds.data.length),
        inputIds.dims,
      ),
    };
    const { last_hidden_state: output } = await this.session.run(feeds);
    if (output?.type !== 'float32' || !(output.data instanceof Float32Array)) {
      throw new Error('Model returned an unsupported output tensor.');
    }
    const outputData = output.data;
    const batchSize = output.dims[0] ?? 0;
    const tokenCount = output.dims[1] ?? 0;
    const dimensions = output.dims[2] ?? 0;
    if (batchSize !== texts.length || tokenCount <= 0 || dimensions !== DIMENSIONS) {
      throw new Error(`Unexpected model output shape: ${output.dims.join('x')}.`);
    }

    return Array.from({ length: batchSize }, (_, batch) => {
      const vector = new Float32Array(dimensions);
      let includedTokens = 0;
      for (let token = 0; token < tokenCount; token += 1) {
        const mask = Number(attentionMask.data[batch * tokenCount + token] ?? 0n);
        if (mask === 0) continue;
        includedTokens += 1;
        const offset = (batch * tokenCount + token) * dimensions;
        for (let dimension = 0; dimension < dimensions; dimension += 1) {
          vector[dimension] = (vector[dimension] ?? 0) + (outputData[offset + dimension] ?? 0);
        }
      }
      if (includedTokens === 0) throw new Error('Model received an empty token sequence.');
      let squaredNorm = 0;
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        const value = (vector[dimension] ?? 0) / includedTokens;
        vector[dimension] = value;
        squaredNorm += value * value;
      }
      const norm = Math.sqrt(squaredNorm);
      if (!Number.isFinite(norm) || norm === 0) throw new Error('Model returned a zero vector.');
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        vector[dimension] = (vector[dimension] ?? 0) / norm;
      }
      return vector;
    });
  }

  async close(): Promise<void> {
    await this.session.release();
  }
}

export function quantize(vector: Float32Array): { vector: Uint8Array; norm: number } {
  const signed = new Int8Array(vector.length);
  let squaredNorm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = Math.max(-127, Math.min(127, Math.round((vector[index] ?? 0) * 127)));
    signed[index] = value;
    squaredNorm += value * value;
  }
  return {
    vector: new Uint8Array(signed.buffer),
    norm: Math.sqrt(squaredNorm),
  };
}

export function cosine(
  left: Uint8Array,
  leftNorm: number,
  right: Uint8Array,
  rightNorm: number,
): number {
  if (
    left.length !== DIMENSIONS ||
    right.length !== DIMENSIONS ||
    leftNorm <= 0 ||
    rightNorm <= 0
  ) {
    throw new Error('Invalid quantized vector.');
  }
  const leftSigned = new Int8Array(left.buffer, left.byteOffset, left.byteLength);
  const rightSigned = new Int8Array(right.buffer, right.byteOffset, right.byteLength);
  let dot = 0;
  for (let index = 0; index < DIMENSIONS; index += 1) {
    dot += (leftSigned[index] ?? 0) * (rightSigned[index] ?? 0);
  }
  return dot / (leftNorm * rightNorm);
}

export function ftsQuery(query: string): string {
  const terms = query.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const unique = [...new Set(terms)].slice(0, 16);
  if (unique.length === 0)
    throw new Error('Query must contain a word or number with 2+ characters.');
  return unique.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' OR ');
}

function parsePath(value: string): string {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new TypeError('Expected section path JSON string array.');
  }
  return parsed.join(' › ');
}

function sourceChunks(database: SqlDatabase, limit: number | undefined): SourceChunk[] {
  const sql = `
    SELECT
      CASE WHEN d.source_type = 'core_catalog_pointer' THEN 'document.' || d.id ELSE c.id END AS chunk_id,
      c.document_version_id, d.id AS document_id, d.content_pack_id, d.title,
      CASE WHEN d.source_type = 'core_catalog_pointer' THEN json_array('Указатель документа') ELSE s.path_json END AS path_json,
      CASE WHEN d.source_type = 'core_catalog_pointer' THEN 'catalog-pointer' ELSE coalesce(s.section_type, '') END AS section_type,
      min(c.anchor) AS anchor,
      min(coalesce(c.page_start, s.page_start)) AS page_start,
      max(coalesce(c.page_end, s.page_end)) AS page_end,
      group_concat(c.original_text, char(10)) AS original_text
    FROM chunks c
    JOIN sections s ON s.id = c.section_id
    JOIN document_versions dv ON dv.id = c.document_version_id
    JOIN documents d ON d.id = dv.document_id AND d.current_version_id = dv.id
    GROUP BY CASE WHEN d.source_type = 'core_catalog_pointer' THEN d.id ELSE c.id END
    ORDER BY d.id, min(c.order_index)${limit === undefined ? '' : ' LIMIT ?'}`;
  const rows = limit === undefined ? database.query(sql).all() : database.query(sql).all(limit);
  return rows.map((value) => {
    const row = asRecord(value);
    return {
      chunkId: stringField(row, 'chunk_id'),
      documentVersionId: stringField(row, 'document_version_id'),
      documentId: stringField(row, 'document_id'),
      contentPackId: stringField(row, 'content_pack_id'),
      title: stringField(row, 'title'),
      sectionPath: parsePath(stringField(row, 'path_json')),
      sectionType: stringField(row, 'section_type'),
      anchor: stringField(row, 'anchor'),
      pageStart: nullableInteger(row, 'page_start'),
      pageEnd: nullableInteger(row, 'page_end'),
      text: stringField(row, 'original_text'),
    };
  });
}

function sourceTools(database: SqlDatabase): SourceChunk[] {
  const table = asRecord(
    database
      .query(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tool_definitions') AS found",
      )
      .get(),
  );
  const { found } = table;
  if (found !== 1) return [];
  const pack = asRecord(database.query('SELECT id FROM content_packs ORDER BY id LIMIT 1').get());
  const contentPackId = stringField(pack, 'id');
  return database
    .query(`SELECT id, kind, version, slug, title, short_title, aliases_json,
      bank_label, category, description, audience FROM tool_definitions ORDER BY id`)
    .all()
    .map((value) => {
      const row = asRecord(value);
      const aliases: unknown = JSON.parse(stringField(row, 'aliases_json'));
      if (!Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string')) {
        throw new TypeError('Expected tool aliases JSON string array.');
      }
      const id = stringField(row, 'id');
      const version = stringField(row, 'version');
      const kind = stringField(row, 'kind');
      const title = stringField(row, 'title');
      return {
        chunkId: `tool.${id}`,
        documentVersionId: `tool:${id}@${version}`,
        documentId: `tool:${id}`,
        contentPackId,
        title,
        sectionPath: kind === 'calculator' ? 'Калькулятор' : 'Опросник',
        sectionType: `tool-${kind}`,
        anchor: `tool:${stringField(row, 'slug')}`,
        pageStart: null,
        pageEnd: null,
        text: [
          title,
          stringField(row, 'short_title'),
          ...aliases,
          stringField(row, 'bank_label'),
          stringField(row, 'category'),
          stringField(row, 'description'),
          stringField(row, 'audience'),
        ].join('\n'),
      };
    });
}

const INDEX_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE rag_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE rag_chunks(
    id TEXT PRIMARY KEY,
    source_db TEXT NOT NULL,
    content_pack_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    document_version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    section_path TEXT NOT NULL,
    section_type TEXT NOT NULL,
    anchor TEXT NOT NULL,
    page_start INTEGER,
    page_end INTEGER,
    text TEXT NOT NULL,
    vector BLOB NOT NULL CHECK(length(vector) = 384),
    vector_norm REAL NOT NULL CHECK(vector_norm > 0)
  );
  CREATE VIRTUAL TABLE rag_chunks_fts USING fts5(
    id UNINDEXED, title, section_path, text,
    tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4'
  );
`;

async function build(args: readonly string[]): Promise<void> {
  const sourcePaths = valuesOf(args, '--db').map((path) => resolve(ROOT, path));
  if (sourcePaths.length === 0) usage();
  for (const path of sourcePaths) {
    if (!existsSync(path)) throw new Error(`Source database does not exist: ${path}`);
  }
  const outputPath = resolve(ROOT, singleValue(args, '--index') ?? DEFAULT_INDEX);
  const temporaryPath = `${outputPath}.tmp`;
  const force = hasFlag(args, '--force');
  if (existsSync(outputPath) && !force) throw new Error(`Index already exists: ${outputPath}`);
  const totalLimitValue = singleValue(args, '--limit');
  const totalLimit = totalLimitValue ? positiveInteger(totalLimitValue, 0, 'limit') : undefined;
  const batchSize = positiveInteger(singleValue(args, '--batch-size'), 16, 'batch-size');
  mkdirSync(dirname(outputPath), { recursive: true });
  rmSync(temporaryPath, { force: true });

  const sqlite = await sqliteModule();
  const chunks: Array<SourceChunk & { readonly sourceDb: string }> = [];
  for (const sourcePath of sourcePaths) {
    const remaining =
      totalLimit === undefined ? undefined : Math.max(0, totalLimit - chunks.length);
    if (remaining === 0) break;
    const source = new sqlite.Database(sourcePath, { readonly: true });
    try {
      chunks.push(
        ...[...sourceChunks(source, remaining), ...sourceTools(source)].map((chunk) => ({
          ...chunk,
          sourceDb: sourcePath,
        })),
      );
    } finally {
      source.close();
    }
  }
  if (chunks.length === 0) throw new Error('No current-version chunks found in source databases.');
  console.log(`Loaded ${chunks.length} source chunks; starting local WASM embeddings.`);

  const embedder = await WasmEmbedder.create(hasFlag(args, '--offline'));
  const output = new sqlite.Database(temporaryPath, { create: true });
  let inserted = 0;
  try {
    output.exec(INDEX_SCHEMA);
    const insertChunk = output.query(`INSERT OR IGNORE INTO rag_chunks(
      id, source_db, content_pack_id, chunk_id, document_id, document_version_id,
      title, section_path, section_type, anchor, page_start, page_end, text, vector, vector_norm
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertFts = output.query(
      'INSERT INTO rag_chunks_fts(id, title, section_path, text) VALUES (?, ?, ?, ?)',
    );
    output.exec('BEGIN');
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const vectors = await embedder.embed(
        batch.map((chunk) => `passage: ${chunk.title}\n${chunk.sectionPath}\n${chunk.text}`),
      );
      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index];
        const floatVector = vectors[index];
        if (!chunk || !floatVector) throw new Error('Embedding batch length mismatch.');
        const id = sha256(`${chunk.contentPackId}\0${chunk.documentVersionId}\0${chunk.chunkId}`);
        const { vector, norm } = quantize(floatVector);
        const result = insertChunk.run(
          id,
          chunk.sourceDb,
          chunk.contentPackId,
          chunk.chunkId,
          chunk.documentId,
          chunk.documentVersionId,
          chunk.title,
          chunk.sectionPath,
          chunk.sectionType,
          chunk.anchor,
          chunk.pageStart,
          chunk.pageEnd,
          chunk.text,
          vector,
          norm,
        );
        if (result.changes > 0) {
          insertFts.run(id, chunk.title, chunk.sectionPath, chunk.text);
          inserted += 1;
        }
      }
      console.log(`Embedded ${Math.min(offset + batch.length, chunks.length)}/${chunks.length}.`);
    }
    const metadata: Readonly<Record<string, string>> = {
      schema: 'localmed-rag-prototype-v1',
      model_id: MODEL_ID,
      model_revision: MODEL_REVISION,
      model_sha256: MODEL_SHA256,
      dimensions: String(DIMENSIONS),
      chunk_count: String(inserted),
      source_databases: JSON.stringify(sourcePaths),
      created_at: new Date().toISOString(),
    };
    const insertMeta = output.query('INSERT INTO rag_meta(key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(metadata)) insertMeta.run(key, value);
    output.exec('COMMIT');
    output.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  } catch (cause) {
    try {
      output.exec('ROLLBACK');
    } catch {
      // The transaction may already be closed by SQLite after a fatal statement error.
    }
    throw cause;
  } finally {
    output.close();
    await embedder.close();
  }
  if (existsSync(outputPath)) rmSync(outputPath);
  renameSync(temporaryPath, outputPath);
  console.log(`Built ${outputPath}: ${inserted} chunks, ${statSync(outputPath).size} bytes.`);
}

function indexedChunk(row: Record<string, unknown>): IndexedChunk {
  const { vector_norm: norm } = row;
  if (typeof norm !== 'number' || !Number.isFinite(norm) || norm <= 0) {
    throw new TypeError('Expected positive vector_norm.');
  }
  return {
    id: stringField(row, 'id'),
    sourceDb: stringField(row, 'source_db'),
    contentPackId: stringField(row, 'content_pack_id'),
    chunkId: stringField(row, 'chunk_id'),
    documentId: stringField(row, 'document_id'),
    documentVersionId: stringField(row, 'document_version_id'),
    title: stringField(row, 'title'),
    sectionPath: stringField(row, 'section_path'),
    sectionType: stringField(row, 'section_type'),
    anchor: stringField(row, 'anchor'),
    pageStart: nullableInteger(row, 'page_start'),
    pageEnd: nullableInteger(row, 'page_end'),
    text: stringField(row, 'text'),
    vector: blobField(row, 'vector'),
    vectorNorm: norm,
  };
}

async function query(args: readonly string[]): Promise<void> {
  const queryText = singleValue(args, '--query');
  if (!queryText) usage();
  const indexPath = resolve(ROOT, singleValue(args, '--index') ?? DEFAULT_INDEX);
  if (!existsSync(indexPath)) throw new Error(`Index does not exist: ${indexPath}`);
  const resultLimit = positiveInteger(singleValue(args, '--limit'), 8, 'limit');
  const candidateLimit = positiveInteger(singleValue(args, '--candidates'), 50, 'candidates');
  const sqlite = await sqliteModule();
  const database = new sqlite.Database(indexPath, { readonly: true });
  const embedder = await WasmEmbedder.create(hasFlag(args, '--offline'));
  try {
    const [queryFloat] = await embedder.embed([`query: ${queryText}`]);
    if (!queryFloat) throw new Error('Model did not return a query vector.');
    const queryVector = quantize(queryFloat);
    const lexical = database
      .query(`SELECT r.*, bm25(rag_chunks_fts) AS rank
        FROM rag_chunks_fts JOIN rag_chunks r ON r.id = rag_chunks_fts.id
        WHERE rag_chunks_fts MATCH ? ORDER BY rank LIMIT ?`)
      .all(ftsQuery(queryText), candidateLimit)
      .map(asRecord);
    const semantic = database
      .query('SELECT * FROM rag_chunks')
      .all()
      .map(asRecord)
      .map(indexedChunk)
      .map((chunk) => ({
        chunk,
        similarity: cosine(queryVector.vector, queryVector.norm, chunk.vector, chunk.vectorNorm),
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, candidateLimit);

    const fused = new Map<string, SearchRow>();
    lexical.forEach((row, index) => {
      const chunk = indexedChunk(row);
      fused.set(chunk.id, { ...chunk, score: 1 / (RRF_K + index + 1), lexicalRank: index + 1 });
    });
    semantic.forEach(({ chunk }, index) => {
      const current = fused.get(chunk.id);
      fused.set(
        chunk.id,
        current
          ? {
              ...current,
              score: current.score + 1 / (RRF_K + index + 1),
              semanticRank: index + 1,
            }
          : { ...chunk, score: 1 / (RRF_K + index + 1), semanticRank: index + 1 },
      );
    });
    const seenDocuments = new Set<string>();
    const results = [...fused.values()]
      .sort((left, right) => right.score - left.score)
      .filter((row) => {
        if (seenDocuments.has(row.documentId)) return false;
        seenDocuments.add(row.documentId);
        return true;
      })
      .slice(0, resultLimit)
      .map(({ vector: _vector, vectorNorm: _vectorNorm, ...row }) => ({
        ...row,
        sourceDb: basename(row.sourceDb),
        snippet: row.text.replaceAll(/\s+/g, ' ').slice(0, 360),
        text: undefined,
      }));

    if (hasFlag(args, '--json')) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    results.forEach((result, index) => {
      const ranks = [
        result.lexicalRank ? `lex ${result.lexicalRank}` : undefined,
        result.semanticRank ? `sem ${result.semanticRank}` : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`\n${index + 1}. ${result.title} [${ranks}]`);
      console.log(`   ${result.sectionPath || 'Без раздела'}`);
      console.log(`   ${result.snippet}${result.snippet.length === 360 ? '…' : ''}`);
      console.log(`   ${result.sourceDb} · ${result.chunkId} · ${result.anchor}`);
    });
  } finally {
    database.close();
    await embedder.close();
  }
}

function selfTest(): void {
  const left = new Float32Array(DIMENSIONS);
  const right = new Float32Array(DIMENSIONS);
  left[0] = 1;
  right[1] = 1;
  const leftQuantized = quantize(left);
  const rightQuantized = quantize(right);
  if (
    Math.abs(
      cosine(leftQuantized.vector, leftQuantized.norm, leftQuantized.vector, leftQuantized.norm) -
        1,
    ) > 1e-6
  ) {
    throw new Error('Cosine identity self-test failed.');
  }
  if (
    Math.abs(
      cosine(leftQuantized.vector, leftQuantized.norm, rightQuantized.vector, rightQuantized.norm),
    ) > 1e-6
  ) {
    throw new Error('Cosine orthogonality self-test failed.');
  }
  if (ftsQuery('ОРВИ: дети + кашель') !== '"орви"* OR "дети"* OR "кашель"*') {
    throw new Error('FTS normalization self-test failed.');
  }
  console.log('RAG prototype self-test passed.');
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'self-test') selfTest();
  else if (command === 'build') await build(args);
  else if (command === 'query') await query(args);
  else usage();
}
