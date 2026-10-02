// Reproducible, incremental, timed build of the discovery core reference-pointer database.
//
// Reconstructed pipeline (see docs/research/core-build-reconstruction-2026-09-27.md for the
// evidence and confidence level behind each stage, including a real run of this script). This
// wires together existing, already bulk-tuned tools/ingest commands; it does not reimplement
// SQLite writing. THREE INDEPENDENT pointer tracks feed one final compose -- verified against
// the released core.db's metadata_json.catalogFamily breakdown (15,904 reference + 3,324
// medication + 744 clinical = 19,972, the exact core_catalog_pointer total):
//
//   Track A -- reference (krasotaimedicina + mkb), 15,904 pointers:
//     compose-reference     medbase compose --input diseases.db --input mkb.db
//                           -> core-reference-merged.db. Bulk INSERT...SELECT copy
//                           (sqlite_composer.py), not per-row Python -- measured 69s for a
//                           928 MB + 1.5 GB merge to 252k chunks, not a bottleneck.
//     reference-pointers    medbase build-core-reference-pointers --source
//                           core-reference-merged.db -> markdown pointer module (this is where
//                           the diagnosis-alias fan-out fix from commit 4cab924f applies;
//                           catalog_module_builder.py). Only krasotaimedicina/rls-mkb source
//                           types may feed this step (_REFERENCE_SOURCE_TYPES) -- clinical
//                           catalog modules do NOT belong here (confirmed by a real failing run:
//                           "unsupported source_type: clinical_recommendation_catalog_record").
//     pointers-build        medbase build <pointer module> -> core-pointers-base.db.
//
//   Track B -- clinical (744) catalog pointers:
//     catalog-pointers-clinical         medbase build-core-catalog-pointers --family clinical
//                           --ledger official-clinical-coverage-ledger.json -> markdown pointer
//                           module. Reads the ledger JSON directly; no compose and no compiled
//                           per-specialty .db needed for this track.
//     catalog-pointers-clinical-build   medbase build <pointer module> -> .db.
//     (A fourth 'legal' CatalogFamily exists in code but has 0 documents in the released
//     core.db, so it is not wired in here.)
//
//   Track C -- medication (3,324), PINNED, not rebuilt from a ledger (coordinator decision,
//   2026-09-27 -- see the long comment further down, "Medical (medication) track"):
//     medication-pointers-pinned   tools/ingest/scripts/pin_medication_pointers.py bulk-copies
//                           the released core.db's own 3,324 medication pointer rows, selected
//                           by a committed, hashed id list, into
//                           data/build/core-medication-pointers-pinned.db. The full GRLS
//                           registry (38,815 records and growing) is NOT rebuilt into the core.
//
//   Assembly:
//     colloquial-alias-pack  content/colloquial-aliases.yaml (45 Russian colloquial rows,
//                           `alias.colloquial.*`) -> alias-only compose input.
//     medication-alias-pack  source-listed medicine names projected onto the pinned INN pointers
//                           -> alias-only compose input.
//     finalize              medbase compose --input core-pointers-base.db --input
//                           core-catalog-pointers-clinical.db --input
//                           core-medication-pointers-pinned.db --input colloquial-aliases.db
//                           --input medication-source-aliases.db --compact
//                           -> data/build/core.<version>.db (candidate final core; NOT copied over
//                           apps/app/public/content/core.db -- that publish step is
//                           manual/separate), then the exact-name identity index (migration 011).
//
// Pilot corpus (retired 2026-10-02, docs/research/pilot-corpus-retired-2026-10-02.md): until
// core 0.6.45 the compose also took the 15 `content/pilot-rf` retellings (7 kr.rf.* summaries, 8
// drug.rf.* cards). They are gone from the build; their colloquial vocabulary lives on as
// content/colloquial-aliases.yaml. The pilot files are kept only as fixtures of the historical
// registry migrations (tools/ingest/tests/fixtures/pilot-rf).
//
// Clinical editions (2026-10-02 registry refresh): the clinical track covers every current
// edition of the registry plus the earlier editions the core already pointed to. `--previous-source`
// keeps an edition that left the current catalog as a `superseded` pointer linked to its
// successor (`supersededByDocumentId`), and the successor lists the codes it replaces. The 30 new
// editions' databases are decoded from their published zstd modules (checksum-verified) because
// the clinical keywords/aliases/definitions/medication links are read from the databases.
//
// Every stage is hashed (inputs) and skipped when its recorded input hash and output file are
// already present and unchanged -- an alias-only rebuild only reruns from stage 3 onward.
//
// Usage:
//   bun run content:core:build
//   bun run content:core:build -- --force            # ignore the incremental cache
//   bun run content:core:build -- --stage=compose-reference   # run one stage (+ its deps)
//   CORE_BUILD_VERSION=0.6.47 bun run content:core:build -- --stage=finalize

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const buildDir = resolve(root, 'data/build');
const manifestPath = resolve(buildDir, 'core-build-manifest.json');
const reportPath = resolve(buildDir, 'core-build-report.json');
const SCHEMA_VERSION = 2;
const VERSION = process.env.CORE_BUILD_VERSION ?? '0.7.0-dev';
const BUILT_AT = process.env.CORE_BUILT_AT ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const identityInputs = {
  identityCatalog: resolve(root, 'apps/app/src/features/modules/catalog.preview.json'),
  identityDefinitions: resolve(
    buildDir,
    'definition-reference/2026.9.30/minimed.definition.reference.2026.9.30.db.gz',
  ),
  identityDocuments: ['reference', 'regulatory', 'ambulatory'].map((name) =>
    resolve(root, `apps/app/public/content/${name}.db`),
  ),
  identityBuilder: resolve(root, 'tools/ingest/src/localmed_ingest/core_identity_index.py'),
  identityMigration: resolve(root, 'schema/sql/011_core_identities.sql'),
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyStage = args.find((a) => a.startsWith('--stage='))?.slice('--stage='.length);

function sha256(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

async function hashPath(path) {
  if (path === null || path === undefined) return null;
  if (typeof path !== 'string') {
    // Not a filesystem path -- a plain config value (e.g. a boolean flag) that should still
    // participate in the stage's cache key.
    return sha256(Buffer.from(JSON.stringify(path)));
  }
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (stat.isFile()) {
    return sha256(await readFile(path));
  }
  // Directory: hash the sorted list of (relative path, file hash) pairs, recursively.
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = resolve(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = statSync(full);
      if (st.isDirectory()) walk(full, rel);
      else entries.push([rel, full]);
    }
  };
  walk(path, '');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const digest = createHash('sha256');
  for (const [rel, full] of entries) {
    digest.update(rel);
    digest.update(await readFile(full));
  }
  return `sha256:${digest.digest('hex')}`;
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { stages: {} };
  }
}

