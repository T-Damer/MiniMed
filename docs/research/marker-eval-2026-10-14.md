# Marker (Surya) against the OCR1 texts — measurements and verdict (STATE MARKER1, 2026-10-14)

Owner approval 2026-10-14: try the open-source converter Marker locally as an alternative that keeps headings, tables and
pictures. Questions: is it better enough for (a) the low-grade ГРЛС scans, (b) full texts of the 30 legal acts, (c) the
feeding-norm textbook scans; what does a full set cost in time. Method: the same PDFs through Marker, compared with the
OCR1 text (`docs/research/ocr-quality-2026-10-14.md`) and with the page images, which are the ground truth (I read them).

## 1. Setup and cost

| Item | Value |
| --- | --- |
| Package | `marker-pdf` **2.0.0** (latest stable), `surya-ocr` 0.22.1, `torch` 2.14.1, `transformers` 5.19.0, CPython 3.12.12, uv 0.9.28 |
| Environment | throwaway `data/build/marker-eval/` (gitignored): `venv/` 1.1 GiB, `cache/hf` 1.5 GiB, `cache/datalab-models` 262 MiB, uv wheel cache 1.0 GiB (`UV_CACHE_DIR`, `HF_HOME`, `TORCH_HOME`, `MODEL_CACHE_DIR` all inside the folder) |
| Download | wheels ≈ 1.0 GiB + weights ≈ 1.76 GiB (the Surya-2 vision-language model as GGUF + its projector, the rf-detr layout model, the text-detection and OCR-error models) = **≈ 2.8 GiB** |
| Device | Apple Silicon: the Surya-2 model runs in the Homebrew `llama-server` (Metal), the layout/OCR-error helpers on MPS. Marker 2.0 has two modes; `balanced` needs guided decoding that this llama.cpp build rejects (grammar parse error → layout fell back), with `SURYA_GUIDED_LAYOUT=false` it gave the same text as `fast` on the two documents tried, so everything below is the default `fast` mode |
| Settings | batch size 1: `SURYA_INFERENCE_PARALLEL=1` (one slot, one request at a time), one process, no keys, no paid service (`use_llm` off) |
| RAM | peak resident size of the process tree (Python + llama-server + two helper servers) 2–7 GiB at first, drifting up to **14.35 GiB** after 60–100 pages in one process (the helper servers stay alive between runs and keep growing: restart them every ~10 documents); lowest system-available memory seen **13.7 GiB** on a 64 GiB machine, never near the 8 GiB stop line (the runner aborts below it) |

Not tested: the `balanced` mode on real data, `use_llm` services (paid), other hardware.

## 2. Samples

**ГРЛС.** The first pick (20 lowest-graded documents) turned out wrong: 11 of them have a *native text layer* on every page except a
stamp page; OCR1's grade for them is computed on that one page. The sample was redone from the 2 290 documents with ≥ 80 %
of their pages recognised: **all 18 scanned instructions graded `low`** (80 pages), 2 amendment sheets of the 122 `low` ones
(table-heavy, 6 pages) and the 3 `fair` scanned instructions with the most uncertain numbers (20 pages): **23 documents, 106 pages**.
Raw PDF checksums were verified against `grls-ocr-quality.jsonl`. Source ids (`drug.rf.` + 12 hex digits): low — 47ea1dd55a3c, 6b8b62922076, 4947d715eb89, f07b3c398fc6, acd6756fa9b5, afcba2c12679,
2d0f3ff8f6f1, 576ce666cd75, 75814cee9964, 4b2df3933da9, 97e875d2a414, f2587a056913, 1364912a02ed, c7c141bc8be3, 2ccca2db2a55,
5193aa3e1b62, c6354f4d216c, 10915ba0cd2c (the 74-page one was left out); amendments 0fcc749b9407, 728b79cc496d; fair 078f172a3542,
72b1152e75f1, 60034b187d26. The tables below abbreviate an id to eight hex digits starting at its second digit.

