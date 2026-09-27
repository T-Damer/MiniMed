# Allmed-style medication UI: data contract

Requested by the user for a new UI (two pages: a hierarchical pharm-group browser, and a drug
detail page with photo, analogs, active ingredient, pharm groups, prescription, and a
Кратко⇄Инструкция toggle). This is the report-and-contract deliverable requested before any build;
it states what data already exists, where, its measured coverage, and what a UI agent can read
today versus what still needs a small build step. No client pack was published from this; every
number below comes from local, already-built or already-extracted data under `data/build/` and
`data/intermediate/`.

## Sources inspected

- `data/build/medications-unified.db` — the largest already-built (but unpublished) merge of
  Allmed + GRLS + ESKLP, 8,410 documents (4,708 `allmed_reference` + 189 `official_drug_instruction`
  + 3,513 `official_registry_summary`).
- `data/intermediate/allmed-reference-candidates.jsonl` — a raw, row-level dump of the Allmed
  source SQLite (`drugs`, `ingredients`, `ingredients_relation`, `categories`, `categories_relation`),
  one JSON line per drug, `reviewStatus: reference-only`. The original Allmed SQLite file itself is
  not present on this machine (private, not committed, likely cleared after this dump and the
  images pack were built); this JSONL is a complete substitute for everything needed below except
  actually downloading the packaging images.
- `data/intermediate/allmed-medications/*.md` — the prepared, searchable Allmed document workspace
  that `medications-unified.db` was built from (`tools/ingest/src/localmed_ingest/allmed_reference.py:prepare_allmed_medications`).
- `data/build/release-esklp/*.db` — 15 already-built, unpublished ESKLP identity modules
  (`minimed.medications.<atc-group>.ru.db`), metadata-only (`trustedDoseData: false`).
- `data/build/official-grls-modules/*` — an earlier, unrelated "family=medication" module
  prototype; noted only as a negative example (see below).
- `apps/app/src/features/medications/medication-record.ts` — the existing merge/compose contract
  (`MedicationProduct`, `composeMedicationProducts`, `parseAllmedMedicationProduct`,
  `parseMedicationProduct`) that any new field must fit into or extend.

## Page 1 — hierarchical pharm-group browser

**Source: Allmed's own `categories`/`categories_relation` tables, not ATC.** The user's "356
групп" is Allmed's own taxonomy (Allmed's public site groups drugs this way today), completely
separate from the ESKLP/WHO ATC hierarchy discussed for Page 2.

- 318 distinct categories appear in `categories_relation` in this snapshot (drugs actually assigned
  to a category); the 356 the user sees on Allmed's site likely includes ~38 categories with no
  linked drug in this particular snapshot, which cannot be confirmed without the raw `categories`
  table (not captured by the dump tool for orphan rows).
