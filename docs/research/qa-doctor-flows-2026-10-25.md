# Doctor-flow QA: speed, usability and data quality — 2026-10-25

Built app 0.6.63 (`vite preview`, Chromium in the Claude browser pane, 375×812 and 1100×800), core
plus the «Нервная система» drug group, «Сепсис (у взрослых)» КР and «Лекарственные расчёты». Three
Sonnet agents audited the data offline against the raw sources and traced prefix search. Scripts
and raw results:
`/private/tmp/claude-501/-Users-d--claude-spares-spare-QJAvPH/fda360d8-6989-4c5b-bbf5-7cf4adf5bfde/scratchpad/{dq-drugs,dq-disease,prefix-search}/`
(session scratchpad; may be gone later — the prefix fix patch is `prefix-search/proposed/*.patch`).

Not tested: a phone (all timings are a desktop Mac, expect 3–5× on a mid phone), the semantic
model, dark theme screenshots, Android WebView.

## Scenarios

| Visit task | Result | Time |
| --- | --- | --- |
| Core download (76 MB) to searchable | ok | ~13 s |
| «критерии сепсиса» → КР → SOFA criteria | КР first; 816 KB set download; find-in-document jumps to 48 «SOFA» hits | search 0.8 s, download ~1 s |
| Child 15 kg, paracetamol dose | «доза парацетамола» → calculator first; 1.2 MB tool set download; 150–225 mg, 6.3–9.4 ml (24 mg/ml), max 900 mg/day — correct | ~2 s + typing |
| Paracetamol instruction | 36 MB group download; card opens on «Состав», dose section several screens down; default instruction is 500 mg tablets (contraindicated < 6 y) | download ~15 s |
| Back from a document to results | scroll position kept, no re-search, no layout shift | < 50 ms |

Search: 0.7–1.9 s from the last keystroke to results, of which 500 ms is the typing debounce
(`SearchWorkspace.tsx:763`); heavy queries («боль в груди», «I10», «диабет 2 типа») take longest.
The worker keeps the main thread free (long tasks ≤ 78 ms per search).

## A — could mislead a decision

1. **КР: `<sup>`/`<sub>` flattened into the number** (`clinical_json_import.py`
   `_StructuredHtmlParser`). Footnote digits glue onto doses and thresholds: «внутрь 5001-10002 мг»
   for 500¹–1000² mg (309_2 ларингит), «> 301» for > 30¹ (714_2), «ниже 300C» for 30 °C (678_2).
   177 glued footnotes in 35 docs, 354 degree signs in 106, 10⁹/л → «109/л» 1 546× in 150, м² /
   SpO₂ / CO₂ thousands more.
2. **КР table cells with several paragraphs/list items concatenated** — 14 048 cells in 627 docs,
   3 262 fusing numbers: «40-80 мг/сутки25-50 мг/сутки…» (283_2 ГКМП), children's sepsis doses
   (953_1), SOFA creatinine «1,2 - 1,9(110 - 170)» (898_1).
3. **КР text after an image in the same paragraph is dropped** — 336 segments, 39.5 k chars, 132
   docs, incl. a whole parenteral-nutrition paragraph (1049_1) and COVID legend lines (1024_1).
4. **КР off-label rows «#…» become headings** (`markdown_parser.py` heading rule on unescaped
   block text): rifampicin dose row detached from its table (1028_1 + 4 docs); the legend line
   becomes a top-level section in 144 docs.
5. **Drug instructions: dose/interaction tables flattened with shifted cells** (text-layer ГРЛС
   PDFs, `pdf_import.py` has no table reconstruction): ≥ 525 docs, 139 inside the dose section.
   Элизария weight table pairs 30–<40 kg with 600 mg; аторвастатин's clarithromycin ratios read as
   saquinavir's.
6. **Several leaflets merged into one document** (165 docs): Омепразол-Тева 10 mg OTC and
   20/40 mg Rx in one text.
7. **OCR symbols**: «≥» read as «2» (947× in 314 docs: «очень часто (21/10)»), «м²» as «м?»
   (232 docs), stamp text inside dose sentences, thresholds garbled («МНОВА 3,5»). Dose numbers in
   the five scans read were right.