**Legal acts.** `content/regulatory-rf-verification.json` records neither official URLs nor SHA-256 for the 25 `ok` acts (URL null);
the URLs are in `content/regulatory-rf-editions.yaml` (publication.pravo.gov.ru `eoNumber`), the portal API gives title, date and
page count. Downloaded from `publication.pravo.gov.ru/file/pdf?eoNumber=…` (all five are image-only PDFs, 3 s between requests):

| Act | eoNumber | Pages | SHA-256 |
| --- | --- | ---: | --- |
| 190н | 0001202505190006 | 9 | `fd1d031f…4553f97` |
| 1122н | 0001202112200070 | 15 | `5bc4f95c…fa9d` |
| 127н | 0001201906200019 | 24 | `bc2c5858…1693` |
| 274н | 0001202505300033 | 59 | `e385d12af60d1aa9a54f4e493addd10d21b764413c697d8eba43358f58a5dd3c` = the value recorded in `tools/ingest/medical-form-sources.json` (**verified**) |
| 120н (pages 1–20 of 120) | 0001202603260014 | 120 | `fa4d983a…fe8e` |

Only 274н could be checked against a recorded checksum; for the other four no checksum exists in the repository (these are the
values now seen).

**Feeding-norm textbook.** `Med/ПДБ/PDB_Kapitan_n.pdf` (Капитан, 458 PDF pages, no text layer, two printed pages per PDF page).
`content/feeding-norms/reference.feeding.kapitan-volume-and-regime.md` is a transcription of PDF pages 239–240 made from the
images earlier (checked against them), which is the yardstick here.

## 3. ГРЛС results

Errors are counted against the image where the two readings disagree (the lists of disagreements were adjudicated by reading
the page image; an error both engines share is not counted). «Numeric» = doses, units, exponents, isotope numbers, dilutions,
registration numbers, phones; the stamp/seal text that OCR1 reads as garbage is excluded from the word counts.

| Document (kind, pages) | s/page | Numeric errors OCR1 / Marker | Words wrong in a ≤ 300-word sample OCR1 / Marker | What differs |
| --- | ---: | --- | --- | --- |
| 7ea1dd55 leaflet 20 (RU+KZ) | 16.3 | 0 / 0 | 0 / 0 (RU page); Kazakh page ≈ 70 / ~0 | OCR1 drops Kazakh diacritics; both read the 18-cell dosing table; Marker keeps tables, 8 pictures |
| 6b8b6292 instr. 2 | 55.4 | 1 / **8 + ≈3 000 invented** | 17 / 5 (page 2) | **Marker: page 1 lost to a number-counting loop** (see §5) |
| 4947d715 instr. 2 | 11.4 | 8 / 0 | 31 / 1 (248 words) | OCR1 lost the whole dilution line (C6 C9 C3 C12 C6 C6) and the registration number |
| f07b3c39 amendment-type 3 | 15.0 | 0 / 0 | 3 / 4 | OCR1 interleaves the old/new columns; Marker keeps the two columns (Ш → «III» ×4) |
| acd6756f instr. 2 | 11.8 | 7 / 0 | 4 / 0 | OCR1 lost C3 ×4, C6, registration number |
| afcba2c1 · 2d0f3ff8 · 75814cee · 1364912a · 2ccca2db instr. 1–2 | 11–17 | 0 / 0 | 0–1 / 0–1 | equal; OCR1 adds stamp garbage lines |
| 576ce666 leaflet 19 | 20.3 | 0 / 0 | 7 / 0 (page 4) | OCR1: «оказать влитие девие», «лекареных», «серено-сосудисто во» |
| 4b2df3933 instr. 4 (Tc-99m) | 18.8 | **15 / 6** | 2 / 0 | OCR1 lost «99» on every ⁹⁹ᵐTc (11), flattened 10⁻³, 10⁻⁴, lost 0,023; Marker kept «99» but dropped the «m» (6) |
| 97e875d2 instr. 2 | 11.4 | 2 / 0 | 2 / 0 | OCR1 lost the registration number |
| f2587a05 · c6354f4d amendment 1 | 103.8 · 367.3 | 1 / 0 · 0 / **≈25** | – | **c6354f4d: Marker lost the whole old/new table** (2 postcodes, 4 phones, house numbers) after 367 s |
| c7c141bc instr. 8 · 10915ba0 instr. 6 (leeches) | 13.7 · 17.5 | 0 / 1 · 0 / 0 | 1 / 0 · 0 / 0 | Marker «2½ объема» for «2\3 объема» (one place; the next occurrence was right) |
| 5193aa3e amendment 1 | 195.4 | 2 / 0 | – | OCR1 lost «стр. 35»; slow (loop guard hit) |
| 0fcc749b · 728b79cc amendments 3 | 15–19 | 2 / 0 | – | Marker keeps 3 tables with cells; OCR1 reads rows as text, loses the leading 0 of «П N014272/02» |
| 078f172a instr. 11 (Tc-99m kit) | 17.4 | **≈17 / 0** | 0 / 1 | **OCR1 reads the dosimetry table «5,6×10⁻²» as «5,6х102»** (sign and superscript lost, 17 values on pp. 8–9); Marker keeps `10^{-2}` |
| 72b1152e instr. 5 (Tc-99m) | 14.1 | ≈9 / 0 | 0 / 0 | OCR1 lost «99» of ⁹⁹ᵐTc on each occurrence |
| 60034b18 instr. 4 | 12.8 | 0 / **≈10** | 0 / 0 | **Marker silently dropped two lines**: the hotline phones «+7 (495) 681-09-30, 681-93-00» and the e-mail |
| **Total (23 documents, 106 pages)** | **22.9 mean**, 15.4 median document | **≈ 64 in 10 documents / ≈ 50 in 5 documents (+≈ 3 000 invented)** | **≈ 68 / ≈ 12 in ≈ 4 250 words** (1.6 % / 0.3 %) | |

