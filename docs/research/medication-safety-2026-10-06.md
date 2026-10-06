# Pregnancy, lactation and child-age questions in search (SAFE1, 2026-10-06)

Status: implemented. Owner request 2026-10-06: «X разрешён ли во время ГВ», «X при беременности», «X можно
кормящей», «X ребёнку до Y лет / ребёнку 3 лет / с какого возраста X». Gap audit item 5
([gap-audit-2026-10-05.md](gap-audit-2026-10-05.md)): section views of the official instructions.
Search-roadmap comparison: [`SEARCH_ROADMAP.md`](../SEARCH_ROADMAP.md) item 15.

## 0. Summary

- A question like those above adds a **card above the results** of «Все источники» and «Препараты». The card
  quotes the sentences of the drug's installed official instruction about pregnancy / lactation / age limits,
  each with its section, the source (instruction kind, edition, ГРЛС or holder's site, fetch date) and
  «Открыть в инструкции». The ranking, the aliases and every exact-name gate are untouched.
- The app never words an answer («можно», «разрешён», «безопасно», «нельзя» appear only inside quotes). For an
  age the doctor typed the card adds a labelled calculation («Рассчитано: 3 года — меньше верхней границы
  12 лет»); when the instruction says nothing it says «В инструкции об этом не сказано» and names the
  instruction that was read; a missing instruction module gets the download offer.
- Everything is deterministic and offline: syntactic query parsing, the app's own medication search (with the S3
  layout/transliteration fallback), a build-time index of **offsets and checksums** (no instruction text) over the
  16 published instruction modules.
- Measured on the real corpus: 44/44 cards of the SAFE1 set correct (installed and not installed); the three
  exact-name gates unchanged (section 5); hand-checked extraction precision 91–100 % per kind (section 4).

## 1. What shipped

| Part | Where |
|---|---|
| Build script (modules checked against the catalog SHA-256, same inputs as INT1) | `scripts/build-medication-safety.ts` (`bun run content:medication-safety`) |
| Index asset, lazy chunk (1.8 MB, 592 kB gzip; offsets + a 4-hex checksum per section; no text) | `apps/app/src/features/medication-safety/data/safety-index.json` |
| Extraction: sections, topics, age / weight limits, dosage forms | `safety-extract.ts`, `age-limits.ts`, `pregnancy-words.ts`, `dosage-forms.ts` |
| Query parser | `safety-query.ts` |
| Name → МНН card (the app's own search) | `safety-candidates.ts` |
| Quotes read from the installed instruction | `safety-quotes.ts` |
| View model (states, groups, calculated lines) | `safety-view.ts` |
| Card, blocks, download offer | `MedicationSafetyCard.tsx`, `SafetyBlocks.tsx`, `SafetyDownloadOffer.tsx`, `styles/medication-safety.css` |
| «Беременность, ГВ, дети» block on the open instruction (same extraction, run on the open text) | `DrugSafetyBlock.tsx`, `safety-document.ts` (mounted in `OfficialDocumentReader`) |
| Separate benchmark set + runner | `tools/benchmarks/safe1-queries.json`, `run-safe1-queries.ts` (`bun run benchmark:safe1`) |
| Audit tool for the hand check | `scripts/audit-medication-safety.ts` |

## 2. How the sources are read

1. **Sections.** A «Применение при беременности и в период грудного вскармливания» section is the typed section
   `pregnancy` (4 297 instructions) or a section whose heading is one of its variants («Беременность и грудное
   вскармливание», «Беременность, грудное вскармливание и фертильность», «Лактация», OCR-cut and upper-case
   forms). Leaflets have no typed section; their 1 908 «Беременность и грудное вскармливание» headings are found
   by title. Pregnancy and lactation words are also read in «Противопоказания», «С осторожностью», «Особые
   указания», «Способ применения и дозы» and leaflet body sections; those hits are flagged by origin and shown in
   their own group, never mixed into the section.
2. **Sentences.** The INT1 splitter (a canonical string per section; offsets into it). In a pregnancy section a
   sentence gets the topic of its words (беременность / лактация / both). A sentence with no topic word inherits
   the topic of the sentence before it (or the heading), at most two after a topical one; the section ends at the
   instruction's own next heading («Фертильность», «Влияние на способность управлять…», «Передозировка», …, also
   when the OCR spelled it with Latin letters) or at a sentence about fertility. The section title repeated at the
   start of the text is not part of the first sentence; a pure sub-heading («Беременность.») is not quoted.
