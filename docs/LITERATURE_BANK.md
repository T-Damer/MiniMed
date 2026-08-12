# Private literature bank

`Med/` is a private personal library outside `data/raw`, not committed to Git. This document classifies
what is in it and what it is candidate source material for. Nothing listed here is published: every
entry still needs OCR (for scans without an existing digital layer) or direct page citation, then the
same rights/redistribution review as any other content input (see [CALCULATORS.md](CALCULATORS.md) and
[TECHNICAL_PLAN.md](TECHNICAL_PLAN.md)).

## High relevance — pediatric norms and calculators

- `ПДБ/Kapitan-Propedevtika_detskikh_boleznei.djvu` — propaedeutics of children's diseases; chosen
  primary calculator-formula source. **Format blocker**: `.djvu` is not accepted by the OCR pilot below
  and needs a local djvu→PDF conversion first.
- `ПДБ/pochivalov-_db_uchebnik.pdf` — propaedeutics textbook; already PDF, ready for OCR.
- `ПДБ/ПроцентильМЖ.pdf` — boy/girl percentile tables; fast cross-check against the WHO tables already
  cited in `who-child-growth-standards.md`.
- `ПДБ/кормление_1год.pdf`, `ПДБ/PITANIE.pdf` — infant feeding norms.
- `Нутрициология/Рабочая тетрадь Нутрициология 28.02.2021.pdf` — nutrition workbook.
- `Поликлиника/Тесты поликлиника 2012/НПР.doc` — neuropsychic development norms by age; candidate for a
  developmental-milestones assessment. **Format blocker**: legacy `.doc`, needs conversion to `.docx`.
- `Поликлиника/Тесты поликлиника 2012/Комплексная оценка состояния здоровья детей.doc` — child
  health-group classification method, overlaps the already-drafted `order-404n`/`order-211n` regulatory
  cards. Same `.doc` blocker.
- `Нео/Литература/` (Шабалов Нео ×3, Володин «Неонатология. Национальное руководство», Гомелла ×2) —
  authoritative neonatology references for birth-weight/gestational-age norms.
- `Трактовка анализов.pdf` (top level) — age-based lab reference ranges.

## Moderate relevance — supports existing content areas

- `ФП` (факультетская педиатрия) — pneumonia/bronchitis/etc. test bank, overlaps
  `content/pilot-rf/pneumonia.md` and `bronchitis.md`; useful for QA cases, not a norms source.
- `ДетскиеБолезни` — lecture decks (hepatitis, exanthems, toxicosis).
- `ДХ` (детская хирургия), `ГП` (госпитальная педиатрия), `Эндо`, `Фтиза`, `ЛОР`, `Офтальм` — overlap
  already-drafted regulatory acts (`order-583n` pediatric endocrinology, `order-127n`/`190n`
  tuberculosis); background reading, not a norms source.
- `Психиатрия` — candidate for the clinical-psychiatric-scale gap flagged in
  [ASSESSMENTS.md:16](ASSESSMENTS.md:16); needs separate validated-instrument review before authoring
  any test.
- `КлинФарма`, `Фарма` — dosing/pharmacology background.
- Top-level `EKG_pod_silu_kazhdomu.pdf`, `Karmanny_spravochnik_po_EKG.pdf`, `ПВБ/Atlas_EKG_150...pdf` —
  ECG atlases; relevant only if an ECG-reading aid is ever roadmapped.

## Not relevant to MiniMed's clinical scope

Basic-science coursework — `Анатомия`, `БХ`, `Биология`, `Гистология`, `Иммунка`, `Микра`, `ПФ`,
`ПатАн`, `ОХТА(ТОПКА)`, `Химия`, `ФизМат` — and administrative/non-medical folders — `БЖД`, `ГОСы`,
`ГОСы(ГИА)`, `ИстМед`, `История`, `Латынь`, `Менеджмент`, `Политология и социология`, `Право`,
`РесурсноеОбеспечение`, `ФК`, `Философия`, `Экономика`, `ЦТ`, `Аккред`, `Электив Шклоы`, `МПЭЧ`,
`МК` (медицина катастроф), `ОФЗД` — stay in the private library, out of scope for the content bank.

## Adult-only specialties — lower priority given the pediatric focus

`АиГ`, `Дерма`, `Инфекции`, `Неврология`, `ОХ`, `Онкология`, `Урология`, `СудМед`, `Травма`, `УХОД`,
`Эпидемиология`, `ФТ(ТФ)(ГТ)(ТГ)`, `МедЭксп`, `МедПраво`, `МПР(МедПрофилактика)`, `ОЗ(Д)` — useful for a
later adult-scope expansion, not the current pediatric-norms push.

## OCR pipeline status

Resolved by a 5-page bake-off (headers, an 8×5 centile table, a diagram, an insulin-dosing table, a
merged-header ISPAD table) extracted from `pochivalov-_db_uchebnik.pdf` and run through every candidate
below. Ground truth was checked by eye against the source scan.

