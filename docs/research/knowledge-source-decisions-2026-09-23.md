# Current source and research decisions — 23 September 2026

User-approved direction for draft PR #180, stacked on #174. This is a documentation-only
follow-up, not a claim of a rebuilt corpus, a new runtime, Laya inference or a ready release.
It qualifies the older dated sections of DEFINITION_REFERENCE_PLAN.md and CURRENT_STATE.md.

## Decisions

1. **Preserve concepts and names independently of the source of their definition.** The earlier
   Wikipedia exclusion was too broad for vocabulary coverage. Retain discovered names/IDs and
   source-explicit variants; obtain useful clinical definitions and instrument content from
   appropriate medical sources. Clinic/polyclinic websites and Krasota i Meditsina are valid
   candidate sources, not automatically reviewed authorities.
2. **Contributed material goes into the normal knowledge-base pipeline.** A source-specific
   preparer can exist, but a separate personal ZIP/viewer is not the finished feature. Reuse
   the same source registry, existing knowledge/content tables, review queue and normal reader.
   Internal provenance and release eligibility do not require a separate user-facing database.
3. **No UI migration now.** GPUIX + Solid + gpui-mobile is an explicit research candidate.
   Availability of a Rust platform is not proof of the combined mobile JS host. Retain the
   current application, dependencies and storage ownership.
4. **Laya is an evaluation candidate, not the search engine.** Evaluate multilingual Laya for
   Russian definition matching, clinical-case retrieval and claim–evidence selection. The
   English browser demo, a quantized download size and confident output are not medical validation.

Authoritative content policy: [REFERENCE_SOURCE_POLICY.md](../REFERENCE_SOURCE_POLICY.md).
Native observations: [GPUI mobile follow-up](gpui-mobile-solid-followup-2026-09-23.md).
Model observations and experimental protocol: [Laya candidate](laya-russian-search-candidate-2026-09-23.md).
The earlier [SemIf candidate](semif-candidate-2026-09-21.md) remains a separate comparison option.

## Ordered content work after this note

### C1. Restore the name inventory without restoring wiki medical prose

- Read the archived Wikipedia-inclusive manifest and verify each original input receipt.
- Recover source-local IDs, titles, explicit aliases and discovery locators. Preserve distinct
  senses. No title-only automatic canonical merge and no source-quality promotion.
- Compare with the existing concept/name layer. Mark a name without an adequate definition as
  `needs-definition`, rather than dropping it or attaching invented text.
- Keep discovered-name counts separate from actual definitions and source-specific variants.
- Verify previously removed names remain retrievable in the eventual normal knowledge path;
  a generated authoring inventory alone is not completion of runtime restoration.
- Keep legacy source bodies/archives intact, but do not reclassify them as professional medical
  definitions. Unknown/missing source matches remain a transparent acquisition backlog.

### C2. Integrate the supplied textbook and pediatric material through one build path

- Verify prepared excerpts against supplied source checksums, page locations and table cells.
- Admit definitions, expansions of abbreviations and instrument/reference records in their
  appropriate knowledge views, with the same review and source model as acquired material.
- Keep publication rights/export visibility separate from medical correctness and from whether
  records are integrated into the database. Do not automatically publish the supplied book or
  a restricted scale merely because it can be read locally.
- Build one combined development knowledge edition and verify lookup, source references, table
  order, variants and bounded text reads through the normal core/reader. Do not finish with
  another ad hoc private viewer or ask the user to manually combine ZIP packages.
- Preserve historical source editions and authors' wording. A named scale plus a copied slide
  interpretation does not qualify executable scoring or treatment advice.

### C3. Acquire missing definitions against the restored inventory

Prioritize explicit medical definitions, including those in Russian medical institutions'
pages, dictionaries, textbooks and recommendations. Inspect the individual source; do not
limit collection to journal titles or inflate coverage with unrelated article headings.
Track filled definition gaps, source variants, complete criteria and instrument completeness.

### R. Research remains separate from those data changes

Native experiment: first prove a pinned minimal Solid tree can drive gpui-mobile; then compare
an actual sourced-reference screen on physical Android/iOS. No adopted framework in this note.

Laya experiment: first freeze source corpus and Russian tasks, then pin the multilingual
checkpoint/tokenizer/runtime, compare the same candidate pools, and measure evidence support,
input truncation, option-order sensitivity and mobile memory/latency. Exact quotations and
source locators stay deterministic. No model weights or private clinical inputs in public CI.

## Actual state at this documentation checkpoint

The last measured definitions-only build remains **8,410 definition candidates**, selected
from **18,357 non-Wikipedia authoring/reference records**. Its report is
[definition-only-scope-2026-09-22.json](definition-only-scope-2026-09-22.json).
The earlier **7,637 Wikipedia source records** remain in archived authoring inputs; they are
not newly restored to the installed application's name index by this note.

Previously prepared supplied-source packages have not been silently declared active corpus.
This follow-up changes documentation/policy only. No additional source was acquired, no new
SQLite/FTS or UI code was introduced, no private PDF was uploaded, and no model/device test,
APK, release or merge was performed. Those boundaries must appear in any delivery summary.
