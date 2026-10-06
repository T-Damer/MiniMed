# Drug comparison: registry rows, quoted sections and deterministic marks (CMP1, 2026-10-06)

Status: implemented. Owner request 2026-10-06: «Sometimes you need to choose between 2 medications but you don't
know the difference — they may be similar but have different traits. Compare drugs by parameters.» Search-roadmap
comparison: [`SEARCH_ROADMAP.md`](../SEARCH_ROADMAP.md) item 16. Reuses the INT1 / SAFE1 pipelines
([drug-interactions-2026-10-06.md](drug-interactions-2026-10-06.md),
[medication-safety-2026-10-06.md](medication-safety-2026-10-06.md)) and the same-substance labelling of
[ADR-0023](../adr/0023-same-substance-instruction-fallback.md).

## 0. Summary

- A tool **«Сравнение препаратов»** (`#/notes/drug-comparison`): 2–4 drugs in columns, parameters in rows, the first
  column pinned on a wide screen, every row stacked with the drug's name on a phone. Rows are registry facts
  (ЕСКЛП, ГРЛС, НСИ «АТХ»), short lines quoted from the instruction, the SAFE1 rows (age and weight, pregnancy,
  breastfeeding), six quoted sections matched across the instructions, and the INT1 / INT2 interaction pairs.
- **No generated text.** A registry value is the registry's; a section is quoted without change from the installed
  instruction with its anchor («Открыть в инструкции»); a mark («у обоих», «только у X», «формулировки различаются»)
  is the result of a word comparison, never a judgement. No summary, no «лучше / хуже». The notice «Сравнение
  текстов инструкций, а не клиническая рекомендация» is on the screen, the print and the share text.
- A search query such as «ибупрофен или парацетамол», «ibuprofen vs paracetamol», «сравнить X и Y», «чем отличается
  X от Y», «разница между X и Y» adds a card above the results of «Все источники» and «Препараты» **only when every
  part of the query names a drug in the ordinary drug search**. «менингит или энцефалит» gets no card. No search
  code, ranking or alias changed; the three exact-name gates are unchanged (section 6).
- Entry points: the search card, «Сравнить с…» on a drug card (substance card and product), «Сравнить эти
  препараты» in the interaction tool, «Все инструменты» and the tool search; `ageScope` is «any».
- Measured: **198 of the 200 most common substances (99 %) have all six quoted sections** in the instruction read
  first; marks hand-checked on 62 + 63 statements (95.2 % before and 100 % after one rule added, with two known
  error classes left, section 5); a 4-drug comparison computes in 66–86 ms (section 7).

## 1. What shipped

| Part | Where |
|---|---|
| Build script (modules checked against the catalog SHA-256, same inputs as INT1 / SAFE1, plus the ГРЛС register) | `scripts/build-drug-comparison.ts` (`bun run content:drug-comparison`) |
| Index asset, lazy chunk (2.5 MB, 541 kB gzip; registry facts per card, which sections each instruction has; **no text**) | `apps/app/src/features/drug-comparison/data/comparison-index.json` |
| Asset shape, validation, instruction ranking | `comparison-index.ts`, `comparison-build.ts`, `comparison-load.ts` |
| Sections: the declared rows, extraction from the installed document | `comparison-sections.ts` (`SECTION_ROWS`, `QUOTE_ROWS`) |
| Units (sentences and list items) | `comparison-units.ts` |
| Normalisation, similarity, groups, differing words | `comparison-match.ts` |
| Which instruction is read; columns, rows, marks | `comparison-view.ts` |
| Registry rows | `comparison-registry.ts` |
| SAFE1 rows (reuse of `safetyOfDocument` + `intentView`) | `comparison-safety.ts` |
| Query parser, name → drug | `comparison-query.ts`, `comparison-candidates.ts` |
| Print / share model | `comparison-model.ts`, `comparison-print.ts` |
| Screen | `DrugComparisonWorkspace.tsx`, `ComparisonMatrix.tsx`, `ComparisonSections.tsx`, `ComparisonSuggestionCard.tsx`, `styles/drug-comparison.css` |
| Interaction pairs shared with the INT1 tool | `drug-interactions/InteractionPairs.tsx` (extracted from `DrugInteractionWorkspace.tsx`, same classes and test ids) |
| Benchmarks | `tools/benchmarks/cmp1-queries.json`, `src/run-cmp1-queries.ts` (`bun run benchmark:cmp1`), `src/run-cmp1-measure.ts` |
| Hand-checked sample | `docs/research/data/cmp1-precision-sample.json` |
| e2e | `apps/app/e2e/drug-comparison.spec.ts` |

