# Hard medical retrieval benchmarks

MiniMed keeps three different retrieval suites because they answer different questions.

## Synthetic 1500-query baseline (removed 2026-10-02)

`hard-medical-queries-1500` was a synthetic baseline of 300 pediatric information needs with five
styles each (professional, colloquial, keyword, noisy, case narrative), written against the 15-card
pilot corpus (its expected sections and forbidden phrases name pilot cards). It is gone:

- its only runner (`benchmark:hard`) was retired on 2026-09-27 with the pilot research tooling
  ([../../docs/research/pilot-research-tools-retired-2026-09-27.md](../../docs/research/pilot-research-tools-retired-2026-09-27.md)),
  and nothing has used it since;
- the committed gzip+base64 parts were corrupt since their first commit (`d02f173c`): the stream
  fails its CRC after row 1 159, so `hard-query-dataset.test.ts` could not run and was excluded from
  Vitest; the generator and source file were never found;
- the corpus it described no longer exists, so a partial re-encode (1 159 rows, 232 scenarios,
  MED-001..MED-232: dev 699, validation 230, hidden_test 230) would have been a lopsided benchmark for
  nothing. The last 341 rows (scenarios 233..300, five styles each: 201 dev, 70 validation, 70
  hidden_test, plus the tail of the partial-answer probes) were lost; the readable 1 159 rows can be
  decoded from commit `d02f173c` onwards if ever needed (`zlib.decompressobj(31)` stops at the bad block).

`hard-query-types.ts` (row shape) and `hard-query-scoring.ts` stay: they score the curated clinician
set below. Real-corpus quality is measured by the lookup sets in `benchmark:all` (core ratchet) and
`benchmark:real:release` (`run-real-corpus.ts`, [../../docs/TESTING.md](../../docs/TESTING.md)). A new
large synthetic set must be generated against the full released databases, with its generator
committed, rather than restored.

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
