# MSD acquisition: page coverage versus medical definitions

Date: 2026-09-23. Draft PR #180. This method note does not claim that a live batch has
completed; actual measurements belong in `msd-topic-intake-2026-09-23.json`.

## Inspected source inventory

The public robots file advertises two Russian index roots:
`https://www.msdmanuals.com/ru/sitemap.xml` and
`https://www.msdmanuals.com/ru-ru/sitemap.xml`.
Their currently inspected topic sets differ:

- `ru/sitemaps/home-topic.xml.gz`
- `ru/sitemaps/professional-topic.xml.gz`
- `ru-ru/sitemaps/professional-topic.xml.gz`

The `ru-ru` index does not advertise a home-topic map. The first live attempt correctly
stopped when an incorrect symmetric-index assumption met this source shape; the two index
bodies were inspected before the contract and regression fixture were updated.

These maps enumerate page URLs, not every defined word, synonym, scale or clinical concept.
A complete snapshot of these three URL lists must not be described as a complete dictionary.
The inventory stays in authoring data, outside the phone's downloadable content package.
Duplicate regional URLs are not evidence of different clinical meanings or independent sources.

## Current acquisition unit

`localmed_ingest.msd_topic_intake` schedules a bounded, deterministic cross-specialty batch
of gaps already present in the name inventory. A URL slug is only a scheduling hint. The visible
page heading, canonical topic identity, actual introductory definition and existing empty-name
receipt must agree before the normal name-completion adapter can accept a candidate.

Each selected record preserves one complete short source sentence, the original topic ID,
available revision label/author identifiers, URL and locator. Missing names of authors or other
metadata are not invented. HTML entity decoding and whitespace normalization are declared.
Hashes distinguish the received response, normalized paragraph and exact selected excerpt;
they are not interchangeable. Full source HTML is not persisted in the public repository.

The current pass admits only a complete defining sentence of at most 25 words. It does not
truncate a longer definition to pass that bound or synthesize a shorter medical explanation.
Longer definitions, heading mismatches, review pages and ambiguous source structure stay in the
review outcomes. This batch boundary is not a claim that medically adequate definitions should
always be that short. A complete MSD-derived concept set remains a further collection/review task.

All acquired records remain source-local and review-required. An exact title match alone does
not medically establish a shared concept; these bound completions still require semantic review.
They do not create approved same-as relations, classification differences, executable scales,
treatment recommendations or evidence of what definition is most commonly used.

## Existing knowledge pipeline

Accepted source records use `minimed-name-completions-v1` and the existing V3 projection.
The original discovered-name ID and search names survive; its discovery annotation remains
separate from the new medical definition. No Wikipedia medical prose is reinstated. Short
bibliography/source descriptors are shared, and no second dictionary or SQLite owner is created.

The active completion manifest binds file hashes and byte counts. Ordinary preparation then
builds the same optional knowledge edition used by the app. Completing a known name increases
the definition count and decreases the empty-name count without inventing an additional concept.

```bash
# Explicit network acquisition; fresh output directory, sequential requests.
uv run --project tools/ingest python -m localmed_ingest.msd_topic_intake \
  --output data/build/msd-new-batch --max-pages 60

# After inspecting/registering the prepared completion and its file receipt:
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version A_FRESH_DEV_VERSION --built-at YYYY-MM-DD
```

There is no unattended continuation implied by these commands. Rejected candidates and source
access failures require inspection, not automated retries through alternative proxies/endpoints.
The collector respects the inspected robots rules and at least five seconds between requests.
HTTP 401, 403 and 429 stop the pass. No authentication, access-rule or rate-limit bypass is used.

## Qualification

Synthetic tests cover canonical paths, redirect origin restrictions, entity/whitespace handling,
hidden markup, duplicate elements, gzip/XML bounds, differing sitemap sets and complete-sentence
selection. The ordinary builder checks input receipts and preserves all existing source data.
`tools/benchmarks/msd-definition-reader-audit.ts` separately checks accepted definitions and original
discovery links through the actual application SQLite reader. Its results must be measured, not
inferred from successful extraction or from unrelated earlier lookup tests.

Source fidelity, medical review, reproduction/distribution rights and search relevance remain
separate. Public availability and a review-required label do not establish redistribution clearance.
No full-article library, private source book, model, APK or released database is delivered by this
method note. Reverse search remains a separate handler and evaluation track on the same corpus.
