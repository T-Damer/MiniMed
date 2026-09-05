import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type FullCorpusQueryStyle,
  type FullCorpusSearchFixture,
  type FullCorpusSearchQuery,
  type FullCorpusSourceFamily,
  validateFullCorpusSearchFixture,
} from './full-corpus-search-scoring';

interface BunQuery {
  all(...parameters: unknown[]): readonly unknown[];
}

interface BunDatabase {
  query(sql: string): BunQuery;
  close(): void;
}

interface BunSqliteModule {
  readonly Database: new (path: string, options: { readonly readonly: boolean }) => BunDatabase;
}

const root = resolve(import.meta.dirname, '../../..');

interface DocumentRow {
  readonly id: string;
  readonly title: string;
  readonly short_title: string | null;
  readonly source_type: string;
  readonly entity_type: string | null;
  readonly metadata_json: string;
}

interface SectionRow {
  readonly document_id: string;
  readonly title: string;
  readonly section_type: string | null;
}

interface MkbDocument {
  readonly id: string;
  readonly document: DocumentRow;
  readonly code: string;
  readonly name: string;
}

interface DocumentMetadata {
  readonly mkbCode?: unknown;
  readonly icd10Codes?: unknown;
}

function parseArgs(args: readonly string[]): {
  readonly sourceFamily: FullCorpusSourceFamily;
  readonly databasePath: string;
  readonly outputPath: string;
} {
  let sourceFamily: FullCorpusSourceFamily | undefined;
  let databasePath: string | undefined;
  let outputPath: string | undefined;
  for (const arg of args) {
    const [key, value] = arg.split('=', 2);
    if (key === '--source' && (value === 'diseases' || value === 'mkb-diseases'))
      sourceFamily = value;
    else if (key === '--database' && value) databasePath = resolve(value);
    else if (key === '--output' && value) outputPath = resolve(value);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  if (sourceFamily === undefined)
    throw new Error('--source=diseases or --source=mkb-diseases is required.');
  return {
    sourceFamily,
    databasePath: databasePath ?? resolve(root, `data/build/${sourceFamily}.db`),
    outputPath: outputPath ?? resolve(root, `data/build/${sourceFamily}-full-search-queries.json`),
  };
}

function row(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SQLite query returned an invalid row.');
  }
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${path} is not a string.`);
  return value;
}

function optionalString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function documentRows(database: BunDatabase): readonly DocumentRow[] {
  return database
    .query(
      `SELECT id, title, short_title, source_type,
              json_extract(metadata_json, '$.entityType') AS entity_type, metadata_json
       FROM documents ORDER BY id`,
    )
    .all()
    .map((value) => {
      const item = row(value);
      return {
        id: stringValue(field(item, 'id'), 'documents.id'),
        title: stringValue(field(item, 'title'), 'documents.title'),
        short_title: optionalString(field(item, 'short_title'), 'documents.short_title'),
        source_type: stringValue(field(item, 'source_type'), 'documents.source_type'),
        entity_type: optionalString(field(item, 'entity_type'), 'documents.entity_type'),
        metadata_json: stringValue(field(item, 'metadata_json'), 'documents.metadata_json'),
      };
    });
}

function sectionRows(database: BunDatabase): readonly SectionRow[] {
  return database
    .query(
      `SELECT d.id AS document_id, s.title, s.section_type
       FROM documents d
       JOIN sections s ON s.document_version_id = d.current_version_id
       WHERE s.section_type IS NOT NULL
       ORDER BY d.id, s.section_type, s.title`,
    )
    .all()
    .map((value) => {
      const item = row(value);
      return {
        document_id: stringValue(field(item, 'document_id'), 'sections.document_id'),
        title: stringValue(field(item, 'title'), 'sections.title'),
        section_type: optionalString(field(item, 'section_type'), 'sections.section_type'),
      };
    });
}

function metadata(value: string): DocumentMetadata {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Document metadata must be an object.');
  }
  return parsed as DocumentMetadata;
}

function stableScore(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function stableSample<T extends { readonly id: string }>(
  values: readonly T[],
  count: number,
): readonly T[] {
  return values
    .toSorted(
      (left, right) =>
        stableScore(left.id) - stableScore(right.id) || left.id.localeCompare(right.id),
    )
    .slice(0, count)
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

function primaryTitle(title: string): string {
  return title.split('(', 1)[0]?.trim() || title;
}

function parentheticalSynonym(title: string): string | null {
  const match = title.match(/\(([^()]*)\)/u);
  const synonym = match?.[1]?.split(',', 1)[0]?.trim();
  return synonym || null;
}

function mkbName(document: DocumentRow, code: string): string {
  const value = document.short_title ?? document.title.replace(/, МКБ-10$/u, '');
  return value.startsWith(`${code} `) ? value.slice(code.length).trim() : value;
}

function uniqueQuery(value: string, used: Set<string>, fallback: readonly string[]): string {
  for (const candidate of [value, ...fallback]) {
    if (candidate.trim() && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not make a unique query for ${value}.`);
}

