# Medication and regulatory catalog inventories

MiniMed treats medication records and legal acts as independently versioned source families. They are
not folded into clinical recommendations and are not trusted merely because a parser extracted a
field.

## Medication inventory

`bun run content:catalog:drugs` downloads the complete ZIP export linked from the official
[GRLS](https://grls.rosminzdrav.ru/GRLS.aspx) page, parses its XLSX files without a spreadsheet
runtime, prefers a current row when the same registration number occurs in historical workbooks, and
builds the normalized medication ledger. Raw downloads, checksums and outputs stay in ignored
`data/` directories.

`medbase-regulated-catalog medications` also accepts a declared JSON, JSONL, CSV or TSV export and
keeps registration identity separate from display names:

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

The public GRLS ZIP has no confirmed ATC field. Its pharmacotherapeutic description is preserved as
source metadata, but most records therefore remain in the visible unclassified module.

A medication record begins as `metadata-only`. Instruction text, contraindications, interactions and
doses require source-specific rights, exact evidence and review. Registration identity and an
instruction edition must not be merged solely by trade name.

### ESKLP snapshot assessment

The manually obtained official ESKLP export
`esklp_20260828_excel_00001.zip` is a candidate source snapshot, not a published MiniMed module. It
was downloaded from the [ESKLP portal](https://esklp.egisz.rosminzdrav.ru/esklp), declares source
date `28.08.2026` and format version `2.0.4`, and has SHA-256
`157e9ef147d2f7139d1c81e362f469d92155c4e586c1f46ef993f41ce7ab9a02`.

The archive passed ZIP integrity validation and contains:

- 7,672 active standardized MNN nodes, including form, strength, units, pharmacotherapeutic group,
  ATC, essential-medicines and controlled-substance flags, validity dates, and KLP links;
- 42,240 trade-name-to-SMNN records with registration numbers and normalized forms and strengths;
- 604,213 active KLP positions split across nine workbooks, including KLP code, trade name,
  normalized MNN/form/strength, package, registration holder, manufacturer, validity period,
  essential-medicines and controlled-substance flags, and available price metadata;
- 1,375 declared interchangeability groups.

ESKLP should own standardized medication identity and Russian catalog attributes in the MiniMed
graph. It can connect:

```text
SMNN node → clinical drug → trade name → KLP/package → registration record
          ↘ ATC / pharmacotherapeutic group / interchangeability group
```

It does not replace an official instruction or clinical recommendation. The inspected export does
not provide sufficient evidence for indications, contraindications, interactions, patient-specific
dosing, or a treatment recommendation. Those claims still require an exact instruction or clinical
source and independent review.

The first application-visible medication card may still target the complete experience, but it is a
multi-source composition rather than an ESKLP record:

```text
ESKLP identity, ATC, form, strength, KLP and package
  + GRLS registration and current official instruction
  + clinical-recommendation treatment passages
  + reviewed structured indications, contraindications, interactions and dose rules
  = source-backed MiniMed medication card
```

Every clinical field keeps its own source, edition, applicability and review status. A missing layer
stays visibly missing; the builder must not infer a contraindication, interaction or regimen from the
ESKLP identity fields.

Keep each ESKLP edition as an immutable raw snapshot with original filename, source URL, format
version, checksum, and row diagnostics. Join records by ESKLP/SMNN/KLP and registration identifiers,
not by display name alone. Redistribution and derivative-processing rights remain unresolved, so the
source stays disabled for released packs and raw files stay uncommitted until a documented rights
decision exists.

The local acquisition path accepts an explicitly selected ESKLP ZIP or the declared official HTTPS
export URL and records the original filename, checksum and edition before parsing. The app consumes a
built SQLite content pack rather than processing the large XLSX archive during startup. Existing
GitHub Releases infrastructure may distribute that immutable pack, but publishing a derived release
asset remains blocked until redistribution rights are documented. Until then, the same builder can
produce a local uncommitted pack for personal use.

### First ESKLP pack contract

ESKLP transformation runs off-device on a maintainer machine or in CI. The user receives only the
ready read-only SQLite pack; the application never parses the source XLSX workbooks. A release artifact
contains the database, immutable manifest, source-set checksum and coverage report. It does not
republish the raw ESKLP ZIP.

The primary application card represents the standardized MNN. Form, strength, trade name, KLP,
registration and package records remain typed child entries of that card:

```text
MNN card
  ├─ form and strength
  │    └─ trade name / KLP
  │         └─ registration and package
  └─ source-backed clinical sections
```

Search indexes standardized and normalized MNN values, trade names, forms, strengths and their useful
combinations. A query such as `Мирамистин мазь` resolves the MNN card but preserves and promotes the
matched form or trade presentation inside the result and opened card. Exact trade-name and
form-qualified matches must not be hidden behind generic MNN text matches.

The MNN card is the default navigation target, not the only detail surface. A trade name or KLP may
open a subordinate product detail when it has verified registration, instruction, formulation or
other clinically relevant differences that cannot be represented as a shared MNN fact. The product
detail links back to the MNN and must not copy a generic MNN statement as though it were verified for
that specific product.

Every MNN card has an expandable `Торговые наименования` section listing all linked trade names and
their available form, strength, KLP, registration and package context. A trade name remains visible in
this section even when it does not justify a separate product detail.

A standardized fixed combination receives its own MNN card and explicit component relations to the
individual substance cards. Search by any component may surface the combination, but the combination
must not inherit component contraindications, interactions or dose rules without source-backed
applicability to that combination.

Metadata-only and partially enriched cards are allowed. Each missing indication, contraindication,
interaction or dose section is shown as unavailable rather than inferred, while available clinical
facts retain their own source and applicability. Clinical facts are scoped at least by indication,
population, form, route, strength where relevant, jurisdiction, source edition and review state; the
shared MNN page is only their container.

The initial catalog is produced by one reproducible end-to-end build invocation: validate and import
the complete ESKLP snapshot, attach every available declared source, build the SQLite pack, run
integrity and coverage checks, and emit the release artifacts. This one-run requirement does not
authorize filling unsupported clinical fields. The same build clinically enriches a declared
priority set of common therapy and pediatric medicines; the remainder of the complete ESKLP catalog
may ship with visibly incomplete clinical sections.

Only one catalog edition is active. The preceding SQLite artifact may be retained for a compatible
rollback, but the application keeps no legacy parser, migration adapter or old-schema runtime path.
During active development, an incompatible schema change requires rebuilding the pack rather than
preserving compatibility code.

`bun run content:rebuild:drug-instructions` refreshes selected current GRLS instructions and builds a
local SQLite pack. A PDF without a text layer remains an explicit OCR task instead of becoming an
empty document.

## Official legal-publication inventory

`medbase-regulated-catalog laws` uses the read-only API documented by the Official Internet Portal of
Legal Information:

```text
https://publication.pravo.gov.ru/api/Documents
https://publication.pravo.gov.ru/api/Document?eoNumber=...
```

`content/official-health-law-queries.yaml` declares the health-related searches. The typed collector:

- uses HTTPS and only the official publication host;
- requests supported page sizes and follows the reported page count;
- records every request URL and raw page in the source checksum;
- validates object and integer fields before storing them;
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
detail metadata, legal categories, Russian title inflections, medication registration identity and
ATC packaging before a live source is queried.

The compatibility module and typed implementation are validated together, so callers keep one stable
import path while malformed API fields remain fail-closed.

GRLS collection is read-only and uses its official complete export and instruction endpoints. It
does not use commercial interfaces. Raw PDFs and generated local packs are not committed or
published automatically; redistribution still requires an explicit rights decision.

Official law collection is also opt-in for scheduled runs through `ENABLE_LEGAL_CATALOG_SYNC=true`.
The query configuration and raw API pages are uploaded alongside the normalized ledger so coverage
changes can be audited. Fixture validation proves parser behavior only; real coverage totals always
refer to the exact configured export or official API pages preserved with that run. Normal CI must
pass formatting, strict typing and the offline regulated-catalog fixture suite, and every live run
must retain its declared source URL or raw official API pages. The permanent workflow is read-only;
formatting changes must be committed before validation.

Temporary diagnostic workflows may capture exact tool output while a branch is being repaired, but
they and their generated reports must be removed before the PR is merged. Diagnostics must contain
only repository fixtures, tool output and public-source metadata—never patient or user query data.

## Publication boundary

These ledgers are inputs to later module builders. A record becomes `published` only after:

1. source identity and rights are recorded;
2. source material is stored with a checksum;
3. deterministic extraction succeeds;
4. SQLite integrity and FTS checks pass;
5. retrieval benchmarks pass;
6. the immutable artifact and its source-set digest are published;
7. the app can install, mount, remove and roll it back.
