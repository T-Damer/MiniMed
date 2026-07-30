# Hard medical retrieval benchmarks

MiniMed keeps three different retrieval suites because they answer different questions.

## Synthetic 1500-query baseline

`hard-medical-queries-1500` is a reproducible **synthetic baseline**, not a claim that all 1500 rows
were typed by real clinicians or parents. It contains 300 information needs with five controlled
styles each: professional, colloquial, keyword, noisy, and case narrative. Its main purpose is to
expose regressions, query-style brittleness, section-ranking errors, and obviously dangerous matches.

The fixture is stored as checked, gzip-compressed base64 split into deterministic text parts so it
remains compatible with the GitHub Contents API. `hard-query-dataset.ts` verifies compressed and
uncompressed SHA-256 checksums, query uniqueness, split counts, style counts, scenario count, and
no-answer probes before returning a row.

Build or provide a SQLite corpus, then run:

```bash
bun run benchmark:hard
```

Environment controls:

```text
MINIMED_HARD_BENCHMARK_DB=data/build/rf-public-pilot.db
MINIMED_HARD_BENCHMARK_SPLIT=all|dev|validation|hidden_test
MINIMED_HARD_BENCHMARK_MODE=auto|lexical|semantic|hybrid
MINIMED_HARD_BENCHMARK_MAX_QUERIES=100
MINIMED_HARD_BENCHMARK_MIN_RECALL_AT_5=0.80
MINIMED_HARD_BENCHMARK_MIN_SECTION_RECALL_AT_5=0.60
MINIMED_HARD_BENCHMARK_MAX_FORBIDDEN_RATE_AT_5=0.01
```

`MINIMED_HARD_BENCHMARK_MAX_QUERIES` is intended only for smoke runs; omit it for a scored comparison.
No quality threshold is enabled by default because the public pilot does not contain an answer for all
75 topics. Release workflows should point the runner at a known corpus and set explicit thresholds.
The report is written to `data/build/hard-medical-benchmark-<split>.json` with per-query rows and slices
by style, intent, and specialty.

## Curated clinician queries

`curated-clinician-queries.json` is a separate small, human-written regression set. It covers practical
queries about paracetamol, ibuprofen, fever that did not respond to the first antipyretic, forgotten
clinical terminology, child and adult health groups, disability, tuberculosis observation, and
sanatorium forms. It deliberately avoids the repeated templates used by the synthetic corpus.

Run it against a combined corpus that actually contains the relevant clinical, medication, and
regulatory sources:

```bash
MINIMED_CLINICIAN_BENCHMARK_DB=data/build/private-pilot.db \
  bun run benchmark:clinician
```

Default gates are:

```text
MINIMED_CLINICIAN_MIN_RECALL_AT_1=0.75
MINIMED_CLINICIAN_MIN_RECALL_AT_5=0.90
MINIMED_CLINICIAN_MIN_SECTION_RECALL_AT_5=0.70
MINIMED_CLINICIAN_MAX_FORBIDDEN_RATE_AT_5=0
```

The committed curated set is still visible to the implementation agent. A final release decision must
also use 200–300 private clinician-written queries that are not stored in the repository.

## Regulatory ranking gate

`benchmark:regulatory` runs both the original source-navigation fixtures and the major-document
clinician queries. Merely finding a document in Top-5 is insufficient:

- every expected regulatory document must be in Top-2;
- direct questions about major documents, health groups, disability, first aid, tuberculosis groups,
  and forms are marked `requireTop1`;
- precise section and context navigation remain required for practical questions;
- historical amendment/version questions remain useful diagnostics but do not dominate the section
  quality gate;
- metadata validation checks the official document identity and, where specified, the child/adult
  audience label.

The project owns edition verification. `content/regulatory-rf-editions.yaml` records the official
source, review date, next review deadline, and audience for every active regulatory card. The Python
suite fails when a card is absent from the ledger, its metadata disagrees with the ledger, or the
review deadline expires.

## Child and adult source ordering

When a query clearly describes a child, MiniMed ranks child and mixed-age sources above adult-only
sources. An adult-only source is retained as fallback when no child source exists and is labelled
`Для взрослых`. The inverse ordering is used for explicit adult queries. The ordering is covered by
unit tests and does not silently discard otherwise relevant sources.

## Interpretation

The automatic entity labels are weak supervision. A required-term miss can be a false negative when a
document uses a synonym, and a forbidden phrase only detects the labelled failure mode. Use reports to
compare engines and identify regressions, then manually review a stratified sample.

The committed `hidden_test` split is held out from ordinary tuning but is not genuinely secret once it
is in the repository. A final release gate still needs private, human-written queries kept out of the
repository and out of the context of the agent modifying retrieval.