Reading the numbers: OCR1's numeric errors are *systematic and mostly structural* (superscripts, exponent signs, isotope mass numbers,
dilution lines, leading zeros). OCR1 also marks uncertain numbers and grades them; none of the exponent flattening is marked.
Marker's errors are *rare but silent*: 3 of 23 documents (13 %) lost content or invented it, with no flag, and the failing page
looks like normal Markdown.

Other measures:

- **Headings.** Standard instruction sections (17 phrases) found as a heading: OCR1 163 / 197 (83 %), Marker 151 / 197 (77 %, one
  document lost its first page). OCR1's list-driven recogniser is as good; Marker adds sub-headings and `##`/`###` levels,
  bold run-in titles, but also marks non-headings.
- **Tables.** Marker keeps cell structure (HTML cells inside Markdown tables, merged cells flattened): dosing tables of the leaflet
  (18 cells right), the Tc-99m dosimetry tables (9 values checked on the page; the 17 exponent values of the kit's table came out as
  `10^{-n}`), amendment sheets (old/new columns kept in 6 of 7). A merged
  «Примечание» cell is repeated or split across rows. OCR1: text rows `a | b`, columns of amendment sheets interleaved.
- **Pictures.** 46 pictures extracted into 23 documents (syringe diagrams of the leaflet, stamps, signatures); the useful ones are
  a handful of diagrams, the rest is stamps/signatures. OCR1 extracts none (stamps become `page_mark` comments).
- **Speed.** 106 pages in 2 428 s: **22.9 s/page** overall, 17.0 s/page for documents of ≥ 3 pages, 11–14 s on clean 2-page sheets;
  three single pages took 104, 195 and 367 s (generation hit its token limit). OCR1's Vision pass is 2.2 s/page with four in parallel.
  A text-layer PDF costs 0.2 s/page (nothing to recognise).

## 4. Legal acts

