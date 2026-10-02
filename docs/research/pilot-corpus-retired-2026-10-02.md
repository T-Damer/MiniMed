# Pilot corpus retired — 2026-10-02

Owner decision (2026-10-02): MiniMed drops the 15-card «pilot» corpus (`rf-public-pilot`: seven
pediatric clinical recommendations and eight medication-registry cards) in favour of the full
databases. This note records what was done to the pilot-era benchmarks, workflows and names, what
still carries the word and why. Companion of
[pilot-research-tools-retired-2026-09-27.md](pilot-research-tools-retired-2026-09-27.md).

## Why the release ratchet was red

`bun run benchmark:real:release` reported `pilot.sectionRecall` 0.836 against 0.869 (same value on
v0.6.45, so old drift, not a regression). The «pilot» query sets expected ids and section anchors of
the 15 pilot cards (`kr.rf.714_2.pneumonia@714_2-2025/лечение`, `drug.rf.*`); the released core still
embeds those cards, so the sets measured the pilot cards, not the full databases. Re-targeting them
at the full corpus also explains the earlier failed «no-pilot» core rebuild: its gate expected pilot
ids that a pilot-free core no longer contains.

## What each pilot thing became

| Thing | Decision |
| --- | --- |
| `pilot-rf-queries.json` (42 pediatric recommendation queries) | kept, renamed `clinical-guideline-queries.json`; expects `kr.rf.<official id>`; section/version/anchor fields dropped |
| `pilot-rf-drug-queries.json` (9 medication queries) | kept, renamed `medication-lookup-queries.json`; expects the ЕСКЛП МНН record or Allmed instruction (`esklp.mnn.*`, `drug.allmed.*`), asked on the «Лекарства» scope |
| `doctor-workflow-queries.json` (10) | kept, same retargeting |
| `real-corpus-demo-queries.json`: `pilotAdditionalTargets`, `kr.rf.<id>.<slug>`/`drug.rf.*` expectations | removed; targets are full-corpus ids only |
| `run-pilot.ts`, `benchmark:pilot` (root and `@localmed/benchmarks`) | deleted (it ran against `rf-public-pilot.db`) |
| `content:sync:inputs`, `content:build:synced`, `content:rebuild:auto`, `content/pilot-rf-sources.yaml`, workflow `Automated content database rebuild` | deleted (synced and benchmarked only the pilot pack) |
| workflow `Validate real Russian drug pilot`, `docs/DRUG_REAL_DATA_PILOT.md`, `docs/PUBLIC_PILOT_CORPUS.md` | deleted |
| workflow `Replicate knowledge pilot`, `scripts/replicate-knowledge-pilot.mjs`, `content:ai:replicate:pilot*` | deleted (LLM-drafted «knowledge» from `content/pilot-rf`) |
| workflow `Public Russian pilot Android release` | renamed `Android release` (`android-release.yml`); versioned asset `MiniMed-<v>-rf-public-pilot-debug.apk` → `MiniMed-<v>-android-debug.apk` |
| workflow `Validate Russian regulatory pilot` | renamed `Validate Russian regulatory pack` (`regulatory-pack.yml`) |
| `docs/PILOT_CORPUS.md`, `docs/REGULATORY_PILOT.md` | renamed `PRIVATE_CORPUS.md`, `REGULATORY_PACK.md` |
| `hard-medical-queries-1500` fixture | deleted, see `tools/benchmarks/HARD_BENCHMARK.md` |

Stable public URLs are untouched: `releases/download/android-latest/MiniMed-android.apk`
(`release.ts`), the Pages app, release tags `v<version>`. The app's update checker takes the first
`.apk` asset of a newer release, so the versioned asset name does not matter to it; nothing else in
the repository referenced the old name. Older releases keep their old asset names.

## The ratchet now

`run-real-corpus.ts` reports `lookup.*` (recall@1/@5, MRR@5, Top-1 rate of marked queries) over the 61
retargeted queries, plus the unchanged `demo.*` and `cases.*` groups; `sectionRecall` is gone (see
`tools/benchmarks/CLINICAL_QUERIES.md`). The pointer documents in `core.db` carry only a
recommendation's title, so `--corpus=all` (the release run) also mounts the released module of each
`kr.rf.<id>` the queries expect from `data/build/release-clinical/` (7 of the 744; local-only 3.6 GB
set, skipped when absent). The baseline was re-measured on the full databases and is keyed by the
databases mounted; tolerance 0.02 is unchanged.

Fresh baselines (released `core.db` of 0.6.45, which still contains the 15 pilot cards):

| Key | lookup R@1 | R@5 | MRR@5 | demo R@5 | cases pass |
| --- | --- | --- | --- | --- | --- |
| `core:core.db` (CI) | 0.131 | 0.246 | 0.175 | 0.158 | 0 |
| `core:` all packs + 7 modules | 0.574 | 0.836 | 0.675 | 0.421 | 0.6 |
| `app:` all packs + 7 modules (release) | 0.705 | 0.918 | 0.788 | 0.684 | 0.6 |

The CI row is low by construction: with `core.db` alone a recommendation is a title-only pointer, so
a symptom description cannot reach it. It still ratchets pointer/title and medication-name lookups.
The Top-1 rate of marked queries is 0 on the app path (the one marked query, «цефтриаксон ребенку 3
лет … как второй антибиотик», is ranked second behind the pilot's own ceftriaxone card, which the pilot-free core below does not have), so that metric gates nothing until the pilot cards leave the core.

Check on the unreleased pilot-free candidate `core.0.7.0-test7.no-pilot.db` (`--core=`, app path, all
packs + 7 modules): lookup R@1 0.82, R@5 0.918, MRR@5 0.86, Top-1 rate 1. A core without the 15
pilot cards therefore does **not** fail the lookup gate (its demo R@5 0.632 is 0.05 under the new
baseline; the candidate predates the 0.6.45 core, so re-measure on the next real rebuild before
judging that).

## What still says «pilot», and why

- `tools/ingest/tests/fixtures/pilot-rf/` (the 15 cards, moved from `content/pilot-rf` with the core 0.6.47
  rebuild) and registry migrations 007/008/012 with their pytest fixtures: migrations are numbered history and
  stay. The core build no longer composes the pilot (stages removed); the 45 colloquial aliases are
  `content/colloquial-aliases.yaml` (`alias.colloquial.*`). Measured result: core 0.6.47 in
  [CURRENT_STATE.md](../CURRENT_STATE.md) («Discovery core 0.6.47»).
- `content/regulatory-rf-pilot`, `content/reference-rf-pilot`, `content/definition-pilot`, pack ids
  `minimed.rf-regulatory-pilot`, `data/build/rf-regulatory-pilot.db`, `definition.pilot.*`: shipped
  companion packs. The word is only part of their identifiers; renaming would invalidate installed
  modules and the catalog, so they keep the name until a pack version bump.
- `data/intermediate/private-pilot`, `data/build/private-pilot.db`, `localmed.private-pilot`,
  `medications-pilot*`: local data paths used by running ingestion pipelines.
- `scripts/replicate-ocr-pilot.mjs` (`content:ocr:replicate:pilot`): a one-file OCR experiment, not the
  pilot corpus.
