# OCR quality of the ГРЛС instruction texts — measurements and decisions (STATE OCR1, 2026-10-14)

Owner 2026-10-13: «Data with quality problems — fix it». Scope: the 15 published ГРЛС instruction
modules (2 296 OCR texts, 457 unclassified scans) and the 16 manufacturer-site OCR texts. Method,
numbers and what was rejected; the shipped state is in `CURRENT_STATE.md` «OCR1».

## 1. What the OCR texts are

- Engine of the released texts: the macOS Vision helper (`tools/ingest/macos_vision_ocr.swift`,
  1 800 px page width, `ru-RU`+`en-US`, accurate level, language correction on). Tesseract is not
  installed on the build machine (the app ships `tesseract.js` 7 with `rus`+`eng` data for the user's own files).
- Only 29 of 2 302 OCR documents had a recognition confidence recorded (the field was added after most were
  extracted). Vision's confidence is coarse: lines come out as 0.3 / 0.5 / ≈1.0.
- The files are scans of 96–300 dpi: pages of 1–51, 19 711 pages and 10.5 GB of PDF.

## 2. Defects, measured on the released text

Measured on the prepared Markdown the modules were built from, against native-text-layer instructions of
the same corpus (6 655 documents) as the reference lexicon, and by looking at the page images.

| Defect | How often (OCR texts) | What it does |
| --- | --- | --- |
| Scan stamps in the body: «СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ…», «МИНЗДРАВ РОССИИ», «СОГЛАСОВАНО», «ЛП - 005351-021219» | 3 381 stamp lines in 966 documents; 281 documents with the expert-report stamp as a heading | cut sentences in two, become section titles, add numbers that are not doses |
| One paragraph per OCR line (Vision also splits a justified line into word pieces) | median paragraph 39 characters, 74.5 % of paragraphs end without punctuation | broken sentences in the reader and in search chunks |
| Sheets of amendments read as the instruction («Изменение № N», «Старая / Новая редакция») | 720 of 2 302 OCR documents (659 labelled «Инструкция по медицинскому применению») | a registration whose only text is a one-page change sheet looked like it had an instruction |
| Title not recognised (stamp between the title words, Latin look-alikes) | 457 documents «unclassified», 390 of them are plain instructions | no kind label, ranked among leaflets |
| Systematic misreads | «Стах» for Cmax (2 224 times), «иньекций» for «инъекций», «коньюнктивит», «вышуска», «вкладьи», dropped «У» of «Условия» | unknown words, failing exact search |
| Text layers with a broken font encoding that the preparer kept (3 documents, 0 recognised words) | 10 documents of 8 957 | unreadable |
| Tables | amendment sheets: columns interleaved line by line | a changed address next to the old one |
| Numbers | not edited by any step; 0.5 % of paragraphs carry a digit-run with a look-alike letter or a unit that is no unit | doses must be checked against the page |

Unknown-word ratio against the lexicon: overall 3.3 %, median 3.5 % (native text 0.9 %). About 70 % of the
distinct unknown words occur once: trade names, INNs and addresses, not errors.

## 3. Engine comparison

Benchmark: 20 OCR documents (127 pages, 29 224 words) for which a native-text edition of the same product
with 0.7–0.89 trigram containment exists. The metric is the share of the OCR text's word trigrams found in
the native edition (and the share of words in its vocabulary); the ceiling is below 1 because the two
registrations differ in places, so only differences between engines count.

| Engine / setting | trigrams in native text | words in native vocabulary |
| --- | ---: | ---: |
| Vision 1 800 px, language correction (released texts, after the preparer) | 0.776 | 0.910 |
| Vision 1 800 px fresh | 0.754 | 0.895 |
| Vision 2 480 px (300 dpi) | 0.757 | 0.897 |
| Vision 3 300 px | 0.757 | 0.896 |
| Vision 2 480 px, no language correction | 0.751 | 0.893 |
| Tesseract.js 7, `rus`+`eng`, PSM 3, 300 dpi | 0.746 | 0.889 |

Vision and Tesseract agree on 95.5 % of the aligned words (28 657 of 30 000). Where they differ: 157 words
only Vision has right (mostly Tesseract's Latin look-alikes), 56 only Tesseract (`вышуска`, `вкладьш`,
`иньекции`, the stamp), 98 neither, 85 in codes and numbers. Speed: Vision 2.2 s per page with four in
parallel on a loaded machine; Tesseract.js 5–10 s per page — a full second pass is 6–11 hours for 0.2 % of
the words. **Resolution, language correction and the second engine do not help; no re-OCR with another
setting is worth the time.** The defects are in what is done with the engine's lines.

Not compared: Marker (Surya) — it needs a package and model weights downloaded, which needs the owner's
approval; to be run on ~20 of the worst scans with batch size 1 once approved.

## 4. What was done (deterministic, every change recorded)

1. The same Vision engine and settings were re-run over every OCR PDF once (confidence per line comes back; the
   raw payload is cached, `scripts/grls_ocr_vision_cache.py`).
2. Lines are assembled from Vision's observations (`ocr_requality.assemble_lines`): observations on one
   baseline are one line; a stamp on a title baseline is its own line; the two columns of an amendment
   sheet are read column by column; a wide gap elsewhere is a table row (`table_candidate`).
3. Stamps become `page_mark` blocks: kept as `<!-- localmed:page-mark {...} -->` comments in the prepared
   Markdown (text, page, box), outside the body text; not deleted.
4. Standard instruction headings (the same fixed list the builder uses) are recognised, codes are not headings.
5. Lines are reflowed into paragraphs from geometry and punctuation; a line-break hyphen is joined only when
   the joined word is a lexicon word and the hyphenated compound is not.
6. Word rules (`ocr_text_cleanup`): only an unknown word with exactly one lexicon spelling one measured
   confusion away (`ь`↔`ъ`, `н`↔`п`, `ш`↔`п`, a dropped letter, never in the last two characters), the
   pharmacokinetic symbols, the Latin ATC abbreviation, the leaflet title word. Measured on 241 OCR/native pairs: 388
   correct corrections, 14 of the replacements differ from the native word (most of them an
   alignment artefact), 2 correct tokens in 56 693 were changed by mistake (grammatical endings are never edited,
   names are skipped). Every edited paragraph keeps its raw text (`ocrRaw`) and the list of edits.
7. Numbers and units are never edited: a digit run with a look-alike letter («1О», «5l0») or a one-to-three-letter
   unit that is neither a unit nor a word («500 мr», «25 Mr») only marks the paragraph
   `<!-- localmed:review ocr-uncertain-number -->` and is counted.
8. Pages with a native text layer keep it; a layer that reads as noise (few real words per character, Cyrillic
   share below 15 %, almost no known words) is replaced by the recognised page.
9. Content classification (`grls_document_kind`): `ohlp`, `leaflet`, `national-instruction`, `amendment`
   (a «Изменение № N» table, not a full instruction), `other`, `unknown`.
10. Where the same product (trade name, INN, holder, dosage form) has a native-text document that is demonstrably
    the same text, doses included (trigram containment ≥ 0.75, same length class, every number of the native
    text in the OCR text, an OCR-only number tolerated only as a one-character misreading), the native text
    replaces the OCR text with `textSource: sibling-text-layer` and the source document recorded.
11. Quality grade `good` / `fair` / `low` per document (`ocr_requality.grade_quality`): mean confidence, share
    of low-confidence characters, unknown-word ratio (relaxed for amendment sheets, which are names and
    addresses), uncertain numbers per 1 000 words. The app shows its OCR note only for `low`.

Provenance per document: raw PDF checksum (`pdfSha256`), pages recognised (`ocrPages`), tool (`macos-vision`),
mean confidence and low-confidence share, grade and its reasons, counters, `textSha256`; per paragraph: the
raw lines with their boxes and confidences in the extraction JSON, source markers listing every line block.

## 5. Not done, and why

- A second OCR engine on low-confidence lines: Vision's confidence is quantised (0.3 / 0.5 / ≈1.0), a quarter of
  all lines are ≤ 0.5, the measured gain of Tesseract on the words Vision gets wrong is ≈ 6 %.
- Marker/Surya: not run (download needs approval).
- Truncated word endings («терапи», «ишемическо») are not repaired: several lexicon completions exist.
- Tables are read as text rows (`a | b`) and flagged `table-candidate`; no cell structure.
- Hand review of every page: the oseltamivir text (`content/grls-reviewed-ocr/`) is the model for the few
  documents a physician wants read against the scan; the builder keeps preferring it.
