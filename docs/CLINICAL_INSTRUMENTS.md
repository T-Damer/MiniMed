# Clinical instruments — PR #173

Read root `AGENTS.md`, `CONTEXT.md` and `REFERENCE_COVERAGE_AUDIT.md` first. One instrument can have
source documents, an explanation, a paper form and an executable definition. These are capabilities,
not mutually exclusive medical categories. No registry membership proves RF clinical applicability.

## Implemented in this branch; not yet release-qualified

- Questionnaire pages expose direct printer and `?` actions. Description/source details stay in the
  existing dialog. A distinct administration instruction stays visible; an identical intro is not
  duplicated. Patient-vault isolation, response scoring and draft ownership are unchanged.
- Assessment index and My Questionnaires expose **Add a scale from a source**. Three authored,
  source-attributed Russian presets create local files through the existing validated importer.
  No separate database, runtime evaluator or provider was added. Copies use existing edit, fill,
  save, export, blank-print and result-print paths. Nothing is added automatically on app start.
- The presets are PHQ-9/GAD-7 in A. A. Zolotareva's published 2023 versions, and the Russian WHO-5
  form labelled 1999 provided alongside WHO's 2024 publication. Never mix these editions with a
  different translation under the same ID. Search aliases select a preset, not clinical equivalence.
- The current local format computes raw sums: PHQ-9 0–27; GAD-7 0–21; WHO-5 0–25. For WHO-5 the
  engine's normalized percentage numerically equals raw sum × 4. It is not disease probability.
  No diagnostic cutoff, RF approval, population reference verdict or patient observation mapping is
  inferred. WHO-5's direction is higher = better; PHQ-9 item nine keeps a separate safety note.
- Print/share retains attribution, edition and limitations. Blank printing also retains item-level
  instructions, including the recall window. The screen's collapsed explanation does not remove
  required administration instructions or attribution from the exported material.
- The local importer opens the editor after addition. A doctor may then select **Pass** to use the
  existing assessment runner. Repeated import intentionally creates a separate editable copy.

## Source wording and separate data licenses

The embedded question/option text in `clinical-instrument-presets.ts` is **not MiniMed-original**.
The source licenses below apply to that data; the repository's software license does not relicense
third-party instruments. These are noncommercial source versions. Attribution, license URLs and
adaptation notices remain in each exported local questionnaire and printed output.

| Preset | Exact source | Data license |
| --- | --- | --- |
| PHQ-9, Zolotareva | https://psyjournals.ru/journals/cpse/archive/2023_n4/Zolotareva — appendix; DOI 10.17759/cpse.2023120406 | CC-BY-NC-4.0 |
| GAD-7, Zolotareva | https://psyjournals.ru/journals/cpp/archive/2023_n4/Zolotareva — appendix; DOI 10.17759/cpp.2023310402 | CC-BY-NC-4.0 |
| WHO-5, Russian form 1999 | https://www.who.int/ru/publications/m/item/WHO-UCN-MSD-MHE-2024.01 — linked `who-5_russian.pdf`, final page | CC-BY-NC-SA-3.0-IGO |

License texts: https://creativecommons.org/licenses/by-nc/4.0/ and
https://creativecommons.org/licenses/by-nc-sa/3.0/igo/ . Source credits are preserved per preset:
PHQ/GAD developers and A. A. Zolotareva; WHO for WHO-5. Adaptations are digital layout and separately
identified MiniMed explanatory/safety text, not a new translation. WHO has not endorsed MiniMed;
its logo is not used. Preserve WHO's notice about the preceding Russian translation and the English
original. Do not silently include these data in a commercial distribution.

The two Russian studies concern general-population adult samples; their existence is not a software
validation or proof for every clinical group. WHO's publication of a Russian form is not itself a
new RF validation study. Original-language/source review and device qualification remain required.

## PhenX and PROQOLID

PhenX is the first machine-ingestion adapter, not the authority for Russian wording. Its metadata
is offered under CC-BY-4.0: https://www.phenxtoolkit.org/resources/download . The database-export
link currently redirects to login. The implemented adapter **does not claim anonymous bulk export
or an undocumented API** and never follows login/external redirects.

```sh
# Explicit network use; seven public protocol pages from several medical areas by default.
uv run --project tools/ingest python -m localmed_ingest.phenx_catalog \
  --network --output data/intermediate/phenx-2026-09-17

# Limit or expand a batch with repeated numeric IDs (maximum 128 unique records).
uv run --project tools/ingest python -m localmed_ingest.phenx_catalog \
  --network --protocol 121704 --protocol 860801 --output data/intermediate/phenx-two

# Replay stored public HTML without network, keeping fingerprints and source-heading locators.
uv run --project tools/ingest python -m localmed_ingest.phenx_catalog \
  --input-dir data/intermediate/phenx-two/sources --protocol 121704 --protocol 860801 \
  --output data/intermediate/phenx-two-replay
```

Default seed IDs, whose public pages were inspected: 121704 (geriatric depressive symptoms),
860801 (PGIC/chronic pain), 130501 (adult migraine), 140601 (kidney failure history), 091301
(respiratory quality of life), 181102 (early-childhood temperament), 820401 (sickle-cell self-efficacy).
They are **catalog candidates, not seven newly implemented Russian calculators**. Source release
versions can be old; never label a protocol as a current guideline merely because its page is live.

Outputs: immutable `catalog.jsonl`, raw HTML snapshots and `manifest.json` with SHA-256s. Only
explicit metadata headings are projected. Item wording, score rules, REDCap branching and
translation permissions are not guessed. Registry license and instrument availability are separate;
every record stays proposed with Russian form/RF applicability unverified. A parse/login/identity
failure aborts the batch before a catalog is written. No patient data, keys or paid inference.

PROQOLID (https://www.mapi-trust.org/services/eprovide/proqolid) is linked as the registry for
instrument versions, translations and permissions. No authenticated API/export was obtained;
**no PROQOLID database or restricted questionnaire was bulk-imported**. Its records can supply
review evidence before adding a further exact-version form. Neither catalogue replaces RF clinical
recommendations or original Russian validation publications.

## Tests and remaining work

Authored: preset/engine endpoint, missing-answer, WHO direction, PHQ item-nine, source/print and
JSON round-trip tests; offline PhenX identity/rights/bounds/replay tests; a real-app Chromium scenario
for import → help → blank print → fill → help without answer reset → result. These tests have
**not been executed in this session**: the Linux/Python execution service returns transport timeouts.
GitHub Actions is intentionally not used; commits carry `[skip ci]`. Keep this PR draft.

Run the existing locked checks locally, including `python:check`, `typecheck`, `test:unit`, formatting,
app build and `apps/app/e2e/clinical-instrument-presets.spec.ts`, before merging. Review the original
PDF/page against every prompt/option and verify browser/Android print layouts. No new APK, SQLite
release, full PhenX crawl, PROQOLID import or physical-device verification is claimed.

Next: reviewed registry-to-concept/tool mappings, additional Russian specialty-specific forms,
multiscale local authoring, and the complete concept/related-source reader. Existing typed
calculator/assessment schemas remain the owners of calculations; do not add per-tool UI branches.