| Act | s/page | Header number / date | Body | Tables / structure |
| --- | ---: | --- | --- | --- |
| 190н (9 p) | 18.2 | **«№ 1904», «11 октября 2023»** (truth 190н, 11 апреля 2025; handwriting under a stamp); annex headers «от Нач. с. 19.12.2025. № 1904», «от Ноября 2025 г. № 1904» | page 3 (≈ 330 words): 0 errors | annex table kept, `+` marks in the right column on the checked page |
| 1122н (15 p) | 16.7 | «6 декабря 2021 г. № 1122Н» right (typed) | right | **national calendar table: both polio rows (3 and 4,5 months) silently missing (24 of 26 entries kept)** |
| 127н (24 p) | 24.1 | **«№ 1274»** (127н) | **preamble paragraph cut after «Правительства Российской» (≈ 120 words, ≈ 45 citation numbers and «приказываю:» lost)** | the multi-page ГДН table is split at each page with repeated headers and cells shifted between columns |
| 274н (59 p) | 24.3 | **«№ 2744»**, running headers «2744»/«2747» ×7 | page 2 (≈ 400 words with 10 registration numbers): 0 errors | form tables kept; number bag against the old Vision OCR 1 682 vs 1 652 tokens, word agreement 0.91 |
| 120н (20 of 120 p) | 30.4 | **«№ 1204»** (120н), date right | right | – |

Pattern: the **body text is word- and number-exact on the pages I read (two pages, ≈ 730 words, 0 errors)**, but a handwritten «н»
after the number became «4» in 4 of 4 handwritten headers, a date under a stamp was invented, stamps' registration numbers are always
dropped, one paragraph was truncated and one table lost rows without any signal. The identifiers can be set from the portal's API
(title, date, number) instead of the OCR; paragraph truncation and dropped rows need a cross-check against a second reading.

## 5. Failure modes (all silent)

1. **Generation loop on a stamped/handwritten header** — `6b8b6292`: the line «ЭТ - 3 / 4 / 5 … / 283 …» filled ≈ 3 000 numbers, a made-up
   date «25.04.1974», and swallowed the rest of page 1 (title, composition with 5 mL / 1 mg / 2 mg / 50 mg / 0,5 mg, indications).
2. **Whole table region not produced** (`c6354f4d`, 367 s, 421 characters out).
3. **Lines dropped inside a page** (`60034b18` hotline phones; 1122н polio rows; 127н preamble).
4. **Symbols simplified** — «⁹⁹ᵐTc» → «⁹⁹Tc» (the metastable «m» lost, 6 times), «2\3» → «2½», «Ш» → «III», handwritten «н» → «4».

Cheap detectors that would have caught all of them: a run of ≥ 20 consecutive integers; a page whose word count is below 0.8 × the
other engine's; a number present in the Vision text and absent in Marker's; numbers of the Vision text inside Marker's table cells.

## 6. Feeding-norm textbook (Kapitan, PDF pages 239–240 = printed 458–461)

Marker output 12 191 characters in 133 s for the two pages (67 s per two-page spread, including the model start). Against the
earlier image-checked transcription: **every number of tables 16.2, 16.3, 16.4 (≈ 60 values), all formulas (Тур, Шабалов,
Маслов as LaTeX) and the worked examples are identical; 1 word error in ≈ 880 words («далжен»)**; heading levels, bold run-ins,
and the text of the neighbouring pages that the transcription skipped came out too. Defects: the merged «Примечание» cell of table 16.2
is spread over two rows; Latin letters in formulas (A, B, C), `$…$` markup. This is the best result of the evaluation (clean printed
book scan, no stamps, no handwriting).

## 7. Verdict

