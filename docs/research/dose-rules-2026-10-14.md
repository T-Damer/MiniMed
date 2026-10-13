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

## 2. Precision (honest)

Hand audits of random dose rules of ЖНВЛП cards (the sentence next to the parsed rule): three early batches of ~140 rules found
10–13 % with some defect; every defect class found was fixed (per-kg wordings read as absolute, a titration step read as a
dose, a heading leaking into the next sentence, daily dose read as a single dose, combination strengths, concentrations such as
«мг/дл», table rows with a clearance band). Two fresh batches of 50 after those fixes: 40/50 and 41/50 fully correct; of the
10 defects, 7 were fixed afterwards (dabigatran «300 мг (1 капсула 150 мг 2 раза в сутки)» was read as 300 mg per intake, a
nifedipine «увеличена на 20 мг» step, the aminosalicylic «для истощенных … <50 кг» weight limit leaking onto the adult dose,
a «в сутки в 3 приема» daily dose read as per intake, a diluent «в 5–10 мл 0,9 % раствора», «30–50 750 мг» read as 50 750,
and a «следует дать выпить» sentence acting as a child heading) and 3 remain (an azithromycin table cell «соответствует дозе для
взрослых» attached to the next sentence, an apixaban duration taken from the previous sentence, a ceftolozane renal table row
read without its clearance band). The fixes were made on the samples that exposed them, so the post-fix figures are
optimistic; the remaining error rate of a rule read at random is of the order of 5–10 %, concentrated in table-like sentences.
A rule is never shown without its quoted sentence, and a computed dose is always next to it.

Known limits: sentences about other drugs in combination regimens are filtered heuristically; a sentence naming no population is
computed for adults only; table rows depend on weight-band detection and a renal band without a cue word is not seen; ЕСКЛП has no
suspension form for amoxicillin so the suspension strengths come from the instruction text, not the registry; when Allmed has no
Latin name the Rp line is Russian in the genitive (allowed by order 1094н, clause 16); the 148-1/у-88 is chosen by the doctor.

## 3. Benchmark `bun run benchmark:dose`

`tools/benchmarks/dose-queries.json`: 134 cases (about 90 hand-verified drug and patient pairs covering adults and children
over age and weight bands, the seven owner examples, forbid lists such as «a child must not be offered the adult sentence», and
`none` cases that must show no dose). Each accepts a quoted sentence and the numbers worked out by hand from it. The runner
(`run-dose-queries.ts`, needs `DOSE_DECODED_DIR`) goes through the same code as the card: `parseDoseQuery` → the app's own
medication search (S3 variants, spelling correction) → the index → the installed instruction → the item analysis.

Result: cases 134, **exact 134 (100 %), wrong 0, missing 0**. Caveat: part of the set was written while the probe queries were
tuned, so it measures regressions and the claimed behaviour, not the generalization; the audit above does that.

## 4. Search ranking

The card is additive. No search or ranking code was changed: the exact-name gates `benchmark:all` and `benchmark:real:release`,
the name-variant, typo and owner sets are unchanged by construction; `benchmark:all` is run in the pre-push checks (see
CURRENT_STATE for the numbers).