## 2. Rows and where each comes from

| Row | Source | How |
|---|---|---|
| МНН | ЕСКЛП card | standardized МНН |
| Код АТХ и группа | ЕСКЛП card codes, **НСИ «АТХ» names** (levels 3–4) | `atcPrefixes` + `atc-names.json` |
| Фармакотерапевтическая группа (реестр) | ЕСКЛП nodes | the registry's words |
| Лекарственные формы и дозировки | ЕСКЛП nodes | form → strengths, spellings of one strength joined («1.0мг/мл» = «1 мг/мл») |
| Условия отпуска (реестр) | **ГРЛС register 02.10.2026** | counts of registrations in force by «По рецепту / Без рецепта / смешанные / не указано», joined to the card by registration number (29 363 valid registrations, 2 967 cards have counts) |
| Перечень ЖНВЛП | ЕСКЛП nodes | per dosage form: listed / not listed |
| Регистрации и производители | ЕСКЛП positions | distinct registration numbers, trade names, manufacturers and holders (company names compared without case, quotes and legal forms) |
| Фармакотерапевтическая группа (из инструкции), Условия отпуска (из инструкции) | the installed instruction | the section quoted whole, title removed |
| Возраст и масса тела, Беременность, Грудное вскармливание | the installed instruction, SAFE1 extraction | `safetyOfDocument` run on the open document: the same sentences, section labels and anchors as the drug screen; the numbers the instruction prints are listed as it prints them; «В инструкции об этом не сказано» when it says nothing |
| Показания, Противопоказания, Способ применения и дозы, Побочное действие, Особые указания и «С осторожностью», Передозировка | the installed instruction | section **types** of the instruction modules (declared in `SECTION_ROWS`); several sections of one type are read in document order, a text printed twice is quoted once |
| Взаимодействие между этими препаратами | INT1 index + DDInter label when the INT2 module is installed | the same panel as the interaction tool (`InteractionPairsPanel`), the same quotes, labels and source notes |

Where the registry has nothing the cell says «В реестре не указано»; where an instruction was not read, «Инструкция не
прочитана»; a section the instruction does not have is named in the row («В прочитанной инструкции этого раздела
нет»), never filled from another document.

## 3. Which instruction is read

