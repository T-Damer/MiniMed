# Supplied definitions in the shared knowledge edition

23 September 2026; same draft PR #180. Search and source content remain primary.

## Delivered and measured

The ordinary `scripts/prepare-definition-reference.py` now accepts a registered supplied-source
manifest in addition to its existing public source/name manifests. All inputs use the existing
projection, compact SQLite schema, source registry, bounded reader and module ID
`minimed.definition.reference.ru`. There is no second dictionary, UI or storage owner.

A full local edition was actually built with the two supplied PDFs, not only a synthetic fixture:

| Counter | Result |
| --- | ---: |
| Supplied source records incorporated | 458 |
| Definitions among those records | 374 |
| Abbreviation expansions | 2 |
| Other source reference records | 82 |
| Combined definition candidates | 8,784 |
| Previously recovered name-only records | 7,637 |
| All searchable source-local records | 16,505 |
| SQLite bytes | 132,771,840 |
| Gzip bytes | 27,757,651 |

Compared with the preceding name-restoration edition, this adds 4,624,384 installed bytes and
880,592 download bytes. These are file sizes, not memory measurements. Original PDFs are not
included as payload files. The authoring excerpts retain the necessary source text and locators.
These counts describe source-local candidates, not unique or clinically approved concepts.
No new external sources were acquired; this pass closes the gap between earlier supplied-source
preparation and the ordinary combined knowledge build.

Actual local evidence: [supplied-reference-local-2026-09-23.json](supplied-reference-local-2026-09-23.json).
Code/synthetic CI evidence: [supplied-reference-ci-2026-09-23.json](supplied-reference-ci-2026-09-23.json).

## Source fidelity

The Semenov/Bersenev 2006 textbook extraction was replayed against the actual supplied PDF:
621 source paragraphs, 450 source-local records, 3,556 structural/source assertions. The earlier
native-text/coordinate audit is retained locally. Declared dehyphenation and whitespace processing
are reproducible; medical terminology and author classifications were not modernized.

The pediatric slides were also replayed from their original PDF. The two output JSON files were
byte-identical to the prepared inputs. They contain three short explanations, two abbreviation
expansions and three distinct instrument references (64 table cells including headers).
The named NICE table, the Yale scale presentation and the separate biomarker algorithm remain
separately attributed. Extracting an author's table does not validate its scoring, age limits,
probabilities or treatment statements. No executable calculator or treatment rule was added.

Neither replay used OCR. PDF checksums identify the source bytes; a matching checksum alone does
not establish correct extraction or clinical accuracy. Those checks remain separate.

In the full combined database, all 16,047 previously searchable identities were retained and the
entire selected identity set matched. All 35,475 projected blocks, 70 source descriptors and
29,513 entry links were compared with the prepared projection; text, metadata and link order
matched. Integrity/foreign-key checks passed. No knowledge facts, same-as relations or executable
tool definitions were created by this projection.

## Search and reader results

The unchanged actual TypeScript `createSqliteDefinitionReference` reader opened every one of the
458 supplied identities and reconstructed all 1,560 linked block reads with exact text/metadata.
All 458 specific source identities appeared in Top-20 when queried by their own title.
The audit was read-only; the final database checksum was unchanged.

The local host had Node 22.16.0 but no Bun, so this companion check used `node:sqlite` and direct
TypeScript type stripping. That is an explicit host-only fallback, not qualification of Bun,
Android/WebView, UI installation or a released application.

Twelve authored descriptive probes were also run on the full combined database: **8/12 Top-1**.
Four target concepts remain missed for those paraphrases: Каталепсия, Конфабуляции,
Дереализация and Персеверация. This is not an independent clinical benchmark or a measured search
improvement; the reader was unchanged. Do not turn these misses into passes by rewriting gold
answers, appending queries as artificial aliases or claiming that a nearby article title suffices.
The query-set SHA-256 and ranks are recorded in the local JSON.

## Verification alignment

The dedicated CI run `35833054756` passed **88 Python tests**, strict Ruff/Pyright checks and the
existing reference layout/metadata Vitest suites. It used only synthetic source-receipt inputs
and the actual ordinary projection/compaction. It did not receive the supplied PDFs or text.
The local real-source check separately passed 74 tests with its installed dependency versions;
these two counts are separate runs, not additive coverage.

The four locally executed production files were compared with the CI AST digests. All match when
empty fields are included in Python 3.13's `ast.dump(..., show_empty=True)`, corresponding to the
Python 3.12 CI representation. The local JSON records the original default-3.13 dump digests;
the CI JSON records these equivalent explicit-empty digests:

```text
definition_supplied_inputs.py        538ed4045e514bab076ac7138bec321f09e91241abcdf87769bdf0a159deb412
definition_reference_pack.py         864a38e34d55871da3f6d8429e7e70306ef56a900e5cb04019a3bb4f9b19c213
definition_reference_compact_pack.py  4d3f7945d7a3655692c1220f4737d7759f48f4369a3cfe18da271f1d186032cd
prepare-definition-reference.py     2492946388f5abf212a1b004c4607ef42257e66e6d251b21ff37077dc10b1382
```

## Ordinary build entrypoint

Register selected existing prepared V3 excerpts and their original PDFs under one explicit root.
Paths passed to the register command are relative to that root. The registration command reads
and checks the selected files; it neither copies nor uploads the originals.

```bash
uv run --project tools/ingest python -m localmed_ingest.definition_supplied_inputs \
  --root /path/to/source-root \
  --manifest intake/manifest.json \
  --source books/psychiatry.pdf \
  --input prepared/psychiatry.definitions.json \
  --source books/pediatric-scales.pdf \
  --input prepared/pediatric.definitions.json \
  --input prepared/pediatric.instruments.json

uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.23-supplied-integrated --built-at 2026-09-23 \
  --supplied-root /path/to/source-root --supplied-manifest intake/manifest.json
```

These are example local filenames; use the actual available files. A new output version is needed
when that immutable edition already exists. The resulting database/gzip and ordinary local module
descriptor are produced by the same preparer as the public-source dictionary, not a source-specific
product. Raw PDF parsing/preparation remains the preceding source-specific deterministic step.

Missing files, replaced bytes, invalid receipts, root/symlink escape, conflicting identities,
dangling blocks and unexpected release eligibility fail before database activation. Supplied
instrument-only reference entries remain counted separately from definitions. The module descriptor
uses the combined entry count and checksum-bound source set.

## Publication and next work

The complete combined edition was built and inspected locally. Supplied PDFs, extracted full text
and their local manifests were not committed to the public repository or sent to CI. Public
builds without those explicitly available inputs retain the previous public-source selection;
this is not a claim that a newly released app already downloads the combined edition.
Release rights remain a publication decision, not a reason for a separate knowledge store.

Next: improve descriptive candidate retrieval without changing source wording; fill the remaining
medical-definition gaps; then reconcile established equivalent meanings behind one base definition
and compact sourced differences. Do not merge identical titles automatically. Laya, GPUI, backward
compatibility and installer redesign were not developed by this pass. No APK, release or merge.