| Use | Verdict | Why |
| --- | --- | --- |
| (a) low-grade ГРЛС scans (140 documents / 298 pages; 122 are 1–3-page amendment sheets) | **Better, but only as a second reading with an automatic cross-check; not a replacement.** | Wins on exactly the defects OCR1 cannot fix by rules: superscripts and exponent signs (≈ 20 values), isotope mass numbers (20), dilution lines, Kazakh letters, amendment-sheet columns, table cells, 0.3 % vs 1.6 % word errors. Loses on silence: 13 % of documents lost or invented content, OCR1 loses none of that kind. Use Marker's text for a page only if the cross-check passes, otherwise keep OCR1's (and the existing review marks). **Time ≈ 2 h** (298 pages × 23 s; add 20 % for the loop cases that have to be re-run). All 2 306 OCR documents (19 740 pages) would take **93–131 h (4–5.5 days)** and is not recommended: only 140 are `low`. |
| (b) legal-act full texts (≈ 30 acts) | **Yes, as the primary reader, with identifiers taken from the portal API and a page-level cross-check against Vision.** | It is the only candidate that returns real running text with tables; the body was exact on every page read. Not usable unattended: headers wrong in 4 of 5 acts, a truncated paragraph and dropped rows in 2 of 5. Pages ≈ 2 030 (1 553 measured through the portal for 18 acts, the other 12 estimated at 40) → **≈ 13 h** (9.5–14 h at 17–24 s/page). The 469-page classification 374н alone is 3 h; the 213-page 323-ФЗ should come from a text source instead. |
| (c) feeding-norm textbook scans (Капитан, 458 spreads) | **Yes.** | 0 numeric errors in 60 table values and the formulas, 1 word error in 880, tables and formulas kept. Only the feeding chapter is needed: **≈ 20 spreads ≈ 25 min**; the whole book would be 458 × 67 s ≈ 8.5 h. The other feeding sources have a text layer (no OCR needed). The merged-cell note and Latin formula letters still need the usual page check. |

Marker is **adopted as an optional local build tool** for (b), (c) and the second reading of (a); the venv and weights are kept
(`docs/data-ledger.json`), everything else of the evaluation is deleted. It stays outside the app and the packs; the output is
raw extraction input, to be verified like any other (AGENTS.md: mark table, OCR and missing-text problems, never repair silently).

## 8. Pipeline step (not run on the full sets)

```bash
cd /Users/d/Projects/Personal/MiniMed          # main checkout; private data stays there, never committed
data/build/marker-eval/venv/bin/python -I scripts/marker_convert.py \
  data/build/marker-out/<set> "<pdf>[:<0-based pages, e.g. 238-239>]" …
pkill -f 'surya\.(fast_layout|ocr_error)'      # after a batch; restart per ≈ 10 documents (the helper servers grow)
```

`scripts/marker_convert.py` loads the models once, converts one document at a time (batch size 1), writes
`<set>/<stem>/<stem>.md` with page breaks (`{N}` + dashes, 0-based) and pictures, appends seconds/page, peak RAM and lowest free memory
to `<set>/results.jsonl`, and aborts below 8 GiB free. Weights live in `data/build/marker-eval/cache/`; to rebuild the tool:
`uv venv --python 3.12 data/build/marker-eval/venv && UV_CACHE_DIR=… uv pip install --python data/build/marker-eval/venv/bin/python marker-pdf==2.0.0`
(the first conversion downloads ≈ 1.76 GiB of weights; the Homebrew `llama-server` must be installed).

Still to build before a full run: the reconciliation step (per page, Marker vs the Vision text: page word count ratio, numbers present
in one and absent in the other, a run of consecutive integers; pages that fail go to review, passing pages take Marker's text, failing
pages keep OCR1's), and for the legal acts the header block from the portal API record. Neither exists yet.

## 9. Honest limits

- One run per document; sample of 23 + 5 + 1 documents; numeric and word errors counted from the aligned differences, adjudicated on
  the page images I opened (≈ 35 pages); an error both engines make is not counted; no page-level ground truth for the rest.
- OCR1's numbers are the released text of this repository (Vision + Tesseract second opinion + rules), not a different engine setting.
- Speeds include model-start time for the first document of each run and loop cases; memory is the process tree, not a cgroup.
- The 74-page low-grade instruction, `balanced` mode, other Apple chips and the rest of the 30 acts were not run.
