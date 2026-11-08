# Definitions layer as an Obsidian-style vault: measurement (2026-11-08)

Task DEFVAULT1 asked whether the curated definitions/aliases layer should live as a vault of linked
Markdown notes, one note per concept. This is measure-only. Nothing in `content/` or the app's data
path changed. The prototype, pilot vault and scripts are in `research/definitions-vault/`.
Raw outputs are `research/definitions-vault/out/{inventory,links}.json`.

**Verdict: no-go for the whole layer. Conditional go for a curated scope of 456 concepts.**

- The format round-trips losslessly, so it can carry the data.
- But 99 % of the layer is machine-extracted from КР and Wiktionary.
- As notes, that becomes ~24 900 files.
- Obsidian then needs 19–33 s to show a warm workspace on this Mac, against a 3 s threshold.
- Automatic unresolved links surface only 16 % of the known missing definitions.

## 0. What the app consumes today

There are two consumers:

1. **DEV lookup.** `apps/app/src/composition/definition-draft-lookup.ts` imports `catalog.json`,
   `ruwiktionary-2026.9.16.json`, `prepared-source-excerpts-2026.09.21.json` and the three
   `clinical-source-excerpts-*.part-0N.json` directly.
2. **The definition-reference SQLite pack.**
   - `scripts/prepare-definition-reference.py` builds it.
   - It reads the 31 files in `source-inputs.json`, plus `discovered-names-2026.09.23.json` (via
     `name-inputs.json`) and the 6 `*-completions-*` batches (via `completion-inputs.json`).
3. **The alias table in the core.** `content/colloquial-aliases.yaml` feeds the `aliases` table
   through `tools/ingest/scripts/build_alias_pack.py`.
4. **Not consumed by these paths:**
   - `content/definition-gap-fills/` has no code reader. It is the authoring copy of the
     completions.
   - `content/definition-pilot/` (9 notes) is already Markdown. Only the medbase demo pipeline reads
     it.

"Exactly the JSON the app consumes today" therefore means these 41 files: 40 JSON + the YAML,
68.6 MB. The other ≈310 files in scope are acquisition provenance: snapshots, evidence, collection
reports and the archived ruwiki sets. They are not build inputs.

## 1. Inventory

| Measure | Value |
| --- | --- |
| Definition rows (term entry × definition block) | **42 524** (27 871 term entries; 42 479 in dated batches) |
| Distinct concepts (normalized title) | **18 533** (18 529 after merging through aliases) |
| Total definition text | 10.3 M characters |
| Discovered names (`needs-definition`) | 7 637; **6 255** with no definition anywhere |

What the rows are (by `coverage` / `recordType`):

| Tier | Rows | Concepts | Comment |
| --- | --- | --- | --- |
| Definitions (explicit definition, glossary term, paraphrase, gloss, excerpt) | 16 232 | 11 867 | the actual concept layer |
| Abbreviation expansions (КР «Список сокращений») | 19 478 | 5 996 | e.g. МРТ → 370 rows, КТ 351, УЗИ 323 |
| КР section excerpts / article overviews | 6 814 | 1 209 | titled by section: «Классификация заболевания или состояния» = 1 919 rows |

By origin:
- **Machine-extracted bulk: 42 085 rows (99 %).**
  - КР glossary 19 373 and КР source excerpts 15 773 come from the corpus.
  - Ruwiktionary contributes 6 939 rows.
- **Curated or selected: 439 rows.** Catalog 36, specialist journals 224, prepared excerpts 76,
  completions 42, gap-fills 30, MSD/selected 22, pilot 9.

### Definitions per concept

| Definitions | 1 | 2 | 3–5 | 6–10 | 11–50 | >50 | ≥2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All concepts (18 533) | 13 618 | 2 205 | 1 807 | 494 | 363 | 46 | **4 915 (26.5 %)** |
| Definition tier (11 867) | 10 039 | 1 168 | 499 | 96 | 61 | 4 | **1 828 (15.4 %)** |
| Definition tier, distinct texts | 10 482 | 984 | 347 | 51 | 3 (>10) | | **1 385 (11.7 %)** |

- 3 510 concepts have definitions from two or more different source documents.
- The "several definitions per note" structure is needed by a quarter of all concepts, and by one
  in seven true definition concepts.

