# ADR-0025: Dose-rule index and prescription draft

- Status: accepted; implemented in the prescription tool and the search card (RX1).
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
   only when the instruction says a tablet may be divided), quantity and packages from the ЕСКЛП pack sizes. Caps are shown
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

## Consequences

- DEV format policy applies (breaking changes allowed): the index is rebuilt whenever the modules or the parser change; no
  legacy adapter.
- A wrong reading is the main risk; mitigations are the quoted sentence next to every number, the conservative skips listed
  in the research note, the benchmark `bun run benchmark:dose` (wrong answers must be 0) and the rule that an unreadable
  sentence yields no rule.
- Not clinical review: rules are machine-extracted from the instruction text and say so on screen by quoting it.