function run(command, commandArgs, { label }) {
  const startedAt = Date.now();
  process.stderr.write(`[build-core] ${label}: ${command} ${commandArgs.join(' ')}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
  const wallMs = Date.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}) after ${wallMs}ms`);
  }
  return wallMs;
}

async function addCoreIdentities(database, editionManifest) {
  const wallMs = run(
    'uv',
    [
      'run',
      '--project',
      'tools/ingest',
      'python',
      '-m',
      'localmed_ingest.core_identity_index',
      '--core',
      database,
      '--catalog',
      identityInputs.identityCatalog,
      '--definitions',
      identityInputs.identityDefinitions,
      ...identityInputs.identityDocuments.flatMap((path) => ['--document-source', path]),
      '--report',
      `${database}.identity-report.json`,
    ],
    { label: 'index exact source names without adding clinical FTS rows' },
  );
  const manifest = JSON.parse(await readFile(editionManifest, 'utf8'));
  manifest.databaseSha256 = await hashPath(database);
  await writeFile(editionManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  return wallMs;
}

// --- stage definitions ----------------------------------------------------
//
// Verified (2026-09-27, real run of this script) against the released core.db's
// metadata_json.catalogFamily counts -- 15,904 'reference' + 3,324 'medication' +
// 744 'clinical' = 19,972, the exact core_catalog_pointer total. Three INDEPENDENT pointer
// tracks feed the final compose, not one merged reference pack:
//   - 'reference' (krasotaimedicina + mkb): compose diseases.db+mkb.db, THEN
//     build-core-reference-pointers. Clinical .db modules do NOT belong in this compose --
//     a real run raised "unsupported source_type: clinical_recommendation_catalog_record"
//     the one time this was tried, because build-core-reference-pointers only accepts
//     {medical_reference, rls_mkb_reference, krasotaimedicina_reference}.
//   - 'clinical': build-core-catalog-pointers --family clinical --ledger
//     official-clinical-coverage-ledger.json, which reads the ledger JSON directly -- no
//     compose, no compiled per-module .db needed at all for this track.
//   - 'medication' is DIFFERENT from the other two and deliberately NOT built the same way --
//     see "Medical (medication) track: pinned, not rebuilt from a ledger" below.
// A fourth 'legal' family exists in the code (CatalogFamily) but has 0 documents in the
// currently released core.db, so it is not wired in here.
//
// ## Medical (medication) track: pinned, not rebuilt from a ledger (coordinator decision,
// 2026-09-27; product direction: the core is a lightweight pointer/routing index over
// everything, full content loads through separate downloadable modules)
//
// A first attempt fed `official-grls-coverage-ledger.json` (raw GRLS product registrations,
// `drug.ru.*`) to `build-core-catalog-pointers --family medication` and got 38,815 documents --
// wrong both in *count* and in *kind*. The released core.db's 3,324 medication pointers all
// target `esklp.mnn.*` records (ESKLP: the deduplicated, INN-level drug-substance catalog, NOT
// the per-product GRLS registry) via a completely different code path
// (`catalog_module_builder.py::project_esklp_mnn_to_core_topic_stub`, dispatched when a ledger
// record has `recordKind == "esklp-mnn"`). Building that ledger needs a raw ESKLP archive
// (`medbase-regulated-catalog esklp --archive ... --taxonomy ...`) that is not available on this
// machine -- only the *output* of that pipeline is here: `data/build/release-esklp/*.db` (15
// per-ATC-category modules, already built, summing to exactly 3,324 documents -- confirmed by
// direct count) and the 3,324 pointers already baked into the released core.db.
//
// Rather than re-deriving a ledger that might drift from what the release actually shipped, the
// medication track is PINNED: `tools/ingest/scripts/pin_medication_pointers.py` bulk-copies
// (not hand-edits) exactly the released core.db's medication pointer rows -- selected by a
// committed id list, `tools/ingest/scripts/released-medication-pointer-ids-2026-09-08.json`
// (3,324 ids, sha256 hashed into this stage's cache key and into its own report) -- into a
// small schema-compatible SQLite file that composes like any other pointer track. This also
// sidesteps the ~10-minute cascading-delete cost a whole-then-filter approach hit in an earlier
// attempt (see docs/research/core-build-reconstruction-2026-09-27.md); the insert-only,
// scoped-from-the-start approach here takes ~14s.
//
// The full GRLS registry (currently 38,815 `drug.ru.*` records and growing -- another agent's
// concurrent `grls-instruction-batch` work) is deliberately NOT in the core. It is the
// downloadable module side of the same "esklp-release" mechanism already used for the ESKLP
// catalog: `medbase-regulated-catalog esklp-release --db-dir data/build/release-esklp ...`
// validates the 15 built modules and writes downloadable catalog updates (docs/research/
// core-build-reconstruction-2026-09-27.md has the coverage/membership findings). This script
// does not build or publish that module.

function catalogPointerTrack(family, ledgerFile, deps = []) {
  const pointerDir = resolve(buildDir, `core-catalog-pointers-${family}`);
  const dbPath = resolve(buildDir, `core-catalog-pointers-${family}.db`);
  return [
    {
      name: `catalog-pointers-${family}`,
      deps,
      async inputs() {
        return {
          ledger: resolve(buildDir, ledgerFile),
          builder: resolve(root, 'tools/ingest/src/localmed_ingest/catalog_module_builder.py'),
        };
      },
      async outputs() {
        return [pointerDir];
      },
      async execute() {
        return run(
          'uv',
          [
            'run',
            '--project',
            'tools/ingest',
            'medbase',
            'build-core-catalog-pointers',
            '--ledger',
            `data/build/${ledgerFile}`,
            '--output',
            `data/build/core-catalog-pointers-${family}`,
            '--version',
            VERSION,
            '--family',
            family,
            '--built-at',
            BUILT_AT,
            '--force',
          ],
          { label: `build ${family} catalog pointers from its coverage ledger` },
        );
      },
    },
    {
      name: `catalog-pointers-${family}-build`,
      deps: [`catalog-pointers-${family}`],
      async inputs() {
        return {
          pointerDir,
          compiler: resolve(root, 'tools/ingest/src/localmed_ingest/builder.py'),
          parser: resolve(root, 'tools/ingest/src/localmed_ingest/markdown_parser.py'),
          normalization: resolve(root, 'tools/ingest/src/localmed_ingest/normalization.py'),
          settings: { lexicalOnly: true },
        };
      },
      async outputs() {
        return [dbPath];
      },
      async execute() {
        const [moduleDir] = readdirSync(pointerDir).filter((name) =>
          statSync(resolve(pointerDir, name)).isDirectory(),
        );
        return run(
          'uv',
          [
            'run',
            '--project',
            'tools/ingest',
            'medbase',
            'build',
            '--input',
            `data/build/core-catalog-pointers-${family}/${moduleDir}`,
            '--output',
            `data/build/core-catalog-pointers-${family}.db`,
            '--report',
            `data/build/core-catalog-pointers-${family}-report.json`,
            '--lexical-only',
          ],
          { label: `compile ${family} catalog pointer markdown into SQLite` },
        );
      },
    },
  ];
}

const RELEASED_CORE = resolve(root, 'apps/app/public/content/core.db');
const PINNED_MEDICATION_IDS = resolve(
  root,
  'tools/ingest/scripts/released-medication-pointer-ids-2026-09-08.json',
);
const CLINICAL_SOURCE_MANIFEST = resolve(
  root,
  'tools/ingest/scripts/released-clinical-source-databases-2026-07-27.json',
);
const CLINICAL_SOURCE_DIR = resolve(
  root,
  'data/build/official-clinical-documents-2026-07-27/databases',
);

// Verifies data/build/official-clinical-documents-2026-07-27/databases against the committed
// per-file sha256 manifest before every 'clinical-ledger-enriched' run, so a missing directory,
// a partial copy, or a silently-swapped file fails loudly with a clear remediation message
// instead of quietly reproducing the "163 vs 6 keywords" regression this stage exists to fix
// (see the long comment on that stage and released-clinical-source-databases-2026-07-27.json's
// own "description" field for the full trace).
async function verifyClinicalSourceDatabases() {
  const manifest = JSON.parse(await readFile(CLINICAL_SOURCE_MANIFEST, 'utf8'));
  const expected = manifest.checksums;
  const expectedCount = Object.keys(expected).length;
  if (!existsSync(CLINICAL_SOURCE_DIR)) {
    throw new Error(
      `clinical-ledger-enriched: missing ${CLINICAL_SOURCE_DIR}. Restore the ${expectedCount} ` +
        `files listed in ${CLINICAL_SOURCE_MANIFEST} (sourcePath: ${manifest.sourcePath}) before ` +
        "re-running -- this directory backs the released core.db's clinical keywords/aliases " +
        'and is not derivable from data/build/official-clinical-documents/databases.',
    );
  }
  const present = new Set(
    readdirSync(CLINICAL_SOURCE_DIR)
      .filter((name) => name.endsWith('.db'))
      .map((name) => name.replace(/\.db$/, '')),
  );
  const missing = [];
  const mismatched = [];
  for (const [officialId, expectedHash] of Object.entries(expected)) {
    const fileName = `clinical-${officialId}-clinical-json-${manifest.sourceDateSuffix}.db`;
    const filePath = resolve(CLINICAL_SOURCE_DIR, fileName);
    if (!existsSync(filePath)) {
      missing.push(officialId);
      continue;
    }
    const actualHash = sha256(await readFile(filePath));
    if (actualHash !== expectedHash) mismatched.push(officialId);
  }
  if (missing.length || mismatched.length) {
    throw new Error(
      `clinical-ledger-enriched: ${CLINICAL_SOURCE_DIR} does not match ` +
        `${CLINICAL_SOURCE_MANIFEST} -- ${missing.length} missing, ${mismatched.length} ` +
        `checksum mismatches (e.g. ${[...missing, ...mismatched].slice(0, 5).join(', ')}). ` +
        'Restore the exact committed batch rather than continuing with unverified input.',
    );
  }
  if (present.size !== expectedCount) {
    throw new Error(
      `clinical-ledger-enriched: ${CLINICAL_SOURCE_DIR} has ${present.size} .db files, expected ` +
        `${expectedCount} from ${CLINICAL_SOURCE_MANIFEST}. Remove any extra/stale files before ` +
        're-running.',
    );
  }
}

// Registry catalogs: the 2026-10-02 snapshot lists every current edition; the earlier catalog
// (2026-07-27, 744 editions) lists the 11 editions the registry has since replaced, which the core
// keeps as superseded pointers.
const CLINICAL_CATALOG = resolve(
  root,
  'data/raw/official-clinical-registry/2026-10-02/catalog.json',
);
const CLINICAL_PREVIOUS_CATALOG = resolve(root, 'data/raw/official-clinical-registry/catalog.json');
const NEW_EDITION_ZST_DIRECTORY = resolve(buildDir, 'official-clinical-2026-10-02/zst');
const NEW_EDITION_DATABASES = resolve(buildDir, 'core-clinical-new-editions/databases');

const stages = [
  {
    name: 'medication-pointers-pinned',
    deps: [],
    async inputs() {
      return { releasedCore: RELEASED_CORE, pinnedIds: PINNED_MEDICATION_IDS };
    },
    async outputs() {
      return [resolve(buildDir, 'core-medication-pointers-pinned.db')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          'tools/ingest/scripts/pin_medication_pointers.py',
          '--source',
          'apps/app/public/content/core.db',
          '--pinned-ids',
          'tools/ingest/scripts/released-medication-pointer-ids-2026-09-08.json',
          '--output',
          'data/build/core-medication-pointers-pinned.db',
          '--report',
          'data/build/core-medication-pointers-pinned-report.json',
        ],
        {
          label:
            'pin medication pointers to the released core.db set (not the growing GRLS ledger)',
        },
      );
    },
  },
  // --- clinical-definition enrichment (coordinator decision, 2026-09-27) --------------------
  //
  // A full metadata audit (docs/research/core-build-reconstruction-2026-09-27.md) found the
  // entityType build defect was necessary but not sufficient: 273/744 clinical pointers in the
  // released core.db carry a real canonicalDefinition, 318/744 carry declaredAliases, 271/744
  // carry clinicalMedicationLinks -- all zero in a candidate built straight from the base
  // coverage ledger. None of that content comes from official-sync/build at all; it comes from
  // `medbase-regulated-catalog clinical-aliases`, which reads the already-fetched clinical
  // guideline databases (`data/build/official-clinical-documents/databases`, 723 files, no
  // network) and writes an ENRICHED ledger copy. `clinical_definition_migration_006.py` (the
  // migration named in the task) instead patches an already-built SQLite pack in place and
  // cross-validates against markdown already staged from a specific build version; since this
  // pipeline rebuilds the clinical pointer track from scratch every time anyway,
  // enriching the LEDGER once and feeding it to the existing, unmodified
  // `build-core-catalog-pointers --family clinical` (which already reads `aliases`/`keywords`/
  // `canonicalDefinition`/`clinicalMedicationLinks` off each ledger record -- see
  // catalog_module_builder.py::_clinical_core_pointer_document) reaches the identical enriched
  // fields without a separate SQL-patching stage. This still fits AGENTS.md's rule (never
  // hand-edit a generated pack): every step below is an explicit, hashed build stage over an
  // intermediate ledger file, not an edit to a built database.
  {
    name: 'clinical-ledger-base',
    deps: [],
    async inputs() {
      return {
        catalog: CLINICAL_CATALOG,
        previousCatalog: CLINICAL_PREVIOUS_CATALOG,
        taxonomy: resolve(root, 'content/clinical-module-taxonomy.yaml'),
        overrides: resolve(root, 'content/clinical-coverage-overrides.yaml'),
        builder: resolve(root, 'tools/ingest/src/localmed_ingest/clinical_catalog.py'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'official-clinical-coverage-ledger.json')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase-clinical-catalog',
          'build',
          '--source',
          relative(root, CLINICAL_CATALOG),
          '--previous-source',
          relative(root, CLINICAL_PREVIOUS_CATALOG),
          '--taxonomy',
          'content/clinical-module-taxonomy.yaml',
          '--overrides',
          'content/clinical-coverage-overrides.yaml',
          '--output',
          'data/build/official-clinical-coverage-ledger.json',
        ],
        {
          label:
            'regenerate the clinical coverage ledger from the cached raw catalogs (no network): current editions plus the replaced editions, linked to their successors',
        },
      );
    },
  },
  {
    // The 30 editions published after the 2026-07-27 batch exist on this machine only as their
    // published zstd modules (the built databases were removed after packaging). The clinical
    // enrichment reads keywords, aliases, definitions and medication relations from per-
    // recommendation databases, so decode them (every output is checked against the decoded
    // checksum recorded when the modules were published) into a scratch directory named like
    // the earlier batches.
    name: 'clinical-new-edition-sources',
    deps: [],
    async inputs() {
      return { zstDirectory: NEW_EDITION_ZST_DIRECTORY };
    },
    async outputs() {
      return [NEW_EDITION_DATABASES];
    },
    async execute() {
      const startedAt = Date.now();
      const report = JSON.parse(
        await readFile(resolve(NEW_EDITION_ZST_DIRECTORY, 'repack-report.json'), 'utf8'),
      );
      await rm(NEW_EDITION_DATABASES, { recursive: true, force: true });
      await mkdir(NEW_EDITION_DATABASES, { recursive: true });
      for (const file of report.files) {
        const decoded = spawnSync(
          'zstd',
          ['-d', '-c', '--long=26', resolve(NEW_EDITION_ZST_DIRECTORY, file.file)],
          { maxBuffer: 1 << 30 },
        );
        if (decoded.status !== 0) throw new Error(`zstd failed for ${file.file}`);
        if (sha256(decoded.stdout) !== file.decodedSha256) {
          throw new Error(`${file.file}: decoded checksum differs from the published module.`);
        }
        await writeFile(
          resolve(NEW_EDITION_DATABASES, file.file.replace(/\.zst$/, '')),
          decoded.stdout,
        );
      }
      return Date.now() - startedAt;
    },
  },
  {
    name: 'clinical-medication-relations',
    deps: ['medication-pointers-pinned', 'clinical-new-edition-sources'],
    async inputs() {
      return {
        databases: resolve(root, 'data/build/official-clinical-documents/databases'),
        newEditionDatabases: NEW_EDITION_DATABASES,
        medicationIndex: resolve(buildDir, 'core-medication-pointers-pinned.db'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'clinical-medication-relations')];
    },
    async execute() {
      // `--resume` reuses a candidate whose database and medication index are unchanged, so a
      // new edition only adds its own file next to the earlier 723.
      const batch = (clinicalDirectory) =>
        run(
          'uv',
          [
            'run',
            '--project',
            'tools/ingest',
            'medbase-regulated-catalog',
            'clinical-medication-relations-batch',
            '--clinical-dir',
            clinicalDirectory,
            '--medication-index',
            'data/build/core-medication-pointers-pinned.db',
            '--output-dir',
            'data/build/clinical-medication-relations',
            '--workers',
            '4',
            '--resume',
          ],
          {
            label:
              'extract clinical-recommendation -> ESKLP MNN relation candidates (deterministic, no LLM/network)',
          },
        );
      return (
        batch('data/build/official-clinical-documents/databases') +
        batch(relative(root, NEW_EDITION_DATABASES))
      );
    },
  },
  {
    // keywords/aliases source, restored (docs/research/core-build-reconstruction-2026-09-27.md,
    // "keywords (163 vs 6)... traced, not fixed" -> traced further and fixed here): the released
    // core.db's 163 keyword-bearing / 10,124 clinical-recommendation-alias clinical pointers were
    // built from a CLEANER, EARLIER parse of the same 744 source PDFs than
    // `data/build/official-clinical-documents/databases` (723 files) currently on disk. In that
    // directory, only 7/723 databases have a section titled exactly "Ключевые слова" --
    // everywhere else the heading was later re-parsed merged with the next one (e.g. "Ключевые
    // слова Список сокращений"), which `_KEYWORD_SECTION_PATTERN` correctly refuses to treat as a
    // keyword list (a deliberately conservative choice -- widening the match would misclassify
    // abbreviation-expansion pairs like "АДС - анатоксин..." as keywords, confirmed by inspecting
    // 79_2.db). The still-available, byte-identical 2026-07-27 batch that WAS cleanly parsed
    // (filename suffix 13991c1feee5) survives, uncommitted, under
    // output/release-0.6.33/packages/clinical-<officialId>-clinical-json-2026.07.27-
    // 13991c1feee5.db -- confirmed by direct inspection: all 744 files parse with a standalone
    // "Ключевые слова" section title (vs 7/723 in the current directory), all 744 official ids
    // match the ledger's 744 records exactly (0 missing/extra, vs 21 unmatched today), and
    // kr.rf.107_2's "Ключевые слова" chunk text in this batch is a byte-exact match for that
    // record's `keywords` array in the released core.db. `output/` is gitignored (ephemeral
    // release output), so this batch is copied to
    // `data/build/official-clinical-documents-2026-07-27/databases` (gitignored too -- a local
    // build cache like every other data/build/* input) with a committed checksum manifest,
    // `tools/ingest/scripts/released-clinical-source-databases-2026-07-27.json` (744 sha256
    // entries keyed by officialId), verified below before every run so a silently-swapped or
    // partial copy fails loudly instead of quietly regressing keywords/aliases again.
    //
    // Neither snapshot alone is complete: 4/744 ids (940_1, 1016_1, 406_3, 801_1) have a
    // correctly-titled "Ключевые слова" section in the 2026-07-27 batch with ZERO chunks under it
    // (an OCR/parse gap specific to that run for those four PDFs), while the current, messier
    // `official-clinical-documents/databases` directory happens to carry real, non-empty, byte-
    // identical-to-released content for exactly those four. `clinical-source-snapshot` below
    // merges the two, deterministically, using the real extraction code (not a guess) to decide
    // per id -- see tools/ingest/scripts/build_clinical_source_snapshot.py's module docstring.
    name: 'clinical-source-snapshot',
    deps: ['clinical-ledger-base', 'clinical-new-edition-sources'],
    async inputs() {
      return {
        ledger: resolve(buildDir, 'official-clinical-coverage-ledger.json'),
        primary: resolve(root, 'data/build/official-clinical-documents-2026-07-27/databases'),
        primaryManifest: CLINICAL_SOURCE_MANIFEST,
        fallback: resolve(root, 'data/build/official-clinical-documents/databases'),
        supplement: NEW_EDITION_DATABASES,
        snapshotBuilder: resolve(root, 'tools/ingest/scripts/build_clinical_source_snapshot.py'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'official-clinical-documents-merged/databases')];
    },
    async execute() {
      await verifyClinicalSourceDatabases();
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          'tools/ingest/scripts/build_clinical_source_snapshot.py',
          '--ledger',
          'data/build/official-clinical-coverage-ledger.json',
          '--primary',
          'data/build/official-clinical-documents-2026-07-27/databases',
          '--fallback',
          'data/build/official-clinical-documents/databases',
          '--supplement',
          relative(root, NEW_EDITION_DATABASES),
          '--output',
          'data/build/official-clinical-documents-merged/databases',
          '--report',
          'data/build/official-clinical-documents-merged-report.json',
        ],
        {
          label:
            'merge the released-parse clinical databases with the current re-parse, preferring whichever yields real keywords per id',
        },
      );
    },
  },
  {
    name: 'clinical-ledger-enriched',
    deps: ['clinical-ledger-base', 'clinical-medication-relations', 'clinical-source-snapshot'],
    async inputs() {
      return {
        baseLedger: resolve(buildDir, 'official-clinical-coverage-ledger.json'),
        databases: resolve(buildDir, 'official-clinical-documents-merged/databases'),
        medicationRelations: resolve(buildDir, 'clinical-medication-relations'),
        enricher: resolve(root, 'tools/ingest/src/localmed_ingest/clinical_aliases.py'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'official-clinical-coverage-ledger-enriched.json')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase-regulated-catalog',
          'clinical-aliases',
          '--ledger',
          'data/build/official-clinical-coverage-ledger.json',
          '--databases',
          'data/build/official-clinical-documents-merged/databases',
          '--output',
          'data/build/official-clinical-coverage-ledger-enriched.json',
          '--report',
          'data/build/clinical-aliases-enrichment-report.json',
          '--medication-relations',
          'data/build/clinical-medication-relations',
        ],
        {
          label:
            'enrich the clinical ledger with traceable aliases, keywords, definitions, medication links (released-parse source, merged)',
        },
      );
    },
  },
  ...catalogPointerTrack('clinical', 'official-clinical-coverage-ledger-enriched.json', [
    'clinical-ledger-enriched',
  ]),
  {
    name: 'compose-reference',
    deps: [],
    async inputs() {
      return {
        diseases: resolve(buildDir, 'diseases.db'),
        mkb: resolve(buildDir, 'mkb.db'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'core-reference-merged.db')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'compose',
          '--input',
          'data/build/diseases.db',
          '--input',
          'data/build/mkb.db',
          '--output',
          'data/build/core-reference-merged.db',
          '--edition-manifest',
          'data/build/core-reference-merged-manifest.json',
          '--edition-id',
          'minimed.core.reference.merged',
          '--edition-version',
          VERSION,
          '--title',
          'MiniMed reference merge (build-time only)',
          '--built-at',
          BUILT_AT,
          '--schema-version',
          String(SCHEMA_VERSION),
        ],
        { label: 'compose krasotaimedicina + mkb into one reference pack' },
      );
    },
  },
  {
    name: 'reference-pointers',
    deps: ['compose-reference'],
    async inputs() {
      return {
        merged: resolve(buildDir, 'core-reference-merged.db'),
        catalog: resolve(root, 'apps/app/src/features/modules/catalog.preview.json'),
        builder: resolve(root, 'tools/ingest/src/localmed_ingest/catalog_module_builder.py'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'core-reference-pointers')];
    },
    async execute() {
      const { ContentModuleCatalogSchema } = await import('@localmed/contracts');
      const catalog = ContentModuleCatalogSchema.parse(
        JSON.parse(
          await readFile(
            resolve(root, 'apps/app/src/features/modules/catalog.preview.json'),
            'utf8',
          ),
        ),
      );
      /** @type {Record<string, string[]>} */
      const targetModules = {};
      for (const module of catalog.modules) {
        if (!['minimed.mkb.ru', 'minimed.reference.krasotaimedicina.ru'].includes(module.id))
          continue;
        if (
          !['published', 'preview'].includes(module.releaseState) ||
          !module.artifacts.some((artifact) => artifact.kind === 'index' && artifact.required)
        ) {
          throw new Error(`Reference module ${module.id} has no released index artifact.`);
        }
        for (const document of module.documents) {
          targetModules[document.documentId] ??= [];
          targetModules[document.documentId].push(module.id);
        }
      }
      await writeFile(
        resolve(buildDir, 'core-reference-target-modules.json'),
        JSON.stringify(targetModules),
      );
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'build-core-reference-pointers',
          '--source',
          'data/build/core-reference-merged.db',
          '--output',
          'data/build/core-reference-pointers',
          '--module-id',
          'minimed.core.reference.ru',
          '--target-modules',
          'data/build/core-reference-target-modules.json',
          '--module-title',
          'Указатель МКБ-10 / клинических источников',
          '--version',
          VERSION,
          '--built-at',
          BUILT_AT,
          '--force',
        ],
        { label: 'build core reference pointers (alias fan-out fix applies here)' },
      );
    },
  },
  {
    name: 'pointers-build',
    deps: ['reference-pointers'],
    async inputs() {
      return {
        pointerRoot: resolve(buildDir, 'core-reference-pointers'),
        compiler: resolve(root, 'tools/ingest/src/localmed_ingest/builder.py'),
        parser: resolve(root, 'tools/ingest/src/localmed_ingest/markdown_parser.py'),
        normalization: resolve(root, 'tools/ingest/src/localmed_ingest/normalization.py'),
        settings: { lexicalOnly: true },
      };
    },
    async outputs() {
      return [resolve(buildDir, 'core-pointers-base.db')];
    },
    async execute() {
      const pointerRoot = resolve(buildDir, 'core-reference-pointers');
      const [moduleDir] = readdirSync(pointerRoot).filter((name) =>
        statSync(resolve(pointerRoot, name)).isDirectory(),
      );
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'build',
          '--input',
          `data/build/core-reference-pointers/${moduleDir}`,
          '--output',
          'data/build/core-pointers-base.db',
          '--report',
          'data/build/core-pointers-base-report.json',
          '--lexical-only',
        ],
        { label: 'compile pointer markdown into SQLite' },
      );
    },
  },
  // The 45-row Russian colloquial vocabulary (abbreviations, lay symptom phrasing) is independent
  // of any document: the `aliases` table has no document foreign key. It was written next to the
  // retired pilot pack and now lives in content/colloquial-aliases.yaml; this builds it as its own
  // compose input straight from that committed file.
  {
    name: 'colloquial-alias-pack',
    deps: [],
    async inputs() {
      return {
        aliases: resolve(root, 'content/colloquial-aliases.yaml'),
        builder: resolve(root, 'tools/ingest/scripts/build_alias_pack.py'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'colloquial-aliases.db')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          'tools/ingest/scripts/build_alias_pack.py',
          '--aliases',
          'content/colloquial-aliases.yaml',
          '--output',
          'data/build/colloquial-aliases.db',
          '--report',
          'data/build/colloquial-aliases-report.json',
          '--edition-version',
          VERSION,
          '--built-at',
          BUILT_AT,
        ],
        { label: 'build the colloquial-vocabulary dictionary (alias-only compose input)' },
      );
    },
  },
  {
    name: 'medication-alias-pack',
    deps: ['medication-pointers-pinned'],
    async inputs() {
      return {
        pointers: resolve(buildDir, 'core-medication-pointers-pinned.db'),
        allmed: resolve(root, 'apps/app/public/content/medications.db'),
        grls: resolve(buildDir, 'official-grls-coverage-ledger.json'),
        generator: resolve(root, 'tools/ingest/src/localmed_ingest/medication_aliases.py'),
        builder: resolve(root, 'tools/ingest/scripts/build_alias_pack.py'),
        settings: { version: VERSION, schemaVersion: SCHEMA_VERSION },
      };
    },
    async outputs() {
      return [
        resolve(buildDir, 'medication-source-aliases.yaml'),
        resolve(buildDir, 'medication-source-aliases-report.json'),
        resolve(buildDir, 'medication-source-aliases.db'),
      ];
    },
    async execute() {
      const projectionMs = run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          '-m',
          'localmed_ingest.medication_aliases',
          '--core',
          'data/build/core-medication-pointers-pinned.db',
          '--allmed',
          'apps/app/public/content/medications.db',
          '--grls',
          'data/build/official-grls-coverage-ledger.json',
          '--output',
          'data/build/medication-source-aliases.yaml',
          '--report',
          'data/build/medication-source-aliases-report.json',
        ],
        { label: 'project source-listed medicine names onto exact existing INN pointers' },
      );
      return (
        projectionMs +
        run(
          'uv',
          [
            'run',
            '--project',
            'tools/ingest',
            'python',
            'tools/ingest/scripts/build_alias_pack.py',
            '--aliases',
            'data/build/medication-source-aliases.yaml',
            '--output',
            'data/build/medication-source-aliases.db',
            '--report',
            'data/build/medication-source-aliases-pack-report.json',
            '--edition-id',
            'minimed.core.medication.source-aliases',
            '--edition-version',
            VERSION,
            '--allow-empty',
            '--title',
            'Поисковые имена лекарств из исходных каталогов',
            '--built-at',
            BUILT_AT,
          ],
          {
            // Names the pinned pointers already carry are not projected again, so this pack is empty
            // once the pin comes from a core that contains the earlier projection (0.6.45 and later).
            label: 'build the medicine alias-only compose input without adding FTS documents',
          },
        )
      );
    },
  },
  {
    name: 'finalize',
    deps: [
      'pointers-build',
      'catalog-pointers-clinical-build',
      'medication-pointers-pinned',
      'colloquial-alias-pack',
      'medication-alias-pack',
    ],
    async inputs() {
      return {
        reference: resolve(buildDir, 'core-pointers-base.db'),
        clinical: resolve(buildDir, 'core-catalog-pointers-clinical.db'),
        medication: resolve(buildDir, 'core-medication-pointers-pinned.db'),
        vocabulary: resolve(buildDir, 'colloquial-aliases.db'),
        medicationAliases: resolve(buildDir, 'medication-source-aliases.db'),
        ...identityInputs,
      };
    },
    async outputs() {
      return [
        resolve(buildDir, `core.${VERSION}.db`),
        resolve(buildDir, `core.${VERSION}.manifest.json`),
        resolve(buildDir, `core.${VERSION}.db.identity-report.json`),
      ];
    },
    async execute() {
      const wallMs = run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'compose',
          '--input',
          'data/build/core-pointers-base.db',
          '--input',
          'data/build/core-catalog-pointers-clinical.db',
          '--input',
          'data/build/core-medication-pointers-pinned.db',
          '--input',
          'data/build/colloquial-aliases.db',
          '--input',
          'data/build/medication-source-aliases.db',
          '--output',
          `data/build/core.${VERSION}.db`,
          '--edition-manifest',
          `data/build/core.${VERSION}.manifest.json`,
          '--edition-id',
          'minimed.core.ru',
          '--edition-version',
          VERSION,
          '--title',
          'Ядро MiniMed',
          '--built-at',
          BUILT_AT,
          '--schema-version',
          String(SCHEMA_VERSION),
          '--compact',
        ],
        {
          label:
            'finalize layout (16 KiB pages, external-content FTS -- docs/research/core-db-size-2026-09-24.md) and VACUUM',
        },
      );
      return (
        wallMs +
        (await addCoreIdentities(
          resolve(buildDir, `core.${VERSION}.db`),
          resolve(buildDir, `core.${VERSION}.manifest.json`),
        ))
      );
    },
  },
];