3. **Age and weight limits** (`age-limits.ts`, deterministic): an operator word («до», «менее», «младше», «моложе»,
   «не достигших», «до достижения возраста», «с», «от», «старше», «после», «не менее», «и старше», «и более»,
   «<», «≥»), a number in digits or words («12», «двенадцати», «3-х», «1,5»), a unit (годы, месяцы, недели,
   дни, кг) and an age context («возраст», «дети», «подростки», …). Ranges («от 6 до 12 лет», «6–12 лет», «от 1,5
   лет (18 месяцев) до 6 лет»). Units are converted to days (age) or tenths of kg (weight) with one rule
   (year = 365.25 days), so «3 года» equals «36 месяцев». Excluded: treatment durations («до 3 месяцев», «курс»),
   gestational and bone age, dose formulas («на каждый кг … свыше 10 кг»), body-mass index («кг/м²»), weight loss,
   and everything above 18 years (elderly limits are not child limits). Age groups without a number
   («новорожденным», «недоношенным», «детский возраст») are kept only where the sentence restricts or warns, not
   in indications, and not when the child is the child of a pregnant or nursing woman.
4. **Dosage forms.** A sentence that names a form (таблетки, капсулы, суспензия, инъекции, наружные формы, …) is
   marked «Названа форма: …»: a limit that holds for one form must be read against the product in hand. The
   instruction's own form is in the source line.
5. **Which instruction.** Per МНН card the index keeps the best instruction of each of its (up to five) most
   common dosage forms: one with its own pregnancy section first, the most common form next, ГРЛС before a
   holder's site, a professional text before a leaflet. The card reads the best one that has something on the
   topic, says it is «одна из инструкций по этому веществу» (ADR-0023 wording) unless the doctor typed the
   product itself, and offers the other forms as a switch.

## 3. Query parsing and card rules

- Intents: **lactation** (ГВ, грудное вскармливание, кормящей, лактация, кормление грудью), **pregnancy**
  (беременность, беременным, триместр N, «в III триместре»), **age** (ребёнку, детям, подросткам, новорождённым,
  «с какого возраста», «возрастные ограничения»), with an optional age («3 лет», «6 месяцев», «трёх лет») or an upper
  bound («до 5 лет»). Several intents give several blocks. «Диабет 2 года», «нурофен детский», a bare
  drug name, «беременность 12 недель» (no drug) are not questions.
- The rest of the query, minus frame words («разрешён ли», «можно», «во время», «при», …), is the name, up to four
  words. It is looked up with the app's own medication search (scope «Препараты», lookup mode, so the S3 layout and
  transliteration fallback applies: «ibuprofen»). The first of six groups whose names begin with every typed word
  (or whose query the search itself rewrote) is the drug. A symptom or disease («давление при беременности»,
  «кашель у ребёнка 3 лет») finds no such group and the card does not appear (no hand-written symptom→drug
  dictionary).
- States: reading, ready, **not installed** (the module is offered through the module runtime), **no instruction**
  in the sources, **nothing said** («В инструкции об этом не сказано», with the instruction named and a link to
  open it whole), **changed** (a section's checksum no longer matches: reported, never guessed).
- Calculated lines compare the typed age with each bound found: below / equal («совпадает с границей …: смотрите
  формулировку в предложении») / above / inside a range; an upper bound typed by the doctor («до 5 лет») is an
  interval and may «включать значения и меньше, и больше границы». The wording says «Рассчитано» and the card says
  once that these lines are the app's arithmetic, not the instruction's conclusion.

## 4. Measurements

Build report (`data/build/medication-safety/report.json`, local): 9 216 instruction documents in 16 modules,
9 186 matched to an ЕСКЛП МНН card (30 not), 3 324 МНН cards of which **2 398 have an instruction** in the modules.

| МНН cards with an instruction (2 398) | Cards | Share |
|---|---:|---:|
| a pregnancy / lactation **section** (typed or by heading) | 1 790 | 74.6 % |
| ≥ 1 pregnancy sentence anywhere (section, contraindications, caution, special instructions, …) | 2 230 | 93.0 % |
| ≥ 1 lactation sentence anywhere | 2 172 | 90.6 % |
| ≥ 1 numeric age limit (any section) | 2 113 | 88.1 % |
| ≥ 1 numeric age limit in «Противопоказания», «С осторожностью» or «Особые указания» | 1 673 | 69.8 % |
| only an age group without a number | 73 | 3.0 % |
| ≥ 1 weight limit | 231 | 9.6 % |

By instruction: 5 824 of 9 186 have a pregnancy section (63.4 %), 7 872 have ≥ 1 limit. Entries: 17 741 sentences
about pregnancy and 12 137 about lactation (some about both), 21 540 mentions outside a pregnancy section,
24 196 age / weight limits, 889 unnumbered age groups. 28 % of the МНН cards (926 of 3 324) have no instruction in
the modules at all: for them the card says «Инструкции этого вещества нет в источниках приложения» (it
never falls back to another substance).

**Extraction precision, hand-checked** (a seeded random sample of the index, each sentence read against its text;
`scripts/audit-medication-safety.ts <kind> <n> <seed>`). A first sample per kind drove the fixes; the second sample,
on fresh seeds, was taken after them and is the figure to read.

| Kind | Sample (seed) | Correct | Precision | First sample, before fixes | Errors of the final sample |
|---|---|---:|---:|---|---|
| numeric age limit | 60 (101) | 59 | **98.3 %** (58/60 = 96.7 % if a limit quoted from a study counts as wrong) | 59/60 (seed 11) | «после 10 лет применения» read as an age |
| weight limit | 50 (102) | 50 | **100 %** (one sentence cut off in the sample) | 44/50 = 88 % (seed 21): body-mass index, weight loss, a dosing formula, a range with a bracket note | none |
| age group without a number | 50 (103) | 47 | **94 %** | 37/49 = 75.5 % (seed 31): newborn «exposed through the mother», indications | dose cap for newborns, an adverse-event report, a procedure advice |
| pregnancy / lactation section sentence | 60 (107) | 59 | **98.3 %** | 56/60 = 93.3 % (seed 41), 58/60 (seed 104) | a cut-off fragment (««Противопоказания»).») |
| pregnancy / lactation mention outside the section | 55 (106) | 52 | **94.5 %** | 50/55 = 90.9 % (seeds 51, 105) | contraception arithmetic ×2, an indication («гестационные трофобластические опухоли») |

