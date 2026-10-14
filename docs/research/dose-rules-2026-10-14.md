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

**Independent audit (RX3, 2026-10-14).** An auditor who had not read the earlier judgement files drew 120 rules that the final gate
lets compute (seed `rx3-audit-2026-10-14`, `tools/benchmarks/src/draw-dose-audit.ts`) from the 739 indexed instructions that no earlier
sample or benchmark case touched (672 documents excluded: the 623 of the blind, development and fresh sets and every instruction of the
50 cards of `dose-queries.json`); all cards, not only ЖНВЛП; stratified by kind and population (44 child and 42 adult / unstated doses, 20
caps, 14 course lengths), one rule per document and per card, 14 of 16 modules. Each rule was judged field by field against its sentence
and paragraph, then run through the screen's own analysis (`analyzeItem`) for a realistic patient (units per registry strength, signa).
Set `tools/benchmarks/dose-rule-audit-2026-10-14.json`, `bun run benchmark:dose-precision --file=…` (exits 1 on purpose: wrong rules compute).
**Wrong 4/120 = 3.3 % (95 % CI 0.9–8.3 %), all in a dose-relevant field**; dose rules 2/86 = 2.3 % (0.3–8.1 %), caps 2/20 = 10 %
(1.2–31.7 %), course lengths 0/14; weighted to the frame 1.2 %; incomplete 4 more (wrong or incomplete 8 = 6.7 %). By field: population 2/92,
cap 2/20, dose 1/86; unit, per kg, frequency, duration 0. The development sample's 0 % was tuned on and did not generalise; this
interval agrees with the last fresh draw (5/68). The wrong rules and their causes:
(1) ibuprofen + paracetamol, «Дети в возрасте старше 12 лет / Разовая доза – 2 таблетки.» then the next line «(до 18 лет), масса тела ≥41 кг»:
the population qualifier continues after the sentence, so a 12-year-old of 30 kg is offered 2 tablets (`splitSentenceSpans` / `readClause`
in `dose-parse.ts` read the sentence only; `headingsOf` joins a broken heading only when the continuation comes before the sentence);
(2) rufinamide cap `cap.local`, «Если ребенок не принимает вальпроат, то максимальная суточная доза составляет 1000 мг» under the heading
«Дети 4 лет и старше с массой тела менее 30 кг»: population read from the word «ребенок» in the clause (child < 18 y) although a heading line
with age and weight bounds stands two sentences above, and a co-medication condition («если … не принимает …») is no rejection cue in
`classifyRule` (`dose-gate.ts`); the 1000 mg is offered to a 16-year-old of 50 kg and as the ceiling of a child on valproate (600 mg);
(3) povidone cap, «Максимальная разовая доза для детей грудного возраста – от 50 до 70 мл» (a per-age list follows): `capsOf` keeps only the
upper end of the range after the dash, so the permissive end (70 ml) is the cap for every infant (the rule «caps that are ranges» did not fire);
(4) metamizole + pitofenone + fenpiverinium, «Рекомендуемые суточные дозы: Для взрослых: 1–2 таблетки 2–3 раза в сутки»: the lead-in «суточные
дозы» makes it «1–2 pieces per day» (summary «1–2 шт. в сутки · 2–3 раза в сутки»); a daily total smaller than the number of intakes is
impossible and should reject the rule. The intake the screen computes (1 tablet × 2) happens to be right.
Not counted as wrong but found: **25/120 (21 %) of the sentences are one indication or regimen of several** (prophylaxis versus treatment,
a named disease, a post-COVID course; the quote shows it, the rule does not carry it), 20 of them dose rules, so the first sentence the tool
offers is often not the general dose; and **15/120 rules print a defect in the tool's own output**: the signa starts «Внутрь» for rectal /
vaginal / sublingual forms when the sentence names no route (`routeWord`, `prescription-text.ts`: the default for solid forms; 6 rules) and
«Наружно» for a lozenge, a spoon of syrup prints «1 шт.» (`pieceWords` / `unitNoun` lose `qu` = spoon; 5), and `roundToProduct`
(`dose-compute.ts`) has no ceiling on rounding up to the registry strength (+100 % … +300 % in the signa, only a note on screen; 4), and
takes tablet or millilitre counts of the instruction's own product for every registry strength of the card (ibuprofen + paracetamol
200+500 / 400+200 / 400+325 mg all show «2 таблетки»). **The gate is bypassed for caps**: `analyzeItem` (`prescription-model.ts`) passes
every rule of the instruction to `checkCaps`, so caps of rejected shapes are compared and shown (887 of 1 223 cap rules are rejected shapes;
167 of the 881 documents with a computing dose rule hold one): the audit's Temalgin page shows an adolescent cap (2 tablets, shape
`rejected.context`, population «Взрослые» carried over from a heading 1 300 characters up) next to the adult cap.
Recommendation (answered by the RX4 fixes below): do not ship computed doses as they are. A narrower gate cannot reach zero by shape: the four wrong rules sit in the core
shapes `dose.local.abs.*` and `cap.local`; dropping `cap.local` numbers (2/8 wrong) helps only caps. Fix the four causes, gate the cap
comparison, make the signa route and the spoon / ampoule words come from the dosage form, refuse a rounding beyond a small tolerance and
tie piece / ml counts to the strength of the instruction's product; then draw a new sample of at least 150 rules from untouched documents.

