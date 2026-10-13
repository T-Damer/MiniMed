# Data tests

Owner rule (2026-10-13): every type of data the app ships or downloads is covered by tests — not every
word, but every type. This page lists each data type, where it comes from, which tests guard it, what
they check and what is still open. Tests assert **invariants** (shape, unique and stable ids,
references that resolve, checksums equal to the catalog, counts in sane ranges, one representative
content assertion), never exact counts that content work will change.

## How the tests run

| Command | What runs |
| --- | --- |
| `bun run test` | everything below except the rows marked *release*; `test:unit` restores `core.db` first |
| `bun run python:check` / `bun run test:python` | Python builders and committed-artifact tests |
| `bun run test:data:release` | adds the gitignored companion packs (`mkb.db`, `medications.db`, `ambulatory.db`); set `MINIMED_COMPANION_DIR=/abs/path/to/apps/app/public/content` when running from a worktree |
| `MINIMED_RELEASE_DATA=1 MINIMED_MODULE_DIRS=/abs/output:/abs/data/build bunx vitest run packages/storage-sqlite/tests/local-release-modules.data.test.ts` | *release*: every locally built module artifact (КР, ЕСКЛП, ГРЛС, Allmed, ICD-11, RLS, krasotaimedicina, ...) is matched to its catalog entry by size and SHA-256, decoded, and checked (decoded checksum, `quick_check`, foreign keys, membership, `previewDocumentCount`). 812 artifacts, about one minute; skips cleanly without the variables or files. Run it before publishing modules, next to `benchmark:real:release` |

Test files written for this page carry `.data.test.ts` / `test_data_*.py`:

- `packages/storage-sqlite/tests/shipped-packs.data.test.ts` — every SQLite pack in the repository
- `packages/storage-sqlite/tests/local-release-modules.data.test.ts` — *release*, local module artifacts
- `apps/app/src/features/modules/catalog.data.test.ts` — catalog structure and core pointers
- `apps/app/src/data-assets.data.test.ts` — JSON assets, indexes, manifests, images, landing snapshots
- `tools/ingest/tests/test_data_shipped_tool_modules.py` — authored tool modules rebuild into the shipped packs

## Inventory

`P` = pack integrity in `shipped-packs.data.test.ts` (`quick_check`, foreign keys, content pack row,
current version of every document, a chunk for every document, no empty chunks/aliases, doubly linked
chunks, embeddings with profiles). `C` = `catalog.data.test.ts`. `A` = `data-assets.data.test.ts`.

### SQLite packs and modules