### Aliases

The alias sources:
- 375 aliases on term entries (411 distinct forms).
- 45 colloquial aliases. They point at 42 canonical terms, and **only 6 of those have a definition
  note**. The other 36 would be alias-only stub notes.

Collisions found by the validator on the vault:
- **6 aliases point to two concepts.** They are «Ясперс», «критерии Ясперса» and «Jaspers» (two
  Jaspers notes), «фибрилляция предсердий» (CHA₂DS₂-VASc and ФП), «регидрон детям» / «рвота
  понос» (two ОРС notes). A seventh, «симптом Воскресенского», is only in
  `content/definition-pilot/`, which is outside this build.
- **30 aliases equal another concept's title.** Examples: «APRI», «FIB-4», «фибрилляция
  предсердий».

Abbreviations as aliases (the obvious next step) would collide massively:
- There are 6 084 abbreviation forms.
- **1 263 of them have two or more stem-distinct expansions.** For example, СД has 6 (сахарный
  диабет, синдром Дауна, смешанная депрессия, …), ПГ has ≥ 8 and ИП has 7.
- Folding them into `aliases:` would make the validator fail 1 263 times. They have to stay
  disambiguation notes (one abbreviation note listing its expansions), as in the full vault below.

### Duplicates (normalized text: casefold, ё→е, punctuation and citation markers removed)

**Exact duplicates:**
- There are 3 574 groups. They contain **14 883 redundant rows, 35 % of all rows**.
- 13 682 of those are repeats inside one concept, mostly the same abbreviation expansion copied
  once per КР.
- 780 groups (3 094 redundant rows) span files:
  - 526 groups across the three `clinical-source-excerpts` parts;
  - 193 groups between the 2026-09-21 excerpts and the 2026-09-29 glossary (the glossary
    re-extracts the same «Термины и определения»);
  - 4 between gap-fills and completions.

**Near duplicates:** 440 pairs in 205 concepts have different text but 5-word-shingle Jaccard
≥ 0.8.

## 2. Round trip

The note format:
- One note per normalized title.
- The frontmatter holds `id` (`c.` + 12 hex), `title`, `aliases`, `kind`, `related` and `sources`.
- Each definition is a `## <source>` block holding the verbatim text, then `^def-<hash>`, then a
  ```` ```def ```` fence with the original record (`"@text"` in place of the text).
- Text-less records sit in ```` ```rec ```` fences.
- File headers are in `_источники/*.md`.
- Links are written `[[Note|surface]]` and stripped at build, so excerpts stay byte-identical.

Byte identity needed four things:
- **A per-record `pos`.** Terms are not in id order in 21 files. Ordering by first block id is
  wrong in only 4 files (14 inversions). A real migration could sort by first block and accept that
  one-time reordering diff instead of storing `pos`.
- **A per-file layout tag.** The files use four layouts: 34 compact, 2 indent-2, 1 "one record per
  line" compact and 2 one-record-per-line indented.
- **The text sentinel** (`"@text"`).
- **Shared blocks.** 28 blocks are shared by two terms. Each note stores the block and the build
  checks the copies agree.

| Run | Notes | Result | Build time |
| --- | --- | --- | --- |
| Pilot (`research/definitions-vault/vault/`) | 85 concepts / 246 definitions, plus 13 source notes | **13/13 files byte-identical to their pilot projection**; 4 whole files byte-identical (`catalog.json`, `selected-medical-definitions`, `msd-definitions-b`, `msd-completions-a`); YAML projection identical | 0.13 s wall, 0.05 s CPU |
| Whole layer, no links | 24 815 concepts + 48 source/orphan notes | **41/41 files byte-identical** | 8.8 s user CPU (17–58 s wall under load) |
| Whole layer, 121 015 automatic links inserted | same | **41/41 byte-identical** | 8.9 s user CPU (25 s wall) |
| Curated scope (see §6) | 456 concepts / 495 notes | 39/39 projections identical; 25 whole files identical | 0.74 s wall |

- The pilot includes 2 alias-only stubs, several concepts with 2–9 definitions from different
  families, and the abbreviation СД with 44 definitions.
