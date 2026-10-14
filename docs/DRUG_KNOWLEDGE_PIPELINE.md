# Offline drug and clinical-knowledge pipeline

MiniMed keeps three representations of medical content, each with a different job:

1. **Immutable source documents and chunks** preserve what the publisher actually said.
2. **Structured SQLite knowledge** stores drug identities, pediatric/safety facts, weighted relations, and review state.
3. **FTS/vector projections** make reviewed knowledge and exact professional-reference links searchable
   without generating an answer at runtime.

The relational layer is the source of truth for structured drug data. Vectors are a replaceable retrieval projection, not the database of record.

## Safety and rights boundary

`medbase collect-drugs` does not crawl websites or reverse-engineer mobile databases. It only:

- synchronizes an explicitly configured HTTPS resource;
- copies a manually obtained/licensed local export;
- records that a vendor/manual export is still required;
- blocks an enabled source when the catalog does not affirm offline-storage rights.

The catalog records separate permissions for offline storage, derivative processing, and
redistribution. Owner-supplied Allmed data and packaging assets are used for this personal project;
the owner decided on 2026-10-13 to publish the packaging-image pack with the source shown on every
photo. The [Allmed terms](https://allmed.pro/information/rules) still require written permission for
copying, distribution, and publication while the footer contains a contradictory source-link
allowance; the owner accepted that risk, it is not resolved.
GRLS text sent to an external AI remains a separate third-party-processing decision. The verified
ESKLP preview is published separately as identity-only content.

The verified ESKLP 2026-08-28 archive now has a published fifteen-module preview release for
identity/registration lookup. Those modules remain metadata-only (`trustedDoseData: false`) and are
gated by the Experimental setting. ESKLP authority here covers identity and registration facts, not
indications or dosing; exact measured core coverage is recorded in [CURRENT_STATE.md](CURRENT_STATE.md).

### Allmed packaging-image pack (published 2026-10-13)

Owner decision 2026-10-13: the pack is published (personal-use app); every photo shows a «?» with its
source instead of a rights gate. Rebuilt from the unchanged Allmed snapshot (SHA-256 `c8e85a68…`):

- module `minimed.medications.packaging-images.ru@allmed-images-c8e85a688094`, `kind: reference` (so
  the drug bundles «Скачать препараты» do not pull it in; it is an opt-in in Settings → Изображения),
  `releaseState: preview`, `minAppVersion` 0.6.60 (needs the sharded reader);
- 4 244 source references, 4 218 distinct, **4 214 images** (279.0 MB, the original bytes: no
  re-encoding, so checksums and provenance are exact), 4 failures (empty file names in the source rows);
- an index (`index.db`, 442 368 bytes, SHA-256 `e3dd4f33…`) and **16 ZIP shards** of 15.8–22.2 MB. A
  shard is the first hex digit of the SHA-256 of the image reference (`shard_of` in
  `allmed_images.py`, `packagingImageShard` in the app). Each shard has its own `manifest.json`
  (per image: checksum, size, content type, source URL, Allmed drug ids; pack-level `fetchedAt`);
- the app stores each ZIP as its own IndexedDB row (store `source-assets`, database v2) and keeps at
  most two shards open, so one photo reads ~17 MB, not the whole pack;
- mirror: branch `datasets/allmed-images-2026.10.13-c8e85a688094`,
  `modules/minimed.medications.packaging-images.ru.{db,source-assets-<x>.zip}` as plain blobs served
  by raw.githubusercontent.com (CORS), published with
  `scripts/publish-module-zstd-mirror.sh --family packaging-images`; the catalog URLs are the
  `releases/download/<tag>/…` form that `artifact-url.ts` maps to that branch;
- catalog entry added to `catalog.preview.json` (`catalogVersion` `packaging-images.2026.10.13`).

Rebuild (only when the snapshot changes; resume reuses cached downloads; never overwrite a published
tag, use a new `--mirror-tag`):

```bash
uv run --project tools/ingest medbase build-allmed-image-pack --input <allmed_tinybase.db> \
  --output data/build/allmed-images --mirror-tag allmed-images-<date>-<hash12>
scripts/publish-module-zstd-mirror.sh --family packaging-images --tag <tag> \
  --source-dir data/build/allmed-images/mirror --create
bun scripts/upsert-catalog-module.ts apps/app/src/features/modules/catalog.preview.json <entry.json> && bun run catalog:shell
```

The local release copy is `output/allmed-images-2026.10.13-c8e85a688094/` (index, 16 shards, catalog
fragment, build report); the download cache was deleted after verification. Integrity is covered by
`tools/ingest/tests/test_allmed_image_pack_published.py` (every image has checksum, source URL and
a drug link into the Allmed snapshot) and `apps/app/src/features/modules/packaging-images-catalog.test.ts`.

In the app each packaging photo (drug-screen header and the Allmed supplement panel) carries a round
«?» (aria-label «Источник изображения») that opens a popover (sheet on phones): site name (Allmed),
the source file's address as a link and the day it was fetched. The credit line and caption were
removed. E2E: `apps/app/e2e/packaging-image-source.spec.ts` (local release copies, `E2E_PORT=4185`).

## End-to-end workflow

### 1. Register sources

Copy the example and fill in actual contract/export details:

```bash
cp docs/examples/drug-sources.yaml data/raw/drug-sources.yaml
```

Do not set `enabled: true` until `location`, `target`, and the rights fields are verified.

### 2. Collect snapshots

```bash
bun run content:collect:drugs
```

The command delegates downloads and local-file copies to the existing checksum/ETag/cache-backed sync layer. It writes:

- collected files below `data/raw/collected-drugs/`;
- `source-provenance.json` with rights and checksums;
- `data/build/drug-source-report.json` with synced, pending, disabled, and blocked sources.

Raw/licensed datasets remain gitignored.

### 3. Convert a source into the normal prepared workspace

Use the existing source registry and preparer. Each prepared Markdown chunk retains source spans, pages, checksums, and stable anchors:

```bash
bun run content:prepare:private
```

A vendor-specific adapter should convert XML/JSON/CSV records into source-preserving Markdown plus metadata. It must not discard the original export.

Every non-synthetic prepared document must also carry a fail-closed rights declaration in its source metadata:

```yaml
metadata:
  rights:
    licenseId: contract-or-source-terms-id
    allowsDerivativeProcessing: true
```

`medbase ai-export` refuses to emit any non-synthetic source without both fields. The resulting task repeats the licence ID and permission flag so the handoff remains auditable. Collection permission alone is not treated as permission to send text through ChatGPT.

### 4. Export ChatGPT tasks

```bash
bun run content:ai:export
```

This creates `data/intermediate/chatgpt-tasks.jsonl`, one record per source chunk. Each task contains the exact source text, document/version/section/chunk IDs, page/span metadata, and non-negotiable extraction rules.

Paste `docs/prompts/drug-enrichment-chatgpt.md` into ChatGPT, then process manageable JSONL batches. Save one JSON response object per input task to a local JSONL file.

### 5. Validate and import proposals

```bash
bun run content:ai:import -- \
  --input data/intermediate/private-pilot \
  --responses data/intermediate/chatgpt-responses.jsonl \
  --output data/intermediate/private-pilot/knowledge.proposed.yaml
```

The importer rejects:

- an unknown task/chunk ID;
- duplicate task IDs;
- a fact or relation whose evidence quote is not an exact substring of its source chunk;
- an entity reference that was not declared in the same task;
- invalid weights or graph references.

Every imported fact and relation is forced to `reviewStatus: proposed`. ChatGPT cannot mark content reviewed. The importer also derives `authorityTier` from the source document metadata/type; an AI response cannot promote a third-party document to an official label or guideline.

Missing pediatric doses, maximum doses, indication-specific regimens, contraindications, or prescription requirements become explicit `reviewTasks`. They are never inferred from adult data or completed from model memory. A missing field is completed only by adding another licensed/source-preserving document, extracting an exact quote from it, and passing clinical review.

### 6. Clinical/editorial review

A reviewer compares each proposal with the opened source and approves selected IDs:

```bash
bun run content:knowledge:approve -- \
  --source data/intermediate/private-pilot/knowledge.proposed.yaml \
  --output data/intermediate/private-pilot/knowledge.yaml \
  --reviewer "clinical-pharmacist@example.org" \
  --id fact.example \
  --id relation.example
```

Approval records the reviewer and timestamp. For relations it also sets the editorial-review component to `1.0` and recalculates the deterministic weight.

This command records an attestation; it does not replace the clinical review process. High-risk pediatric, neonatal, renal/hepatic, pregnancy, controlled-drug, and dose-calculation content should require the project’s configured second-review policy.

### 7. Lint and compile the offline pack

```bash
bun run content:knowledge:lint -- --input data/intermediate/private-pilot
bun run content:build:private
```

`medbase build` now loads optional `knowledge.yaml`, validates every evidence pointer, adds reviewed terms
and exact `professional-reference` links to the linked chunk’s FTS projection, and writes the complete graph
into SQLite. Proposed/rejected facts and unrelated proposed relations stay in the relational audit layer but
do not enter search projections in normal builds. The public demo release temporarily passes
`--include-unreviewed-knowledge`, which indexes proposed records without changing their `reviewStatus` and
continues to exclude rejected records; remove that flag after the demo.

## Relational model

Migration `003_knowledge.sql` adds:

| Table | Purpose |
|---|---|
| `knowledge_entities` | Conditions, substances, clinical drugs, brands, drug classes, care topics, administrative concepts, and future non-medical entity types |
| `knowledge_names` | Russian/Latin names, trade names, INN variants, abbreviations, misspellings, and other aliases |
| `medication_profiles` | Non-vector drug identity fields: concept level, INN, ATC, form, route, strength, registration and pediatric status |
| `knowledge_facts` | Typed facts such as pediatric use, dosing, contraindications, warnings, interactions, administration, monitoring, pregnancy/lactation, and prescription rules |
| `knowledge_relations` | Drug-condition, class-drug, treatment-document, contraindication, off-label, and alternative relationships with deterministic weights |
| `knowledge_evidence` | Exact source quote and document/version/section/chunk provenance for every fact/relation |
| `knowledge_document_links` | Explicit links from an entity to existing clinical recommendations or other documents |
| `knowledge_review_tasks` | Missing fields, conflicts, stale material, and reviewer questions |
| `knowledge_fts` | Reviewed and exact professional-reference structured lookup index |

`structured_json` and `population_json` preserve extensibility while stable columns cover high-value filters. A pediatric dose can carry age/weight/gestational-age constraints, route, frequency, duration, maximum dose, approval status, and jurisdiction without flattening everything into prose.

## How illnesses, treatments, drugs, and documents connect

A typical graph is:

```text
condition entity
  ├─ described-by ───────────────> clinical recommendation/document chunk
  ├─ has-recommended-treatment ──> medication or non-drug intervention
  ├─ has-off-label-option ───────> medication
  ├─ has-contraindication ───────> medication/intervention
  └─ has-care-guidance ──────────> feeding, first-aid, follow-up, or prevention topic
```

A medicine remains a separate entity hierarchy:

```text
substance → clinical drug (ingredient + strength + form + route)
          → branded product → package/registration
```

Do not merge these levels by display name. External IDs and reviewed crosswalks should connect GRLS/ESKLP/vendor/ATC/GTIN concepts where the licence permits.

### Relation weight

The stored `final_weight` is deterministic:

```text
0.30 × authority
+ 0.25 × evidence quality
+ 0.20 × applicability
+ 0.10 × recency
+ 0.15 × editorial review
```

It is a ranking signal, **not** a probability that a treatment is safe or correct. `relationStatus` and `authorityTier` remain visible, so an official recommendation, supported off-label option, third-party practice, contraindication, and anecdotal method cannot collapse into one undifferentiated score.

## Runtime search flow

Runtime remains local and deterministic:

```text
Russian free-text query
  → fact extraction (age, sex, duration, measurements, medications, negation)
  → intent classification
  → intent-specific clarification suggestions
  → weighted lexical branches + optional local vector branch
  → source chunks and reviewed knowledge projections
  → open exact source context
```

Current intents are:

- diagnosis;
- treatment;
- medication lookup;
- disease reference;
- care guidance (feeding, growth, prevention, first-aid guidance);
- administrative reference;
- mixed/unknown.

The intent engine is profile-driven: another project can reuse `classifyIntent` with engineering entities, signals, and refinements while keeping the same offline storage/search architecture.

## ATC code completion (ATC2)

ЕСКЛП gives every СМНН node an `atcCode`; `~` means none and a five-character code is a group stub. A deterministic
post-processing step completes the published ЕСКЛП modules from other sources and records where each code came from.
It never touches text, vectors or the search index.

```bash
cd tools/ingest
uv run python scripts/build_atc_fill.py derive --out DIR   # ledger.jsonl, coverage.json (before/after)
uv run python scripts/build_atc_fill.py apply  --out DIR   # DIR/patched/*.db: documents.metadata_json only, VACUUMed
cd ../.. && bun scripts/reframe-modules.ts --marker atc2 --family esklp --decoded-dir DIR/patched \
  --out-dir output/module-zstd-esklp-atc2-<date> --published-at <UTC now> [--module-id …] [--write-catalog]
scripts/publish-module-zstd-mirror.sh --family esklp --tag esklp-2026-08-28-atc2 --source-dir output/…/<tag> --create
```

Input is the decoded published module set (catalog `decodedSha256`), the НСИ «АТХ» rows
(`data/raw/nsi/atc/v*/rows.json`, `scripts/fetch-nsi-dictionary.sh`) and the prepared instruction Markdown named by
`grls-instruction-text-manifest.jsonl`. Rules (`localmed_ingest/atc_fill.py`):

1. Normalise every code (Cyrillic look-alikes, the letter O for a zero) and take its level (1-5 by length 1/3/4/5/7).
2. Candidates per node: `instruction-text` (the code after «АТХ»/«ATC» in the instruction of any registration of the node;
   `instruction-text-ocr` when the text is OCR), `same-inn` (normalised МНН components + dosage-form class: injection, eye,
   ear, nasal, inhalation, rectal, vaginal, topical, oral-liquid, oral-solid, else the form text; a full ЕСКЛП code on
   another node), `same-inn-other-form` (only a node without its own full code, and only when every donor of the МНН agrees on
   one code, so route-dependent МНН such as hydrocortisone are never filled across routes), `same-inn-instruction`
   (instruction text of another registration with the same МНН and class) and `registry-nsi` (the level-5 НСИ name equals the
   МНН, combinations in any order; a name with several codes is an option set that can only support another source's code).
3. Agreement: codes agree when equal or when one is the group prefix of the other. All candidates agree → the longest code is
   applied (`filled` from none, `refined` from a stub) if a self-sufficient source supports it (OCR text alone does not:
   `unconfirmed`). Any disagreement, including with a full ЕСКЛП code, → `conflict`: nothing changes; the node gets
   `atcFlag` and `atcCandidates` (every code with its sources). An НСИ name with several codes and no other support is
   `ambiguous`.
4. Provenance in the card: node `atcCode` (completed), `atcOriginal`, `atcSource` (first of `atcSources`), `atcFlag`,
   `atcCandidates`; card `atcCodes` recomputed from the nodes, `atcFill` (version `atc-fill-1`, counts, source per code).
   No field means the code is ЕСКЛП's own.
5. Consensus against a stub (ATC3, owner decision 2026-10-14 «show both»). A `conflict` whose registry value is a level-4
   group stub (`L03AX`) and where **one** full code outside the stub (`J05AX13`) is proposed by sources of **two
   independent kinds** gets the node field `atcConsensus: {code, sources}` (`stub_consensus`); the card gets
   `atcConsensusCodes` (the list of such codes) and `atcFill.consensusNodes`. `atcCode`, `atcOriginal`, `atcFlag` and
   `atcCandidates` do not change: the registry code stays the official value, the app shows the agreed code first and
   the registry code beside it («J05AX13 · в реестре: L03AX»), and search, the group tree and the comparison index use
   both. Independent kinds: *registry* (`same-inn`, `same-inn-other-form`) and *instruction* (`instruction-text`,
   `same-inn-instruction`, and `instruction-text-ocr`, which counts as the instruction kind but never makes a
   consensus without the registry kind). Two instructions are one kind. The НСИ dictionary does not vote: a name with
   several codes is only an option set, and a code the dictionary lacks for a form is not a contradiction. A claim that
   repeats the stub or stops at the full code's group is neutral; a second full code, or another group, is a
   disagreement and there is no consensus. `apply` checks every written consensus (`consensus_problems`) and refuses
   an invalid one. On the 2026-10-13 inputs this gives 26 nodes in 13 cards (9 groups).

Measured precision (agreement with the 5 369 full ЕСКЛП codes): instruction text 95.6 %, OCR text 94.3 %, НСИ 95.8 %,
same МНН and class 98.1 %, instruction of the same МНН 96.0 %. Result of the 2026-10-13 run and the coverage table are in
CURRENT_STATE.md «ATC completion» and «ATC consensus against a registry stub». To rerun after a ЕСКЛП refresh, decode the new
modules as ЕСКЛП published them (never an already filled set: `atcCode` is read as the registry value) into
`data/build/atc-fill/base/` and run `derive` and `apply` again; delete `DIR/patched` and the decoded copies afterwards.

The consensus (ATC3) is metadata only as well, so it ships the same way, only for the groups that hold a consensus node.
Compare the patched databases with the published modules table by table first (only `documents.metadata_json` may
differ, and there only the ATC fields), then:

```bash
bun scripts/reframe-modules.ts --marker atc3 --family esklp --module-id minimed.medications.<group>.ru … \
  --decoded-dir DIR/patched --out-dir output/module-zstd-esklp-atc3-<date> --published-at <UTC now> --write-catalog
bun run catalog:shell
scripts/publish-module-zstd-mirror.sh --family esklp --tag esklp-2026-08-28-atc3 --source-dir output/…/esklp-2026-08-28-atc3 --create
# the comparison index carries both codes of a card (from a worktree: MINIMED_DATA_ROOT = the main checkout)
MINIMED_DATA_ROOT=<main> CMP1_ESKLP_DIR=DIR/patched bun scripts/build-drug-comparison.ts
```

`reframe-modules.ts` replaces an `atcN` marker of the earlier tag and version (`…-atc2` becomes `…-atc3`), so a later fill
is `atc4`. The interaction and medication-safety indexes (`build-drug-interactions.ts`, `build-medication-safety.ts`) still
read the original ЕСКЛП release and take neither the ATC2 nor the ATC3 codes: their class rules (an ATC prefix decides
which interaction phrases apply) need a review of the new codes before they are rebuilt.

## Update policy

Each update should produce a new immutable source snapshot and content-pack checksum. Do not overwrite historical source text or review metadata. On change:

1. sync/export the new source;
2. diff source checksums and document versions;
3. re-export only changed chunks for ChatGPT assistance;
4. create conflict/staleness review tasks for affected facts and relations;
5. approve changes explicitly;
6. compile and sign a new SQLite pack;
7. retain the preceding pack for rollback and historical audit.

A source becoming unavailable does not make its prior medical claims current. Validity dates, registration status, source version, and review state must control ranking and presentation.

## Dose rules from official instructions (RX1, 2026-10-14)

`scripts/build-dose-rules.ts` reads the «Способ применения и дозы» sections of the released instruction modules with deterministic
patterns and writes a lazy index of structured rules, offsets and section checksums (no text). The instruction text stays the only
source; the prescription tool and the search dose card cut the quoted sentence from the installed instruction. See
[ADR-0025](adr/0025-dose-rule-index-and-prescription-draft.md) and [research/dose-rules-2026-10-14.md](research/dose-rules-2026-10-14.md).
