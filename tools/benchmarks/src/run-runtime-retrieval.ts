/** Runtime retrieval, without an LLM or the prototype's custom scorer/vector index. */
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { ContentModuleCatalogSchema, type MedicalDocumentSummary } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import { MultiMedicalStore } from '@localmed/storage';
import { ScopedMedicalCore } from '../../../apps/app/src/features/search/ScopedMedicalCore';
import { createBunFileMedicalStore } from './bun-sqlite-medical-store';
import {
  type BenchmarkCase,
  type Candidate,
  type CoreDocument,
  createCases,
} from './rag-benchmark-fixtures';
import { RUNTIME_RETRIEVAL_CASES, type RuntimeRetrievalCase } from './runtime-retrieval-cases';
import {
  type RuntimeRetrievalEvaluation,
  runtimeRetrievalPassed,
  summarizeRuntimeRetrieval,
} from './runtime-retrieval-scoring';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const option = (key: string) =>
  args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
for (const arg of args)
  if (!/^--(?:core|pack|report|fixtures|case-prefix|edition)=.+/u.test(arg))
    throw new Error(`Unknown argument ${arg}`);
const corePath = resolve(option('core') ?? resolve(root, 'apps/app/public/content/core.db'));
const packs = args.filter((arg) => arg.startsWith('--pack=')).map((arg) => resolve(arg.slice(7)));
const fixtureMode = option('fixtures') ?? 'contracts';
const casePrefix = option('case-prefix');
const editionFilter = option('edition');
if (editionFilter && !['core-only', 'installed'].includes(editionFilter))
  throw new Error('--edition must be core-only or installed');
if (editionFilter === 'installed' && !packs.length)
  throw new Error('--edition=installed requires at least one --pack');
const fixtureIndexPath = resolve(root, 'data/build/rag-prototype-500.sqlite');
if (fixtureMode !== 'contracts' && fixtureMode !== 'rag500')
  throw new Error('--fixtures must be contracts or rag500');
const catalog = ContentModuleCatalogSchema.parse(
  JSON.parse(
    readFileSync(resolve(root, 'apps/app/src/features/modules/catalog.preview.json'), 'utf8'),
  ),
);

function strings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

async function sameRagCases(documents: readonly MedicalDocumentSummary[]) {
  // Reuse only the frozen corpus selection from the research index, never its vectors or ranking.
  const sqlite = (await import('bun:sqlite' as string)) as {
    Database: new (
      path: string,
      options: { readonly: boolean },
    ) => { query(sql: string): { all(): unknown[] }; close(): void };
  };
  const index = new sqlite.Database(fixtureIndexPath, {
    readonly: true,
  });
  const candidates: Candidate[] = [];
  try {
    for (const value of index
      .query('SELECT id, document_id, content_pack_id, title, section_path, text FROM rag_chunks')
      .all()) {
      if (!value || typeof value !== 'object') throw new Error('Invalid fixture candidate');
      const row = value as Record<string, unknown>;
      const text = (key: string): string => {
        const field = row[key];
        if (typeof field !== 'string') throw new Error(`Missing ${key}`);
        return field;
      };
      const documentId = text('document_id');
      const kind = documentId.startsWith('tool:')
        ? 'tool'
        : documentId.startsWith('patient:')
          ? 'patient'
          : documentId.startsWith('note:')
            ? 'personal-note'
            : documentId.startsWith('core.catalog.pointer.medication.')
              ? 'medication'
              : documentId.startsWith('core.catalog.pointer.clinical.') ||
                  documentId.startsWith('kr.rf.') ||
                  text('content_pack_id').includes('clinical')
                ? 'clinical'
                : 'document';
      candidates.push({
        id: text('id'),
        documentId,
        title: text('title'),
        sectionPath: text('section_path'),
        text: text('text'),
        kind,
      });
    }
  } finally {
    index.close();
  }
  const pointers: CoreDocument[] = documents.flatMap((document) => {
    if (document.sourceType !== 'core_catalog_pointer') return [];
    const family = document.metadata?.['catalogFamily'];
    const targetDocumentId = document.metadata?.['targetDocumentId'];
    if (family !== 'medication' && family !== 'clinical') return [];
    return [
      {
        id: document.id,
        title: document.title,
        aliases: strings(document.metadata?.['declaredAliases']),
        keywords: strings(document.metadata?.['keywords']),
        family,
        ...(typeof targetDocumentId === 'string' ? { targetDocumentId } : {}),
      },
    ];
  });
  return createCases(
    pointers.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    candidates,
  );
}