// --- driver ----------------------------------------------------------------

async function main() {
  await mkdir(buildDir, { recursive: true });
  const manifest = await loadManifest();
  const report = { builtAt: BUILT_AT, version: VERSION, stages: [] };
  const requested = onlyStage ? new Set([onlyStage, ...depsOf(onlyStage)]) : null;

  for (const stage of stages) {
    if (requested && !requested.has(stage.name)) continue;
    const inputs = await stage.inputs();
    const inputHashes = {};
    for (const [key, path] of Object.entries(inputs)) {
      inputHashes[key] = Array.isArray(path)
        ? await Promise.all(path.map(hashPath))
        : await hashPath(path);
    }
    const outputs = await stage.outputs();
    const outputsExist = outputs.every((p) => existsSync(p));
    const cached = manifest.stages[stage.name];
    const unchanged =
      !force &&
      cached &&
      outputsExist &&
      JSON.stringify(cached.inputHashes) === JSON.stringify(inputHashes);

    if (unchanged) {
      report.stages.push({ name: stage.name, skipped: true, wallMs: 0 });
      process.stderr.write(`[build-core] ${stage.name}: skipped (inputs unchanged)\n`);
      continue;
    }

    const wallMs = await stage.execute();
    manifest.stages[stage.name] = { inputHashes, outputs, ranAt: new Date().toISOString() };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    report.stages.push({ name: stage.name, skipped: false, wallMs });
  }

  report.totalMs = report.stages.reduce((sum, s) => sum + s.wallMs, 0);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stderr.write(
    `[build-core] done. Candidate core: data/build/core.${VERSION}.db (NOT published). ` +
      `Report: ${reportPath}\n`,
  );
}

function depsOf(name) {
  const stage = stages.find((s) => s.name === name);
  if (!stage) return [];
  return stage.deps.flatMap((dep) => [dep, ...depsOf(dep)]);
}

if (import.meta.main) {
  await main();
}
