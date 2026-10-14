# Dose rules from official instructions, the prescription tool and the search card (RX1, 2026-10-14)

Owner request 2026-10-13: semantics for drugs, a prescription tool (patient → drug → form → dose → course → quantity →
printable prescription, several drugs, a «Рецепт» modal) and, later the same day, a search card that answers «амоксициллин
ребенок 20 кг». Contract and decision: [ADR-0025](../adr/0025-dose-rule-index-and-prescription-draft.md). Search-roadmap
comparison: [SEARCH_ROADMAP.md](../SEARCH_ROADMAP.md) item 20.

## 1. Coverage (index built 2026-10-14 from the 16 published instruction modules)

| | Count |
|---|---:|
| Instruction documents / with a dosage section | 9 216 / 8 314 |
| Indexed (best document per dosage form of a card, up to 6) | 2 981 |
| ЕСКЛП МНН cards / with an instruction / with a dose rule | 3 324 / 2 232 / 1 720 |
| **ЖНВЛП cards** / with an instruction in the modules / **with ≥ 1 dose rule** | 905 / 770 / **666** (74 % of all, 86 % of those with an instruction) |
| ЖНВЛП cards with an adult / a child rule / a cap / a course length | 653 / 296 / 249 / 391 |
| Rules: dose / cap / course | 22 306 / 3 999 / 6 110 |
| Clauses read / amounts skipped as not a dose | 181 985 / 18 285 |

The 104 ЖНВЛП cards with an instruction and no rule are mostly: «доза подбирается индивидуально», titration tables, regimens
written as tables the parser skips, and dosage sections of the instruction that are scans with broken text.

## 2. Precision and the confidence gate (RX2, 2026-10-14)

The RX1 author estimated 5–10 % wrong rules from three hand audits that were also used to fix the parser. RX2 replaced that with a
protocol that cannot be tuned on.

**Protocol.** (1) *Blind set*: a random sample, fixed seed `rx2-blind-2026-10-14` (SHA-256 → mulberry32), of 200 rules of ЖНВЛП
cards, one rule per card, stratified (55 adult, 55 child, 15 unstated-population, 10 other-population and 10 condition doses, 30 caps, 25 course lengths)
and module-balanced; each judged field by field (population, dose, unit, per kg, frequency, cap, duration, form / strength, route, role)
against its sentence and paragraph as correct / incomplete (nothing false stated, narrower or a detail not read) / wrong (something
contradicts the source, or a qualifier is missing so the number would be offered to a patient it is not for). Stored without instruction
text: rule id, section checksum, fields, verdict, a one-line reason (`tools/benchmarks/dose-rule-precision.json`). Not judged: boundary
inclusivity of an age and the indication a sentence belongs to (the quote carries both). (2) *Development sample*: four further draws
(309 rules, `dose-rule-gate-dev.json`) from other documents, judged by hand, used to build the gate. (3) *Fresh draws*: four draws of rules
the gate of that day let through (182 rules, `dose-rule-precision-fresh.json`), judged before the fixes they exposed.

**Results.**

| | Rules | Wrong in some field (95 % CI) | Wrong in a dose-relevant field |
|---|---:|---|---|
| RX1 parser, blind set | 200 | **77 = 38.5 %** (31.7–45.6 %) | 70 = 35.0 % (28.4–42.0 %) |
| After the gate: still computing, blind set | 36 | **0 = 0 %** (0–9.7 %) | 0 |
| Development sample, gate shapes | 186 | 0 (0–1.9 %), tuned on | 0 |
| Fresh draws, as judged (earlier gates) | 182 | 18 = 9.9 % (6.0–15.2 %) | 16 = 8.8 % |
| Fresh draws, after the final gate and fixes | 156 | 0 (0–2.3 %), not independent | 0 |
| Last fresh draw (68, unseen rules of seen documents, near-final gate) | 68 | 5 = 7.4 % | 4 = 5.9 % |

By field in the blind set: population 19.0 % of the rules that carry one, dose 14.5 %, frequency 16.3 %, duration 37.1 %, per kg 7.0 %,
cap 10.0 %, route 5.5 %, unit 0.6 %, form 0 %. By sentence shape the rejected shapes hold 77 of the wrong rules (stage / titration 22,
special populations 10, context 10, table 8, condition 7, alternative 5 …) and the allowed shapes none.

