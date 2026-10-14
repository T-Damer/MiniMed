# OCR quality of the ГРЛС instruction texts — measurements and decisions (STATE OCR1, 2026-10-14)

Owner 2026-10-13: «Data with quality problems — fix it». Scope: the 15 published ГРЛС instruction modules
(2 302 OCR texts, 457 unclassified scans) and the 16 manufacturer-site OCR texts. Method, numbers and what was
rejected; the shipped state is in `CURRENT_STATE.md` «OCR1».

## 1. What the OCR texts are

- Engine of the released texts: the macOS Vision helper (`tools/ingest/macos_vision_ocr.swift`, 1 800 px page
  width, `ru-RU`+`en-US`, accurate level, language correction on). Tesseract is not installed on the build machine
  (the app ships `tesseract.js` 7 with `rus`+`eng` data for the user's own files; that is what was used here).
- Only 29 of 2 302 OCR documents had a recognition confidence recorded (the field was added after most were
  extracted). Vision's confidence is coarse: lines come out as 0.3 / 0.5 / ≈1.0, a quarter of all lines are ≤ 0.5.
- The files are scans of 96–300 dpi: pages of 1–51, 19 740 pages and 10.5 GB of PDF.

## 2. Defects, measured on the released text

Measured on the prepared Markdown the modules were built from, against native-text-layer instructions of the same
corpus (6 655 documents) as the reference lexicon, and by looking at the page images.

| Defect | How often (OCR texts) | What it does |
| --- | --- | --- |
| Scan stamps in the body: «СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ…», «МИНЗДРАВ РОССИИ», «СОГЛАСОВАНО», «ЛП - 005351-021219» | 7 507 stamp lines in 2 306 documents; 281 documents with the expert-report stamp as a heading | cut sentences in two, become section titles, add numbers that are not doses |
| One paragraph per OCR line (Vision also splits a justified line into word pieces) | median paragraph 38 characters, 74.6 % of paragraphs end without punctuation | broken sentences in the reader and in search chunks |
| Sheets of amendments read as the instruction («Изменение № N», «Старая / Новая редакция») | 730 of 2 302 OCR documents (668 labelled «Инструкция по медицинскому применению», 351 of one page) | a registration whose only text is a change sheet looked like it had an instruction: 736 registrations |
| Title not recognised (stamp between the title words, Latin look-alikes) | 451 OCR texts + 8 text layers «unclassified» | no kind label, ranked among leaflets |
| Systematic misreads | «Стах» for Cmax (2 224 times), «иньекций» for «инъекций», «коньюнктивит», «вышуска», «вкладьи», the dropped «У» of «Условия» | unknown words, failing exact search |
| Lines Vision loses on a noisy scan | 4 282 lines of 5 306 compared with Tesseract (see §4) | a pack-size line with its doses read as «мли по 10 г, 20 1,23 банковало ной …» |
| Text layers with a broken font encoding | 3 documents of 8 957 (zero or noise words; one cut every word into pieces) | unreadable |
| Tables | amendment sheets: columns interleaved line by line | a changed address next to the old one |
| Numbers | 254 digit runs with a look-alike letter or a unit that is none | doses must be checked against the page |

Unknown-word ratio against the lexicon: overall 3.27 %, median 3.65 % (native text 0.9 %). About 70 % of the distinct
unknown words occur once: trade names, INNs and addresses, not errors.

## 3. Engine comparison

Benchmark: 20 OCR documents (127 pages, 29 224 words) for which a native-text edition of the same product with
0.7–0.89 trigram containment exists. The metric is the share of the OCR text's word trigrams found in the native
edition (and the share of words in its vocabulary); the ceiling is below 1 because the two registrations differ in
places, so only differences between engines count.

| Engine / setting | trigrams in native text | words in native vocabulary |
| --- | ---: | ---: |
| Vision 1 800 px, language correction (released texts, after the preparer) | 0.776 | 0.910 |
| Vision 1 800 px fresh | 0.754 | 0.895 |
| Vision 2 480 px (300 dpi) | 0.757 | 0.897 |
| Vision 3 300 px | 0.757 | 0.896 |
| Vision 2 480 px, no language correction | 0.751 | 0.893 |
| Tesseract.js 7, `rus`+`eng`, PSM 3, 300 dpi | 0.746 | 0.889 |

Vision and Tesseract agree on 95.5 % of the aligned words (28 657 of 30 000). Where they differ: 157 words only Vision
has right (mostly Tesseract's Latin look-alikes), 56 only Tesseract (`вышуска`, `вкладьш`, `иньекции`, the stamp), 98
neither, 85 in codes and numbers. Speed: Vision 2.2 s per page with four in parallel on a loaded machine; Tesseract.js
1–10 s per page. **Neither resolution nor language correction nor a blanket second engine pass helps** (a full second
pass is 6–11 hours for 0.2 % of the words). Where the engines are *complementary* is on single lines: Vision drops
whole phrases of a noisy scan while Tesseract reads them, and the other way round for look-alike letters. That is
what the targeted second opinion (§4.5) uses.

Marker (Surya) was compared afterwards on the worst scans: see [marker-eval-2026-10-14.md](marker-eval-2026-10-14.md).

## 4. What was done (deterministic, every change recorded)

1. The same Vision engine and settings were re-run over every OCR PDF once (19 894 pages, no failures; the
   confidence per line comes back; the raw payload is cached, `scripts/grls_ocr_vision_cache.py`). A rotation rescue
   (`grls_ocr_vision_rescue.py`, pages with mostly unknown words read again turned by 90/180/270°) found 32 pages to
   try and 1 to fix: rotated scans are rare.
2. Lines are assembled from Vision's observations (`ocr_requality.assemble_lines`): observations on one baseline are
   one line; a stamp on a title baseline is its own line; the two columns of an amendment sheet are read column by
   column; a wide gap elsewhere is a table row (`table_candidate`).
3. Stamps become `page_mark` blocks: kept as `<!-- localmed:page-mark {...} -->` comments in the prepared Markdown
   (text, page, box), outside the body text; not deleted. Audit: 13 matches in 6 655 native documents, all real stamps.
4. Standard instruction headings (the same fixed list the builder uses) are recognised, codes and scan-noise lines are
   not headings.
5. Lines are reflowed into paragraphs from geometry and punctuation; a line-break hyphen is joined only when the
   joined word is a lexicon word and the hyphenated compound is not.
6. Word rules (`ocr_text_cleanup`): only an unknown word with exactly one lexicon spelling one measured confusion away
   (`ь`↔`ъ`, `н`↔`п`, `ш`↔`п`, a dropped letter, never in the last two characters), the pharmacokinetic symbols, the
   Latin ATC abbreviation, the leaflet title word. Measured on 241 OCR/native pairs: 388 correct corrections, 14 of the
   replacements differ from the native word (most of them an alignment artefact), 2 correct tokens in 56 693 were changed
   by mistake (grammatical endings are never edited, names are skipped). Every edited paragraph keeps its raw text
   (`ocrRaw`) and the list of edits.
7. Numbers and units are never edited: a digit run with a look-alike letter («1О», «5l0») or a one-to-three-letter unit
   that is neither a unit nor a word («500 мr», «25 Mr») only marks the paragraph
   `<!-- localmed:review ocr-uncertain-number -->` and is counted. Alphanumeric names («CYP2B6», «50S») and postal codes
   are not flagged (the first version flagged 676 such tokens).
8. Pages with a native text layer keep it; a layer that reads as noise (few real words per character, Cyrillic
   share below 15 %, almost no known words, or words cut into one-and-two-letter pieces: > 40 % tiny tokens and < 70 %
   known longer words; normal text reads ≤ 29 % and ≥ 92 %) is replaced by the recognised page.
9. Content classification (`grls_document_kind`): `ohlp`, `leaflet`, `national-instruction`, `amendment` (a «Изменение № N»
   table, not a full instruction), `other`, `unknown`.
10. Where the same product (trade name, INN, holder, dosage form) has a native-text document that is demonstrably the
    same text, doses included (trigram containment ≥ 0.75, same length class, every number of the native text in the OCR
    text, an OCR-only number tolerated only as a one-character misreading), the native text would replace the OCR text
    with `textSource: sibling-text-layer`. 50 of 1 448 OCR instructions have such a candidate; none passes (different
    strengths or doses), so nothing was replaced.
11. **Second opinion** (`grls_ocr_second_opinion.py`, `scripts/ocr-tesseract-worker.mjs`, `ocr_second_opinion.py`): the
    pages of low-graded documents and every page with a low-confidence Vision line holding two or more unknown words were
    read again with Tesseract.js (6 561 pages, 1 649 documents, 82 minutes on six workers, no failure). For each Vision
    line the Tesseract lines inside its box are joined and the lexicon decides: fewer unknown words and less junk
    (Latin tokens the lexicon does not know), no known word given up, at least one known word to stand on, a length
    ratio of 0.6–1.7 per line a box spans. **5 306 lines compared, 4 282 replaced**; the other reading is kept
    (`ocrAlternatives`). A disagreement about a *standalone number* (each reading has one the other lacks) marks the paragraph
    for review: 1 082 lines (the first version counted any difference in digit tokens and flagged 6 196, mostly Tesseract's
    O/0 and lost exponents). A line made only of names is never replaced.
12. Quality grade `good` / `fair` / `low` per document (`ocr_requality.grade_quality`): mean confidence, share of
    low-confidence characters, unknown-word ratio (relaxed for amendment sheets, which are names and addresses), uncertain
    numbers and number disagreements per 1 000 words. The app shows its OCR note only for `low`.

Provenance per document: raw PDF checksum (`pdfSha256`), pages recognised (`ocrPages`), tools (`macos-vision`,
`macos-vision+tesseract.js`), mean confidence and low-confidence share, grade and its reasons, counters, `textSha256`;
per paragraph: the raw lines with their boxes and confidences in the extraction JSON, source markers listing every line
block.

## 5. Results

2 306 documents re-prepared (2 302 OCR + 4 text layers): unknown words 3.27 % → 2.42 % (median 3.65 % → 2.67 %); stamp lines
7 507 → 2; paragraphs 816 142 → 324 156, median length 38 → 65 characters, without closing punctuation 74.6 % → 44.6 %;
confidence recorded 29 → 2 303 documents; kinds: every document has one (1 364 instructions, 211 leaflets, 1 ОХЛП, 730
amendment sheets); grades 1 108 good / 1 044 fair / 151 low. Instruction-section coverage did not move (95.1 / 96.8 /
96.3 % → 95.2 / 96.9 / 96.5 %): the builder's own resegmentation had already found the standard headings.

Spot checks against the page images (ten pages, good / fair / low): every dose and number read exactly except one unit
(«5 м.» for «5 мл», document graded low); a dose line and an indication line that Vision had lost were recovered by the
second engine. A page-level ground truth for the remaining pages does not exist.

## 6. Not done, and why

- Marker/Surya: compared in [marker-eval-2026-10-14.md](marker-eval-2026-10-14.md) (better on superscripts, tables and Kazakh letters, but with silent losses; adopted only as a cross-checked second reading and for legal acts / textbook scans).
- Truncated word endings («терапи», «ишемическо») are not repaired: several lexicon completions exist.
- Tables are read as text rows (`a | b`) and flagged `table-candidate`; no cell structure.
- Hand review of every page: the oseltamivir text (`content/grls-reviewed-ocr/`) is the model for the few documents a
  physician wants read against the scan; the builder keeps preferring it.
- A line the second engine cannot place (a Vision observation wider than any Tesseract line) keeps Vision's reading.

## 7. The table of contents of a leaflet (STATE LEAF1, 2026-10-15)

Found by DRUG-UI2 on «Вермокс» (`drug.rf.7687a385d1076d10a7d7.instruction`, 375×812): a lone heading «Прием препарата», «4. Возможные
нежелательные реакции.» followed by a lone «5.», «Хранение препарата», «6.» … before «1. Что из себя представляет …». The
suspected cause (list numbers in text-layer blocks apart from their text) is **not** what happens: the PDF text layer
holds every entry as one block («3. Прием препарата Вермокс.»). Two stages of the preparer broke the list:

1. the generic PDF heading rule (`pdf_import._looks_like_heading`) makes a block a heading when it *ends in* a common
   heading phrase: «4. Возможные нежелательные реакции.» became a heading, its five siblings stayed list blocks;
2. the instruction re-segmenter (`grls_instruction_sections.resegment_paragraph_text`, applied by the pack builder to
   every paragraph) cuts a paragraph at the standard phrases it contains and left the numbering prefix behind: «3. Прием
   препарата Вермокс.» became the piece «3. » plus the section «Прием препарата». That is the lone «5.» and «6.».

### Measured (before, shipped modules and prepared texts)

| | documents | with a contents list | entry made a heading | entry cut at a heading phrase |
| --- | ---: | ---: | ---: | ---: |
| ГРЛС text layer | 6 644 | 3 588 | 2 394 | 3 574 |
| ГРЛС OCR | 2 303 | 199 | 194 | 191 |
| ГРЛС all (15 modules) | 8 947 | **3 787** (leaflets 3 782 of 3 818, ОХЛП 3, instruction 2) | 2 588 | 3 765 |
| manufacturer sites (1 module) | 272 | **91** | 63 | 90 |

Per module (documents with a list / documents): alimentary-metabolism 529/1 217, antiinfectives 460/1 247,
antineoplastic-immunomodulating 391/688, antiparasitic 7/30, blood 266/516, cardiovascular 429/949, dermatological 178/502,
genitourinary-hormones 167/263, musculoskeletal 308/616, nervous-system 470/1 086, respiratory 301/680, sensory-organs
90/203, systemic-hormones 44/87, unclassified 75/705, various 72/158. **Every** document that has the list was damaged.
3 997 lists (some PDFs repeat the leaflet once per strength): 3 977 of six entries, 17 of seven, 2 of four, 1 of five.
Shapes: a list block per entry (most), one block with all entries, entries on one line, a wrapped title as a block of its
own, entries whose number the scan lost («Что из себя …») or misread («А. Возможные …»), a list printed inside one long
block with the text before and after it (489 lists; 414 are cut out of a block that goes on with the first section), a
misread header («Содержание листка-вкладьна»). Examples: Вермокс (`…7687a385d1076d10a7d7`), Терифлуномид
(one block), Нейромидин (one line), Диовенгес (list + heading in a block), Румикоз (whole page one block), Арлеверт
(scan, lost number), Мисуфер (scan, header misread).

List numbers split from their text, in the shipped modules (chunks whose text holds a paragraph that is only a number):
**5 683 chunks in 2 800 documents** (manufacturer: 138 chunks in 74 documents) — all from the re-segmenter's numbering
prefix, none from the text layer. Numbers that stand alone in a *PDF block* exist in 20 documents (step labels of an
injection pen «21.», table cells, a footer «2.55.44»); the one same-baseline case repeats its number in the text
(«10.» / «10. Сильно сожмите кожу»), so they are not re-joined.

### What was done

- `leaflet_contents.py` recognises the list in the extracted blocks (entries numbered 1…N without a gap, after a short
  «Содержание …» header or, headerless, only when at least two entries are standard leaflet sections and all repeat later;
  wrapped titles, a lone number joined with the title block after it, scan-lost numbers, entries on one line, a header or
  list inside a longer block). A list whose titles do not come back later, a numbered list of steps, short numbered
  headings of a real text and numbers with a gap are **not** contents (tests with excerpts of real documents).
- `render_body(contents_lists=True)` writes the list as one block with `"role":"contents"` and the ids of every block it covers
  (a block that held more than the list keeps the text before and after it as ordinary blocks with an `offset`: no character is
  lost, checked on every changed document), and the parser keeps such a paragraph whole, one entry per line, never
  re-segmented; the text after a list is its own chunk.
- The re-segmenter keeps a numbering prefix with the heading text it numbers («5. Хранение препарата …» is one piece).
- Delivery: `grls_contents_lists.py apply` re-renders only the bodies of the documents with a list from the stored extraction
  (all 8 947 bodies re-render to the stored Markdown byte for byte before the change, so nothing else moves) into
  `data/intermediate/grls-contents-lists`, plus the overlay `data/build/grls-contents-lists.jsonl`; `manufacturer` does the
  same for `prepared-contents`.

### Result (modules `grls-2026.10.15.kd1`, `manufacturer-2026.10.15`)

| | before | after |
| --- | ---: | ---: |
| ГРЛС modules: sections | 210 052 | 197 336 |
| ГРЛС modules: chunks | 239 720 | 229 370 |
| chunks holding a paragraph that is only a list number (documents) | 5 683 (2 800) | 24 (24) |
| documents changed | | 3 865 of 8 946 (3 787 with a list + 78 numbering prefix); 5 081 identical row for row |
| manufacturer module: sections / chunks | 5 691 / 7 158 | 5 405 / 6 946 |
| manufacturer: chunks with a lone number (documents) | 138 (74) | 0 (0) |
| manufacturer: documents changed | | 109 of 271 (91 + 18); 162 identical |
| KD1 vectors of the 9 419 chunks present in both releases | | byte-identical (27 re-encoded, 27 gone) |

The 24 remaining chunks are numbers inside the PDF's own blocks (step labels of an injection pen, a table cell, a footer).
`scripts/compare_instruction_modules.py` hashes the sections, chunks and `documents` rows of every document in both
releases and the vectors of every chunk id they share. The interaction, safety, comparison and dose-rule indexes were rebuilt
from the new modules (they record the module versions and checksums) and are byte-reproducible; dose values did not change
in any document (section references and character offsets moved by the three characters of a numbering prefix; five documents
that had no dose rule dropped out of the dose index), the substance fallback is identical.

### Not done

- 50 prepared documents mention «Содержание листка» but none of the recogniser's shapes fits (the list is in a table cell, split
  by a page header, or its entries are not numbered); they stay as they were. The 72 headerless lists and the
  scan-damaged ones are found by the leaflet section titles only.
- Lone numbers inside PDF blocks (20 documents) are left: they are step labels and table cells, not list numbers.
- Allmed instructions come from HTML, not from this preparer.
