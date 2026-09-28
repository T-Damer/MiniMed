// Does a fresh install know every concept the app knows about? Mounts core.db alone (or core plus
// the two companions that ship inside the app bundle), samples real names/codes from every full
// source the app can reach (MKB, clinical recommendations, ESKLP/Allmed/GRLS medications,
// regulatory acts, the definition reference, reference packs, the tool catalog), and runs them
// through the app's ordinary lookup path (ScopedMedicalCore 'all', lexical, analysisMode lookup).
//
// Per stratum it reports: any result, the correct target in the top 5, an identity match in the
// top 5 (a result whose own title/alias equals the query), whether that correct result can
// actually be downloaded from the module catalog, and how many top-5 results are pointers to a
// module the catalog does not offer (dead ends). It also writes a per-category inventory
// (full source versus identities present in core.db). Read-only: no database is modified.
//
// bun tools/benchmarks/src/run-core-coverage.ts [--mount=core|shipped] [--core=<core.db>]
//   [--per-stratum=200] [--seed=20260928] [--report=data/build/core-coverage-report.json]
//   [--inventory-only]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';

import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { fuzzyQueryScore } from '../../../apps/app/src/state/fuzzy-text';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';

const ROOT = resolve(import.meta.dirname, '../../..');
const CONTENT = resolve(ROOT, 'apps/app/public/content');

// ---------------------------------------------------------------------------------------------
// Arguments

const args = process.argv.slice(2);
for (const arg of args) {
  if (
    !/^--(?:mount=(?:core|shipped)|core=.+|per-stratum=\d+|seed=\d+|report=.+|inventory-only)$/u.test(
      arg,
    )
  ) {
    throw new Error(`Unknown argument ${arg}`);
  }
}
const option = (key: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
const mount = (option('mount') ?? 'core') as 'core' | 'shipped';
const corePath = resolve(ROOT, option('core') ?? 'apps/app/public/content/core.db');
const perStratum = Number(option('per-stratum') ?? '200');
const seed = Number(option('seed') ?? '20260928');
const reportPath = resolve(
  ROOT,
  option('report') ?? `data/build/core-coverage-${mount}-report.json`,
);
const inventoryOnly = args.includes('--inventory-only');
if (!Number.isInteger(perStratum) || perStratum <= 0) throw new Error('--per-stratum must be > 0.');

// Optional local-only sources (gitignored data/build); a missing one skips its strata and is
// recorded as "not measured" rather than silently shrinking the population.
const SOURCES = {
  mkb: resolve(CONTENT, 'mkb.db'),
  medications: resolve(CONTENT, 'medications.db'),
  regulatory: resolve(CONTENT, 'regulatory.db'),
  reference: resolve(CONTENT, 'reference.db'),
  ambulatory: resolve(CONTENT, 'ambulatory.db'),
  catalog: resolve(ROOT, 'apps/app/src/features/modules/catalog.preview.json'),
  shell: resolve(ROOT, 'apps/app/src/features/modules/catalog.shell.json'),
  clinicalRegistry: resolve(ROOT, 'data/raw/official-clinical-registry/catalog.json'),
  esklpDir: resolve(ROOT, 'data/build/release-esklp'),
  grlsLedger: resolve(ROOT, 'data/build/official-grls-coverage-ledger.json'),
  definitionReference: resolve(
    ROOT,
    'data/build/definition-reference/2026.9.30/minimed.definition.reference.2026.9.30.db',
  ),
} as const;

// ---------------------------------------------------------------------------------------------
// SQLite (read-only) and normalization

type SqlValue = string | number | null;
interface ReadonlyDatabase {
  query(sql: string): { all(...parameters: SqlValue[]): unknown[] };
  close(): void;
}
interface BunSqlite {
  readonly Database: new (
    path: string,
    options: { readonly readonly: boolean },
  ) => ReadonlyDatabase;
}
const bunSqlite = (await import('bun:sqlite' as string)) as unknown as BunSqlite;

function withDatabase<T>(path: string, read: (database: ReadonlyDatabase) => T): T {
  const database = new bunSqlite.Database(path, { readonly: true });
  try {
    return read(database);
  } finally {
    database.close();
  }
}
function rows<T>(database: ReadonlyDatabase, sql: string, ...parameters: SqlValue[]): T[] {
  return database.query(sql).all(...parameters) as T[];
}

/** Identity comparison: case, ё, punctuation and spacing are not identity. */
function norm(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function normCode(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/\s+/gu, '');
}
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}
function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function parseMetadata(json: string): Readonly<Record<string, unknown>> {
  return record(JSON.parse(json));
}
const ICD_TITLE =
  /^([A-ZА-Я]\d{2}(?:\.\d{1,2})?(?:-[A-ZА-Я]\d{2}(?:\.\d{1,2})?)?)\s+(.+?)(?:,\s*МКБ-10)?$/u;

// ---------------------------------------------------------------------------------------------
// Deterministic sampling

