# Loadable catalog metadata modules

MiniMed can make an inventoried record searchable before its complete source text is distributable.
This is done with a metadata module, not by pretending that a catalog row is a clinical document.

## Why metadata modules exist

Complete clinical recommendations, drug instructions and legal PDFs have different source access,
rights and extraction requirements. Waiting for every full-text source would make the rest of the
catalog invisible. Publishing unverified text would be worse.

A metadata module provides a safe intermediate state:

- the record is categorized and loadable;
- identity, edition, status and provenance remain searchable;
- the official or declared source link is preserved;
- the UI can state that full text is not installed;
- a later validated full-text version can replace or extend the same record through the normal module
  lifecycle.

## Generator

```bash
uv run --project tools/ingest medbase-catalog-modules build \
  --ledger data/build/clinical-coverage-ledger.json \
  --output-root data/build/clinical-metadata-modules \
  --family clinical \
  --version 2026.07.preview.1
```

Supported families are `clinical`, `medication` and `legal`. One build-ready workspace is generated
for every module in the input coverage ledger. The generator rejects unsupported families, empty
module plans and references to records that are absent from the ledger.

The shared envelope validates stable module IDs, titles, record references and coverage counts. It also
accepts family-specific categorization and provenance fields, which remain protected by the checksum of
the complete source ledger rather than being mistaken for the shared runtime contract. Fixture tests
exercise those extra fields so clinical, medication and legal ledgers cannot silently drift apart.

Each workspace contains:

```text
manifest.yaml
aliases.yaml
<stable-record-id>.md
...
```

The existing deterministic `medbase lint` and `medbase build` commands compile each workspace into a
normal SQLite/FTS5 module. No new runtime format is introduced.

A record keeps the stable catalog identity chosen by its owning ledger. Secondary category labels may
make the same source discoverable from several specialties, but publication tooling must preserve one
canonical identity and report duplicate aliases rather than silently merging unrelated records.
Canonical JSON checksums preserve the exact normalized catalog record used to generate each card.
Metadata modules preserve source links and checksums but do not copy unavailable full source payloads.

Each record is physically packaged only in its declared `primaryModuleId`. Additional `moduleIds` stay
on the card as search and specialty facets; they never create a second copy of the same document in a
different downloadable database.

## Clinical metadata cards

A clinical catalog card preserves:

- official identifier and edition;
- application status;
- ICD-10 and age categories;
- developer;
- module assignments;
- coverage and rights state;
- official and declared source URLs.

The visible text explicitly says that full text is not installed unless the ledger state is
`published`. The card contains no inferred diagnostic or treatment statements.

## Medication metadata cards

A medication card preserves registration identity, trade name, INN, ATC, dosage form, listed
strengths/routes, manufacturer, holder and source edition. It explicitly states that catalog metadata
does not confirm doses, indications, contraindications or interactions.

The metadata flag `trustedDoseData` remains false. Dose knowledge must come from an exact reviewed
instruction fragment and cannot be inferred from a strength field.

## Legal metadata cards

A legal card preserves electronic publication number, act number/type, dates, authority and Ministry
of Justice registration metadata when present. It explicitly states that publication does not prove
current applicability or supersession.

Applicability and amendment relations are separate reviewed data.

## Promotion to full text

A metadata-only record is promoted only when:

1. source identity and rights are recorded;
2. the source payload is checksum-verified;
3. deterministic extraction and diagnostics pass;
4. SQLite integrity and FTS row checks pass;
5. source-specific retrieval benchmarks pass;
6. the immutable full-text artifact is published;
7. installation, restart, update and rollback work in the application.

The coverage ledger remains the source of truth for whether a record is metadata-only, under review,
blocked, restricted, historical or fully published.

## Automation

`.github/workflows/catalog-metadata-modules.yml` compiles a deterministic fixture ledger into real
SQLite databases for every generated category. A manual run may consume a declared HTTPS coverage
ledger and generate all category workspaces/databases as an auditable artifact.

Validation requires one compiled SQLite database for every generated module and rejects a build that
loses catalog records between the ledger, workspace report and final databases. The uploaded artifact
retains the ledger-derived report beside the generated workspaces and databases.

This workflow does not publish the generated modules to a release automatically. Release publication
still requires coverage review and immutable channel-manifest generation.
