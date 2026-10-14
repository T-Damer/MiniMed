# ADR-0025: Dose-rule index and prescription draft

- Status: accepted; implemented in the prescription tool and the search card (RX1); amended by the confidence gate (RX2, decision 7) and by the fixes after the independent audit and the release switch (RX4, decisions 8–9).
- Decision: project owner, 2026-10-13 («About drugs — we need semantics on them … make a prescription»).
- Related: [REFERENCE_SOURCE_POLICY.md](../REFERENCE_SOURCE_POLICY.md), [ADR-0023](0023-same-substance-instruction-fallback.md),
  [research/dose-rules-2026-10-14.md](../research/dose-rules-2026-10-14.md).

## Context

The released instruction modules hold the official «Способ применения и дозы» of 9 216 documents. A doctor who wants a
dose for a 20 kg child reads the section by eye. The product invariants stay: source text is never replaced by generated
text, provenance is exact, no verdict is worded by the app, and everything works offline.

## Decision

1. **A build-time dose-rule index** (`apps/app/src/features/prescription/data/dose-rules-index.json`, schema version 1,
   contract `packages/contracts/src/dose-rules.ts`) written by `scripts/build-dose-rules.ts` (`bun run content:dose-rules`)
   from the published instruction modules (SHA-256 checked against the catalog like INT1 / SAFE1 / CMP1) and the ЕСКЛП МНН
   cards. It holds, per instruction, the **structured rules and the offsets of the sentence they were read from plus a
   checksum of the section — no instruction text**. At run time the sentence is cut from the installed instruction; when the
   checksum of the installed section differs, the same pure parser (`dose-parse.ts`) re-reads the installed text. A sentence
   that is not parsed is not a rule: the tool shows the quoted section instead. Lazy asset (3.1 MB, 725 kB gzip).
2. **Rules are deterministic pattern reads**, never a model: population (age bounds, weight, group words, conditions),
   dose per intake or per day (mg, ml, IU, U, mmol, drops, doses, pieces; per kg or per m²), frequency, duration, route,
   caps (single / daily / course). Renal, hepatic and dialysis rules and sentences naming no population are **quoted only**;
   a sentence naming no population is computed for adults only and never when the dose is per kg.
3. **Computation is arithmetic on a rule**: per-kg scaling, BSA (Mosteller), rounding to the registry strength (a half tablet
   only when the instruction says a tablet may be divided; at most ±10 %, decision 8), quantity and packages from the ЕСКЛП pack sizes. Caps are shown
   as a neutral comparison, with no verdict. No rule for the patient: «в инструкции доза для этого пациента не указана» and the
   quoted section.
4. **A prescription draft** (`packages/contracts/src/prescription.ts`): items (card slug, form, strength, chosen rule key,
   intakes, course, pack, editable Rp / signa), patient facts and the blank. Stored as the vault blob
   `prescription-draft/<patientId>` (anonymous drafts in localStorage); «Сохранить» writes a `start` medication event per drug
   to the patient. Validated at the storage boundary; a damaged draft is reported, never half-read.
5. **Output goes through the existing forms engine**: 107-1/у (up to three names; one name for ATC N05A/N05B/N05C/N06A) and
   148-1/у-88 (one name), plus a «Рецепт» text (copy / share / print). The registry holds no controlled-substance flag, so the
   choice of the blank is the doctor's.
6. **The search card** (`DoseCard`) is additive: it never changes ranking and every exact-name gate is untouched.
7. **Confidence gate (RX2, owner 2026-10-14: «a wrong computed dose is unacceptable; a missing one is fine»).** A random sample of
   200 rules measured the RX1 parser at 38.5 % wrong in some field. Every rule now carries a **shape** (`gc`, stamped at build time
   by `classifyRule` in `dose-gate.ts`) made of its evidence: where the population comes from (own clause, a plain heading line, none),
   absolute / per kg / per m², frequency stated or not, cap or duration kind, and a list of rejections (tables, stages and titration,
   alternatives, borrowed populations, sex / pregnancy, other-drug doses, typos, derived piece strengths …). **Only shapes whose family
   has ≥ 9 hand-judged rules on a development sample, none wrong (`GATE_ALLOWED`, `GATE_MIN_JUDGED`), produce numbers**; every other
   sentence that may be about the patient is shown quoted, with «Открыть в инструкции», and computes nothing (`ItemAnalysis.quoted`).
   The development sample is separate from the blind precision set (never tuned on) and the gate's own figures are reported with
   binomial confidence intervals by `bun run benchmark:dose-precision`. Raising coverage means judging more rules of a family, not
   loosening a cue. DEV format policy applies: the index gained `gc`; old indexes are rebuilt.