function makeQuery(
  id: string,
  query: string,
  expectedDocumentIds: readonly string[],
  style: FullCorpusQueryStyle,
  sourceFamily: FullCorpusSourceFamily,
  usedQueries: Set<string>,
  fallback: readonly string[] = [],
  expectedSectionType?: string,
): FullCorpusSearchQuery {
  const unique = uniqueQuery(query, usedQueries, fallback);
  return expectedSectionType === undefined
    ? { id, query: unique, expectedDocumentIds, style, sourceFamily }
    : { id, query: unique, expectedDocumentIds, style, sourceFamily, expectedSectionType };
}

function diseaseQueries(
  database: BunDatabase,
  sourceFamily: FullCorpusSourceFamily,
): readonly FullCorpusSearchQuery[] {
  const documents = documentRows(database).filter(
    (item) => item.source_type === 'krasotaimedicina_reference',
  );
  const diseases = stableSample(
    documents.filter((item) => item.entity_type === 'disease'),
    356,
  );
  const syndromes = stableSample(
    documents.filter((item) => item.entity_type === 'syndrome'),
    44,
  );
  if (diseases.length !== 356 || syndromes.length !== 44) {
    throw new Error(
      `Expected 5,419 diseases and 649 syndromes; sampled ${diseases.length} and ${syndromes.length}.`,
    );
  }
  const identities = [...diseases, ...syndromes].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const usedQueries = new Set<string>();
  const identityQueries = identities.map((document, index) => {
    const primary = primaryTitle(document.title);
    const synonym = parentheticalSynonym(document.title);
    const kind = document.entity_type === 'syndrome' ? 'синдром' : 'болезнь';
    const assignment =
      synonym !== null
        ? {
            style: 'parenthetical-synonym' as const,
            query: synonym,
            fallback: [document.title, primary],
          }
        : index % 3 === 0
          ? { style: 'exact-title' as const, query: document.title, fallback: [primary] }
          : index % 3 === 1
            ? { style: 'primary-title' as const, query: primary, fallback: [document.title] }
            : {
                style: 'readable-prefixed-lookup' as const,
                query: `${kind}: ${primary}`,
                fallback: [primary, document.title],
              };
    return makeQuery(
      `disease-identity-${String(index + 1).padStart(3, '0')}`,
      assignment.query,
      [document.id],
      assignment.style,
      sourceFamily,
      usedQueries,
      assignment.fallback,
    );
  });

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const sectionCandidates = new Map<string, SectionRow>();
  for (const section of sectionRows(database)) {
    if (section.section_type === null || !documentById.has(section.document_id)) continue;
    const key = `${section.document_id}:${section.section_type}`;
    if (!sectionCandidates.has(key)) sectionCandidates.set(key, section);
  }
  const sectionTargets = [
    ['diagnostics', 'диагностика', 20],
    ['treatment', 'лечение', 20],
    ['classification', 'классификация', 15],
    ['prevention', 'профилактика', 15],
    ['differential-diagnosis', 'дифференциальная диагностика', 10],
    ['clinical-picture', 'симптомы', 10],
    ['other', null, 10],
  ] as const;
  let sectionIndex = 0;
  const sectionQueries = sectionTargets.flatMap(([sectionType, intent, count]) =>
    stableSample(
      [...sectionCandidates.values()]
        .filter((section) => section.section_type === sectionType)
        .map((section) => ({ ...section, id: `${section.document_id}:${sectionType}` })),
      count,
    ).map((section) => {
      const document = documentById.get(section.document_id);
      if (!document) throw new Error(`Missing section document: ${section.document_id}`);
      sectionIndex += 1;
      const primary = primaryTitle(document.title);
      const sectionIntent = intent ?? section.title;
      return makeQuery(
        `disease-section-${String(sectionIndex).padStart(3, '0')}`,
        `${primary} ${sectionIntent}`,
        [document.id],
        'section-intent',
        sourceFamily,
        usedQueries,
        [`${sectionIntent} ${primary}`],
        sectionType,
      );
    }),
  );
  if (sectionQueries.length !== 100)
    throw new Error(`Expected 100 disease section queries, got ${sectionQueries.length}.`);
  return [...identityQueries, ...sectionQueries];
}