- Hierarchy: `categories.sub` is the parent category id; `sub == 0` is a root. Depth reaches at
  least 3 levels in the data (e.g. "Антибиотик-азалид" → "Макролиды и азалиды" → "Антибиотики").
  109 categories are roots by this rule. **Caveat, not fixed silently**: a few parent chains look
  like source data-quality artifacts (e.g. "Противовирусные... средства" chains up to "Ненаркотические
  анальгетики..." as a grandparent) — this is Allmed's own taxonomy as scraped, not something this
  report corrects.
- Coverage: 4,707 / 4,708 Allmed drugs (99.98%) have ≥1 category; 3,617 have exactly one, 939 have
  two, up to 5 for a few drugs.
- **Not currently exposed** in the built `allmed_reference` documents or `medications-unified.db`:
  `tools/ingest/src/localmed_ingest/allmed_reference.py:prepare_allmed_medications` never reads
  `categories`/`categories_relation` at all (only `export_allmed_reference`, the raw-dump audit path,
  touches those tables). A UI cannot read a pharm-group tree from the current pack; it would need a
  small new module (see "Proposed build" below), for which every field already exists in the JSONL.

## Page 2 — drug detail

| Field | Source (table.column) | Currently in a built pack? | Coverage |
|---|---|---|---|
| Name (`name_ru`) / Latin (`name_lat`) | `drugs.name_ru` / `drugs.name_lat` | Yes — `document.title` / `metadata.nameLat` | 4,708/4,708 |
| Package photo | `drugs.img` (format `img/preparations/<id>.<ext>`, matches `safePackagingImageReference` in `medication-record.ts` exactly) | **No** — 0/4,708 documents in `data/intermediate/allmed-medications` carry `metadata.img`, even though the code path (`prepare_allmed_medications`) computes and writes it. Confirmed stale: the raw dump has `img: "img/preparations/1.png"` for drug 1 (Анальгин) and the current code would accept it, but this workspace predates that logic and the raw Allmed SQLite is gone, so it cannot be regenerated without a fresh source snapshot | 4,244/4,708 (90.2%) in the raw dump; a **separate** local-dev-only packaging-image ZIP (4,214 images, checksum-verified) already exists per `docs/DRUG_KNOWLEDGE_PIPELINE.md`, gated on Allmed redistribution rights, not in the catalog |
| Аналоги (дженерики, синонимы) | `drugs.analogs` (free-text comma list, e.g. "Метамизол натрия, Баралгин М, Анальгин-Ультра") | Rendered as prose under a "# Аналоги" markdown heading, not as linkable entities | 4,708/4,708 have non-empty text; **0 are resolved to another Allmed/GRLS document id** — this is a name list, not links |
| Действующее вещество | `ingredients`/`ingredients_relation` (МНН, Latin+Russian name+description) | Partially — `metadata.ingredientNames`/`ingredientIds` are written by `prepare_allmed_medications`, and a separate ESKLP crosswalk sets `metadata.linkedMnnDocumentId` when `--esklp-ledger` is supplied | 4,707/4,708 have ≥1 ingredient row; `linkedMnnDocumentId` set on 3,538/4,708 (75.2%) in `medications-unified.db` |
| Фармакологические группы | Two candidate sources: (a) Allmed's own `categories` (see Page 1, near-100% coverage, no ATC codes); (b) GRLS `pharmacotherapeuticGroups` free-text labels, present only on the 189 GRLS registry cards that already have a downloaded instruction | (b) is in the pack today (`document.metadata.pharmacotherapeuticGroups`); (a) is not | Recommend (a) as the primary always-available source for this UI field, since instruction coverage is currently only 189/3,513 GRLS registrations |
| Рецепт (международный + Россия, Rp./D.S.) | `drugs.recipe` (Latin Rp./D.S., HTML) and `drugs.recipe_ru` (Russian translation, also embeds dispensing status + Рецептурный бланк number as free HTML text, e.g. "Таблетки без рецепта / Ампулы по рецепту / Рецептурный бланк - 107-1/у") | Rendered as prose under two markdown headings ("# Пример рецепта", "# Расшифровка примера рецепта"), HTML-stripped but not split into structured fields | `recipe`: 4,708/4,708; `recipe_ru`: 4,700/4,708 (99.8%). A UI can read these two sections today by heading text; a cleaner contract would add `metadata.recipeLatin`/`recipeRu`/`dispensingStatusText` at prepare time (not built) |
| Кратко ⇄ Инструкция | `medication-record.ts` (`composeMedicationProducts`, `instructionDocumentId`) | Yes, the mechanism exists; coverage is the GRLS-instruction-availability question already tracked under the GRLS ingestion work (task 1/3 of this session) | ~75/4,708 (1.6%) if `medications-unified.db` were published as-is; up to ~1,876/4,708 (39.9%) achievable from already-downloaded (not yet built) GRLS PDFs, per the earlier checkpoint |
| ATC code (Allmed's own) | `drugs.atc_id` (foreign key; no `atc` lookup table was captured by the dump tool, so the code text itself is **not resolvable** from local data) | No | 3,896/4,708 (82.8%) have a non-null `atc_id`, but it cannot be turned into a code/name without a fresh Allmed export that also captures the `atc` table |
| ATC code (authoritative, resolvable) | ESKLP `esklp_rows.py` column 13 (`atc`), already parsed into every ESKLP MNN document's `metadata.atcCodes` | Yes, in the 15 unpublished `data/build/release-esklp/*.db` modules | 2,765/3,324 ESKLP MNN documents (83.2%) carry a real WHO ATC code (the rest are almost entirely homeopathic/multi-ingredient combination remedies with no ATC by design, correctly bucketed, not a data gap) |

### The "6 near-duplicate presentation lines" bug (Регидрон, and likely every multi-pack-size GRLS drug)

Root cause found in `tools/ingest/src/localmed_ingest/grls_products.py:parse_grls_presentations`.
It splits one raw `releaseForms` catalog entry by comma into `[dosage_form, strength, ...packaging]`
and locates the strength segment by regex. For most drugs the raw GRLS text has three clean
comma-separated segments ("таблетки, 10 мг, 1 шт. - упаковки ... - По рецепту"), so this works. For
Регидрон/РеАкватант/Тригидросоль-style entries the raw text has **no comma** between the
weight/strength and the packaging description ("порошок для приготовления раствора для приема
внутрь, 18,9 г - пакетики (30 шт.) - пачки картонные - Без рецепта" — only one comma, right after
the dosage form). The parser's `strength_index` lookup still finds a match (the segment contains a
number+unit), but then takes **everything after the dosage form** as `raw_strength`, because there
is no further comma to stop at — so `strength` ends up holding the entire packaging tail, and
`dosage_form` gets a stray trailing `, ~` from an adjacent empty field. The grouping key
`(dosage_form, strength)` then differs for every pack size (30/20/10/4 sachets, In-Bulk variants),
so what should be **one** presentation with 6 `packages[]` entries becomes 6 separate
"presentations". Verified directly against the built `data/build/medications-v2.db`: Регидрон's
`presentations[0].strength` is literally `"18.9 г - пакетики (30 шт.) - пачки картонные - Без
рецепта"`.

**Fix direction (not yet implemented, per "report first")**: when no interior comma separates the
strength from the packaging tail, split on the first `" - "` (which the raw text always uses to
introduce packaging) instead of relying purely on commas; then group by
`(normalized(dosage_form), normalized(strength))` as already designed. This only requires a change
inside `parse_grls_presentations`/`_split_values` in `grls_products.py`, no schema change, and
should collapse Регидрон's 6 presentations into 1 with 6 `packages[]`. Needs regression coverage
against drugs whose raw text already parses correctly today before landing.

### МНН-level canonical instruction + per-trade-name diffing (proposed design, not built)

Goal: trade names sharing one MNN (e.g. every "порошок для приготовления раствора для приема
внутрь" ORS product) usually carry near-identical official text; the UI wants one canonical
instruction per MNN plus a deterministically computed, clearly-attributed list of sections where a
specific trade name's instruction differs.

- **Grouping key**: `(standardizedInn, dosageForm)` from the ESKLP crosswalk already computed per
  GRLS registration (`grls_products.py:_crosswalk_metadata`, exposed today as
  `esklpStandardizedInn`/`esklpMnnDocumentId` in every registry-card's metadata) — no new matching
  logic needed, the join key already exists.
- **Canonical selection**: pick the trade name's instruction with (a) the most sections classified
  by the new GRLS sectioner (fewest `other`) and (b) the most-recent `instructionLabel` date as a
  tiebreaker; record which trade name/registration number was chosen and why in the built pack's
  metadata, never silently. An originator-vs-generic rule was considered and rejected for a default:
  GRLS data does not reliably mark originator status, so "most complete, most recent" is the only
  criterion available without inventing an unverifiable fact.
- **Diffing**: compare each `section_type` (from the sectioner) pairwise by `normalize_for_index`d
  text (existing helper in `normalization.py`); a section present in the canonical MNN instruction
  but textually different in a given trade name's instruction is flagged as "own" and rendered from
  that trade name's own instruction; a section identical after normalization is rendered from the
  canonical MNN instruction with **explicit attribution to the canonical trade name and its
  registration number** in that render, per the user's requirement — a trade-name card must never
  present another product's instruction as if it were its own. No text is synthesized or merged;
  this is a pure per-section pointer/attribution table, computable once the sectioner output exists
  for enough instructions to test on more than the ORS family.
- Coverage today: 0 MNN groups have been computed this way yet (design only); once the sectioner
  mass-processing (task 3 of this session) produces `section_type` for a large instruction set,
  computing this table is a single pass over already-extracted data, no new downloads.

### Generics vs. similar (proposed design, not built)

- **Дженерики**: same standardized INN (`esklpStandardizedInn`) **and** the same dosage form (and,
  where present, the same strength) — a strict, source-exact equivalence class, no fuzzy matching.
- **Похожие**: same ATC prefix at a stated level, defaulting to **level 4** (5-character code,
  "chemical subgroup") per the user's decision; the level actually used must always be stated next
  to the result (never implied). Source: ESKLP `atcCodes` (see table above, 83.2% coverage across
  3,324 MNN documents); when a product's ESKLP entity has no ATC code at all (the ~17% homeopathic/
  combination-remedy remainder), the UI contract must show that explicitly ("АТХ не определён"), not
  omit the field silently or fall back to Allmed's own unresolvable `atc_id`.
- This can be computed in one pass over `data/build/release-esklp/*.db` plus the GRLS↔ESKLP
  crosswalk already produced by `grls_products.py`; no new source acquisition required.

## Negative example: don't reuse `official-grls-modules`

`data/build/official-grls-modules/module-build-report.json` (an earlier, `family=medication`
prototype invoked via `catalog_module_builder.py`) buckets all 38,815 raw GRLS registrations into
only 3 modules: `antiinfectives` (399), `nervous-system` (5), and **`unclassified` (38,411, 99% of
the catalog)**. This is not usable as a "modules by ATC" answer and should not be extended;
`data/build/release-esklp/*.db` (below) is the real, already-working ATC split and should be the
basis for any medications module the user asks to build later.

## Existing ATC module infrastructure (answers the "modules by pharm group" question directly)

`data/build/release-esklp/` already contains 15 built (unpublished, metadata-only) modules
following WHO ATC anatomical level 1, produced by the existing `esklp_catalog.py`/`esklp-release`
pipeline — this is the "по образцу ESKLP" pattern the user asked to follow, and it already exists:

| Module | Documents (MNN identities) |
|---|---|
| alimentary-metabolism | 394 |
| antiinfectives | 345 |
| antineoplastic-immunomodulating | 327 |
| antiparasitic | 16 |
| blood | 170 |
| cardiovascular | 246 |
| dermatological | 190 |
| genitourinary-hormones | 160 |
| musculoskeletal | 125 |
| nervous-system | 325 |
| respiratory | 223 |
| sensory-organs | 87 |
| systemic-hormones | 29 |
| unclassified (no ATC / homeopathic) | 559 |
| various | 128 |
| **Total** | **3,324** |

These count MNN identities, not individual registrations/instructions (ESKLP is organized by MNN;
one MNN group can back many GRLS registrations). If GRLS-instruction full text is added to this
same module split (task 3 of this session), each module's real size is driven by how many
registrations under its MNNs have a downloaded+prepared instruction, not by the identity-module
document count above; that sizing is reported separately in the GRLS mass-processing checkpoint.

## Summary contract for the UI agent

- Page 1 (pharm groups): not yet buildable from a published pack; every needed field exists in
  `data/intermediate/allmed-reference-candidates.jsonl` (`categories`/`categories_relation`). A
  small, cheap build step (extend `prepare_allmed_medications` to also emit `metadata.categoryIds`
  + a `data/build/allmed-categories.json` membership file, id/name/parent/drugIds, shaped like
  `catalog-esklp-membership.json`) would make this immediately usable; not built yet, per
  "report first."
- Page 2: name/Latin/ingredient/ESKLP-МНН-link/GRLS pharmacotherapeutic-groups-for-189-drugs are
  already readable from `medications-unified.db` today (once published). Photo, structured recipe
  fields, structured presentations (post-bugfix), pharm-groups-for-all-4,708-drugs, generics, and
  ATC-level similarity are all designed above but need the small build steps listed; none require
  a new source download.