The index lists every instruction document (9 186) with the sections it has. Per drug (МНН card) the order is: the
most quoted sections, a ГРЛС file before a holder's site, a professional text before a leaflet (`compareInstructions`).
A **product** the doctor asked for (a trade name the drug search found) keeps its own instruction when the index has it.
Otherwise the comparison reads **one dosage-form class for every drug** (the first word of the form: таблетки,
капсулы, раствор…) when each drug has an instruction in it and it costs at most two quoted sections against each
drug's own best one: a tablet is read against a tablet, not against a gel. The form of the instruction is in the
column head, a `<select>` there lists the other instructions of the substance, and the head says when a leaflet is
read («его разделы и слова отличаются от инструкции для врача») and that this is one manufacturer's instruction of the
substance (the ADR-0023 wording). The instruction needed may be in another module than the other drug's; the page
offers every missing module once (the interaction pairs' modules are merged into the same list).

## 4. How statements are matched

1. **Units.** A section is the canonical string of INT1 (its chunks joined by a newline). A unit is a sentence or a list
   item: a bullet (including the private-use bullet of Word PDFs), a numbered item, a sentence end («.», «!», «?» before a
   capital letter, abbreviations excepted) or «;» outside brackets starts a new unit; a printed line otherwise continues
   the unit before it; a short heading («Симптомы:») stays with the unit after it; the section's own title repeated at the
   start is dropped. A unit is a plain substring of the instruction, whitespace collapsed.
2. **Normalisation.** Lower case, «ё» → «е», punctuation dropped, every word cut to the same light stem the interaction
   index uses (`nameWordStem`), numbers kept as tokens («12» ≠ «6»), Roman numerals kept («II» ≠ «III»). Not counted: a list
   of 33 function words, and **the drug's own names** (МНН words and trade names), so «Гиперчувствительность к ибупрофену»
   and «… к парацетамолу» are the same statement about the drug in front of the reader.
3. **Marks.** *Identical*: the remaining stem sequences are equal. *Similar*: Jaccard similarity of the stem sets
   **≥ 0.6** (`SIMILAR_THRESHOLD`), or a statement of ≥ 4 words that is ≥ 85 % inside a longer unit of the other drug
   (`CONTAINED_THRESHOLD`, a list printed as one sentence). A similar pair is shown side by side with the words that
   differ marked, a differing number included («до 6 лет» / «до 12 лет»). Everything else is «только у X». With three or
   four drugs a group of matched statements is a **clique** (every two members at least similar) with at most one statement
   per drug: «у всех», «у X, Y», «только у X».
4. **Order.** The first drug's statements in their own order, each with its matches; then the groups that start with the
   second drug; and so on. The first column of the group rows carries the mark.
5. **«Показать только различия»** hides the groups that are identical in every drug; similar groups and «только у»
   groups stay.
6. A row is compared only when at least two instructions are read; with fewer it says so and shows no marks. A
   section longer than 400 statements is cut and the cut is stated.

The threshold 0.6 was set just above 0.5: «Тяжёлая печёночная недостаточность» and «Тяжёлая почечная недостаточность»
(two different contraindications in one list) have a Jaccard similarity of exactly 0.5 and would match at 0.5. It was
not tuned further; 0.7 was not tried, so a threshold that loses fewer pairs or admits fewer is untested.

## 5. Measurements

Build report (`data/build/drug-comparison/report.json`, local): 9 216 instruction documents in 16 modules, 9 186 matched
to an ЕСКЛП МНН card (30 not), 3 324 cards of which **2 398 have an instruction**, 1 494 of them one that has all six
quoted sections.

**Coverage, the 200 most common substances** (INT1 definition: single-substance cards with the most registrations),
instruction read first:

| Quoted row | Substances with it |
|---|---:|
| Показания | 200 |
| Противопоказания | 200 |
| Способ применения и дозы | 200 |
| Побочное действие | 200 |
| Особые указания / «С осторожностью» | 200 |
| Передозировка | 198 |
| **All six** | **198 (99 %)** — missing: ривароксабан, аллергены пищевые (no «Передозировка» section) |
| Фармакотерапевтическая группа (строка инструкции) | 194 |
| Условия отпуска (строка инструкции) | 192 |

«Has the row» means the instruction has a typed section of that type with text; it does not say the section is
well extracted (a leaflet and a national instruction differ in structure).

**Precision of the marks, hand-checked.** Seeded random pairs of the 200 substances (seed 7), the adverse-effects row
left out (catalogue lists); every sampled statement read against the other instruction's section. Criterion: a «у
обоих» / «формулировки различаются» pair answers the same question about both drugs; a «только у X» statement has no
statement of the same content in the other section. The verdicts are the author's reading, with no second reviewer
(`data/cmp1-precision-sample.json`).

| Draw | Matching | Identical | Similar | «Only» | Total correct |
|---|---|---:|---:|---:|---:|
| 1 | Jaccard ≥ 0.6 | 13 / 13 | 29 / 29 (1 questionable pairing) | 17 / 20 | 59 / 62 = **95.2 %** |
| 2 (after the containment rule) | + containment ≥ 0.85 | 13 / 13 | 30 / 30 | 20 / 20 | 63 / 63 = **100 %** |

Draw 1's three errors: a short statement inside a longer list printed as one sentence (fixed by the containment rule),
and two statements on the same topic worded differently («Во время лечения рекомендуется подбирать надёжные методы
контрацепции» / «Контрацепция у мужчин и женщин: эффективные методы должны применяться…»; «не рекомендуется управлять
транспортными средствами» / «не выявлено влияния на способность управлять…»), which stay «только у X». The same
class is the known error that remains: **two instructions that say something on one topic in different words are not
matched below the threshold, so «только у X» can be shown for a topic the other drug also covers.** The one questionable
similar pair (driving: «исследований не проводилось» / «не влияет») is paired on the topic and the differing words are
marked. The sample is small (95 % interval of 59/62: 87–99 %), the draw 2 sample was taken after the rule was tuned on
draw 1, and shared statements are rare between different drugs (13 identical and 29 similar among 80 random pairs).
Recall of shared statements was not measured.

**Search queries** (`bun run benchmark:cmp1`, 35 cases, separate from `owner-queries.json`): 12 «или» / «vs», 9 cue
phrases, 14 negatives; **35/35**. Negatives include two diseases («менингит или энцефалит», «астма или хобл»), a drug and
a symptom, one drug, «X и Y» without a cue, interaction queries and a long clinical phrase. Two fixes came from the set: a
genitive («эналаприла») matched the longer «эналаприлат» by prefix, and the search did not find «лизиноприла» as the single
substance; the name is now matched as whole words and looked up again as its stem.

## 6. Search regression check

The card is rendered beside unchanged results; the card calls `core.search` once per name. Measured before and after on
the same tree (`benchmark:real:release`, `benchmark:doctor-lookup`, `benchmark:owner-queries`); the card code was not part
of either run (the benchmarks run the core, not the UI):

| Gate | Before | After |
|---|---|---|
| `benchmark:real:release` lookup R@1 / R@5 / MRR@5 | 0.803 / 0.934 / 0.855 | identical |
| … demo R@1 / R@5 / MRR@5 | 0.526 / 0.632 / 0.566 | identical |
| `benchmark:doctor-lookup` recall@5 / MRR@5 | 1.0 / 0.875 | identical |
| `benchmark:owner-queries` hit@1 / hit@5 (rush hit@5, thoughtful hit@5) | 0.278 / 0.574 (0.774, 0.304) | identical; per-query ranks identical |

The only differences between the two runs are the milliseconds (release-gate p50 925 → 763 ms, p95 1 896 → 1 535 ms:
machine noise, the second run was warm). No search code, ranking, alias or core file changed.

## 7. Latency of a 4-drug comparison

`bun run … run-cmp1-measure.ts --latency`, bun + SQLite on the author's desktop, median of 5 runs, documents read from
the decoded instruction modules (the app reads them from OPFS in a worker, so the read stage is optimistic):

| Drugs | Statements compared | Choose | Read 4 documents | Extract rows | Match | SAFE1 rows | Total |
|---|---:|---:|---:|---:|---:|---:|---:|
| ибупрофен, парацетамол, диклофенак, кетопрофен | 460 | 3 ms | 5 ms | 21 ms | 4 ms | 47 ms | 80 ms |
| амоксициллин, азитромицин, левофлоксацин, ципрофлоксацин | 440 | 1 ms | 7 ms | 23 ms | 4 ms | 52 ms | 86 ms |
| метформин, омепразол, эналаприл, амлодипин | 395 | 1 ms | 7 ms | 18 ms | 4 ms | 41 ms | 66 ms |

Before the SAFE1 extraction ran once per document (it ran once per row, three times) the same stage took 140–198 ms.
The index chunk (541 kB gzip) and the НСИ names are loaded when the tool opens; the interaction index (672 kB gzip) is
loaded for the pairs block. Not measured on a phone or in the WebView.

## 8. Not done / not verified

- Android, WebView, a physical device and an emulator: not run (e2e is desktop Chromium at 390 and 1280 px).
- The comparison is not word-for-word complete: statements on one topic in different words are not matched (section 5);
  tables flattened by the PDF extraction are compared as the text they became; OCR-damaged words match nothing.
- Registry counts are ЕСКЛП (2026-08-28) and ГРЛС (02.10.2026) editions; a new edition needs `bun run
  content:drug-comparison`. Conditions of dispensing come from the register only (the instruction's «Условия отпуска»
  line is quoted next to it, and the two can differ). The ЖНВЛП flag is the ЕСКЛП flag per dosage form.
- A product keeps its own instruction only when the instruction index has the trade name; otherwise the substance's
  instruction is read and labelled so. Combination products are compared as their own card.
- The instruction read is one per drug; other manufacturers' instructions of the substance are one `<select>` away and are
  not compared with each other.
- Print and share carry the same rows and marks; they were not exercised on paper.

## Coordinator change (2026-10-06): the unmatched mark

«только у X» claimed an absence the matcher cannot prove: the same topic worded differently in
another instruction is not matched. The mark is now «у X; у других совпадения нет», the row summary
says «без совпадения у других — X: N», and the explanation adds that another instruction may say the
same in other words. Matching rules and thresholds are unchanged.