**Fixes after the audit (RX4, 2026-10-14).** Every finding of RX3 was fixed at its cause (ADR-0025, decisions 8–9); each has a unit test
with the audit's own sentence (`dose-gate.test.ts`, `dose-compute.test.ts`, `prescription-text.test.ts`, `prescription-model.test.ts`).

| # | Finding | Fix |
|---|---|---|
| 1 | weight / age on the line after the sentence (ibuprofen + paracetamol) | `attachQualifierLines` (`dose-parse.ts`) joins a following bracket or lower-case continuation that prints an age or weight bound to the sentence (the quote shows it; the shared `splitSentenceSpans` is untouched); a bracket that may head the next sentence rejects the sentence (`qualifierFollows`, `rejected.population`). In the 6 124 dosage sections of the indexed documents it joins 4 sentences (the audit's) and rejects none; a capital-letter line («От 3 до 18 лет», «Масса тела») is a heading and is never joined |
| 2 | population read from «ребенок» under the heading «Дети 4 лет и старше с массой тела менее 30 кг»; co-medication condition (rufinamide cap) | a group-only clause is read within the printed bounds of the heading above it (`narrowedBy` in `inheritedBy`: the clause's group, the heading's age and weight; «Взрослые:» under «Взрослые и дети старше 12 лет массой тела более 50 кг» stays 18 years and gets 50 kg), and the gate then asks for a plain heading; `CO_MEDICATION` («если … не принимает/принимает …», «пациентам, принимающим …») rejects any rule kind (`rejected.special`) |
| 3 | cap range «от 50 до 70 мл» + per-age list taken as 70 ml (povidone) | `capsOf` keeps both ends (`d0`, `d1`), the gate rejects a cap with `d0`, and `CAP_RANGE` (words «от N до M») joins the dash test (`rejected.cap`); rufinamide's «от 1800 мг до 3200 мг» (a cap at the permissive end) is rejected the same way |
| 4 | «суточные дозы: 1–2 таблетки 2–3 раза в сутки» read per day | a day's total of pieces smaller than the lower number of intakes is rejected (`rejected.basis`) |
| 5 | the gate bypassed for caps | `checkCaps(…, trusted)`: only `ResolvedRule.computable` caps are compared, a rejected cap is quoted (`quoted`); range caps are never compared |
| 6 | route «Внутрь» for rectal / vaginal / sublingual, «Наружно» for a lozenge; «1 шт.» for a spoon | `routeOfForm` reads the route from the dosage form's own wording (a suppository the wording does not place gets none; a lozenge «Рассасывать»); `подъязычно` is a sublingual route; `PIECE_KINDS` tell teaspoon, tablespoon, dessertspoon, measuring spoon / cap / cup, ampoule and vial apart and the sign names what the instruction counts («1 столовая ложка», «1/2 чайной ложки (2,5 мл)») |
| 7 | rounding +100 … +300 % | `ROUNDING_TOLERANCE_PERCENT` = 10: beyond it the dose stays a mass («2,5 мг»), no count of pieces or millilitres, no quantity, the nearest dose and its deviation are named on screen; within the tolerance the deviation (≥ 1 %) is printed |
| 8 | one count for every registry strength | index field `ps` = the registry rows of the instruction's own registrations; `productTie` (strengths compared by what they say) decides; another strength: a mass rule is recomputed, a rule in pieces / ml / drops gives `strength-mismatch` (no count) |
| 9 | indication-bound sentences (21 %) | `i` (range of «при амебиазе» / «Для лечения» / the heading / the name of the state that opens the sentence) and `sv` (one of several regimens of the population) in the index; the screen prints the indication beside the number, and the general sentence comes first (`RuleOption.bound`) |

**Numbers before / after.** `bun run benchmark:dose-precision [--dev | --file=…]`: the rules the gate lets compute, and how many of those are wrong in some
field. Between the audit and these fixes the instruction modules were republished (OCR1, 2026-10-14: re-prepared OCR texts), which moves offsets and
removes some judged rules (a judged rule whose sentence no longer yields a rule does not compute), so the table gives both bases.

| Set (judged) | Modules of the audit: RX3 gate | After RX4 | Current modules (OCR1): RX3 gate | After RX4 |
|---|---|---|---|---|
| Blind (200) | 36 compute, 0 wrong | 36, 0 | 33, 0 | **33, 0** (CI 0–10.6 %) |
| Development (309) | 186, 0 | 186, 0 | 178, 0 | **178, 0** (0–2.1 %) |
| Fresh draws (182) | 156, 0 | 156, 0 | 144, 0 | **144, 0** (0–2.5 %) |
| **Audit (120)** | 120, **4 wrong (3.3 %, CI 0.9–8.3 %)** | 116, **0** (0–3.1 %) | 115, **4 (3.5 %, 1.0–8.7 %)** | 111, **0** (0–3.3 %) |
| `benchmark:dose` (134 cases) | exact 83, missing 51, wrong 0 | 83 / 51 / 0 | exact 80, missing 51, wrong 3 (OCR1 changed the first sentence of кларитромицин ×2, карбамазепин; run with the RX4 app code on the index of the RX3 parser) | **82 / 52 / 0** |

The audit file is **no longer an independent measure**: its four wrong rules were fixed, so 0 wrong there proves only that the four causes are gone;
the rules that changed and still compute were re-judged by hand (on the old modules three spoon kinds, a vial, a sublingual route; on the OCR1 modules a
cap route, a lost route line and three course lengths whose heading line is no longer a line of its own): all correct. The gate's family evidence now
pools every hand-judged set (`GATE_MIN_JUDGED` = 9 per family over the development, blind, fresh and audit sets; none wrong): `cap.heading` has 20 (it fell
to 8 in the development sample alone when the rufinamide-like cap left it). `benchmark:dose` after OCR1 and RX4: six first answers were read against
their sentences and accepted — clarithromycin ×2 (the general adult sentence), carbamazepine (alcohol withdrawal, accepted only while the screen names the
indication) and ceftriaxone ×3 (both sentences of the top instruction are regimens of one indication; accepted only while marked); fluconazole 6 y 20 kg
moved from exact to missing: its sentence («у детей больных СПИДом …») sits under a heading «Дети от 3 лет …», so it now stands under that heading's bound
and is rejected as context instead of being offered to a 1-year-old.

**Coverage (current modules, index).** ЖНВЛП cards with a computing dose rule: **280 of 905 (30.9 %; 36.4 % of the 770 with an instruction) → 280, unchanged**
(adult 251, child 68, cap 99, course 46 — also unchanged); gate-passing rules 1 434 / 331 / 292 → 1 425 / 328 / 292 (dose / cap / course). 460 of the 1 425
computing dose rules (32 %) are bound to an indication (292 name it, 168 more are only «one of several regimens»): only 218 ЖНВЛП cards (626 cards in
all) keep a **general** dose sentence, the other 62 ЖНВЛП cards show their dose with its indication. On the screens of the audit's computing rules (184 screens:
every registry strength of the instruction's form, up to five per rule): 19 show no count because the strength is not the instruction's, 18 show the dose
without a count because the rounding would exceed 10 %, none prints «шт.» for a spoon or «Внутрь» for a suppository or a lozenge.
The new independent sample was drawn afterwards: **Independent audit 2** below. (Rule set before it: draw a fresh audit of at least 150 gate-passing rules
from untouched documents before a release ships the numbers; if it finds a wrong rule, ship with `computedDoses: false`, ADR-0025 decision 9.)

**Independent audit 2 (RX5, 2026-10-14, after the RX4 fixes).** An auditor in a fresh session (earlier judgement files not opened, only the document ids of
the blind, development, fresh and audit sets read to exclude them) drew **170 gate-passing rules** (seed `rx5-audit2-2026-10-14`,
`tools/benchmarks/src/draw-dose-audit-2.ts`) from the **634 indexed instruction documents no earlier set touched** (797 documents excluded: the 743 of the four
judged sets and the 54 more of the 50 cards of `dose-queries.json`), all 16 current modules (`grls-2026.10.14.kd1` ×15 and the manufacturer module; decoded copies
by absolute path from `output/`, deleted afterwards), one rule per document and per card. Strata: kind × population × indication marking — 36 adult
general doses, 20 adult indication-bound, 37 + 4 child (general / bound), 28 unstated-population doses, 20 + 3 caps (adult / child), 24 course lengths; the
untouched frame holds only 70 child dose rules and 3 child caps, so those were taken nearly whole. Each rule was judged field by field (population, dose,
unit, per kg, frequency, caps, duration, route, form and strength, indication marking) against its sentence and paragraph, then `analyzeItem` was run for a
realistic patient of the rule's population on up to three registry forms of the instruction's form class × three strengths each (shown numbers, units per
intake, the ≤ 10 % rounding, signa route and spoon words, cap checks). A wrong screen counts as wrong. Set `tools/benchmarks/dose-rule-audit-2-2026-10-14.json`
(`build-dose-audit-2-set.ts`; no instruction text), `bun run benchmark:dose-precision --file=…` (exits 1 on purpose). The set is *not* added to the gate's pooled
evidence (it would fail `--dev` for the families with wrong rules).

| | Count | 95 % CI (Clopper–Pearson) |
|---|---:|---|
| **Rule wrong in a dose-relevant field** | **7/170 = 4.1 %** | 1.7–8.3 % |
| **Screen output wrong** | **13/170 = 7.6 %** | 4.1–12.7 % |
| of which numbers or cap checks (dose, strength, cap, daily total) | 7 = 4.1 % | 1.7–8.3 % |
| of which words of the sign (route, product) | 6 = 3.5 % | |
| **Rule or screen wrong** | **15/170 = 8.8 %** (weighted to the frame 7.6 %) | 5.0–14.1 % |
| Dose-relevant rule field or numeric screen output wrong | 9/170 = 5.3 % | 2.4–9.8 % |
| Incomplete only (nothing false: schedule in the next sentence 6, prepared form 4, other 2) | 12 | |
| Without the four borderline calls (#7, #84, #87, #119) | 11/170 = 6.5 % | |

By stratum (rule or screen wrong): doses 13/123 (adult 5/54, child 5/41, unstated 3/28), caps 2/23, course lengths 0/24; 11 of the 16 modules hold at least one
(antiinfectives 4/14, sensory-organs 2/13). RX3 had 4/120 (3.3 %) in the rule alone; this sample finds 7/170 (4.1 %) there and 8 more only in the screen. **The RX3
causes stayed fixed; none of the 15 repeats one** (the route defects are in `routeOfForm` again, but for multi-route form names, a case the RX4 fix did not cover).
48/170 (28 %) of the sentences are one indication
or regimen of several; the rule marks 28 of them, 20 (42 %) carry no `i` / `sv` mark, so the number shows without its indication label (the quote shows it).

The defects, with their cause (`apps/app/src/features/prescription/`, numbers are the audit's):
1. **Rule, dose (#26, chondroitin, manufacturer module)** `doseOf` (`dose-parse.ts`): «Капсулы по 250 мг: по 2 капсулы 2 раза в день» — the first amount
   outside parentheses leads and `perPiece` only reads a mass *after* the count («2 таблетки по 500 мг»), so the strength of the piece is the dose (250 mg
   instead of 500 mg an intake; screen «В сутки: 500 мг» for 1 000 mg).
2. **Rule, dose (#157, child, laryngeal papillomatosis)** `doseOf` / `readClause`: «1 раз в сутки, ежедневно, курс лечения 10 суппозиториев» — the size of the
   course is the dose per intake; screen «Ректально по 10 суппозиториев 1 раз в день» for a child. The same document holds ten more rules of that shape; the other
   child one («курс лечения 10-20 суппозиториев», children with malignancies) also passes the gate.
3. **Rule, cap (#127)** `capsOf`: «Суточная доза не должна превышать 1 каплю … 2 раза в сутки» — the rate of the cap sentence is dropped, the cap is 1 drop a day;
   `checkCaps` marks the instruction's own regimen (1 drop twice a day) as exceeded.
4. **Rule, frequency (#141, child)** `findFrequencies`: «один пакетик каждые 6 часов» is 4 intakes, the next sentence limits the day to 3 sachets and was
   read as a *dose* (`d0` 3, rejected shape), not as a cap, so nothing cross-checks the 4.
5. **Rule, strength (#143, child)** «Детям 0,05 % раствор препарата: от 1 года до 6 лет — по 1-2 капли»: the concentration is no part of the rule and `productTie`
   ties the count to every strength of the instruction's registrations, 0,1 % nasal drops included.
6. **Rule, population (#60, edoxaban)** the weight bound of 30 mg («− У пациентов с массой тела 60 кг или менее …», also renal impairment and P-gp
   inhibitors) stands in dash lines after the sentence; `attachQualifierLines` (`dose-parse.ts`) joins brackets and lower-case continuations only, so a
   55 kg patient is offered 60 mg.
7. **Rule, population (#119, child)** `groupBitsOf` / `populationOf`: «Детям школьного возраста» is child < 18 y with no lower bound; the next sentence
   (preschool, > 1 y, 15 drops) is the default option for a 9- or 15-year-old (probe: `specificity` favours the rule with a lower age) and the 25 drops are
   offered to a 3-year-old beside it.
8. **Screen, route and product (#2, #10, #47, #84, #134, #151)** `routeOfForm` (`prescription-text.ts`): the first pattern of a multi-route form name wins
   («капли глазные назальные и ушные» → «В конъюнктивальный мешок» for an ear-canal sentence; «суппозитории вагинальные и ректальные» → «Вагинально» for «применяют
   ректально»; «…для внутривенного и внутримышечного введения» → «Внутримышечно» for «внутривенная инфузия»; «…для инъекций, инфузий и ингаляций» → «Ингаляционно» for an
   IV maintenance dose), and the form class is the first word of the dosage form (`formClassOf`, `dose-index.ts`; `formTieKey`, `prescription-model.ts`):
   an injectable's instruction is applied to the «лиофилизат … для ингаляций» of colistimethate and an oral instruction to «таблетки вагинальные» of ornidazole.
9. **Screen, strength (#7, ivabradine, borderline)** the count «по 1 таблетке» belongs to the «1 таблетка 5 мг» of the paragraph; the 7.5 mg row prints
   «1 таблетка 2 раза в день» (15 mg a day) as the recommended regimen (`productTie` accepts every strength of the instruction's registrations).
10. **Screen, cap (#87, borderline)** `checkCaps`: 3 × 566,667 mg = 1 700,001 mg > 1 700 mg → «EXCEEDED» for a dose exactly at the limit (no tolerance).

**Separable shapes?** No. Seven different mechanisms in 170 rules, in every stratum except course lengths; dropping all child numbers and all caps would still
leave #26, #60 and #7 in the adult and unstated doses (3/82). A scan of the 2 045 gate-passing rules of the whole index finds each seen text shape rare
(course-size counts 3, piece strength before the count 3, cap with a rate 3, concentration qualifier 6, «школьного возраста» 2; but «каждые N часов» 52 and dash lines
after the sentence 58), so removing these shapes costs little and would not touch the long tail: two audits, 14 causes (RX3 4 rule + 4 screen, RX5 7 rule + 3
screen), no cause twice.
**Recommendation: (b) ship the release with `computedDoses: false`** (`features/prescription/data/prescription-settings.json`, ADR-0025 decision 9): 7 of 170
rules (95 % CI 1.7–8.3 %) carry a wrong dose-relevant field and 15 (5.0–14.1 %) a wrong rule or screen output, among them numbers a doctor would
read as a prescription (10 suppositories, a 4th sachet above the stated maximum, a 0,1 % drop for a 3-year-old). With the setting off the tool keeps its
registry choices, the quoted sentences with «Открыть в инструкции», the blank and the Rp / signa text without numbers. Re-enable after the ten causes above are fixed
at their cause and a third audit of ≥ 150 untouched rules finds none wrong; the 797 + 170 documents are no longer untouched then, so that audit needs the
modules of a later publication or the exclusion of the used ones (frame 464 documents left). Limits of this audit: one auditor, judged against the sentence and
its paragraph (not the whole instruction: contraindications, interactions), one realistic patient per rule, the 4 borderline calls above, the unmarked-indication
share not counted as wrong; the real doctor's selection of form and strength was approximated by every registry row of the instruction's form class.

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