| Data type | Source | Tests | What is checked | Gap |
| --- | --- | --- | --- | --- |
| `core.db` (discovery index, 20 002 pointer documents, identity index) | `content/bundled/core.db.gz`, restored by `content:restore:core` | `P`; `C` (core pointers); `packages/storage-sqlite/tests/core-identities.test.ts`; `test_core_identity_index.py`; `test_core_reference_pointers.py`; `benchmark:all` | bundled archive equals `core-report.json` transfer checksum/size; counts, version and identity-index totals equal the report; every target has an identity and a typed pointer; every document's module is in the catalog and lists the target document | none; the 445 MB file is not rebuilt in tests |
| `reference.db`, `regulatory.db` (bundled companions) | `apps/app/public/content` | `P`, sidecar `*-report.json` | checksum equals report, integrity, representative titles; `regulatory.db` counts equal the report | defect 1 |
| `mkb.db`, `medications.db`, `ambulatory.db` (gitignored companions) | local builds | `P` via `test:data:release` | same pack integrity, document minimums | *release* only; stale builds in the main checkout (Aug–Sep) still pass |
| Tool modules ×16 (245 calculators/questionnaires) | `content/tool-modules/*.json` → `apps/app/public/content/modules/minimed-tools-*.db` | `P` (tool section); `test_data_shipped_tool_modules.py`; `test_tool_modules.py`; `tool-age-scope-audit.test.ts`; `calculator-*.test.ts`, `assessment-*.test.ts`; `local-artifact-checksums.test.ts` | one file per catalog tool module; catalog version and `sourceSetDigest` equal the authored file; pack `checksum` equals the file digest; stored tools, kinds, slugs, definitions and source counts equal the JSON; a rebuild reproduces the shipped pack row for row; tool ids and slugs unique across modules; every definition parses with its contract and declares `ageScope` | none |
| Pediatric growth/BP reference (WHO 0–5/5–19, AAP) | tool module `pediatrics-growth` (definitions carry the tables) | tool-module rows above; `calculator-growth-demo.test.ts` (published WHO example, range errors) | definitions parse, calculations reproduce published values | tables are inside the definition JSON; no separate table-integrity test (monotone z-score columns) |
| Diets pack (`minimed.reference.diets.ru`) | `content/diets-official` → `…diets.2026.10.12.db.gz` | `P`, catalog checksums (`P`, gzip decode), `test_diets_official.py` | decoded checksum/size equal the catalog; pack integrity; a «диет…» title exists | another agent is changing diets (DQ1); no rebuild-equals-shipped test |
| Medical-services pack (725 documents) | `…medical-services.2026.10.12.db.gz` | `P`, catalog checksums, `test_regulated_catalogs.py` | as above; titles `Услуга A00.00.000` | none |
| Regulatory acts pack | `minimed.regulatory.pediatrics.2026.10.13.db.gz` (+ `regulatory.db`) | `P`, `local-artifact-checksums.test.ts`, `test_regulatory_edition_ledger.py`, `test_regulatory_pack.py`, `benchmark:regulatory` | every act has number, date, issuer, edition, source URL, checksum, no empty section; «приказ <номер>» finds each act first | none |
| Reference pediatrics, respiratory pediatrics packs | committed `.db` | `P` | integrity, representative titles | legacy preview packs |
| КР clinical modules ×775 (+30 new editions) | `datasets/clinical-json-*` mirrors, built in `data/build/release-clinical` | `catalog.preview.test.ts`, `catalog.clinical-editions.test.ts`, `clinical-editions.test.ts`, `C`; `test_clinical_*.py`; *release* module check | catalog ids/artifacts/dependencies/sizes/membership structure; editions chain; local artifacts decode to the catalog checksum and membership | contents of a КР module are only checked in the *release* run, not in the fast suite |
| ЕСКЛП module ×15, ГРЛС instructions ×15, Allmed, manufacturer-site | mirrors | `catalog.preview.test.ts`, `section-manifest-source.test.ts`, `instruction-fallback.test.ts`, `C`, `test_esklp_*.py`, `test_grls_*.py`, `test_manufacturer_instruction_modules.py`, *release* | zstd/dataset-mirror URLs, group membership, fallbacks, decoded identity | drug modules are being changed by other agents |
| ICD-11, МКБ-10, RLS packaging, krasotaimedicina, definitions, DDInter | mirrors | `catalog.preview.test.ts`, `terminology-catalog.test.ts`, `C`, `test_icd11_prepare.py`, `test_rls_mkb*.py`, `test_krasotaimedicina_*.py`, `test_definition_*.py`, `test_ddinter_severity.py`, *release* | gzip/zstd identities for each optional pack, language/identity checks | — |

### Lazy JSON and static assets