8. **Dose text under the wrong heading** (fragment headings in 825 OCR / 434 text docs; ceftriaxone's
   «Способ применения и дозы» empty, warfarin's titration under a half-sentence heading); the
   comparison tool reads only `dosage` sections.
9. **«Доза по инструкции» picks the wrong substance**: «доза парацетамола» offered
   «Дицикловерин парацетамол» («нет инструкции») although paracetamol's instructions were installed.
10. **Allmed private-use glyphs**: «КК  60 мл/мин» with ≥ rendered blank (7 docs).

Faithful: prose numbers in text-layer drug PDFs (98.7 % word agreement, no changed digit in 600
docs), Allmed sections (token-identical), КР order, УУР/УДД, tables/images counts, МКБ-10/11 codes.

## B — hurts finding or reading

- **Prefix search** («Парацет» → пирацетам, «Амокс» → Ампиокс/Авелокс, «Гиперт» → натрия гиалуронат,
  «Левотир» → левофлоксацин, «Метфор» → метронидазол; «Панкреат» 40 → 1 group). Not typo correction:
  the medication-spelling plan treats an unfinished word as a misspelt drug and a final sort key
  (`create-medical-core.ts` ~1722) hoists its candidates; 5–6-letter prefixes do not match long
  words (`hasWordPrefix`); the «Все» drug filter drops the drug itself. Proposed patch (+149/−14):
  «unfinished last word» rule + most-common completion first; probe set 30/39 → 39/39, generated
  set rank-1 55 % → 97.5 %, `benchmark:all` unchanged. Not applied.
- **An installed document outranks better matches**: «артериальная гипертензия критерии» → the
  downloaded «Сепсис (у взрослых)» first, АГ у взрослых third.
- **КР list markers lost for 99.4 % of list items** (`<li><p>` flushes the bullet).
- **NFD «й»** («и» + U+0306) in 365 КР (6 427 marks, from the source JSON); search is fine (NFKC),
  but highlight and find-in-document skip those words, and «й̆» double breves render (173×).
- **Soft hyphens / ZWSP split index words** (233 КР); line-break hyphens left in drug text
  («иммунодефи- цитом», 582 docs); Latin look-alikes inside Cyrillic words (833 docs).
- **Definition cards**: 375/380 КР definitions start lowercase («патологический процесс…»), 7 cut at
  «т.е.»; snippet «Пневмония у детей — ый процесс…» comes from the snippet window starting mid-word
  (`snippet.ts:69`) — ~16 % of definition snippets.
- **Abbreviations defined inline («ССВР») are not term links**; ~4 680 inline-defined abbreviations
  are not in the dictionary at all (only «Список сокращений» sections are harvested).
- **Drug card opens on «Состав»** (composition table flattened into one line); doses are several
  screens down; the default instruction is the 500 mg tablet even for a child query.
- **Missing МКБ-10 codes** E70.0, J90, J91, J94.8, J94.9, R09.1 (crawl failures).

## C — layout, compactness, motion

- Layout shift 0.24 when a downloaded КР replaces its preview; 0.14 when the calculator result
  appears (footnote jumps). Both break «no viewport jumps on state changes».
- Calculator: no live result (needs «Рассчитать и сохранить»); suspension concentration has no
  presets (120 mg/5 ml, 250 mg/5 ml); six result rows could be two («150–225 мг · 6,3–9,4 мл»); a
  «подтверждайте по инструкции…» disclaimer violates the no-disclaimer rule.
- Calculator route shows a blank screen ~1 s before the download offer (two loading states).
- First screen of results at 375×812 fits ~1.5 results: the semantic-model promo sits between
  results and every card's download chip takes its own row.
- Download toast covers the calculator header; «Лекарственные расчёты» скачан (number agreement).
- First-run: «Скачать основную базу · ~76 МБ» in the card and a floating pill «Основная база не
  скачана · около 76 МБ» at the same time; the progress pill showed «287 МБ».

## Fixed in this session

`bd5ed8b9` history drawer footer; UI-HOVER (uncommitted at writing): opaque hover fill, no blanket
hover shadow, picker hover, favourites ✕, «Скачать всё» in the header row, inline «Очистить
историю?», no age filter in search, equal tool-card heights, section crumb on inner pages.

## Suggested order

1. КР parser: sup/sub (keep as Unicode super/subscripts or `^`), cell paragraph separators, text
   after images, «#» escaping, list markers — one rebuild of the 774 КР modules fixes A1–A4 and the
   list bullets. Add raw-vs-module regression counters to the content lint.
2. Apply and review the prefix-search patch (biggest daily friction).
3. Drug PDFs: table reconstruction (`find_tables()`), leaflet split, OCR «≥»/«м²» rules, heading
   rules; rebuild ГРЛС modules.
4. «Доза по инструкции» substance match; drug card opening at doses for dose queries.
5. Layout shifts (КР swap, calculator result), calculator live result + concentration presets.
6. NFC-normalise text at ingest (or highlight NFD-aware); definition cards from the canonical text.