function mulberry32(value: number): () => number {
  let state = value >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sample<T>(items: readonly T[], count: number, stratumId: string): T[] {
  // One independent, seeded stream per stratum so adding a stratum never reshuffles another.
  let hash = seed;
  for (const character of stratumId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const random = mulberry32(hash);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }
  return copy.slice(0, count);
}

// ---------------------------------------------------------------------------------------------
// Module catalog: can a pointer's target actually be downloaded?

interface CatalogArtifact {
  readonly id: string;
  readonly kind: string;
  readonly required: boolean;
  readonly url?: string | null;
  readonly sha256?: string | null;
}
interface CatalogModule {
  readonly id: string;
  readonly kind: string;
  readonly releaseState: string;
  readonly artifacts: readonly CatalogArtifact[];
  readonly documents: readonly {
    readonly documentId: string;
    readonly indexArtifactId: string;
    readonly title?: string;
  }[];
  readonly tools?: readonly { readonly id: string }[];
}
const catalog = JSON.parse(readFileSync(SOURCES.catalog, 'utf8')) as {
  readonly modules: readonly CatalogModule[];
};
if (!Array.isArray(catalog.modules)) throw new Error('catalog.preview.json has no modules array.');
const modulesById = new Map<string, CatalogModule>(
  catalog.modules.map((entry) => [entry.id, entry] as const),
);

type Resolution = 'local' | 'published' | 'preview' | 'dead-end';
/** Mirrors selectModuleForPointer/isModuleReleased (experimental modules on = preview allowed). */
function resolvePointer(metadata: Readonly<Record<string, unknown>>): Resolution {
  if (metadata['contentMode'] !== 'module-pointer') return 'local';
  const target = metadata['targetDocumentId'];
  const primary = metadata['primaryModuleId'];
  if (typeof target !== 'string' || typeof primary !== 'string') return 'dead-end';
  let best: Resolution = 'dead-end';
  for (const moduleId of new Set([primary, ...stringArray(metadata['moduleIds'])])) {
    const module = modulesById.get(moduleId);
    if (!module) continue;
    const reachable = module.documents.some(
      (document) =>
        document.documentId === target &&
        module.artifacts.some(
          (artifact) =>
            artifact.id === document.indexArtifactId &&
            artifact.kind === 'index' &&
            artifact.required &&
            Boolean(artifact.url && artifact.sha256),
        ),
    );
    if (!reachable) continue;
    if (module.releaseState === 'published') return 'published';
    if (module.releaseState === 'preview') best = 'preview';
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// The mounted corpus: identity surfaces and codes per document

const mountedPaths: readonly (readonly [string, string, number])[] = [
  ['minimed.core.ru', corePath, 1.1],
  ...(mount === 'shipped'
    ? ([
        // Built-in companions that ship inside the app bundle (vite keeps them; mkb/medications/
        // ambulatory are excluded as large companions). Weights mirror builtInCompanionMounts.
        ['minimed.regulatory.pediatrics.ru', SOURCES.regulatory, 1.12],
        ['minimed.reference.pediatrics.ru', SOURCES.reference, 1.08],
      ] as const)
    : []),
];
for (const [, path] of mountedPaths)
  if (!existsSync(path)) throw new Error(`Missing mounted database ${path}`);

interface MountedDocument {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly family: string;
  readonly resolution: Resolution;
  readonly identity: ReadonlySet<string>;
  readonly codes: ReadonlySet<string>;
}
const mounted = new Map<string, MountedDocument>();
/** Every identity surface in the mounted corpus → documents (for the inventory). */
const surfaceDocuments = new Map<string, Set<string>>();
const addSurface = (surface: string, documentId: string, into: Set<string>): void => {
  const key = norm(surface);
  if (!key) return;
  into.add(key);
  const documents = surfaceDocuments.get(key) ?? new Set<string>();
  documents.add(documentId);
  surfaceDocuments.set(key, documents);
};
let aliasRowsWithoutDocument = 0;
const aliasOnlySurfaces = new Set<string>();
const knowledgeNames = new Set<string>();
for (const [, path] of mountedPaths) {
  withDatabase(path, (database) => {
    const titleDocuments = new Map<string, Set<string>>();
    for (const row of rows<{
      id: string;
      title: string;
      short_title: string | null;
      metadata_json: string;
    }>(database, 'SELECT id, title, short_title, metadata_json FROM documents')) {
      const metadata = parseMetadata(row.metadata_json);
      const identity = new Set<string>();
      const surfaces = [
        row.title,
        row.short_title ?? '',
        ...stringArray(metadata['declaredAliases']),
        ...stringArray(metadata['navigationAliases']),
        ...(typeof metadata['standardizedInn'] === 'string' ? [metadata['standardizedInn']] : []),
      ];
      const icdTitle = ICD_TITLE.exec(row.title);
      if (icdTitle?.[2]) surfaces.push(icdTitle[2]);
      for (const surface of surfaces) addSurface(surface, row.id, identity);
      for (const surface of [row.title, metadata['standardizedInn']]) {
        if (typeof surface !== 'string') continue;
        const set = titleDocuments.get(norm(surface)) ?? new Set<string>();
        set.add(row.id);
        titleDocuments.set(norm(surface), set);
      }
      const codes = new Set<string>(
        [
          ...(typeof metadata['mkbCode'] === 'string' ? [metadata['mkbCode']] : []),
          ...stringArray(metadata['icd10Codes']),
        ].map(normCode),
      );
      const target = metadata['targetDocumentId'];
      mounted.set(row.id, {
        id: row.id,
        title: row.title,
        target: typeof target === 'string' ? target : row.id,
        family:
          typeof metadata['catalogFamily'] === 'string'
            ? `${metadata['catalogFamily']}${
                typeof metadata['sourceType'] === 'string' ? `:${metadata['sourceType']}` : ''
              }`
            : `local:${String(metadata['contentMode'] ?? 'document')}`,
        resolution: resolvePointer(metadata),
        identity,
        codes,
      });
    }
    // Alias rows have no document key; the search resolves canonical_term to documents at query
    // time. Attach an alias to every document whose title (or INN) equals its canonical term.
    for (const alias of rows<{ canonical_term: string; alias: string }>(
      database,
      'SELECT canonical_term, alias FROM aliases',
    )) {
      const documents = titleDocuments.get(norm(alias.canonical_term));
      if (!documents) {
        aliasRowsWithoutDocument += 1;
        aliasOnlySurfaces.add(norm(alias.alias));
        aliasOnlySurfaces.add(norm(alias.canonical_term));
        continue;
      }
      for (const documentId of documents) {
        const document = mounted.get(documentId);
        if (document) addSurface(alias.alias, documentId, document.identity as Set<string>);
      }
    }
    const hasKnowledge = rows<{ n: number }>(
      database,
      "SELECT count(*) AS n FROM sqlite_master WHERE name = 'knowledge_names'",
    )[0]?.n;
    if (hasKnowledge)
      for (const name of rows<{ name: string }>(database, 'SELECT name FROM knowledge_names'))
        knowledgeNames.add(norm(name.name));
  });
}
const inCoreIdentity = (surface: string): boolean => surfaceDocuments.has(norm(surface));
const coreTargets = new Set([...mounted.values()].map((document) => document.target));

// ---------------------------------------------------------------------------------------------
// Full sources → strata

interface Case {
  readonly query: string;
  readonly label: string;
  /** Document ids (or pointer targetDocumentIds) that count as the correct answer. */
  readonly targets: readonly string[];
  /** ICD codes: a result carrying this code counts as correct. */
  readonly codes: readonly string[];
  /** Identity fallback: a result whose own identity surfaces include the query. */
  readonly identity: boolean;
  /** Tool catalog id, for the client-side tool card check. */
  readonly toolId?: string;
}
interface Stratum {
  readonly id: string;
  readonly category: string;
  readonly source: string;
  readonly population: number;
  readonly cases: readonly Case[];
}
const strata: Stratum[] = [];
const notMeasured: string[] = [];
interface InventoryRow {
  readonly category: string;
  readonly entity: string;
  readonly source: string;
  readonly total: number;
  readonly inCore: number;
  readonly missing: number;
  readonly note: string;
  readonly missingExamples: readonly string[];
}
const inventory: InventoryRow[] = [];
function inventoryRow(
  category: string,
  entity: string,
  source: string,
  items: readonly { readonly name: string; readonly inCore: boolean }[],
  note = '',
): void {
  const missing = items.filter((item) => !item.inCore);
  inventory.push({
    category,
    entity,
    source,
    total: items.length,
    inCore: items.length - missing.length,
    missing: missing.length,
    note,
    missingExamples: sample(missing, 6, `inventory:${entity}`).map((item) => item.name),
  });
}
function addStratum(
  id: string,
  category: string,
  source: string,
  population: readonly Case[],
): void {
  const unique = new Map<string, Case>();
  for (const item of population) {
    const key = norm(item.query);
    if (key && !unique.has(key)) unique.set(key, item);
  }
  const all = [...unique.values()];
  strata.push({
    id,
    category,
    source,
    population: all.length,
    cases: sample(all, perStratum, id),
  });
}

// ICD-10 (RLS MKB companion)
if (existsSync(SOURCES.mkb)) {
  const nodes = withDatabase(SOURCES.mkb, (database) =>
    rows<{ id: string; title: string; metadata_json: string }>(
      database,
      "SELECT id, title, metadata_json FROM documents WHERE source_type = 'rls_mkb_reference'",
    ),
  ).map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    const code = typeof metadata['mkbCode'] === 'string' ? normCode(metadata['mkbCode']) : '';
    return { id: row.id, code, name: ICD_TITLE.exec(row.title)?.[2] ?? row.title };
  });
  const kinds = [
    [
      'icd.category',
      'three-character categories (J18)',
      (code: string) => /^[A-Z]\d{2}$/u.test(code),
    ],
    ['icd.subcategory', 'four-character codes (J18.9)', (code: string) => code.includes('.')],
    ['icd.block', 'blocks/ranges (J09-J18)', (code: string) => code.includes('-')],
  ] as const;
  const codeSet = new Set([...mounted.values()].flatMap((document) => [...document.codes]));
  for (const [entity, label, match] of kinds) {
    const items = nodes.filter((node) => match(node.code));
    inventoryRow(
      'ICD-10',
      label,
      'mkb.db (RLS MKB, local-dev companion)',
      items.map((node) => ({
        name: `${node.code} ${node.name}`,
        inCore: coreTargets.has(node.id) && codeSet.has(node.code),
      })),
      `${entity}: pointer by targetDocumentId and code in mkbCode/icd10Codes`,
    );
  }
  const icdCase = (node: (typeof nodes)[number], query: string): Case => ({
    query,
    label: `${node.code} ${node.name}`,
    targets: [node.id],
    codes: [node.code],
    identity: false,
  });
  const subcodes = nodes.filter((node) => node.code.includes('.'));
  addStratum(
    'icd.code-dotted',
    'ICD-10',
    'mkb.db',
    subcodes.map((node) => icdCase(node, node.code)),
  );
  addStratum(
    'icd.code-no-dot',
    'ICD-10',
    'mkb.db',
    subcodes.map((node) => icdCase(node, node.code.replace('.', ''))),
  );
  addStratum(
    'icd.code-lowercase',
    'ICD-10',
    'mkb.db',
    subcodes.map((node) => icdCase(node, node.code.toLowerCase())),
  );
  addStratum(
    'icd.category',
    'ICD-10',
    'mkb.db',
    nodes.filter((node) => /^[A-Z]\d{2}$/u.test(node.code)).map((node) => icdCase(node, node.code)),
  );
  addStratum(
    'icd.block',
    'ICD-10',
    'mkb.db',
    nodes.filter((node) => node.code.includes('-')).map((node) => icdCase(node, node.code)),
  );
  addStratum(
    'icd.title',
    'ICD-10',
    'mkb.db',
    nodes.map((node) => ({ ...icdCase(node, node.name), identity: true })),
  );
} else notMeasured.push('ICD-10: apps/app/public/content/mkb.db missing');

// Clinical recommendations (official registry snapshot; falls back to the module catalog)
{
  interface KrRecord {
    readonly id: string;
    readonly name: string;
    readonly mkb10: readonly string[];
  }
  const registry: KrRecord[] = existsSync(SOURCES.clinicalRegistry)
    ? (
        JSON.parse(readFileSync(SOURCES.clinicalRegistry, 'utf8')) as {
          readonly records: readonly { id: string; name: string; mkb10?: unknown }[];
        }
      ).records.map((item) => ({ id: item.id, name: item.name, mkb10: stringArray(item.mkb10) }))
    : catalog.modules
        .filter((module) => module.id.startsWith('minimed.clinical.recommendation.'))
        .map((module) => ({
          id: module.id.slice('minimed.clinical.recommendation.'.length),
          name: module.documents[0]?.title ?? module.id,
          mkb10: [],
        }));
  const catalogKr = new Set(
    catalog.modules
      .filter((module) => module.kind === 'clinical')
      .flatMap((module: CatalogModule) => module.documents.map((entry) => entry.documentId)),
  );
  inventoryRow(
    'Clinical recommendations',
    'active KR (cr.minzdrav.gov.ru snapshot)',
    existsSync(SOURCES.clinicalRegistry)
      ? 'data/raw/official-clinical-registry/catalog.json'
      : 'catalog.preview.json',
    registry.map((item) => ({
      name: `${item.id} ${item.name}`,
      inCore: coreTargets.has(`kr.rf.${item.id}`),
    })),
    `downloadable in catalog: ${registry.filter((item) => catalogKr.has(`kr.rf.${item.id}`)).length}`,
  );
  addStratum(
    'kr.title',
    'Clinical recommendations',
    'registry',
    registry.map((item) => ({
      query: item.name,
      label: item.id,
      targets: [`kr.rf.${item.id}`],
      codes: [],
      identity: false,
    })),
  );
  addStratum(
    'kr.by-icd-code',
    'Clinical recommendations',
    'registry (first MKB code of each KR)',
    registry
      .filter((item) => item.mkb10.length > 0)
      .map((item) => ({
        query: item.mkb10[0] ?? '',
        label: `${item.id} ${item.name}`,
        targets: [`kr.rf.${item.id}`],
        codes: [],
        identity: false,
      })),
  );
}

// Medications
{
  const esklpFiles = existsSync(SOURCES.esklpDir)
    ? readdirSync(SOURCES.esklpDir).filter((file) => file.endsWith('.db'))
    : [];
  const inn = new Map<string, string>();
  const tradeNames = new Map<string, Set<string>>();
  if (esklpFiles.length > 0) {
    for (const file of esklpFiles) {
      withDatabase(resolve(SOURCES.esklpDir, file), (database) => {
        for (const row of rows<{ id: string; title: string; metadata_json: string }>(
          database,
          'SELECT id, title, metadata_json FROM documents',
        )) {
          inn.set(row.id, row.title);
          const metadata = parseMetadata(row.metadata_json);
          const nodes = Array.isArray(metadata['smnnNodes']) ? metadata['smnnNodes'] : [];
          for (const node of nodes)
            for (const trade of Array.isArray(record(node)['tradeNames'])
              ? (record(node)['tradeNames'] as unknown[])
              : []) {
              const name = record(trade)['tradeName'];
              if (typeof name !== 'string' || !name.trim() || name.trim() === '~') continue;
              const set = tradeNames.get(name.trim()) ?? new Set<string>();
              set.add(row.id);
              tradeNames.set(name.trim(), set);
            }
        }
      });
    }
  } else {
    notMeasured.push('ESKLP trade names: data/build/release-esklp missing (INN from catalog only)');
    for (const module of catalog.modules.filter((item) => item.kind === 'medication'))
      for (const document of module.documents)
        if (document.title) inn.set(document.documentId, document.title);
  }
  inventoryRow(
    'Medications',
    'INN (ESKLP MNN)',
    esklpFiles.length > 0 ? 'data/build/release-esklp (15 modules)' : 'catalog.preview.json',
    [...inn].map(([id, title]) => ({ name: title, inCore: coreTargets.has(id) })),
  );
  addStratum(
    'med.inn',
    'Medications',
    'ESKLP MNN',
    [...inn].map(([id, title]) => ({
      query: title.toLocaleLowerCase('ru-RU'),
      label: title,
      targets: [id],
      codes: [],
      identity: false,
    })),
  );
  if (tradeNames.size > 0) {
    inventoryRow(
      'Medications',
      'trade names (ESKLP)',
      'data/build/release-esklp',
      [...tradeNames].map(([name]) => ({ name, inCore: inCoreIdentity(name) })),
    );
    addStratum(
      'med.trade-esklp',
      'Medications',
      'ESKLP trade names',
      [...tradeNames].map(([name, ids]) => ({
        query: name,
        label: name,
        targets: [...ids],
        codes: [],
        identity: true,
      })),
    );
  }
  if (existsSync(SOURCES.medications)) {
    const allmed = withDatabase(SOURCES.medications, (database) =>
      rows<{ id: string; title: string; metadata_json: string }>(
        database,
        'SELECT id, title, metadata_json FROM documents',
      ),
    ).map((row) => {
      const linked = parseMetadata(row.metadata_json)['linkedMnnDocumentId'];
      return { id: row.id, title: row.title, linked: typeof linked === 'string' ? linked : null };
    });
    inventoryRow(
      'Medications',
      'Allmed drug cards (trade/INN titles)',
      'medications.db (Allmed snapshot)',
      allmed.map((item) => ({
        name: item.title,
        inCore:
          inCoreIdentity(item.title) || (item.linked !== null && coreTargets.has(item.linked)),
      })),
      `linkedMnnDocumentId present: ${allmed.filter((item) => item.linked).length}`,
    );
    addStratum(
      'med.allmed-title',
      'Medications',
      'medications.db',
      allmed.map((item) => ({
        query: item.title,
        label: item.id,
        targets: item.linked ? [item.linked, item.id] : [item.id],
        codes: [],
        identity: true,
      })),
    );
  } else notMeasured.push('Allmed: apps/app/public/content/medications.db missing');
  if (existsSync(SOURCES.grlsLedger)) {
    const ledger = JSON.parse(readFileSync(SOURCES.grlsLedger, 'utf8')) as {
      readonly records: readonly { tradeName?: unknown; inn?: unknown; status?: unknown }[];
    };
    const innIds = new Map<string, string[]>();
    for (const [id, title] of inn)
      innIds.set(norm(title), [...(innIds.get(norm(title)) ?? []), id]);
    const products = new Map<string, { name: string; targets: Set<string>; active: boolean }>();
    for (const item of ledger.records) {
      if (typeof item.tradeName !== 'string') continue;
      const name = item.tradeName.replace(/\s*\(.*$/u, '').trim();
      if (!name || name === '~') continue;
      const entry = products.get(norm(name)) ?? { name, targets: new Set<string>(), active: false };
      for (const value of stringArray(item.inn))
        for (const id of innIds.get(norm(value)) ?? []) entry.targets.add(id);
      entry.active ||= item.status === 'active';
      products.set(norm(name), entry);
    }
    const active = [...products.values()].filter((item) => item.active);
    inventoryRow(
      'Medications',
      'GRLS trade names (active registrations)',
      'data/build/official-grls-coverage-ledger.json',
      active.map((item) => ({ name: item.name, inCore: inCoreIdentity(item.name) })),
      `all statuses: ${products.size}; with an INN that has an ESKLP pointer: ${
        active.filter((item) => item.targets.size > 0).length
      }`,
    );
    addStratum(
      'med.trade-grls',
      'Medications',
      'GRLS ledger (active)',
      active.map((item) => ({
        query: item.name,
        label: item.name,
        targets: [...item.targets],
        codes: [],
        identity: true,
      })),
    );
  } else
    notMeasured.push('GRLS trade names: data/build/official-grls-coverage-ledger.json missing');
}

// Normative acts
if (existsSync(SOURCES.regulatory)) {
  const acts = withDatabase(SOURCES.regulatory, (database) =>
    rows<{ id: string; title: string; short_title: string | null; metadata_json: string }>(
      database,
      'SELECT id, title, short_title, metadata_json FROM documents',
    ),
  ).map((row) => {
    const metadata = parseMetadata(row.metadata_json);
    const kind = typeof metadata['documentKind'] === 'string' ? metadata['documentKind'] : '';
    const number = typeof metadata['documentNumber'] === 'string' ? metadata['documentNumber'] : '';
    return { ...row, kind, number };
  });
  const catalogRegulatory = new Set(
    catalog.modules
      .filter((module) => module.kind === 'regulatory')
      .flatMap((module: CatalogModule) => module.documents.map((entry) => entry.documentId)),
  );
  inventoryRow(
    'Normative acts',
    'regulatory acts (pediatric pilot)',
    'regulatory.db (ships in the app bundle)',
    acts.map((act) => ({
      name: act.title,
      inCore: coreTargets.has(act.id) || inCoreIdentity(act.title),
    })),
    `downloadable in catalog: ${acts.filter((act) => catalogRegulatory.has(act.id)).length}`,
  );
  const actCase = (act: (typeof acts)[number], query: string): Case => ({
    query,
    label: act.title,
    targets: [act.id],
    codes: [],
    identity: false,
  });
  addStratum(
    'reg.title',
    'Normative acts',
    'regulatory.db',
    acts.map((act) => actCase(act, act.title)),
  );
  addStratum(
    'reg.short-title',
    'Normative acts',
    'regulatory.db',
    acts.filter((act) => act.short_title).map((act) => actCase(act, act.short_title ?? '')),
  );
  addStratum(
    'reg.number',
    'Normative acts',
    'regulatory.db',
    acts
      .filter((act) => act.number)
      .map((act) =>
        actCase(
          act,
          act.kind === 'федеральный закон' ? act.number : `${act.kind} ${act.number}`.trim(),
        ),
      ),
  );
} else notMeasured.push('Normative acts: apps/app/public/content/regulatory.db missing');

// Terms, abbreviations and scale names (definition reference edition)
if (existsSync(SOURCES.definitionReference)) {
  const entries = withDatabase(SOURCES.definitionReference, (database) =>
    rows<{ id: string; entity_type: string; canonical_name: string }>(
      database,
      `SELECT e.id, e.entity_type, e.canonical_name FROM definition_reference_entity_keys k
       JOIN knowledge_entities e ON e.id = k.entity_id`,
    ),
  );
  const family = (id: string) => id.slice(0, id.indexOf('.') + 1);
  const groups: readonly (readonly [
    string,
    string,
    string,
    (entry: (typeof entries)[number]) => boolean,
  ])[] = [
    [
      'term.glossary',
      'Terms and definitions',
      'glossary/definition terms (KR glossaries, prepared, journals)',
      (entry) =>
        ['clinical-glossary.', 'prepared.', 'journal.', 'medical.', 'draft.'].includes(
          family(entry.id),
        ) && !['scale', 'tool', 'law'].includes(entry.entity_type),
    ],
    [
      'term.abbreviation',
      'Terms and definitions',
      'abbreviations (KR abbreviation lists)',
      (entry) => family(entry.id) === 'clinical-abbrev.',
    ],
    [
      'term.wiktionary',
      'Terms and definitions',
      'Wiktionary glosses',
      (entry) => family(entry.id) === 'ruwikt.',
    ],
    [
      'term.wikipedia-name',
      'Terms and definitions',
      'archived Wikipedia names (needs-definition)',
      (entry) => family(entry.id) === 'ruwiki.',
    ],
    [
      'scale.definition-name',
      'Scales and questionnaires',
      'scale/tool names in the definition reference',
      (entry) => ['scale', 'tool'].includes(entry.entity_type),
    ],
    [
      'law.definition-name',
      'Normative acts',
      'law names in the definition reference',
      (entry) => entry.entity_type === 'law',
    ],
  ];
  for (const [id, category, label, match] of groups) {
    const items = entries.filter(match);
    inventoryRow(
      category,
      label,
      'definition reference 2026.9.30 (preview module)',
      items.map((entry) => ({
        name: entry.canonical_name,
        inCore: inCoreIdentity(entry.canonical_name),
      })),
      `identity only (no pointer track); also in core knowledge_names: ${
        items.filter(
          (entry) =>
            !inCoreIdentity(entry.canonical_name) && knowledgeNames.has(norm(entry.canonical_name)),
        ).length
      } of the missing`,
    );
    addStratum(
      id,
      category,
      'definition reference',
      items.map((entry) => ({
        query: entry.canonical_name,
        label: entry.id,
        targets: [],
        codes: [],
        identity: true,
      })),
    );
  }
} else notMeasured.push('Definition reference: data/build/definition-reference/2026.9.30 missing');

// Reference packs (pediatric norms, ambulatory)
for (const [key, label, shipped] of [
  ['reference', 'reference.db (pediatric reference, ships in the bundle)', true],
  ['ambulatory', 'ambulatory.db (local-dev companion)', false],
] as const) {
  const path = SOURCES[key];
  if (!existsSync(path)) {
    notMeasured.push(`${key}.db missing`);
    continue;
  }
  const documents = withDatabase(path, (database) =>
    rows<{ id: string; title: string }>(database, 'SELECT id, title FROM documents'),
  );
  inventoryRow(
    'Reference material',
    label,
    `${key}.db`,
    documents.map((document) => ({
      name: document.title,
      inCore: coreTargets.has(document.id) || inCoreIdentity(document.title),
    })),
    shipped ? 'mounted by the app bundle (not a core pointer)' : 'not shipped',
  );
  addStratum(
    `ref.${key}-title`,
    'Reference material',
    `${key}.db`,
    documents.map((document) => ({
      query: document.title,
      label: document.id,
      targets: [document.id],
      codes: [],
      identity: false,
    })),
  );
}

// Tools: assessments and calculators from the bundled tool catalog (client-side, no core needed)
interface ShellTool {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly aliases: readonly string[];
  readonly description?: string;
}
const tools = (
  JSON.parse(readFileSync(SOURCES.shell, 'utf8')) as {
    readonly tools: readonly { readonly tool: ShellTool }[];
  }
).tools.map((entry) => entry.tool);
for (const [kind, category] of [
  ['assessment', 'Scales and questionnaires'],
  ['calculator', 'Calculators'],
] as const) {
  const items = tools.filter((tool) => tool.kind === kind);
  inventoryRow(
    category,
    `${kind}s (tool catalog)`,
    'catalog.shell.json',
    items.map((tool) => ({
      name: tool.title,
      inCore: [tool.title, tool.shortTitle, ...tool.aliases].some(inCoreIdentity),
    })),
    'client-side catalog: 100% searchable without core (matchingCatalogTools)',
  );
  const toolCase = (tool: ShellTool, query: string): Case => ({
    query,
    label: tool.title,
    targets: [],
    codes: [],
    identity: true,
    toolId: tool.id,
  });
  addStratum(
    `tool.${kind}-title`,
    category,
    'catalog.shell.json',
    items.map((tool) => toolCase(tool, tool.title)),
  );
  addStratum(
    `tool.${kind}-alias`,
    category,
    'catalog.shell.json (short titles and aliases)',
    items.flatMap((tool) =>
      [tool.shortTitle, ...tool.aliases].map((alias) => toolCase(tool, alias)),
    ),
  );
}

// Pointer reachability inventory
const pointerStates = new Map<string, Map<Resolution, number>>();
for (const document of mounted.values()) {
  const states = pointerStates.get(document.family) ?? new Map<Resolution, number>();
  states.set(document.resolution, (states.get(document.resolution) ?? 0) + 1);
  pointerStates.set(document.family, states);
}

// ---------------------------------------------------------------------------------------------
// Search

function clientToolRank(query: string): readonly string[] {
  return tools
    .map((tool, index) => ({
      id: tool.id,
      index,
      score: fuzzyQueryScore(query, [
        tool.title,
        tool.description ?? '',
        tool.shortTitle,
        ...tool.aliases,
      ]),
    }))
    .filter((item) => item.score > 0)
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.id);
}

interface Row {
  readonly stratum: string;
  readonly query: string;
  readonly label: string;
  readonly resultCount: number;
  readonly rejectedNoSearchableTerms: boolean;
  readonly targetRank: number | null;
  readonly identityAt5: boolean;
  readonly correctAt5: boolean;
  readonly correctActionableAt5: boolean;
  readonly deadEndInTop5: number;
  readonly top1DeadEnd: boolean;
  readonly clientToolAt5: boolean | null;
  readonly top5: readonly { id: string; family: string; resolution: Resolution }[];
}
const resultRows: Row[] = [];
let elapsedMs = 0;
if (!inventoryOnly) {
  const store = new MultiMedicalStore(
    await Promise.all(
      mountedPaths.map(async ([moduleId, path, searchWeight]) => ({
        moduleId,
        store: await createBunFileMedicalStore(path),
        required: true,
        searchWeight,
      })),
    ),
  );
  const core = createMedicalCore({ store, platform: 'test' });
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  const scoped = new ScopedMedicalCore(core, 'all');
  const started = performance.now();
  const total = strata.reduce((sum, stratum) => sum + stratum.cases.length, 0);
  for (const stratum of strata) {
    for (const item of stratum.cases) {
      const response = await scoped.search({
        query: item.query,
        mode: 'lexical',
        analysisMode: 'lookup',
        filters: {},
        limit: 20,
        includeSuggestions: false,
      });
      // A query made only of stopwords/too-short tokens («НА», «В») is rejected by the core before
      // retrieval: the app shows nothing for it, so it is recorded as a zero-result row with its
      // reason. Any other error still aborts the run.
      const rejected =
        !response.ok &&
        response.error.code === 'INVALID_REQUEST' &&
        response.error.message === 'Search query has no searchable terms.';
      if (!response.ok && !rejected)
        throw new Error(`${stratum.id} «${item.query}»: ${response.error.message}`);
      const groups = response.ok ? response.value.groups : [];
      const documents = groups.map((group) => {
        const document = mounted.get(group.documentId);
        if (!document) throw new Error(`Result ${group.documentId} is not in the mounted corpus.`);
        return document;
      });
      const targets = new Set(item.targets);
      const codes = new Set(item.codes.map(normCode));
      const query = norm(item.query);
      const identityMatch = (document: MountedDocument) => document.identity.has(query);
      const correct = (document: MountedDocument) =>
        targets.has(document.target) ||
        targets.has(document.id) ||
        [...codes].some((code) => document.codes.has(code)) ||
        (item.identity && identityMatch(document));
      const top5 = documents.slice(0, 5);
      const rank = documents.findIndex(correct);
      const clientRank = item.toolId ? clientToolRank(item.query).indexOf(item.toolId) : null;
      resultRows.push({
        stratum: stratum.id,
        query: item.query,
        label: item.label,
        resultCount: documents.length,
        rejectedNoSearchableTerms: rejected,
        targetRank: rank >= 0 ? rank + 1 : null,
        identityAt5: top5.some(identityMatch),
        correctAt5: top5.some(correct),
        correctActionableAt5: top5.some(
          (document) => correct(document) && document.resolution !== 'dead-end',
        ),
        deadEndInTop5: top5.filter((document) => document.resolution === 'dead-end').length,
        top1DeadEnd: top5[0]?.resolution === 'dead-end',
        clientToolAt5: clientRank === null ? null : clientRank >= 0 && clientRank < 5,
        top5: top5.map((document) => ({
          id: document.id,
          family: document.family,
          resolution: document.resolution,
        })),
      });
      if (resultRows.length % 250 === 0)
        console.error(
          `${resultRows.length}/${total} queries, ${Math.round(performance.now() - started)} ms`,
        );
    }
  }
  elapsedMs = performance.now() - started;
  await core.close();
}

// ---------------------------------------------------------------------------------------------
// Report

const rate = (values: readonly boolean[]) =>
  values.length === 0 ? null : Number((values.filter(Boolean).length / values.length).toFixed(4));
const summarize = (items: readonly Row[]) => ({
  sampled: items.length,
  anyResult: rate(items.map((row) => row.resultCount > 0)),
  rejectedNoSearchableTerms: items.filter((row) => row.rejectedNoSearchableTerms).length,
  correctAt5: rate(items.map((row) => row.correctAt5)),
  correctActionableAt5: rate(items.map((row) => row.correctActionableAt5)),
  identityAt5: rate(items.map((row) => row.identityAt5)),
  deadEndQueries: rate(items.map((row) => row.deadEndInTop5 > 0)),
  top1DeadEnd: rate(items.map((row) => row.top1DeadEnd)),
  deadEndShareOfTop5: (() => {
    const shown = items.reduce((sum, row) => sum + row.top5.length, 0);
    return shown === 0
      ? null
      : Number((items.reduce((sum, row) => sum + row.deadEndInTop5, 0) / shown).toFixed(4));
  })(),
  clientToolAt5: rate(
    items.flatMap((row) => (row.clientToolAt5 === null ? [] : [row.clientToolAt5])),
  ),
});
const strataSummary = strata.map((stratum) => ({
  id: stratum.id,
  category: stratum.category,
  source: stratum.source,
  population: stratum.population,
  ...summarize(resultRows.filter((row) => row.stratum === stratum.id)),
}));
const categories = [...new Set(strata.map((stratum) => stratum.category))].map((category) => ({
  category,
  ...summarize(
    resultRows.filter(
      (row) => strata.find((stratum) => stratum.id === row.stratum)?.category === category,
    ),
  ),
}));
const report = {
  schemaVersion: 1,
  dataset: 'minimed-core-coverage',
  generatedAt: new Date().toISOString(),
  method: {
    mount,
    corePath,
    mountedDatabases: mountedPaths.map(([moduleId, path]) => ({ moduleId, path })),
    searchPath: "ScopedMedicalCore('all') → lexical, analysisMode lookup, limit 20",
    perStratum,
    seed,
    correct:
      'result target (pointer targetDocumentId or document id) equals the source id, or a result carries the queried ICD code, or (identity strata) a result title/short title/declared/navigation alias/alias-table alias equals the normalized query',
    deadEnd:
      'module-pointer whose target is not in any catalog module (moduleIds ∪ primaryModuleId) with a downloadable required index artifact and releaseState published|preview',
    notMeasured,
  },
  aliasRowsWithoutDocument,
  aliasOnlySurfaceCount: aliasOnlySurfaces.size,
  pointerReachability: Object.fromEntries(
    [...pointerStates].map(([family, states]) => [family, Object.fromEntries(states)]),
  ),
  inventory,
  categories,
  strata: strataSummary,
  elapsedMs: Math.round(elapsedMs),
  rows: resultRows,
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      reportPath,
      mount,
      notMeasured,
      pointerReachability: report.pointerReachability,
      inventory: inventory.map(({ missingExamples: _examples, ...row }) => row),
      categories,
      strata: strataSummary,
      elapsedMs: report.elapsedMs,
    },
    null,
    2,
  ),
);