function mkbDocuments(documents: readonly DocumentRow[]): readonly MkbDocument[] {
  return documents
    .filter((item) => item.source_type === 'rls_mkb_reference')
    .map((document) => {
      const data = metadata(document.metadata_json);
      const code = stringValue(data.mkbCode, `${document.id}.mkbCode`);
      return {
        id: document.id,
        document,
        code,
        name: mkbName(document, code),
      };
    });
}

function mkbQueries(
  database: BunDatabase,
  sourceFamily: FullCorpusSourceFamily,
): readonly FullCorpusSearchQuery[] {
  const documents = documentRows(database);
  const allMkb = mkbDocuments(documents);
  const mkb = stableSample(allMkb, 400);
  if (mkb.length !== 400)
    throw new Error(`Expected at least 400 MKB documents, got ${mkb.length}.`);
  const usedQueries = new Set<string>();
  const identityQueries = mkb.map((item, index) => {
    const position = index % 5;
    const variants = [
      { style: 'code-only' as const, query: item.code, fallback: [item.document.title] },
      { style: 'name-only' as const, query: item.name, fallback: [item.document.title] },
      {
        style: 'code-and-name' as const,
        query: `${item.code} ${item.name}`,
        fallback: [item.document.title],
      },
      {
        style: 'readable-prefixed-lookup' as const,
        query: `МКБ-10: ${item.code} ${item.name}`,
        fallback: [item.code, item.document.title],
      },
      {
        style: 'title-variant' as const,
        query: item.document.title,
        fallback: [item.name, `${item.code} ${item.name}`],
      },
    ] as const;
    const variant = variants[position] ?? variants[0];
    return makeQuery(
      `mkb-identity-${String(index + 1).padStart(3, '0')}`,
      variant.query,
      [item.document.id],
      variant.style,
      sourceFamily,
      usedQueries,
      variant.fallback,
    );
  });

  const diseases = documents.filter((item) => item.source_type === 'krasotaimedicina_reference');
  const byCode = new Map(allMkb.map((item) => [item.code, item.document.id]));
  const compositionCandidates = diseases.flatMap((document) => {
    const data = metadata(document.metadata_json);
    const codes = Array.isArray(data.icd10Codes)
      ? data.icd10Codes.filter((code): code is string => typeof code === 'string')
      : [];
    const code = codes.find((candidate) => byCode.has(candidate));
    const mkbId = code === undefined ? undefined : byCode.get(code);
    return code === undefined || mkbId === undefined
      ? []
      : [{ document, code, mkbId, id: document.id }];
  });
  const composition = stableSample(compositionCandidates, 100).map((item, index) => {
    const primary = primaryTitle(item.document.title);
    return makeQuery(
      `mkb-composition-${String(index + 1).padStart(3, '0')}`,
      `${item.code} ${primary}`,
      [item.document.id, item.mkbId],
      'composition',
      sourceFamily,
      usedQueries,
      [`МКБ-10: ${item.code} ${primary}`, `${primary} ${item.code}`],
    );
  });
  if (composition.length !== 100)
    throw new Error(`Expected 100 MKB composition queries, got ${composition.length}.`);
  return [...identityQueries, ...composition];
}

const { sourceFamily, databasePath, outputPath } = parseArgs(process.argv.slice(2));
if (!existsSync(databasePath)) throw new Error(`Input database does not exist: ${databasePath}`);

const sqlite = (await import('bun:sqlite' as string)) as unknown as BunSqliteModule;
const database = new sqlite.Database(databasePath, { readonly: true });
try {
  const queries =
    sourceFamily === 'diseases'
      ? diseaseQueries(database, sourceFamily)
      : mkbQueries(database, sourceFamily);
  const fixture: FullCorpusSearchFixture = {
    schemaVersion: 1,
    id: `minimed-${sourceFamily}-full-search-v1`,
    description:
      sourceFamily === 'diseases'
        ? 'Deterministic identity and section-intent regression queries across the diseases corpus.'
        : 'Deterministic MKB identity and disease-composition regression queries across the composed corpus.',
    sourceFamily,
    queries,
  };
  const validated = validateFullCorpusSearchFixture(fixture);
  writeFileSync(outputPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify({ outputPath, sourceFamily, queryCount: validated.queries.length }, null, 2),
  );
} finally {
  database.close();
}