8. **Fixes at the cause after the independent audit (RX4, 2026-10-14).** The audit of RX3 (120 gate-passing rules from untouched
   documents: 4 wrong = 3.3 %, CI 0.9–8.3 %, plus output defects) is answered by changing the parser, the gate and the arithmetic,
   not by narrowing a shape:
   - a weight or an age on the line after the sentence («(масса тела 21-30 кг)», «(до 18 лет), масса тела ≥41 кг») is joined to the
     sentence (`attachQualifierLines`: a bracket or a lower-case continuation that prints an age or weight bound), so the population is
     read from both and the quote shows both; when the bracket may head the next sentence (that one carries a dose of its own) the
     sentence is rejected (`GateInput.qualifierFollows`);
   - a clause that names only a group («ребенок», «Взрослые:») is read within the printed age and weight bounds of the heading it
     stands under (`narrowedBy` in `inheritedBy`; the clause's group, the heading's bounds); conditional
     co-medication clauses («если … не принимает вальпроат», «пациентам, принимающим …») are rejection cues of every rule kind
     (`CO_MEDICATION`);
   - a cap written as a range keeps both ends (`d0`, `d1`) and is rejected; the range test also covers «от N до M» (`CAP_RANGE`);
   - a day's total of pieces smaller than the number of intakes (`суточные дозы: 1–2 таблетки 2–3 раза в сутки`) is rejected as an
     impossible reading;
   - **only gate-passing caps are compared** (`checkCaps(…, trusted)` with `ResolvedRule.computable`); a rejected cap is quoted;
   - the route of the sign comes from the dosage form's own wording when the sentence names none (`routeOfForm`: rectal, vaginal,
     sublingual, lozenge «Рассасывать», eye / ear / nose, topical), a suppository the wording does not place gets no route; what the
     instruction counts keeps its own name (`PIECE_KINDS` told apart: teaspoon, tablespoon, dessertspoon, measuring spoon, cap, cup,
     ampoule, vial), so a syrup is «1 столовая ложка» (with the instruction's «5 мл» beside it), never «1 шт.»;
   - rounding to a registry strength moves a dose by at most `ROUNDING_TOLERANCE_PERCENT` = 10 %; beyond it the dose stays a mass, no
     count of pieces or millilitres is shown, no quantity is computed, and the screen says why;
   - the counts an instruction prints («по 2 таблетки», «5 мл», «20 капель») are valid for **the registry rows of the instruction's own
     registrations** (index field `ps`, built from the registration numbers of the ЕСКЛП positions); for another strength a rule in
     milligrams is recomputed from the mass, any other rule yields `PlanStatus` `strength-mismatch` (no count, the sentence quoted);
     strengths compare by what they say (a percentage is a concentration, the parts of a combination are a set, coated and plain
     tablets are one product);
   - **indication-bound sentences** (a phrase «при амебиазе», a heading «Для лечения», or one of several regimens of one population in
     the instruction) carry the range of their indication (`i`) or the mark `sv`; the screen prints the indication beside the number
     and offers the instruction's general sentence first (`RuleOption.bound`).
   DEV format policy applies: the index gained `i`, `sv`, `ps`; `PIECE_KINDS` gained entries (the old `spoon` became `teaspoon`);
   the index is rebuilt. The audit file is no longer an independent measure (its 4 wrong rules were fixed); a fresh audit of at
   least 150 rules from untouched documents follows (research note §2). The family evidence of decision 7 now pools every
   hand-judged set (development, blind, fresh and audit), still ≥ 9 judged and none wrong per family.
9. **A release switch for computed numbers (RX4).** `features/prescription/data/prescription-settings.json` (`{"computedDoses": true}`,
   validated by `parsePrescriptionSettings` in `packages/contracts/src/prescription.ts`, read as `PRESCRIPTION_SETTINGS`) turns every
   computed number off at once: with `false` `analyzeItem` treats each dose, cap and duration sentence as quoted-only (`quoted`,
   `ItemAnalysis.numbersOff`), nothing is computed (no single / daily dose, units, cap comparison, quantity, packages), and the
   registry choices, the quoted sentences with «Открыть в инструкции», the safety quotes, the blank, the Rp / signa text and the
   «Рецепт» modal stay. Default ON. A release ships with numbers off if the next audit fails; the setting is release data, not a user
   preference, and the code never branches on a drug id.

## Consequences

- DEV format policy applies (breaking changes allowed): the index is rebuilt whenever the modules or the parser change; no
  legacy adapter.
- A wrong reading is the main risk; mitigations are the quoted sentence next to every number, the conservative skips listed
  in the research note, the benchmark `bun run benchmark:dose` (wrong answers must be 0) and the rule that an unreadable
  sentence yields no rule.
- Not clinical review: rules are machine-extracted from the instruction text and say so on screen by quoting it.