| Data type | Source | Tests | What is checked | Gap |
| --- | --- | --- | --- | --- |
| Module catalogs (`catalog.preview/shell/terminology/clinical-editions.json`) | generated by catalog scripts | `C`; `catalog.preview.test.ts`; `module-catalog-shell.test.ts`; `terminology-catalog.test.ts`; `catalog.clinical-editions.test.ts`; `landing/catalog-facts.test.ts` | schema parse; unique module and artifact ids; dependencies resolve; checksum/size/https on every artifact; decoded identity for compressed ones; download = sum of artifacts; installed ≥ decoded; membership vs artifacts and `previewDocumentCount`; no module needs a newer app than `release.json`; two named artifact-free preview stubs | none |
| ATC names (НСИ v3.8) | `features/medications/atc-names.json` | `atc-names.test.ts` | parser rejects malformed assets; levels 1–4 present; two real codes named | none |
| Manufacturing countries | `mfg-countries.json` | `mfg-country.test.ts` | parser, key normalisation, resolution, bundled asset | none |
| Substance fallback | `substance-fallback.json` | `instruction-fallback.test.ts`, `test_substance_fallback.py` | real asset parses; donor rules | none |
| Drug interaction / safety / comparison indexes | `features/drug-*/data/*-index.json` | `interaction-index.test.ts`, `safety-index.test.ts`, `comparison-*.test.ts`, `A` | parsers reject references outside the tables; the real assets parse; all three share a module basis that the catalog lists | defect 2 |
| Sick-leave periods | `features/sick-leave/sick-leave-periods.json` | `sick-leave-data.test.ts` | parser, 16 tables of the letter, real ICD-10 lookups, uncovered codes | being changed by another agent (DQ1) |
| Vaccination calendar (order 1122н) | `features/vaccination/data/ru-minzdrav-1122n.json` | `packages/contracts/tests/vaccination-calendar.test.ts`, `test_vaccination_calendar.py` | contract, source page for every row, no empty cell, OCR agreement, rebuild equals committed | none |
| Form schemas ×13 | `features/forms/schemas/*.json` | `form-registry.test.ts`, `form-*.test.ts`, `test_medical_forms.py` and per-form `test_medical_form_*.py` | contract, provenance, paragraph citations, rebuild equals committed, overlay calibration | none |
| ICD-10 → ICD-11 map | `features/icd11/icd10-icd11-map.json` | `icd10-icd11-map.test.ts` | parser, chapter logic, bundled asset resolves a known code | none |
| Section manifest | `features/sections/section-manifest.json` | `section-manifest-source.test.ts` | collections/modules still in the catalog, no duplicate or empty groups | none |
| Suggested feeds | `features/news/suggested-feeds.json` | `suggested-feeds.test.ts` | validation, unique ids/addresses, no remote picture | none |
| Model catalog, query encoder (kd1) manifest | `features/models/catalog.preview.json`, `semantic/e5-model.ts` | `models/catalog.test.ts`, `selection.test.ts`, `e5-model.test.ts` | schema, hosts, hashes; pinned checksum and size of every encoder file | the model weights themselves are not in the repo |
| Symptom expressions (lexical) | `packages/search-lexical/src/symptom-expressions.ru.json` | `A`; `analysis.test.ts` | unique ids, normalised phrases, no phrase shared by two symptoms | none |
| Reference images (preview 3 files, full manifest 9 123 images) | `public/content/reference-images*` | `A`; `reference-image-assets.test.ts`; `test_reference_images.py` | preview files exist with the recorded size and SHA-256 (content-addressed names); manifest totals equal its entries; failures are a small recorded minority | the 484 MB archive is not in the repo (`reference-images.sha256` only) |
| Onboarding MRI slices | `public/onboarding/mri-viewer` | `A` | slice files exist and are non-trivial; source and licence recorded | none |
| Landing snapshots | `apps/landing/src/data/*.json` | `A`; `landing/src/scripts/*.check.ts` | search cards keep anchors and checksums | defect 3 |
| ECG paediatric norms, ECG ST/photo/CNN | `calculators/ecg-pediatric-norms.ts`, `ecg-*.ts`, `tools/ecg-cnn` | `ecg-pediatric-norms.test.ts` (printed table values), `ecg-*.test.ts`, `ecg-st-ptbxl.test.ts` | published values reproduced | CNN weights are not shipped in the repo |
| Test fixtures (`core-demo.json`, `core-slice.json`) | `packages/test-fixtures` | used by core/storage tests; `build-core-slice.ts` regenerates | exercised indirectly | no standalone shape test (fixtures only) |
| PWA shell (`manifest.webmanifest`, icons, `sw.js`) | `apps/app/public` | `A` | files exist; icon paths resolve | — |

User data (patient vault, notes, diaries, downloaded books, subscriptions) is created on the device and
has its own store tests (`*-store.test.ts`); it is not shipped data.

## Defects found

1. **`reference-report.json` is stale.** It reports 10 documents / 40 sections / 40 chunks / 14 aliases / 40
   embeddings; the checksum-matching `reference.db` holds 18 / 94 / 94 / 29 / 94. Test:
   `reference.db counts equal reference-report.json` (`.fails`). Fix: regenerate the sidecar report.
2. **Drug indexes were built on the `…e5` instruction modules, the catalog ships `…kd1`.**
   `interaction-index.json`, `safety-index.json` and `comparison-index.json` record
   `grls-2026.10.05.e5` versions and checksums; `catalog.preview.json` has `grls-2026.10.05.kd1`
   (only the manufacturer-site module still matches). Section checksums in the indexes stay valid only if
   the instruction text is unchanged. Test: `record the exact module versions and checksums the catalog
   ships` (`.fails`). Fix: rebuild the three indexes from the shipped modules, then remove `.fails`.
3. **Landing snapshots are older than their sources.** `apps/landing/src/data/calculator.json` and
   `questionnaire.json` lack `ageScope` and still carry `audience`, unlike the authored definitions in
   `content/tool-modules`; the README promises unchanged copies. Test: `keep the shown calculator and
   questionnaire equal to their authored definitions` (`.fails`). Fix: refresh the snapshots.
4. Note, not a defect: `minimed.clinical.pediatrics.infectious` and `…nephro-urology` are preview
   placeholders without an artifact; `catalog.data.test.ts` names them so a new artifact-free module fails.

An expected-fail test that starts passing fails the run on purpose: remove `.fails` once the data is fixed.
