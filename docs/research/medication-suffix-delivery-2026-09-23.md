# Medication suffix recovery and reference refresh: verified delivery

Existing draft PR #180, branch `experiment/system-one-search-benchmark`, still stacked on #174.
No merge, APK or public content release.

Completed verification: [Actions run 35922212120](https://github.com/T-Damer/MiniMed/actions/runs/35922212120).
Checked implementation: `272a2851adecd9b47f501820e4ee7d79ec8e01d9`.
Data and machine receipts: `e9ba43d0c84aef33696c16616ddee9e3f5efff6b`.

## Search

The new source-name projection handles an omitted existing one-letter marker, including
`Канефрон Н`, with the existing bounded weighted OSA matcher. It does not add hand-authored
misspelling aliases, erase explicit product markers or merge source medicine identities.
`канефрно`, `канифрон`, `конифрон`, `канефронн`, `канефро` and related cases now retrieve
catalog targets associated with the complete source name. Catalog target retrieval is not a
claim that an exact trade presentation or a full drug instruction is installed.

The [same-database comparison](medication-suffix-2026.09.23-suffix-1.json) used the previous
core at `4c66e84f31632f3847c735a300ce15b1ca596019` with separately installed dependencies.

| Development check | Previous | Current |
| --- | ---: | ---: |
| User Kanephron variants, Top-1 | 4/10 | 10/10 |
| Boundary errors in marked source names, Top-1 | 35/80 | 65/80 |
| Same 80 boundary queries, Top-20 | 55/80 | 77/80 |
| Previous frozen spelling set, Top-1 | 162/162 | 162/162 |

All 203 exact-name result-group arrays stayed identical. No rank regressions were observed.
249 successful target hits were checked against source context and anchors; four exclusion
filter checks passed. The clinical parser comparison remained unchanged. Three wider
marked-name queries still have no target in Top-20 and remain in the report. These are
mechanical and authored development cases, not independent clinician typo logs.

This is a recall/identity repair, not a demonstrated latency improvement: on the CI host,
median latency for the prior set changed from about 224 to 235 ms and for the ten Kanephron
queries from about 298 to 334 ms. No Android/WebView timing qualification was performed.

## Actual content accepted

[Acquisition receipt](selected-completions-2026.09.23-suffix-1.json): four of eight candidates
were independently refetched and accepted into existing empty records:

- Гипофосфатемия, Гиперкалиемия and Пресбиопия: MSD professional manual.
- Турецкое седло: inspected K+31 anatomical introductory sentence.

Гипермагниемия and Гипонатриемия were deferred because fetched visible text did not exactly
match the selected excerpt. The two INVITRO candidates, Гиперпролактинемия and Эозинофилы,
were deferred because their fetched pages lacked the required article heading. No INVITRO
text was accepted in this batch. Validation requirements were not weakened to accept them.

Definitions: **8,470 → 8,474**. Pending source records: **7,599 → 7,595**.
All **16,069 identities** and **34,382 prior source blocks** were preserved. New text is
source-local, requires-review, local-dev and ineligible for public redistribution or clinical
promotion. Source-specific thresholds remain attributed source text, not executable norms.

The ordinary DEV preparer includes the registered completion bundle. The
[SQLite build receipt](selected-completion-build-2026.09.23-suffix-1.json) confirms offline
building, identity/coverage equality, logical round-trip and integrity checks. The
[actual reader audit](selected-completion-reader-2026.09.23-suffix-1.json) verifies all four
exact source texts and all four completed cards at rank 1 for their titles.

SQLite: 128,393,216 bytes; gzip: 26,947,887 bytes.
SQLite SHA-256: `5beeb1951723d6127c5e566d8e3fd723f1f8a73cfc81a4a69e47862a0a19a978`.
No generated database binary was committed or uploaded.

## Qualification and cleanup

Passed 732 scoped JavaScript tests and 114 Python tests without failures/errors/skips,
package and app typechecks, changed-file Biome/Ruff and strict Pyright checks. This is not
an assertion that all unrelated repository/clinical release gates are green.

The dedicated one-shot write-back workflow was removed after successful delivery: its
immutable batch identity must not be replayed on every later search edit. The unit tests,
CLI audits, acquisition code, registered data and machine reports are retained. Future
acquisition requires a new batch ID. No recurring collector was created and no Actions
artifact or cache upload was used. Full reasoning about suffix boundaries and standard
algorithms is in [the implementation note](medication-suffix-and-reference-refresh-2026-09-23.md).
