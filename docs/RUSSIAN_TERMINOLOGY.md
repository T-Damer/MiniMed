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

The release publisher verifies archive and decoded checksums, SQLite/FK integrity, exact document
membership and redistribution rights. Only after GitHub confirms uploaded asset digests does it
commit `catalog.terminology.json` to the same PR. The current gzip installer handles decompression,
verification and atomic activation; no new download subsystem is introduced. Remote catalog refresh
must retain these bundled verified entries when an older main catalog does not yet include them.
Do not replace an immutable tag or mark an unuploaded catalog candidate as an available download.

## Measured local run, 16 September 2026

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
- Full MeSH owner/index rebuilding is a separate local job. Do not confuse the completed Russian
  combined-core measurement with completion of the larger all-MeSH combined edition.

Physical-device installation and clinical/editorial qualification remain separate checks. Publishing
terminology data is not an APK release, application deployment or PR merge.