interface DownloadTarget {
  readonly pointerId: string;
  readonly targetId: string;
  readonly moduleId: string | null;
  readonly installed: boolean;
  readonly verified: boolean;
}

const rows: (RuntimeRetrievalEvaluation & {
  edition: string;
  id: string;
  query: string;
  rank: number | null;
  checks: Record<string, boolean>;
  downloadTargets: DownloadTarget[];
  expectedTargets: readonly string[];
  retrievedTargets: readonly string[];
})[] = [];
let excluded: { id: string; reason: string }[] = [];
let ragFixtures: readonly BenchmarkCase[] | undefined;
for (const edition of editionFilter
  ? [editionFilter]
  : packs.length
    ? ['core-only', 'installed']
    : ['core-only']) {
  const paths = [corePath, ...(edition === 'installed' ? packs : [])];
  const core = createMedicalCore({
    store: new MultiMedicalStore(
      await Promise.all(
        paths.map(async (path, i) => {
          return {
            moduleId: `${i}:${basename(path)}`,
            store: await createBunFileMedicalStore(path),
            required: true,
            searchWeight: i === 0 ? 1.1 : 1,
          };
        }),
      ),
    ),
    platform: 'test',
  });
  try {
    const initialized = await core.initialize();
    if (!initialized.ok) throw new Error(initialized.error.message);
    const listed = await core.listDocuments();
    if (!listed.ok) throw new Error(listed.error.message);
    const documents = new Map(listed.value.map((document) => [document.id, document]));
    const identity = (id: string): string => {
      const target = documents.get(id)?.metadata?.['targetDocumentId'];
      return typeof target === 'string' ? target : id;
    };
    let cases: readonly RuntimeRetrievalCase[] = RUNTIME_RETRIEVAL_CASES;
    if (fixtureMode === 'rag500') {
      ragFixtures ??= await sameRagCases(listed.value);
      const fixtures = ragFixtures;
      excluded = fixtures
        .filter((fixture) => ['tool', 'patient', 'personal-note'].includes(fixture.category))
        .map((fixture) => ({
          id: fixture.id,
          reason: 'Separate application surface; not the official MedicalCore corpus.',
        }));
      cases = fixtures
        .filter((fixture) => !excluded.some((item) => item.id === fixture.id))
        .map((fixture) => ({
          id: fixture.id,
          query: fixture.query,
          scope: fixture.category === 'medication' ? 'medications' : 'all',
          expectedTargets: fixture.expectedDocumentIds,
        }));
    }
    const selectedCases = cases.filter(
      (fixture) => !casePrefix || fixture.id.startsWith(casePrefix),
    );
    if (!selectedCases.length) throw new Error('No fixtures match --case-prefix.');
    for (const fixture of selectedCases) {
      console.log(`[runtime] ${edition}: ${fixture.id}`);
      const scoped = new ScopedMedicalCore(core, fixture.scope);
      const result = await scoped.search({
        query: fixture.query,
        mode: 'auto',
        filters: {},
        limit: 20,
        includeSuggestions: true,
      });
      if (!result.ok) throw new Error(`${fixture.id}: ${result.error.message}`);
      const groups = result.value.groups.slice(0, 5);
      const expected = fixture.expectedTargets?.map(identity);
      const expectedLocal = expected?.some((id) => documents.has(id)) ?? false;
      const expectedDiscovery =
        expected?.some((id) =>
          listed.value.some(
            (document) =>
              document.sourceType === 'core_catalog_pointer' && identity(document.id) === id,
          ),
        ) ?? false;
      const coverage = expectedLocal ? 'local' : expectedDiscovery ? 'discovery' : 'absent';
      const matched = groups.find((group) => expected?.includes(identity(group.documentId)));
      const rank = matched ? groups.indexOf(matched) + 1 : null;
      const checks: Record<string, boolean> = {};
      if (expected) checks['recall@5'] = rank !== null;
      if (fixture.forbiddenTargets)
        checks['forbiddenTargetsAbsent'] = groups.every(
          (group) => !fixture.forbiddenTargets?.includes(identity(group.documentId)),
        );
      if (fixture.expectedIcdCode)
        checks['icdCode'] = groups.some((group) =>
          strings(documents.get(group.documentId)?.metadata?.['icd10Codes']).some(
            (code) =>
              code === fixture.expectedIcdCode || code.startsWith(`${fixture.expectedIcdCode}.`),
          ),
        );
      if (fixture.negatedTerm)
        checks['negation'] = result.value.analysis.facts.some(
          (fact) =>
            fact.polarity === 'negative' &&
            fact.normalizedValue.includes(fixture.negatedTerm ?? ''),
        );
      const downloadTargets: DownloadTarget[] = [];
      const excerpts: string[] = [];
      checks['exactContext'] = true;
      for (const group of groups) {
        for (const hit of group.results) {
          const context = await scoped.getSearchResultContext(hit, 0);
          const chunk = context.ok
            ? context.value.chunks.find((item) => item.id === hit.chunkId)
            : undefined;
          checks['exactContext'] &&= Boolean(
            chunk &&
              chunk.documentVersionId === hit.documentVersionId &&
              chunk.anchor === hit.anchor &&
              chunk.sectionId === hit.sectionId,
          );
          if (group === matched && chunk) excerpts.push(chunk.originalText.toLowerCase());
        }
        const document = documents.get(group.documentId);
        if (document?.sourceType !== 'core_catalog_pointer') continue;
        const targetId = identity(document.id);
        const moduleIds = strings(document.metadata?.['moduleIds']);
        const selected = catalog.modules.find(
          (module) =>
            moduleIds.includes(module.id) &&
            (module.releaseState === 'published' || module.releaseState === 'preview') &&
            module.documents.some(
              (item) =>
                item.documentId === targetId &&
                module.artifacts.some(
                  (artifact) =>
                    artifact.id === item.indexArtifactId &&
                    artifact.kind === 'index' &&
                    artifact.required &&
                    Boolean(artifact.url && artifact.sha256),
                ),
            ),
        );
        const installed = documents.has(targetId);
        // Missing manifest membership is a failed download contract, not assumed success.
        const verified = installed || Boolean(selected);
        const primaryModuleId = document.metadata?.['primaryModuleId'];
        downloadTargets.push({
          pointerId: document.id,
          targetId,
          moduleId: selected?.id ?? (typeof primaryModuleId === 'string' ? primaryModuleId : null),
          installed,
          verified,
        });
        checks['downloadTarget'] = (checks['downloadTarget'] ?? true) && verified;
        if (installed) {
          const full = await core.getDocument(targetId);
          checks['installedTargetReadable'] =
            (checks['installedTargetReadable'] ?? true) &&
            full.ok &&
            full.value.sections.some((section) => section.chunks.length > 0);
        }
      }
      if (fixture.evidenceIncludes || fixture.evidencePattern)
        checks['samePassageEvidence'] = excerpts.some(
          (text) =>
            (fixture.evidenceIncludes?.every((term) => text.includes(term.toLowerCase())) ??
              true) &&
            (fixture.evidencePattern?.test(text) ?? true),
        );
      rows.push({
        edition,
        id: fixture.id,
        query: fixture.query,
        rank,
        checks,
        downloadTargets,
        ...(expected
          ? {
              coverage,
              outcome: matched
                ? documents.get(matched.documentId)?.sourceType === 'core_catalog_pointer'
                  ? 'discovery-found'
                  : 'local-found'
                : coverage === 'absent'
                  ? 'absent'
                  : 'miss',
            }
          : {}),
        expectedTargets: expected ?? [],
        retrievedTargets: result.value.groups.map((group) => identity(group.documentId)),
      });
    }
  } finally {
    await core.close();
  }
}
const report = {
  schemaVersion: 2,
  request: { mode: 'auto', limit: 20, includeSuggestions: true, scoredTopK: 5 },
  experimentalModulesEnabled: true,
  fixtureMode,
  casePrefix: casePrefix ?? null,
  editionFilter: editionFilter ?? null,
  engine: 'MedicalCore + ScopedMedicalCore + MultiMedicalStore',
  sourceFiles: await Promise.all(
    [corePath, ...packs, ...(fixtureMode === 'rag500' ? [fixtureIndexPath] : [])].map(
      async (path) => {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        return { path, sha256: hash.digest('hex') };
      },
    ),
  ),
  excluded,
  rows,
  metrics: summarizeRuntimeRetrieval(rows),
  passed: rows.every(runtimeRetrievalPassed),
};
const reportPath = resolve(
  option('report') ?? resolve(root, `data/build/runtime-${fixtureMode}-report.json`),
);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      reportPath,
      evaluated: rows.length,
      excluded: excluded.length,
      passed: report.passed,
      metrics: report.metrics,
      failures: rows
        .filter((row) => Object.values(row.checks).some((value) => !value))
        .map((row) => ({ edition: row.edition, id: row.id, checks: row.checks })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
