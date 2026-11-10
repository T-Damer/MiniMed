# Narcology КР: our text against the official source — 2026-11-10 (STATE KR-NARCO)

Question (owner): are the problems another agent reported in the narcology клинические рекомендации ours,
or are they in the official documents? Rule: no AI-formulated clinical content; a КР says what the official
document says, even where КР contradict each other. Only defects **our pipeline** introduced are fixed.

## Method

For every item the text was taken in three forms and compared:

1. **Ours** — `extract_clinical_json` (the importer the modules are built with) on the raw JSON in
   `data/raw/official-clinical-documents/<id>.json` (byte-exact `GetClinrec2`, registry snapshot 2026-10-02).
2. **Official JSON** — the same file, tags stripped.
3. **Official PDF** — `data/raw/official-clinical-documents/<id>.pdf` (the document as published by
   Минздрав; `pdftotext`, not the live cr.minzdrav.gov.ru page — it was not opened).

Whole-document check, word by word, ours against the official JSON (punctuation kept, sup/sub folded) on the
nine КР of the report (32_2, 161_2, 146_2, 590_2, 601_2, 784_1, 817_1, 888_1, 899_1): the only words ours does not
carry are the table captions that sit in the table block's `caption` field (shown above the table), and the only
word-level difference in the text is the one fixed below («₌»).

Quotes are ≤ 15 words. `B` = present in the official source, left as it is.

## Items

