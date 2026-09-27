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
//     public-pilot-build    medbase build content/pilot-rf -> rf-public-pilot.db (15 docs: 7
//                           kr.rf.*.{uti,bronchiolitis,bronchitis,measles,meningococcal,
//                           pneumonia,rotavirus} clinical_recommendation_summary retellings + 8
//                           drug.rf.* official_registry_summary retellings). Reuses
//                           content:build:pilot.
//     finalize              medbase compose --input core-pointers-base.db --input
//                           core-catalog-pointers-clinical.db --input
//                           core-medication-pointers-pinned.db --input rf-public-pilot.db
//                           --compact -> data/build/core.<version>.db (candidate final core;
//                           NOT copied over apps/app/public/content/core.db -- that publish step
//                           is manual/separate). This is the equivalence-proving build: it still
//                           contains the 15 public-pilot documents, matching the currently
//                           released core.db precisely so a before/after diff is possible.
//
// Coordinator decision (2026-09-27, Russian, see conversation): after the above proves
// equivalent to the released core.db, remove the 15 public-pilot documents (their pointers,
// generated from the real krasotaimedicina/mkb/clinical/medication sources above, are
// unaffected and stay) as a SEPARATE step with its own diff report, via inputs -- never by
// hand-editing a built database. The following stages implement that:
//
//   public-pilot-clean-build   filters content/pilot-rf down to a scratch directory (default:
//                         only oral-rehydration-salts.md, see the ORS exception below) and builds
//                         it the same way as public-pilot-build -> rf-public-pilot-clean.db. If
//                         the ORS exception does not apply, this directory is empty and the
//                         stage is skipped entirely (no clean-pilot input to compose).
//   finalize-clean        medbase compose --input core-pointers-base.db --input
//                         core-catalog-pointers-clinical.db --input
//                         core-medication-pointers-pinned.db [--input
//                         rf-public-pilot-clean.db] --compact -> core.<version>.no-pilot.db.
//   pilot-removal-diff    Diffs finalize vs finalize-clean's document id sets and writes
//                         data/build/core-pilot-removal-diff.json (removed ids, kept ids,
//                         checksums, and the ORS decision with its rationale).
//
// ORS exception, resolved 2026-09-27: a real GRLS/ESKLP oral-rehydration-salts instruction
// (Регидрон + 3 more) has landed in the medications package (data/build/medications-v2.db,
// data/build/grls-selected-instructions-v2.db -- only their YAML registries are committed), so
// the pilot ORS retelling is dropped along with the other 14 by default. Pass --keep-ors to
// restore the old conservative default (e.g. if those v2 databases are rebuilt without it).
//
// Every stage is hashed (inputs) and skipped when its recorded input hash and output file are
// already present and unchanged -- an alias-only rebuild only reruns from stage 3 onward.
//
// Usage:
//   bun run content:core:build
//   bun run content:core:build -- --force            # ignore the incremental cache
//   bun run content:core:build -- --stage=compose-reference   # run one stage (+ its deps)
//   bun run content:core:build -- --stage=pilot-removal-diff  # runs the full chain through diff
//   bun run content:core:build -- --stage=pilot-removal-diff --keep-ors

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const buildDir = resolve(root, 'data/build');
const manifestPath = resolve(buildDir, 'core-build-manifest.json');
const reportPath = resolve(buildDir, 'core-build-report.json');
const SCHEMA_VERSION = 2;
const VERSION = process.env.CORE_BUILD_VERSION ?? '0.7.0-dev';
const BUILT_AT = process.env.CORE_BUILT_AT ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyStage = args.find((a) => a.startsWith('--stage='))?.slice('--stage='.length);
// ORS exception, resolved 2026-09-27: the coordinator confirmed a real ORS/Регидрон instruction
// has landed in the medications package (data/build/medications-v2.db and
// data/build/grls-selected-instructions-v2.db both carry drug.rf.regidron.instruction; only
// their YAML registries are committed). So the pilot ORS retelling is dropped by default too,
// same as the other 14. Pass --keep-ors to restore the old conservative default if that ever
// regresses (e.g. those v2 databases are rebuilt without it).
const dropOrs = !args.includes('--keep-ors');
const pilotRoot = resolve(root, 'content/pilot-rf');
const PILOT_DOCUMENT_IDS = [
  'kr.rf.281_3.uti',
  'kr.rf.360_3.bronchiolitis',
  'kr.rf.381_3.bronchitis',
  'kr.rf.563_2.measles',
  'kr.rf.58_2.meningococcal',
  'kr.rf.714_2.pneumonia',
  'kr.rf.755_1.rotavirus',
  'drug.rf.amoxicillin-clavulanate.suspension-400-57',
  'drug.rf.amoxicillin.tablets-500',
  'drug.rf.azithromycin.suspension-200mg-5ml',
  'drug.rf.ceftriaxone.injection-1g',
  'drug.rf.ibuprofen.pediatric-suspension',
  'drug.rf.oral-rehydration-salts.powder-18-9g',
  'drug.rf.oseltamivir.capsules-30mg',
  'drug.rf.paracetamol.pediatric-suspension',
];
const ORS_DOCUMENT_ID = 'drug.rf.oral-rehydration-salts.powder-18-9g';
const ORS_SOURCE_FILE = 'oral-rehydration-salts.md';

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
        return { ledger: resolve(buildDir, ledgerFile) };
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
        return { pointerDir };
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
        catalog: resolve(root, 'data/raw/official-clinical-registry/catalog.json'),
        taxonomy: resolve(root, 'content/clinical-module-taxonomy.yaml'),
        overrides: resolve(root, 'content/clinical-coverage-overrides.yaml'),
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
          'data/raw/official-clinical-registry/catalog.json',
          '--taxonomy',
          'content/clinical-module-taxonomy.yaml',
          '--overrides',
          'content/clinical-coverage-overrides.yaml',
          '--output',
          'data/build/official-clinical-coverage-ledger.json',
        ],
        {
          label:
            'regenerate the base clinical coverage ledger from the cached raw catalog (no network)',
        },
      );
    },
  },
  {
    name: 'clinical-medication-relations',
    deps: ['medication-pointers-pinned'],
    async inputs() {
      return {
        databases: resolve(root, 'data/build/official-clinical-documents/databases'),
        medicationIndex: resolve(buildDir, 'core-medication-pointers-pinned.db'),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'clinical-medication-relations')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase-regulated-catalog',
          'clinical-medication-relations-batch',
          '--clinical-dir',
          'data/build/official-clinical-documents/databases',
          '--medication-index',
          'data/build/core-medication-pointers-pinned.db',
          '--output-dir',
          'data/build/clinical-medication-relations',
          '--workers',
          '4',
        ],
        {
          label:
            'extract clinical-recommendation -> ESKLP MNN relation candidates (deterministic, no LLM/network)',
        },
      );
    },
  },
  {
    name: 'clinical-ledger-enriched',
    deps: ['clinical-ledger-base', 'clinical-medication-relations'],
    async inputs() {
      return {
        baseLedger: resolve(buildDir, 'official-clinical-coverage-ledger.json'),
        databases: resolve(root, 'data/build/official-clinical-documents/databases'),
        medicationRelations: resolve(buildDir, 'clinical-medication-relations'),
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
          'data/build/official-clinical-documents/databases',
          '--output',
          'data/build/official-clinical-coverage-ledger-enriched.json',
          '--report',
          'data/build/clinical-aliases-enrichment-report.json',
          '--medication-relations',
          'data/build/clinical-medication-relations',
        ],
        {
          label:
            'enrich the clinical ledger with traceable aliases, keywords, definitions, medication links',
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
      return { merged: resolve(buildDir, 'core-reference-merged.db') };
    },
    async outputs() {
      return [resolve(buildDir, 'core-reference-pointers')];
    },
    async execute() {
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
      return { pointerRoot: resolve(buildDir, 'core-reference-pointers') };
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
        ],
        { label: 'compile pointer markdown into SQLite' },
      );
    },
  },
  {
    name: 'public-pilot-build',
    deps: [],
    async inputs() {
      return { pilotRoot };
    },
    async outputs() {
      return [resolve(buildDir, 'rf-public-pilot.db')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'build',
          '--input',
          'content/pilot-rf',
          '--output',
          'data/build/rf-public-pilot.db',
          '--report',
          'data/build/rf-public-pilot-report.json',
        ],
        { label: 'build the 15-document public pilot pack (content:build:pilot)' },
      );
    },
  },
  // Coordinator decision (2026-09-27): removing the 15 public-pilot documents also silently
  // dropped content/pilot-rf/aliases.yaml's 45-row Russian colloquial vocabulary (finding 4,
  // investigation 6, measurement 5, symptom 25, treatment 2, diagnosis 3 -- confirmed by a full
  // alias-table audit against the released core.db). That vocabulary is independent of the pilot
  // documents (AGENTS.md: "Aliases are the intended Russian vocabulary layer") and must survive
  // pilot removal. tools/ingest/scripts/build_pilot_vocabulary_pack.py builds it as its own
  // compose input straight from the committed aliases.yaml (no document required -- the
  // `aliases` table has no document foreign key, so this is a hashed, reproducible build stage
  // over that one committed file, not a hand-edit of any built pack).
  {
    name: 'pilot-vocabulary-pack',
    deps: [],
    async inputs() {
      return { aliases: resolve(pilotRoot, 'aliases.yaml') };
    },
    async outputs() {
      return [resolve(buildDir, 'pilot-vocabulary.db')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          'tools/ingest/scripts/build_pilot_vocabulary_pack.py',
          '--aliases',
          'content/pilot-rf/aliases.yaml',
          '--output',
          'data/build/pilot-vocabulary.db',
          '--report',
          'data/build/pilot-vocabulary-report.json',
          '--edition-version',
          VERSION,
          '--built-at',
          BUILT_AT,
        ],
        {
          label:
            'build the pilot colloquial-vocabulary dictionary, independent of the pilot documents',
        },
      );
    },
  },
  {
    name: 'finalize',
    deps: [
      'pointers-build',
      'catalog-pointers-clinical-build',
      'medication-pointers-pinned',
      'public-pilot-build',
      'pilot-vocabulary-pack',
    ],
    async inputs() {
      return {
        reference: resolve(buildDir, 'core-pointers-base.db'),
        clinical: resolve(buildDir, 'core-catalog-pointers-clinical.db'),
        medication: resolve(buildDir, 'core-medication-pointers-pinned.db'),
        pilot: resolve(buildDir, 'rf-public-pilot.db'),
        vocabulary: resolve(buildDir, 'pilot-vocabulary.db'),
      };
    },
    async outputs() {
      return [resolve(buildDir, `core.${VERSION}.db`)];
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
          'data/build/core-pointers-base.db',
          '--input',
          'data/build/core-catalog-pointers-clinical.db',
          '--input',
          'data/build/core-medication-pointers-pinned.db',
          '--input',
          'data/build/rf-public-pilot.db',
          '--input',
          'data/build/pilot-vocabulary.db',
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
    },
  },
  {
    // Post-equivalence cleanup (coordinator decision, 2026-09-27): the 15 public-pilot
    // documents are retellings/summaries of the real krasotaimedicina/mkb/clinical/GRLS sources
    // that already have proper catalog pointers from stage 3; this stage builds a "clean" pilot
    // input containing only what the ORS exception keeps, entirely via a filtered content
    // directory under data/build/ -- content/pilot-rf itself is never edited.
    name: 'public-pilot-clean-build',
    deps: [],
    async inputs() {
      return { pilotRoot, dropOrs };
    },
    async outputs() {
      return keptPilotFiles().length ? [resolve(buildDir, 'rf-public-pilot-clean.db')] : [];
    },
    async execute() {
      const kept = keptPilotFiles();
      if (!kept.length) {
        process.stderr.write(
          '[build-core] public-pilot-clean-build: nothing kept (ORS dropped too, default) -- skipping.\n',
        );
        return 0;
      }
      const cleanDir = resolve(buildDir, 'pilot-rf-clean');
      await mkdir(cleanDir, { recursive: true });
      const { copyFile } = await import('node:fs/promises');
      await copyFile(resolve(pilotRoot, 'manifest.yaml'), resolve(cleanDir, 'manifest.yaml'));
      await copyFile(resolve(pilotRoot, 'aliases.yaml'), resolve(cleanDir, 'aliases.yaml'));
      for (const file of kept) {
        await copyFile(resolve(pilotRoot, file), resolve(cleanDir, file));
      }
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'medbase',
          'build',
          '--input',
          'data/build/pilot-rf-clean',
          '--output',
          'data/build/rf-public-pilot-clean.db',
          '--report',
          'data/build/rf-public-pilot-clean-report.json',
        ],
        { label: `build clean pilot pack (${kept.length} document(s) kept)` },
      );
    },
  },
  {
    name: 'finalize-clean',
    deps: ['finalize', 'public-pilot-clean-build', 'pilot-vocabulary-pack'],
    async inputs() {
      return {
        reference: resolve(buildDir, 'core-pointers-base.db'),
        clinical: resolve(buildDir, 'core-catalog-pointers-clinical.db'),
        medication: resolve(buildDir, 'core-medication-pointers-pinned.db'),
        cleanPilot: keptPilotFiles().length ? resolve(buildDir, 'rf-public-pilot-clean.db') : null,
        vocabulary: resolve(buildDir, 'pilot-vocabulary.db'),
        dropOrs,
      };
    },
    async outputs() {
      return [resolve(buildDir, `core.${VERSION}.no-pilot.db`)];
    },
    async execute() {
      const composeArgs = [
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
        'data/build/pilot-vocabulary.db',
      ];
      if (keptPilotFiles().length) {
        composeArgs.push('--input', 'data/build/rf-public-pilot-clean.db');
      }
      composeArgs.push(
        '--output',
        `data/build/core.${VERSION}.no-pilot.db`,
        '--edition-manifest',
        `data/build/core.${VERSION}.no-pilot.manifest.json`,
        '--edition-id',
        'minimed.core.ru',
        '--edition-version',
        VERSION,
        '--title',
        'Ядро MiniMed (без публичного пилота)',
        '--built-at',
        BUILT_AT,
        '--schema-version',
        String(SCHEMA_VERSION),
        '--compact',
      );
      return run('uv', composeArgs, {
        label: 'finalize layout without the 14-or-15 public-pilot documents',
      });
    },
  },
  {
    // Read-only audit (coordinator decision, 2026-09-27): the aliases table has no per-document
    // foreign key, so there is no field to "retarget" -- this records, for traceability, which
    // surviving document each pilot-vocabulary alias's canonicalTerm now resolves to via the same
    // lexical FTS the app uses, in the pilot-removed candidate.
    name: 'pilot-vocabulary-retargeting-report',
    deps: ['finalize-clean'],
    async inputs() {
      return {
        aliases: resolve(pilotRoot, 'aliases.yaml'),
        candidate: resolve(buildDir, `core.${VERSION}.no-pilot.db`),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'pilot-vocabulary-retargeting-report.json')];
    },
    async execute() {
      return run(
        'uv',
        [
          'run',
          '--project',
          'tools/ingest',
          'python',
          'tools/ingest/scripts/report_pilot_vocabulary_retargeting.py',
          '--aliases',
          'content/pilot-rf/aliases.yaml',
          '--candidate',
          `data/build/core.${VERSION}.no-pilot.db`,
          '--report',
          'data/build/pilot-vocabulary-retargeting-report.json',
        ],
        {
          label:
            'report what each pilot-vocabulary alias resolves to in the pilot-removed candidate',
        },
      );
    },
  },
  {
    name: 'pilot-removal-diff',
    deps: ['finalize', 'finalize-clean'],
    async inputs() {
      return {
        withPilot: resolve(buildDir, `core.${VERSION}.db`),
        withoutPilot: resolve(buildDir, `core.${VERSION}.no-pilot.db`),
      };
    },
    async outputs() {
      return [resolve(buildDir, 'core-pilot-removal-diff.json')];
    },
    async execute() {
      const startedAt = Date.now();
      const withPilotIds = await documentIds(resolve(buildDir, `core.${VERSION}.db`));
      const withoutPilotIds = await documentIds(resolve(buildDir, `core.${VERSION}.no-pilot.db`));
      const removed = [...withPilotIds].filter((id) => !withoutPilotIds.has(id)).sort();
      const unexpectedlyAdded = [...withoutPilotIds].filter((id) => !withPilotIds.has(id)).sort();
      const expectedRemoved = (
        dropOrs ? PILOT_DOCUMENT_IDS : PILOT_DOCUMENT_IDS.filter((id) => id !== ORS_DOCUMENT_ID)
      )
        .slice()
        .sort();
      const diff = {
        builtAt: BUILT_AT,
        version: VERSION,
        withPilotDocumentCount: withPilotIds.size,
        withoutPilotDocumentCount: withoutPilotIds.size,
        removedDocumentIds: removed,
        unexpectedlyAddedDocumentIds: unexpectedlyAdded,
        matchesExpectation:
          JSON.stringify(removed) === JSON.stringify(expectedRemoved) &&
          unexpectedlyAdded.length === 0,
        orsDecision: dropOrs
          ? 'dropped (default as of 2026-09-27: coordinator confirmed a real ORS/Регидрон ' +
            'instruction landed in data/build/medications-v2.db and ' +
            'data/build/grls-selected-instructions-v2.db -- drug.rf.regidron.instruction)'
          : 'kept (--keep-ors was passed)',
        withPilotChecksum: sha256(await readFile(resolve(buildDir, `core.${VERSION}.db`))),
        withoutPilotChecksum: sha256(
          await readFile(resolve(buildDir, `core.${VERSION}.no-pilot.db`)),
        ),
      };
      await writeFile(
        resolve(buildDir, 'core-pilot-removal-diff.json'),
        JSON.stringify(diff, null, 2),
      );
      return Date.now() - startedAt;
    },
  },
];

function keptPilotFiles() {
  if (dropOrs) return [];
  return [ORS_SOURCE_FILE];
}

async function documentIds(dbPath) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      "import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('SELECT id FROM documents')]))",
      dbPath,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to read document ids from ${dbPath}: ${result.stderr}`);
  }
  return new Set(JSON.parse(result.stdout));
}

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