Precision here means: the sentence says something about the topic and the bounds / operator / topic flag are
right. A neutral sentence that continues a pregnancy statement («Врач примет решение о возможности продолжения
лечения.») counts as correct when it directly follows one. The asset was rebuilt once after the second samples
(a duration-word rule narrowed, «до достижения возраста» added; +43 age entries) without a new sample.

**Recall (estimate).** In every 20th instruction of the four searched section types (≈ 460 instructions) 769
sentences gave a limit and 119 sentences that look like one (number + unit + child word) gave none; of 50 of those
119 read by hand, 3 were child limits missed (a month range after the word «терапия», «до достижения возраста
1 мес», a vaccination schedule), the others elderly limits (excluded on purpose), study ages and pharmacology. → ≈ 99 % of
the sentences that carry a number, a unit and a child word; two of the three misses were fixed after the sample.
Not measured: limits worded without a number («детям старшего возраста»), sections the section splitter typed
wrongly (a contraindication list under «treatment»), OCR-garbled numbers.

## 5. Benchmarks

`bun run benchmark:safe1` (`tools/benchmarks/safe1-queries.json`, 44 questions: 10 lactation, 12 pregnancy,
14 age, 8 negative; each with the МНН card it must produce, whether it must hold quotes, a regular expression one
quote must match and, for ages, the relation of the calculated line). The runner mounts the real corpus and the
decoded instruction modules and runs the code the card runs.

| Run | Result |
|---|---|
| instructions installed | **44/44** (lactation 10, pregnancy 12, age 14, negative 8); no verdict word in any calculated line |
| no instruction installed | **44/44** (every card asks for the download) |

The set is separate from `owner-queries.json`, which was not edited. Existing gates, before and after (no search
code changed; the card is rendered next to the unchanged results):

| Gate | Before | After |
|---|---|---|
| `benchmark:real:release` (lookup R@1 / R@5 / MRR@5; demo R@1 / R@5) | within tolerance of the baseline | within tolerance; lookup 0.803 / 0.934 / 0.855, demo 0.526 / 0.632 |
| `benchmark:doctor-lookup` (recall@5 / MRR@5) | — | 1.0 / 0.875 |
| `benchmark:owner-queries` (hit@1 / hit@5; rush; thoughtful) | per-query ranks as below | 0.278 / 0.574; rush 0.774, thoughtful 0.304 (the committed baseline) |

The before and after runs printed identical lines (per-query ranks of the owner set included; the only difference
between two runs is the milliseconds). No change in search code is expected and none was found: the card calls
`core.search` once more, for the name, and renders beside the results.

## 6. Not done / not verified

- The substance's other manufacturers' instructions are one switch away; they are not compared with each other,
  so a difference between generics is not flagged.
- Trade names inside quoted text, a combination drug's per-component statements, products as items (a drug is
  picked as a МНН or by the product the search found; for a product without an instruction of its own the card
  names another one of the substance, never the product's own).
- Sections the extractor does not read: «Побочное действие», «Фармакология» (animal data are kept only where a
  pregnancy section contains them), pediatric text in sections typed `treatment` or `other` without a child heading.
- Android / WebView: not run (e2e is desktop Chromium at phone width). No adb, emulator or device was used.
- Print / share of the card: not built (the interaction tool has them).
- «Рассчитано» compares one number with the bounds the extractor read; it does not read exceptions inside the
  sentence («за исключением …») or a dosage form: both are shown in the quote.
