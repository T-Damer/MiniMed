# Offline drug and clinical-knowledge pipeline

MiniMed keeps three representations of medical content, each with a different job:

1. **Immutable source documents and chunks** preserve what the publisher actually said.
2. **Structured SQLite knowledge** stores drug identities, pediatric/safety facts, weighted relations, and review state.
3. **FTS/vector projections** make reviewed knowledge searchable without generating an answer at runtime.

The relational layer is the source of truth for structured drug data. Vectors are a replaceable retrieval projection, not the database of record.

## Safety and rights boundary

`medbase collect-drugs` does not crawl websites or reverse-engineer mobile databases. It only:

- synchronizes an explicitly configured HTTPS resource;
- copies a manually obtained/licensed local export;
- records that a vendor/manual export is still required;
- blocks an enabled source when the catalog does not affirm offline-storage rights.

The catalog records separate permissions for offline storage, derivative processing, and redistribution. Derivative processing must be allowed before a source is sent through the ChatGPT handoff. The example catalog deliberately leaves Allmed, GRLS, ESKLP, and commercial datasets disabled until a supported export and appropriate terms are supplied.

## End-to-end workflow

### 1. Register sources

Copy the example and fill in actual contract/export details:

```bash
cp docs/examples/drug-sources.yaml data/raw/drug-sources.yaml
```

Do not set `enabled: true` until `location`, `target`, and the rights fields are verified.

### 2. Collect snapshots

```bash
pnpm content:collect:drugs
```

The command delegates downloads and local-file copies to the existing checksum/ETag/cache-backed sync layer. It writes:

- collected files below `data/raw/collected-drugs/`;
- `source-provenance.json` with rights and checksums;
- `data/build/drug-source-report.json` with synced, pending, disabled, and blocked sources.

Raw/licensed datasets remain gitignored.

### 3. Convert a source into the normal prepared workspace

Use the existing source registry and preparer. Each prepared Markdown chunk retains source spans, pages, checksums, and stable anchors:

```bash
pnpm content:prepare:private
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
pnpm content:ai:export
```

This creates `data/intermediate/chatgpt-tasks.jsonl`, one record per source chunk. Each task contains the exact source text, document/version/section/chunk IDs, page/span metadata, and non-negotiable extraction rules.

Paste `docs/prompts/drug-enrichment-chatgpt.md` into ChatGPT, then process manageable JSONL batches. Save one JSON response object per input task to a local JSONL file.

### 5. Validate and import proposals

```bash
pnpm content:ai:import -- \
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
pnpm content:knowledge:approve -- \
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
pnpm content:knowledge:lint -- --input data/intermediate/private-pilot
pnpm content:build:private
```

`medbase build` now loads optional `knowledge.yaml`, validates every evidence pointer, adds reviewed terms to the linked chunk’s FTS/vector projection, and writes the complete graph into SQLite. Proposed/rejected facts stay in the relational audit layer but do not enter search projections.

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
| `knowledge_fts` | Reviewed-only structured lookup index |

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