| # | Item (КР, section) | Ours | Official JSON | Official PDF | Class | What was done |
| --- | --- | --- | --- | --- | --- | --- |
| 1a | 32_2, Приложение В (information for patients): a page number inside the opioid-withdrawal duration sentence | «…длительности заболевания, проводимого 50» + new paragraph «лечения.» | the same «50» before `</p><p>лечения.` | the same: «проводимого 50» at the foot of a page, «лечения.» on the next | **B** | Nothing. The number is in the official JSON and PDF; removing it would be an edit of the source. The paragraph break in the middle of the sentence is also in the JSON. |
| 1b | 32_2: cannabinoid withdrawal duration, doctors' part vs patients' part (Приложение В) | «Длительность СО в среднем составляет 14 суток» (2.1 Жалобы и анамнез) / «продолжительность в среднем 7 дней» (Приложение В) | same | same | **B** | Данные противоречивы: КР 32_2 в разделе для врачей говорит 14 суток, в разделе для пациентов 7 дней. |
| 2 | 32_2 vs 161_2: cannabinoid withdrawal onset (both 2.1 Жалобы и анамнез) | 32_2: «составляет не менее 2-3 лет»; 161_2: «от 8 лет и более» | same | 32_2 PDF same; 161_2 PDF same | **B** | Данные противоречивы: КР 32_2 говорит 2–3 года, КР 161_2 говорит 8 лет и более. |
| 3 | Haloperidol, adults: 888_1, 817_1, 590_2, 161_2 (all 3. Лечение) | 888_1 «не более 10 мг разово»; 817_1 «в разовой дозе 5 мг, … – 60 мг»; 590_2 «не более 10 мг/сутки»; 161_2 «1,5-20 мг в сутки» | same | same (888_1, 817_1, 590_2 checked in the PDF text) | **B** | Данные противоречивы: КР 888_1 говорит ≤ 10 мг разово, КР 817_1 5 мг разово и максимум 60 мг в сутки, КР 590_2 не более 10 мг/сутки, КР 161_2 1,5–20 мг в сутки. |
| 4 | Haloperidol, children, 888_1 and 817_1: «в сутки» without «на кг» — lost «/кг»? | «по 0,025-0,05 мг в сутки, максимальная суточная доза – 0,15 мг/кг» | identical, no «кг» after «0,05» | identical | **B** | Nothing: no «/кг» was lost, it is not in the source (JSON and PDF). |
| 5 | 888_1, infusion rate | «не более 500 мл/час, в объеме до 3-4 л в сутки до 1 л в час» | same | same, one sentence | **B** | Данные внутри КР 888_1 противоречивы (500 мл/час и 1 л в час в одном предложении). |
| 6 | Thiamine, 784_1 / 590_2 / 146_2 | 784_1 «от 100 до 500 мг/сутки»; 590_2 «до 500 мг в сутки парентерально 3 раза в день» and «инфузию … от 500 мг … три раза в день»; 146_2 «100 мг в сутки, внутрь», «250 мг … внутривенно или внутримышечно», «500 мг три раза в день внутривенно» | same | same | **B** | Данные противоречивы: дозы и пути введения тиамина в КР 784_1, 590_2 и 146_2 различаются. |
| 7a | 784_1 (3. Лечение), CIWA-Ar threshold | «баллы по шкале CIWA-Ar превышают 8» and «показатель CIWA-Ar > 8-10 баллов» | same | same | **B** | Данные внутри КР 784_1 противоречивы: порог 8 и порог 8–10. |
| 7b | 784_1, phenobarbital units | «15-40 мкг/кг (65-170 мкм/л)» | same | same | **B** | Единицы в источнике как есть; не исправлялись (не наше преобразование). |
| 7c | 784_1, tofisopam | «Тофизопам назначается внутрь в дозе от 150 до 300 мг» (3 приема) | same | same | **B** | Данные как в источнике. |
| 8a | 899_1 (3. Лечение), antidepressants in severe course | «назначение антидепрессантов может ухудшить результаты, поэтому не рекомендовано [59]» vs «при более легком течении … может быть оправданным, эффективным [58]» | same | same | **B** | Данные внутри КР 899_1: не рекомендовано при тяжёлом течении [59] и оправданно при более лёгком [58]. |
| 8b | 899_1, naltrexone duration | «Длительность приема препарата составляет не менее 3 месяцев [17; 47]» (oral) / «Продолжительность лечения – от 3 до 6 месяцев» (prolonged-action form) | same | same | **B** | Данные внутри КР 899_1: не менее 3 мес. и 3–6 мес. (для разных форм). |
| 8c | 899_1, heading «Налмефен» glued to the end of the paragraph before | «… без сопутствующей психотерапевтической поддержки [41-42]. Налмефен» then «Рекомендуется взрослым …» | `…[41-42].</em> Налмефен  </p><p>Рекомендуется …` — the word is inside the previous `<p>`, not bold, the bullet and the bold «Рекомендуется» are gone too | «Налмефен» is a heading line of its own, the recommendation has a bullet | **B (JSON differs from the PDF)** | Not ours: the official JSON carries the glue (other drug headings in this КР, e.g. «Цианамид», are `<p><strong>…</strong></p>` and are headings in our text). A rule «a trailing capitalised word after `</em>`» would be a guess; the repository has no per-document text-correction mechanism for КР (only coverage overrides in `clinical_catalog.py`). **Owner decision**, see «Open». |
| 9 | 601_2 (Приложение А3), unclosed brackets and cut-off fragments | «Вы употребляете табачную» / next paragraph «и/или никотинсодержащую продукцию?»; enumerators «а) … б)», «1) …» without «(» | the same: Appendix А3 is stored one PDF line per `<p>`; «а)», «1)» are in the text | PDF flows the sentences; brackets as in the JSON | **B** | Nothing changed in the text. The line-wrapped `<p>` are the source's structure (not a conversion step). Brackets that look unbalanced are enumerators and quotes split by those breaks. See «Open» for the paragraph-join idea. |
| 10 | 590_2 (3. Лечение), extra «)» after «Фенобарбитал**» | «Фенобарбитал**) также может назначаться при СО фенобарбитала**…» | same | same | **B** | Nothing: the «)» is in the source (JSON and PDF). |
| — | Found on the way: 32_2 (Список литературы): «=» turned into «₌» | `…323788649₌Pharmacological₌interventions…` | `…323788649<sub>=</sub>Pharmacological<sub>=</sub>…` (a link text; the PDF has «=» too) | «=» | **A** | `_script_text` converted a `<sub>=</sub>` to the subscript sign. Fixed generically: a script of only punctuation other than +/−/- stays as written (`H⁺`, `Cl⁻`, `Ca²⁺`, `СО₂` unchanged). `EXTRACTOR_REVISION` 6 → 7 so `prepare --reuse` re-extracts. Test `test_bare_punctuation_wrapped_in_a_script_tag_stays_as_written`. |