- One-time conversion of the whole layer takes 9.4 s CPU.
- **A bug the round trip caught.** A link glued to a source bracket («[LSD]») became
  `[[[LSD|LSD]]]`. Obsidian cannot resolve that, and the strip regex would drop the bracket. The
  linker now skips bracket-adjacent matches.

### Validator on the whole vault

| Check | Count |
| --- | --- |
| Bad or duplicate ids | 0 |
| `textSha256` ≠ verbatim text | 0 |
| Missing source or locator | 0 |
| Alias on two concepts | 6 |
| Alias = another title | 30 |
| Missing hash | 66 (36 catalog paraphrases, 30 gap-fills) |

Requested provenance fields that are not on the record today, out of 42 515 rows:

| Field | Rows | Share | Where it exists |
| --- | --- | --- | --- |
| method | 231 | 0.5 % | completions and specialist records; otherwise implied by the file's `version`/`textKind` |
| retrievedAt | 87 | 0.2 % | otherwise only the file-level `source.accessed` (99.8 %) |
| context (педиатрия/взрослые) | 6 939 | 16.3 % | Wiktionary subject labels |
| review status | — | — | file-level only |

Requiring method, retrievedAt or context per definition would fail more than 99 % of today's rows.

## 3. Linking

Mentions of known concepts, aliases and discovered names were matched automatically and
self-links excluded. There were two modes:
- **exact:** casefolded word sequence; abbreviations case-sensitive.
- **stem:** a crude Russian stem; drop 2 letters, allow up to +4.

Precision is from 40 random links per mode, checked by hand.

Definition tier, 16 232 definitions:

| | exact | stem |
| --- | --- | --- |
| With ≥1 link to a concept that has a definition | **9 200 (56.7 %)** | 15 153 (93.4 %) |
| The same, excluding 82 / 228 hub concepts (≥100 backlinks) | **6 755 (41.6 %)** | 11 376 (70.1 %) |
| Precision of a random link | **37/40 (92 %)**; ~20/40 point at a specific concept, the rest at generic ones («область», «процесс») | **27/40 (68 %)**: «желудочка»→«желудок», «сосков»→«соска», «психол.»→«психоз» |
| Links in all 42 524 rows | 121 671 | 273 738 |

Gap list (links to a known name that has no definition):

| | exact | stem |
| --- | --- | --- |
| Distinct gap targets | **1 016** | 1 445 |
| Gap link occurrences | 10 433 | 25 117 |
| Discovered names without definition that appear as a link | **1 013 / 6 255 (16 %)** | 1 442 (23 %) |

- The top exact gap targets are опухоль 799, конечности 379, электрокардиография 308, инфекция 276,
  скорость оседания эритроцитов 179 and инфаркт миокарда 149.
- The other 5 242 known gaps (84 %) are never mentioned. They would need stub notes or a kept list.
  Unresolved links alone are not a complete gap list.

Backlinks per concept (exact):

| | 0 | ≥1 | ≥5 | median | mean | max |
| --- | --- | --- | --- | --- | --- | --- |
| All 18 533 concepts | 9 001 | 9 532 | 2 338 | 1 | 3.3 | 756 («назначение») |
| Definition-tier concepts (11 643) | **7 447 (64 %)** | 4 196 | 1 177 | **0** | 2.9 | |

- The hubs are «назначение» 756, «заболевание» 615, «состояние» 504, «баллов» 468, «синдром» 429,
  «КТ» / «компьютерная томография» ~429, «психиатр» 400. The last comes from Wiktionary's
  «психиатр.» label: a false link.
- Usable stemming needs a real lemmatizer, which is a new dependency.

## 4. Scale and performance

### Projected vault, whole layer, lossless

- **24 863 notes, 93.4 MB.** Today's 41 JSON/YAML files are 68.6 MB, so this is +36 %.
- Where the bytes go: text 21.1 MB (23 %), definition provenance fences 41.2 MB (44 %), record
  fences 17.2 MB (18 %), frontmatter and headings 11 MB.
- 51 notes are over 100 KB. The largest are:
  - «Классификация заболевания или состояния», 6.2 MB (1 919 КР sections);
  - «Приложение Г1 - Г… Шкалы оценки», 2.0 MB;
  - МРТ, 454 KB.
