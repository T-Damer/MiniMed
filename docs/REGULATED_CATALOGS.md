# Medication and regulatory catalog inventories

MiniMed treats medication records and legal acts as independently versioned source families. They are
not folded into clinical recommendations and are not trusted merely because a parser extracted a
field.

## Medication inventory

`medbase-regulated-catalog medications` accepts a declared JSON, JSONL, CSV or TSV export and keeps
registration identity separate from display names:

- registration number;
- trade name and INN list;
- ATC codes;
- dosage form, strengths and routes;
- manufacturer and registration holder;
- registration status and source edition;
- pediatric-use and prescription-status source fields;
- official and instruction URLs;
- coverage and rights state.

The ATC-based taxonomy in `content/medication-module-taxonomy.yaml` produces independent loadable
module plans for the major ATC groups. Products without a confirmed ATC code remain visible in the
unclassified module rather than being guessed into a therapeutic group.

A medication record begins as `metadata-only`. Instruction text, contraindications, interactions and
doses require source-specific rights, exact evidence and review. Registration identity and an
instruction edition must not be merged solely by trade name.

## Official legal-publication inventory

`medbase-regulated-catalog laws` uses the read-only API documented by the Official Internet Portal of
Legal Information:

```text
https://publication.pravo.gov.ru/api/Documents
https://publication.pravo.gov.ru/api/Document?eoNumber=...
```

`content/official-health-law-queries.yaml` declares the health-related searches. The collector:

- uses HTTPS and only the official publication host;
- requests supported page sizes and follows the reported page count;
- records every request URL and raw page in the source checksum;
- deduplicates acts by electronic publication number;
- optionally requests document-type and authority details;
- preserves publication, signature and Ministry of Justice registration metadata;
- categorizes acts with `content/legal-module-taxonomy.yaml`;
- emits metadata-only records until source PDF packaging and applicability review are complete.

Initial categories cover care organization, clinical quality, medicines/pharmacy,
sanitary-epidemiology, licensing/workforce/education, medical records/consent/privacy, OMC and
financing, disability/rehabilitation, maternal/child health, emergency/military/forensic medicine and
a visible fallback group.

The API identifies published acts. It does not by itself prove that an act is currently applicable or
that it supersedes another act. Amendment, invalidation and replacement relationships require a
separate applicability pass and remain explicit review work.

## Automation

`.github/workflows/regulated-catalog-inventory.yml` runs parser and classification tests without
network access on every relevant pull request. The fixture suite validates pagination, duplicate acts,
detail metadata, legal categories, medication registration identity and ATC packaging before a live
source is queried.

A complete medication inventory requires an explicitly configured HTTPS export through
`MEDICATION_CATALOG_URL` or manual workflow input. The repository does not scrape GRLS, ESKLP or
commercial interfaces without a supported export and documented rights.

Official law collection is also opt-in for scheduled runs through `ENABLE_LEGAL_CATALOG_SYNC=true`.
The query configuration and raw API pages are uploaded alongside the normalized ledger so coverage
changes can be audited. Fixture validation proves parser behavior only; real coverage totals always
refer to the exact configured export or official API pages preserved with that run. Normal CI must
pass formatting, strict typing and the offline regulated-catalog fixture suite, and every live run
must retain its declared source URL or raw official API pages. The permanent workflow is read-only;
formatting changes must be committed before validation.

Temporary diagnostic workflows may capture exact tool output while a branch is being repaired, but
they and their generated reports must be removed before the PR is merged.

## Publication boundary

These ledgers are inputs to later module builders. A record becomes `published` only after:

1. source identity and rights are recorded;
2. source material is stored with a checksum;
3. deterministic extraction succeeds;
4. SQLite integrity and FTS checks pass;
5. retrieval benchmarks pass;
6. the immutable artifact and its source-set digest are published;
7. the app can install, mount, remove and roll it back.