## Result

* **(A), ours:** one — «=» → «₌» in 32_2's reference URL (and any other КР with a bare `<sub>=</sub>`; see the corpus check below).
* **(B), in the source:** everything else, including all three that the reporting agent expected to be ours
  (the page number «50», «Налмефен» glued, the extra «)» in 590_2) and the «/кг» of item 4, which is not lost.
* The text does not differ from the official JSON anywhere else in these nine КР.

## Corpus check of the fix

All `<sub>`/`<sup>` runs of the 774 raw КР were listed. The change touches only runs with no letter or digit that are
not plain signs. Texts that were converted before and are written as in the source now: `<sub>=</sub>` (32_2, 3 runs),
`<sup>**)</sup>` (391_2, 391_3), `<sup>+/‒</sup>` (529_1), `<sub>) </sub>` (286_1) and the footnote marks
`* - ` / `# - ` / `- (` (940_1, 372_3, 78_1). Signs alone (`H⁺`, `Cl⁻`, `10⁻³`, `β⁺⁺`), digits, letters
(`Cₘₐₓ`, `SpO₂`) and everything else is converted exactly as before. So 8 КР change by a handful of characters each; the other
766 extract byte for byte as before apart from `extractor_revision`.

Tests: `uv run --project tools/ingest pytest tools/ingest/tests -o addopts=""` — 2 002 passed, 19 skipped (the clinical subset
`-k "clinical or kr_ or source_registry"`: 160 passed); `bun run check` passes (no errors; warnings/infos as on main);
`cd apps/app && bunx tsc -p tsconfig.json` clean. No reader (vitest) file was touched.

## Needs a rebuild / publish

**Nothing was rebuilt and nothing is published.** The fix changes 8 КР by a few characters (32_2 mostly: the
reference URL), no clinical text. A rebuild is not worth a 692 MB re-download on its own; ride along with the next КР
republish (`EXTRACTOR_REVISION` 7 makes `prepare --reuse` re-extract). Publish step for the owner when that happens: the
KR-PARSE recipe in `docs/CURRENT_STATE.md` — build the affected modules (32_2, 391_2, 391_3, 529_1, 286_1, 940_1, 372_3,
78_1: 8 modules, order of 0.4 MB each as `.db.zst` by the 33.3 MB / 30 modules of the 2026-10-02 refresh, i.e. ~1.1 MB) from the
raw JSON, KD1 re-embed those, frame as zstd, publish to a new additive mirror branch and move the catalog entries.

## Open (owner decisions, nothing done)

* **«Налмефен» in 899_1** (item 8c): the official PDF has a heading and a bullet that the official JSON lost. Options:
  leave (the text is the JSON as published); or add a sanctioned per-document correction file for the КР importer
  (id, section, exact source string → replacement, source cited: page of the PDF), reviewed one by one. Not built:
  it would be the first place where we edit a КР text, so it is the owner's call.
* **Line-wrapped paragraphs in the JSON** (601_2 Appendix А3 and others): the source stores some text one PDF line per
  `<p>`. A reader-side join (a paragraph that ends without a sentence mark followed by one in lower case) would change
  layout only, no character; a rough count over the 774 КР finds ~3.8 k candidate pairs but most are abbreviation lists,
  so it needs a conservative rule and an FMT-AUDIT-style sample before it is worth doing. Not done.
* **The page number «50»** in 32_2: a numeral at the end of a paragraph that the source cut at a page break exists in
  JSON and PDF; stripping page numbers is an edit of the source text and was not done.

## Not verified

* The live pages on cr.minzdrav.gov.ru were not opened; the local PDFs (downloaded 2026-07-24) were used as the
  official PDF. The JSON is the 2026-10-02 snapshot (the same edition ids as the PDFs).
* The reader's display repairs (FMT-AUDIT) were not re-run: nothing in them is touched.
