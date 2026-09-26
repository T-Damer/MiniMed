# Specialist teaching sources: delivered selection

Date: 2026-09-22. Same draft PR #180, `experiment/system-one-search-benchmark`, stacked on #174.
Final tested source-selection/data commit: `f3ede855accb31684db8b1b2383cdd324e8c8900`.
Acquisition/rebuild run: https://github.com/T-Damer/MiniMed/actions/runs/35774822653
Final offline label-quality/rebuild run: https://github.com/T-Damer/MiniMed/actions/runs/35776740394

This pass implements the user's content-first, specialist-source direction. Wikipedia was not
used or restored. Installer/backward-compatibility work, AI inference, device optimization,
publication and clinical interpretation are not part of this delivery.

## Actual new content

The starting branch already contained the earlier 98-record, 20-article specialist batch,
bringing the post-Wikipedia-exclusion corpus from 18,133 to 18,231 records. That earlier batch
is not counted as newly collected here. This pass adds **126 records from 37 further full-text
publications**, yielding **18,357 active source/editorial records**.

| Measured new selection | Count |
| --- | ---: |
| Full source articles | 37 |
| Article overview cards, not independent terms | 37 |
| Source-backed definition candidates | 83 |
| Subject-specific source-section cards | 6 |
| All selected new records | 126 |
| Previously absent normalized names | 121 |
| Known normalized names receiving another source | 5 |
| Preserved prepared blocks | 1,651 |
| Source tables | 30 |

The sources are one article from *Российский семейный врач*, ten from *Педиатр*, fifteen from
*Урологические ведомости* and eleven from *Неврологический вестник*. Their publication dates range
from **2019-05-24 to 2021-12-14**. Journal section names such as «Клинические рекомендации» are
publisher metadata, not proof of a current official guideline or clinician approval.

The bounded issue discovery examined an explicit archival window, offset 20 with at most twelve
issues per journal, and selected at most eighteen candidate articles per journal. Of 72 candidates,
37 passed the full-text, identity, language, licensing and structure gates; 35 remain pending.
The earlier recent-issue window did not produce an eligible batch. Its metadata/availability
receipts remain evidence of the attempt, not a claim of newly imported source content. Closed,
abstract-only or unclear-license pages were not substituted with summaries or mirror copies.

Examples of preserved source topics include the 2020 lecture on urosepsis, laboratory criteria and
positive blood-culture interpretation; the 2020 review of central-nervous-system injury markers
in children; otoacoustic emissions in pediatric practice; and 2019 articles about Chiari type I
malformation and depersonalization in psychiatric/somatic practice. Definitions, classifications
and caveats remain tied to their original authors and dates. No source is silently reconciled
with the user's 2006 psychiatry manual or current medical practice.

All new records are source-local and require review. Eleven article licenses are marked
non-commercial-only (CC BY-NC-SA 4.0); those constraints and attribution remain in the source
records. Other articles carry their captured article-specific declarations. No commercial reuse,
independent instrument permissions or release eligibility is inferred from this acquisition.

## Quality correction after inspecting the actual labels

The initial successful selection produced 153 records and a combined count of 18,384. Inspection
found additional sentence fragments and incomplete subtype/stage names admitted as independent
terms. The final pass removes **27 such standalone labels**, on top of the 49 labels excluded by
the earlier intake. Examples are «Первое», «Вторая стадия», «обязательные» and narrative clauses
such as «Секреция кортизола происходит по циркадному ритму».

These are not deleted paragraphs. The complete source article, all original prepared blocks,
source descriptors and table metadata are retained. A stage lacking its parent condition is not
renamed into an invented medical term. The final per-article record set is an exact subset of the
previous one; retained source records are unchanged. Reasons, source URLs and label spans are in
`specialist-teaching-active-2026.09.22-d/label-quality-report.json`.

The broader lexical rules are regression-tested alongside meaningful scoped labels such as
«Псевдокоронарная форма миокардита», «Первая стадия хронической болезни почек», «ОАЭ» and «Лёгкое».
This is conservative structural screening, not a complete linguistic or medical audit of all
18,357 records. Older source inputs have not been silently regenerated under the new rules.

## Compact, source-preserving integration

New per-article source projections remain in the authoring collection. The runtime manifest uses
one bounded bundle at:

`content/definition-drafts/specialist-teaching-active-2026.09.22-d/bundles/articles-01.json`

The bundler remaps only declared numeric source/block references, including parent-block spans,
definition/context memberships and label evidence. Every mapping is reversed and compared with
the complete per-article object before admission. Source strings, dates, rights, tables and stable
external record IDs are not rewritten. Unsupported optional annotation shapes fail rather than
passing through with stale references. No second database owner or whole-corpus UI import was added.

The source acquisition checkpoint, prior selection and archived responses remain outside the
runtime input manifest. They are not phone download dependencies. The final ordinary SQLite
preparer uses the same existing numeric-link layout and installer descriptor.

| Final measured file | Bytes |
| --- | ---: |
| Installed SQLite | 122,699,776 |
| Gzip transport | 29,944,653 |

These are actual file sizes, not RAM, native installation peaks or the total application footprint.
The earlier 122,834,944/29,979,245-byte edition and its 153-record count are superseded by this
final selection, not current measurements.

## Executed verification

**163 selected Python tests passed**, with no failures, errors or skips. Scoped Ruff and strict
Pyright checks passed. The earlier acquisition pass ran 120 selected cases; the final total adds
43 label-regression cases. Early workflow/fixture failures remain visible in run history and are
not represented as successful executions.

Offline replay prohibits network creation. Each admitted article is reconstructed from its
captured original full-text evidence and run through the ordinary projection/intake. The final
manifest, selected identity set and prior input receipts are checked. All **26,685 projected
source blocks** and **66 source descriptors** were compared with the final SQLite representation.
Integrity is `ok`, foreign-key violations are zero, Wikipedia source records are zero, and no
approved knowledge facts or relations were created.

The actual file-backed application reader reconstructed **all 126 new cards**, their **4,093 block
reads** and **4,170 text slices**. Every slice was bounded to 4,096 Unicode code points. All 37 source
references resolved, and each new specific source ID was present in Top-20 for its title.
There were no name misses in this new batch. These measurements do not establish independent
reverse-definition relevance, clinical correctness, browser rendering or Android performance.

Machine evidence: `specialist-teaching-quality-2026-09-22.json`. The earlier acquisition scope
is recorded separately in `specialist-teaching-batch-2026-09-22.json`; its intermediate cardinality
must not replace the final result. `CURRENT_STATE.md` and `DEFINITION_REFERENCE_PLAN.md` now begin
with the final selection. The one-time collection/probe/quality workflows are removed after
successful delivery; source tools, tests, data and reproducible evidence remain.

## Reproduce the current DEV edition

```bash
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.22-specialist-teaching-d --built-at 2026-09-22
```

Choose another version if that generated output already exists. This builds the local optional
reference and descriptor; it does not publish a binary, replace a released core, update an installed
APK or approve the source content. No private PDF or derived owner text was used in public CI.
The supplied Semenov/Bersenev manual remains a separate private source, not part of this batch.

No new executable scales, structured root/etymology dictionary or scientist identity links were
implemented. Further specialist source acquisition and clinical-content/detail coverage remain
ahead of model, compatibility and installer work. No merge, release, APK, model weights or
GitHub Actions artifact upload was performed by these source workflows.
