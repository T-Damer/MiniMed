# Clinical recommendation catalog inventory

MiniMed does not use a fixed target such as 30 or 50 recommendations. The catalog pipeline is designed
to inventory every discoverable record, categorize it, and explain why it is or is not present in a
loadable module.

## Inputs

The inventory command accepts a declared JSON, JSONL, CSV, TSV or delimited text export. Russian and
English column aliases are normalized for:

- official identifier;
- title and edition;
- ICD-10 codes;
- age category;
- developer;
- publication date;
- application status;
- official and source URLs.

The source file and taxonomy are both recorded by SHA-256 in the output ledger. The pipeline does not
silently crawl arbitrary web pages or claim that a partial export is the complete official registry.

```bash
uv run --project tools/ingest medbase-clinical-catalog build \
  --source data/raw/clinical-catalog/catalog.json \
  --taxonomy content/clinical-module-taxonomy.yaml \
  --overrides content/clinical-coverage-overrides.yaml \
  --output data/build/clinical-coverage-ledger.json
```

## Categorization

`content/clinical-module-taxonomy.yaml` is a versioned deterministic ruleset. It uses ICD-10 prefixes,
Russian title cues, developer cues and age categories. A recommendation may receive several labels,
but one highest-scoring module becomes the primary packaging destination.

The initial taxonomy covers emergency care, infectious diseases, pulmonology/allergology,
cardiology, gastroenterology, nephrology/urology, neurology, psychiatry/narcology, endocrinology,
hematology/oncology, rheumatology/immunology, dermatology, ophthalmology, ENT,
dentistry/maxillofacial surgery, surgery/trauma, obstetrics/gynecology, neonatology, general
pediatrics, rehabilitation/palliative care and a visible fallback category.

Rules are intentionally reviewable rather than model-generated. Incorrect or multidisciplinary
assignments can be corrected in `content/clinical-coverage-overrides.yaml` without changing source
metadata.

## Coverage states

Every normalized record receives one explicit state:

- `published` — available in a validated immutable module;
- `metadata-only` — searchable metadata exists, but no distributable full-text artifact is active;
- `needs-review` — source or extraction exists but still needs provenance, rights or structural review;
- `blocked-source` — the declared source could not be retrieved;
- `licence-restricted` — source redistribution is not permitted;
- `superseded` — replaced by another edition;
- `historical` — intentionally retained historical material;
- `failed-validation` — rejected by checksum, extraction, SQLite or retrieval gates.

Unknown or missing rows are never silently counted as published. Malformed rows are written to the
ledger warnings; conflicting duplicate official IDs fail the build.

## Generated ledger

The JSON ledger contains:

- normalized source records;
- primary and secondary module assignments;
- coverage and rights state;
- source and taxonomy checksums;
- counts by coverage state, status and module;
- warnings for skipped or duplicate rows;
- a deterministic module plan.

The ledger is the input to later source synchronization and module-generation PRs. Publication still
requires source-specific rights decisions, deterministic extraction, SQLite integrity checks and
retrieval benchmarks.

## Automation

`.github/workflows/clinical-catalog-inventory.yml` always validates the parser and taxonomy against a
fixture. A full inventory run requires either:

- a manual `catalog_url` and format through `workflow_dispatch`; or
- repository variables `CLINICAL_CATALOG_URL` and `CLINICAL_CATALOG_FORMAT` for scheduled runs.

The URL must use HTTPS. The workflow uploads the ledger and the declared source metadata as build
artifacts; it does not publish medical modules by itself.