**Gate.** `dose-gate.ts` stamps each rule with a shape at build time; the app computes only for allowed shapes: `dose.local|heading|none`
× `abs|kg|bsa` × `freq|nofreq`, `cap.*`, `duration.none` (listed in `GATE_ALLOWED`; each family has ≥ 9 judged rules and none wrong). Rejected:
tables and table cues, titration / stage / «затем», alternatives, «до N раз», qualifiers («при необходимости», «в тяжелых случаях»), a
population taken from a sentence or section title, age-or-weight «и/или» populations, a lone open lower age bound, sex / pregnancy /
cycle, other-substance and component doses, ranges wider than tenfold or with a leading zero (typos), a daily total without a stated
frequency, units that do not fit the dosage form, caps that are ranges or about another component. **Coverage: 275 of 905 ЖНВЛП cards
(30.4 %; 35.7 % of those with an instruction) still get a computed dose** (245 adult, 68 child, 101 cap, 45 course); sentences of the
other 392 cards with parsed rules are quoted only.

**Defects fixed at their cause.** The azithromycin table cell leaking into the next sentence (the «соответствует дозе для взрослых»
remark no longer supplies a population), the apixaban duration taken from the previous clause, the ceftolozane renal table row read without
its clearance band (a table context after «Таблица N» / a band cell now blocks the rule). Others found on the way: a single dose read as
daily, «до N раз» as a frequency, per kg lost («на кг», «/кг», «на квадратный метр»), the scope of a cap, tolerability / titration /
cycle-length durations, route taken from the previous therapy or from the section lead, micrograms rounded, «не меньше» inverted,
tablets of a split day turned into a piece strength, typos such as «0,5-075».

**Caveats (honest).** The blind set was judged before any fix and its error classes drove the first fixes (the set itself is not used
to choose gate cues); the numbers after the gate on it are therefore not independent of the work. The gate is tuned on the development
sample, and each fresh draw of gate-passing rules still found new defect classes until the last one (4 of 68); the final gate is not
measured on a new independent sample, and every document with an allowed rule has been seen by a draw. Expect a few percent of the
computed doses to carry a defect in an unseen document; the quoted sentence sits next to every number. Indications («при мягкой
степени АГ», «при сибирской язве») and severity are shown in the quote, not parsed; the first sentence offered can be an
indication-specific one (ceftriaxone «средний отит», ciprofloxacin anthrax). Amoxicillin's children's rules are age-or-weight
tables («5–13 лет и/или 19–40 кг»): 11 rules of 2 documents were judged only by their text, and the family is not allowed until a
sample of it exists, so amoxicillin children are quoted only. Not a clinical review.

Known limits (unchanged): sentences about other drugs in combination regimens are filtered heuristically; ЕСКЛП has no suspension form
for amoxicillin so the suspension strengths come from the instruction text; when Allmed has no Latin name the Rp line is Russian in the
genitive (order 1094н, clause 16); the 148-1/у-88 is chosen by the doctor.

## 3. Benchmark `bun run benchmark:dose`

`tools/benchmarks/dose-queries.json`: 134 cases (about 90 hand-verified drug and patient pairs covering adults and children
over age and weight bands, the seven owner examples, forbid lists such as «a child must not be offered the adult sentence», and
`none` cases that must show no dose). Each accepts a quoted sentence and the numbers worked out by hand from it. The runner
(`run-dose-queries.ts`, needs `DOSE_DECODED_DIR`) goes through the same code as the card: `parseDoseQuery` → the app's own
medication search (S3 variants, spelling correction) → the index → the installed instruction → the item analysis.

Result before RX2: cases 134, exact 134, wrong 0, missing 0. **After the gate: exact 83 (61.4 % of the 132 answerable), missing 51
(the sentence is quoted, no number), wrong 0.** 52 first answers changed to another valid sentence of the same instruction; each was
read against its sentence and added to the accept list of its case (indication-specific first sentences among them). Caveat: part of
the set was written while the probe queries were tuned, so it measures regressions and the claimed behaviour, not the generalization;
the blind set above does that.

## 4. Search ranking

The card is additive. No search or ranking code was changed: the exact-name gates `benchmark:all` and `benchmark:real:release`,
the name-variant, typo and owner sets are unchanged by construction; `benchmark:all` is run in the pre-push checks (see
CURRENT_STATE for the numbers).