- For comparison, the owner's ZettleKasten has 2 110 notes / 14 MB.

### Obsidian desktop

- Setup: Obsidian 1.15.0 (the owner's asar), MacBook Pro M2 Max, 12 cores, 64 GB.
- Each run used an isolated profile (`--user-data-dir`) and a fresh vault cache for "cold". The
  owner's vault and settings were not touched.
- Timings come from the DevTools protocol (`tools/obsidian_probe.ts`).
- **The machine was busy with other sessions (load average 21–43), so absolute times are inflated.**
  Only the relative ordering is solid.

| Vault | Notes | MB | Cold: layout ready | Cold: all files indexed | Warm: layout ready |
| --- | --- | --- | --- | --- | --- |
| Pilot | 98 | 0.46 | 1.3 s | 1.8 s | — |
| Curated scope | 495 | 6.2 | 1.5 s | 4.3 s | **2.0 s** |
| Definition-tier concepts only | 11 892 | 34.8 | 2.0 s | 33.7 s | 6.0 s |
| Definitions + abbreviations | 17 354 | 61.5 | 1.6 s | 37.8 s | 10.0 s |
| Whole layer, frontmatter + links only (no text) | 24 815 | 10.4 | 1.8 s | 70.9 s | 23.2 s |
| Whole layer, no links | 24 863 | 90.4 | 1.7 s | 51.9 s | 14.4 s |
| Whole layer, 121 k links | 24 863 | 93.4 | 1.8–2.1 s | 63.6–67.3 s | **18.7–33.4 s** |

How to read the table:
- **Cold.** Obsidian shows the workspace almost at once and indexes in the background.
- **Warm.** Obsidian loads its metadata cache *before* showing the workspace. Warm "layout ready"
  is therefore the boot the owner would feel on every launch.
- **Note count drives the cost, not bytes.** The 10 MB frontmatter-only vault is as slow as the
  93 MB one.
- On warm runs, link resolution was still running when layout became ready (3–7 k of 24.9 k files
  resolved).

### Android

**Not measured.**
- There is no device here, and no emulator with Obsidian. Installing Obsidian's APK would need a
  download.
- From the owner's own phone (Xiaomi 14), ZettleKasten (2 110 notes) reaches layout ready in
  4.7–8 s. Halyard hydrating the whole vault dominates that time.
- The whole-layer vault has 11.8× the notes. No number is claimed for it.

### App boot

**Unchanged by construction.**
- The build emits byte-identical inputs, so the pack and the bundled assets are the same bytes.
- The vault exists only at content-build time.
- The cost is +9 s CPU per content build for the whole layer, or <1 s for the curated scope.

## 5. What it removes and what it costs

The test is the owner's «что убрать, чтобы стало лучше?»: the change must replace things, not add a
layer.

### Whole-layer migration

**Removes:**
- **44 committed build-input files**, which would become build output:
  - 31 `source-inputs` files;
  - 6 dated completion batches;
  - 2 gap-fills;
  - `discovered-names`;
  - the 3 manifests (`source-inputs.json`, `completion-inputs.json`, `name-inputs.json`);
  - `colloquial-aliases.yaml`.
- **The dated-batch format.** A new source becomes note edits, so the diff is per term.
- **The manifest/merge plumbing, ≈580 LOC:**
  - `scripts/refresh-definition-inputs.py` (144);
  - `definition_source_manifest.py` (95);
  - `definition_name_completions.py` (168);
  - `definition_candidate.py` (174).
- **Their tests, ≈590 LOC:** `test_definition_name_completions`, `test_definition_supplied_inputs`
  and `test_selected_completion_transport`.

**Stays, but changes:**
- The acquisition tools would write notes instead of batches. These are
  `catalog_/clinic_definition_completions.py`, `msd_topic_intake.py`,
  `selected_definition_excerpts.py` and `clinical_definition_sections.py` (≈1 970 LOC).
- `definition_reference_pack.py` (741) and `build_alias_pack.py` keep reading the built JSON.
- ≈310 provenance files stay.

**New cost:**
- Build and validator, ≈250 LOC (`vault.py` without the one-time `convert`).
- +9 s CPU per content build.
- **+24 863 files in git (against 44 removed)** and +36 % bytes. Provenance fences are 62 % of
  those bytes.
- A second key layer: concept `id` on top of the 27 871 source-entry ids, which the pack still
  uses.
- A KR id→title map, so headings read «КР — <название>» instead of «КР — kr.rf.286_3».

### Curated scope

This is every concept that has a non-bulk definition or a colloquial alias: 456 concepts / 495
notes / 6.2 MB.

**Removes 27 committed files and 3 formats:**
- 25 JSON files fully covered by the scope:
  - `catalog.json`, `prepared-source-excerpts`, `selected-medical-definitions`, `msd-definitions-b`;
  - the 6 completion batches and the 2 gap-fills;
  - 13 specialist-journal records.
- `colloquial-aliases.yaml` and `completion-inputs.json`.
- The 3 formats are catalog v1, the `minimed-name-completions-v1` envelope and the gap-fill
  format.
- It also removes `definition_name_completions.py` (168 LOC). Its job is filling an empty discovered
  name with a selected definition, and in a vault that becomes writing into that name's note.

**Costs:**
- The same ≈250-LOC build and validator.
- A <1 s build.
- 495 notes instead of 27 files.
- In the 14 partially covered files (Wiktionary, КР excerpts/glossary, 8 journal articles,
  discovered names), the scope's records would leave the JSON. The bulk remainder stays generated
  JSON.
- 3.1 MB of the 6.2 MB is article fragments from specialist-journal overview records. Those are
  article notes rather than concepts, and could stay JSON.

## 6. Recommendation

The thresholds were set before reading the results.

| # | Threshold | Whole layer | Curated scope |
| --- | --- | --- | --- |
| T1 | Lossless: built files byte-identical | ✅ 41/41 | ✅ 39/39 projections |
| T2 | Build ≤ 30 s CPU | ✅ 8.9 s | ✅ <1 s |
| T3 | Validator fails on ≤ 1 % of definitions after migration | ✅ 102 / 42 524 (0.24 %); ❌ if abbreviations become aliases (1 263) | ❌ before cleanup: 74 / 679 (10.9 %): 6 + 2 alias, 66 hash; all fixable by hand |
| T4 | ≥ 50 % of definitions get a ≥ 90 %-precise link to a non-hub concept | ❌ 41.6 % (exact, 92 %); stem 70 % but 68 % precise | not measured separately (175 links among 456 concepts) |
| T5 | Unresolved links surface ≥ 50 % of known missing definitions | ❌ 16 % (1 013 / 6 255) | ❌ same; keep the names list |
| T6 | Obsidian desktop: warm layout ready ≤ 3 s, cold full index ≤ 30 s | ❌ 18.7–33 s / 64–67 s | ✅ 2.0 s / 4.3 s |
| T7 | Replaces rather than adds: committed formats and plumbing go down | ❌ +24.8 k files for −44 | ✅ −3 formats, −27 files, −168 LOC merge; +495 notes, +250 LOC build |

**No-go for the whole layer.**
- The extracted КР glossary, abbreviation lists, section excerpts and Wiktionary make up 42 085
  rows. They are regenerable derivatives of the corpus and are not authored text.
- As notes they make Obsidian slow at every launch (T6). They multiply files (T7). Their links are
  mostly generic hubs (T4).
- Abbreviations cannot become aliases without 1 263 collisions.
- They should stay generated JSON, next to the search index.

**Conditional go for the curated scope** (≈456 concept notes, the hand-selected definitions plus
colloquial aliases). It passes T1, T2, T6 and T7, and passes T3 once its 74 validator errors are
fixed. Before migrating:
1. Resolve the 6 alias collisions and the 2 alias=title cases in scope.
2. Decide how the 36 paraphrases and 30 gap-fills get a hash, or exempt `version: 1` paraphrases.
3. Map КР ids to titles for the headings.
4. Keep the discovered-names list as JSON. Its 6 255 gaps are not reachable through links.
5. Compute backlinks from the bulk КР text at build time instead of writing links into notes. The
   note then shows where a term is used without copying 42 k rows into the vault.

T4 and T5 fail for both scopes. Automatic linking gives backlinks for about half the definitions,
not a complete relation graph or gap list. `related:` stays a curated field: there are 0
term↔term relations today.
