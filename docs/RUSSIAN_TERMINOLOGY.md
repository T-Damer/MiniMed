# Russian terminology — source and distribution

The Russian Wiktionary extraction from Kaikki is a **community lexical reference**, not a clinical
recommendation, prescription source, or reviewed MeSH translation. No model is called. Read together
with `MEDICAL_TERMINOLOGY.md`; existing ConceptUIs and exact source anchors are unchanged.

## Source and rights

Source: `https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz` (Russian Wiktionary edition).
Terms: `https://kaikki.org/ruwiktionary/` and Wikimedia Terms of Use section 7.
Adapted dictionary data: **CC-BY-SA-4.0**, `https://creativecommons.org/licenses/by-sa/4.0/`.
Attribution: Russian Wiktionary contributors; extraction by Wiktextract/Kaikki.org. Every sense links
its original page (including authors' history); the source archive/record SHA-256 and line/sense
locator are retained. Changes are selection and whitespace normalization, not medical rewriting.
External example quotations, media, translations and non-Russian entries are not redistributed.

Only source-labelled **sense-level** medical, anatomy, physiology, pharmacology, psychology and
psychiatry categories admit an entry. An entry-level category never admits unrelated figurative
senses. Homonyms retain independent content-addressed `ruwikt.*` identities. No name-based MeSH
merge is performed. Source definitions and names are full-text searchable; metadata flows through
the existing terminology projection. Knowledge entities/facts/evidence remain proposed/third-party.
The source contains short cross-reference glosses as well as definitions; it is not exhaustive and
must not be reported as full Russian coverage of the 61,794 MeSH concepts.

## Reproduce locally

```sh
uv run --project tools/ingest medbase-terminology collect-russian --network \
  --output data/raw/ru-terms --cache .cache/ru-terms
uv run --project tools/ingest medbase-terminology prepare-russian \
  --input data/raw/ru-terms --output data/intermediate/ru-terms
uv run --project tools/ingest medbase-terminology build-russian \
  --input data/intermediate/ru-terms --output data/build/ru-terms \
  --version 2026.9.16 --built-at 2026-09-16T00:00:00Z
```

All output directories are immutable. A changed source requires a new version and review of its
coverage. Collection is bounded, checksummed and opt-in; ordinary tests use offline synthetic data.
The index includes **all supplied Russian definitions**, not only term names. Six section packs
hold disjoint owner sets; source subject memberships and additional owners are in the size report.
Sections are optional. The initial implementation must not force a large MeSH pack onto a device.

`russian_distribution_catalog` verifies archive and decoded checksums, SQLite/FK integrity, exact
membership and source rights before producing candidate descriptors. A future publisher must still
upload and verify all assets before committing those descriptors to the runtime catalog; this
function alone is not proof of publication. Never replace an immutable tag or advertise an
unuploaded candidate. The current gzip installer owns decompression, verification and atomic
activation. Remote refresh retains verified bundled terminology entries when the main catalog
predates this feature; no second download subsystem is introduced.

## Published distribution

Dataset release: `https://github.com/T-Damer/MiniMed/releases/tag/terminology-ru-2026.9.16`
(release ID `389769808`). It is a data prerelease, not an APK release and not the latest-app release.

Seven uploaded `.db.gz` assets are advertised in `catalog.terminology.json`: the complete Russian
lexical index and six owner sections (medicine, anatomy, physiology, pharmacology, psychology,
psychiatry). The index's actual released transfer is **18,493,069 bytes**, SHA-256
`1730269a741ed4792c4f9922dcb178a47e990896270d3a5a85c55c5432e55096`.
This compressed size is not the installed SQLite size. `catalog.terminology.json.gz` contains exact
membership, archive/decoded byte counts and both hashes for every section. `senses.jsonl.gz`,
`source.json`, `ATTRIBUTION.txt`, `pack-size-report.json` and `SHA256SUMS` accompany the data.

The initial publisher checked GitHub asset state, byte count and SHA-256 receipts before advertising
the URLs in this PR. Temporary source-transfer/export/bootstrap workflows were then removed. The
ordinary collection/build CLI remains; a future data edition needs a new immutable tag and the same
publication checks. Merging the application changes and deploying `/app/` remain separate actions.

## Recorded local measurements, 16 September 2026

- Source archive: 292,526,569 bytes; SHA-256
  `672973ab0647e1860a321ef9962cdf3d6e44e75572ebad0adde1fd87b676a755`.
- 6,939 distinct medical lexical senses; 6,661 names; **6,940 supplied Russian glosses**.
  Source memberships include 407 psychiatric and 517 psychological senses (memberships overlap).
- Local index: 129,667,072 SQLite bytes / 18,411,501 gzip bytes. Six owner sections together contain
  6,939 detail cards. Actual released byte counts/hashes come from its own reproducible build report;
  SQLite binaries from different SQLite versions are not assumed byte-identical.
- Current 19,987-document core reconstruction completed locally in 216.97 s with initial FK indexes.
  Numbered `005_knowledge_foreign_keys.sql` adds the missing cascade lookup indexes; it does not
  rewrite source rows or weaken validation. Regression checks require indexed child lookups.
- Combined core + Russian index + literal mention projection completed locally: **26,926 documents,
  75,299 chunks**, SQLite 692,518,912 bytes. Composition 57.03 s; including gzip and fingerprint checks
  109.33 s; peak RSS 1,073,084 KiB. Gzip 115,461,923 bytes. SQLite/FK checks passed and input hashes
  were unchanged. This is an unpublished qualification output, not a replacement of the app core.
- Full MeSH owner/index rebuilding remains separate. Do not confuse the completed Russian
  combined-core measurement with completion of the larger all-MeSH combined edition.

Physical-device installation and clinical/editorial qualification remain separate checks. Publishing
terminology data is not an APK release, application deployment or PR merge.