| Candidate | Cost | Headers/lists | Tables | Images | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Replicate `datalab-to/marker`** (existing `scripts/replicate-ocr-pilot.mjs`, no `--use-llm`) | paid | correct | all 3 tables reconstructed exactly, including a merged-header table | extracted **and** described in readable prose | **winner** |
| Local `marker-pdf` (pip, Apple MPS, same underlying engine) | free | correct | broken — line-wrapped cell text splits into extra table rows, headers truncated | extracted as a file, no description | usable for text, not tables |
| Local `docling` (IBM, pip, Apple MPS/CPU) | free | correct | column alignment mostly right, but leftover soft-hyphen artifacts inside cells (`«очень низ­ ких»`) and Latin `S` instead of `✓` | embedded as a raw base64 PNG with no description — bloated one 5-page test file to 443 KB | usable for tables, text needs hyphen cleanup |
| MLX `dots-community/dots.ocr-6bit` via `mlx-vlm` | free (≈4 GB download) | — | — | — | **broken**: returns a single degenerate whole-page "Picture" bbox regardless of prompt |
| MLX `mlx-community/dots.mocr-4bit` via `mlx-vlm` | free (≈3.5 GB download, slow fetch) | — | — | — | **broken**: even with the exact official `prompt_layout_all_en` prompt from `rednote-hilab/dots.ocr`, returns near-empty or degenerate output; the MLX-community port does not work reliably for this task today |

**Recommendation**: use the existing Replicate `datalab-to/marker` pilot as the default — it already
covers the structure requirement (headers, tables, images) better than every local alternative tried, and
needs no new integration. Fall back to local `marker-pdf` only when avoiding Replicate cost matters more
than clean tables (tables still need the same manual review the `draft-review-required` contract already
requires). `docling` is a viable second local fallback specifically when table alignment matters more than
clean prose, at the cost of a hyphen-cleanup pass and stripping/re-saving its embedded images. The MLX
document-VLM route is not recommended right now — the community `mlx-vlm` ports for `dots.ocr`/`dots.mocr`
did not produce usable output in this test even against their documented official prompts.

- Output is always `status: draft-review-required` in `data/intermediate/replicate-ocr/` and is never
  auto-promoted into a content pack or SQLite — matches the existing safety contract as-is.
- **Cost**: `datalab-to/marker` on Replicate is priced at **$4 per 1,000 pages** ($0.004/page) in `fast`/
  `balanced` mode — confirmed via the Replicate blog and cross-checked against our own metered prediction
  (5 pages, `mode: fast`, billed at $0.02). `accurate` mode + structured JSON extraction is $6/1,000 pages
  ($0.006/page). At this rate `pochivalov-_db_uchebnik.pdf` (272 pages) costs about **$1.09**; the
  neonatology literature (Шабалов ×3, Володин, Гомелла ×2) will run several dollars given hundreds of
  pages per book. The earlier $0.25-for-four-excerpts figure in [CURRENT_STATE.md](CURRENT_STATE.md) was a
  different, much smaller pilot and is not the per-page rate.
- **Format gap unchanged**: the pilot accepts only `.pdf`/`.docx`. `Kapitan-...djvu` and the two
  `Поликлиника` `.doc` files still need a local, free conversion pass first.

### Already-run drafts found in `data/intermediate/replicate-ocr/` (2026-08-09, predates this bake-off)

Not produced by this session — found already present, dated two days before this investigation:
`neo.volodin_nr`, `neo.shabalov`, `ft.moiseev_t1`, `psych.obschaya`, `ftiz.lozovskaya`, `lor.bogomilsky`,
`trauma.kotelnikov`. These are outside the pediatric-norms shortlist below (faculty therapy, general
psychology, phthisiology, ENT, trauma) and have not been quality-checked against this bake-off's findings.
Review before relying on them; they predate confirming Replicate marker as the recommended default.

## First OCR batch — done (2026-08-11)

Ran via Replicate `datalab-to/marker`, `fast` mode, confirmed winner above. `Kapitan-...djvu` turned out
unnecessary — `ПДБ/PDB_Kapitan_n.pdf` is already a 458-page PDF of the same book, no djvu conversion
needed. That file exceeded Replicate's per-upload size limit (123 MB, HTTP 413), so it was split into 4
page-range chunks with PyMuPDF (no recompression) and OCR'd separately; the four drafts are merged into
`pdb.kapitan.merged.ocr-draft.json` with page-range markers, chunk provenance kept in
`pdb.kapitan.part1-4.ocr-draft.json`.

| File | Pages | Draft | Cost |
| --- | ---: | --- | ---: |
| `pdb.procentil-mzh.ocr-draft.json` | 8 | `data/intermediate/replicate-ocr/` | $0.03 |
| `pdb.pochivalov.ocr-draft.json` | 272 | `data/intermediate/replicate-ocr/` | $1.09 |
| `pdb.kapitan.merged.ocr-draft.json` (4 parts) | 458 | `data/intermediate/replicate-ocr/` | $1.83 |
| **Total** | **738** | | **$2.95** |

No garbled-text/replacement-character corruption found in any file (automated scan). Kapitan part 4 alone
contains 551 detected tables, largely a renal-system workup chapter dense with normative lab values
(urinalysis, Нечипоренко/Амбюрже/Зимницкий methods, biochemistry) — high-value for the pediatric-norms
goal, not yet read by a person. Every file here needs a human pass before informing any published content;
open questions and unverified claims are tracked in
[LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md), not silently trusted.

## Second batch (not started)

Neonatology literature (Шабалов/Володин/Гомелла) and the `.doc` Поликлиника files (need `.doc`→`.docx`
conversion first, `textutil` available locally) remain for a second batch, pending review of this first
one.
