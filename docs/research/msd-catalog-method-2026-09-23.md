# MSD topic inventory and reverse-search qualification

Source intake decision: 2026-09-23. Definitions/search remain primary. No renderer/model change.
Execution counts belong to the dated machine reports, not to the method description below.

## What this pass collects

The official Russian professional [medical-topic index](https://www.msdmanuals.com/ru/professional/health-topics)
links its specialty sections. Their ordinary public HTML includes chapter/topic navigation in
`__NEXT_DATA__`. The collector reads only the explicit title, URL, source ID and hierarchy fields.
Some index responses also carry preview text: it is discarded, not put in the repository or pack.
No article page, hidden search API, Sitecore API or multilingual mirror is requested.

The declared [Russian sitemap index](https://www.msdmanuals.com/ru/sitemap.xml) identifies the
professional-topic sitemap. Compare **URLs**, not a guessed expected count. Retain sitemap-only
and navigation-only locations for review. The resulting scope is the professional topic navigation,
not every term inside paragraphs, all table/calculator names, or the consumer edition. A missing
URL must not acquire a fabricated title derived from its slug.

The [publisher robots file](https://www.msdmanuals.com/robots.txt) requests a five-second delay and
excludes several endpoint families. Acquisition honors the delay, limits requests/bytes and stops
on denied/redirected requests instead of rotating proxies or bypassing restrictions. The public
page's language/metadata shape is validated. Full HTML is not retained: raw-response checksums
record which responses were inspected, while the persisted metadata is separately reproducible.

## What enters MiniMed

Keep the complete collected title/location inventory for coverage review. Only previously
unindexed names enter the existing discovery input pipeline; overview/navigation headings and
existing-name overlaps remain in the metadata inventory. A title collision is a reason for sense
review, not automatic synonymy or a canonical same-as relation. No medical classification is
inferred from where a page is placed in the contents.

New rows carry `needs-definition`, an ordinary numeric source reference and a provenance-only
annotation block. They do not enter definition-body FTS. Existing Russian clinical definitions,
Wikipedia-discovered names, identifiers and source text are not replaced. Dictionary definition
counts and pending topic-name counts must be reported separately.

One documented base definition plus short source/version-specific differences remains the
presentation goal. An index title alone does not supply either a base definition or a difference.
No automatic full-manual paraphrasing or first-sentence copying is used to fill these rows.

## Source reuse boundary

MSD has a [permission-request process](https://www.msdmanuals.com/de/profi/content/permissions)
for reusing content, including the intended publication/distribution. Public access does not
establish permission to republish the entire manual's definition text in an offline product.
No blanket license has been obtained in this task. Names/location metadata and selective source
research are distinct from a full text export. Licensed/supplied material, when actually available,
should use the same ordinary knowledge ingestion path, not a separate personal dictionary.

## Search checks

The existing description handler preserves exact identity lookup, then plans a bounded search
against definition text using normalized language features, coverage, rarity and proximity.
It is not a language model, a diagnosis engine or full semantic entailment. Keep its documented
failure cases; do not copy benchmark queries into aliases or relabel gold to claim success.

Two different checks are useful and must not be conflated:

1. Same expanded database, pinned/current reader: checks code/ranking changes, if any.
2. Same reader, pre-expansion and post-expansion databases: checks whether new vocabulary
   disrupts prior exact-name outputs, reverse-query targets or unrelated-query controls.

`tools/benchmarks/definition-catalog-growth-audit.ts` implements the second check using the existing
frozen developer queries. The source-derived examples are not an independent clinical evaluation.
A pass confirms a regression boundary, not that every user paraphrase now works.

## Reproduction

Acquire metadata only, with network access and no provider credentials:

```bash
uv run --project tools/ingest python -m localmed_ingest.msd_topic_inventory \
  --output content/reference-authoring/msd-professional-topics.NEW.json
```

Use `compile_msd_names` with the actual currently indexed names to produce a checked discovery
inventory; register its file size/checksum in `content/definition-drafts/name-inputs.json`. This
manifest supports a bounded explicit input list. Existing receipts are still checked. Use the
ordinary `scripts/prepare-definition-reference.py` for the combined immutable SQLite edition.
The committed dated inventory supports offline replay; collecting a later site state is a new
input snapshot and must get its own coverage report rather than replacing old measurements.

No APK, model weights, private textbook, source-page body or binary database is published by
these tools. The ingestion tests and actual-reader checks do not constitute Android qualification.
