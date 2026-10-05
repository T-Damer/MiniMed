# ADR-0023: Labelled same-substance instruction fallback

- Status: accepted; implemented in the drug screen (MED3).
- Decision: project owner, 2026-10-05 (decisions D1 and D2 of
  [medication-instructions-2026-10-05.md](../research/medication-instructions-2026-10-05.md); D1 was
  delegated to the coordinator and decided there).
- Related: [DRUG_KNOWLEDGE_PIPELINE.md](../DRUG_KNOWLEDGE_PIPELINE.md),
  [GRLS_INGESTION_HANDOFF.md](../GRLS_INGESTION_HANDOFF.md), [REFERENCE_SOURCE_POLICY.md](../REFERENCE_SOURCE_POLICY.md).

## Context

An official Russian instruction exists for 43.7 % of the 604 213 ЕСКЛП product positions
(12 666 of 29 300 registrations). The ГРЛС hands out its files slowly, so most of the remaining
registrations will not have an own text for months. For most of them another registration of the
same МНН, dosage form and strength already has an official text in the shipped modules. A doctor
who opens a product without its own text sees only a plaque today.

The invariants stay: generated or inferred text never replaces source material; no silent
substitution; provenance is exact; nothing is merged.

## Decision

A product without its own instruction document may show **an existing document of another
registration of the same МНН**, as a pointer, never as the product's own text.

### Data model

- Build-time asset `apps/app/src/features/medications/substance-fallback.json` (schema version 1),
  produced by `tools/ingest/scripts/build_substance_fallback.py` from the released ЕСКЛП cards, the
  documents the released instruction modules actually hold and the ГРЛС registry export. It is a
  generated file: nobody edits it by hand, it is rebuilt with every instruction-module refresh and
  its `basis` records the ЕСКЛП edition, the registry edition and a digest of the registrations
  that had a text.
- `registrations[<registration number>] -> group`, `groups[group] = { level, donors }`, where a
  donor is `[registration number, flags]`, ranked, at most four per registration. Only
  registrations **without** an own document appear.
- The app validates the asset with a schema at the package boundary and treats a donor as usable only
  when (a) the donor registration belongs to the same ЕСКЛП МНН card as the product and (b) the
  donor's document is installed (found by the existing registration-number index). Otherwise the
  entry is ignored and the product behaves as before. The matching is never repeated at runtime.

### Matching rules

1. A donor is a registration of the **same ЕСКЛП МНН card**. A card is exactly one standardized
   МНН (a combination is its own card), so a fallback never crosses an МНН, and never crosses a
   combination boundary.
2. **Level 1**: same dosage form and same strength. «Same» means the registry's own grouping (the
   same СМНН node) with a stated strength, or an identical normalized form string and an
   identical canonical strength (`0,5 г` = `500 мг`; components of a combination keep their order).
   A strength the registry does not state («НЕ УКАЗАНО») is never «the same strength».
3. **Level 2**, only when level 1 has no donor: the same **form class** (the collector's
   `dosage_form_class`: oral-solid, parenteral, topical, …; a form the classifier cannot place
   matches only exactly) with a different strength, an unstated strength or a different wording of
   the form. Each difference is a flag on the donor: `1` strength differs, `2` strength not stated,
   `4` form wording differs. A different form class never matches.
4. **Ranking** of donors, deterministic: fewest differences; source class ГРЛС before
   `manufacturer-site`; professional text before leaflet (ОХЛП, national instruction, unknown,
   leaflet); a foreign holder (the originator proxy) first; earliest registration date; registration
   number.

### What the screen shows

- The «Инструкция» tab opens the donor's document unchanged (its own source block stays: kind,
  edition, source link, fetch date, OCR note).
- Above it a fallback block, in this order: the label «Инструкция другого производителя: то же
  вещество, форма и дозировка» (level 1) or «Инструкция другого производителя: то же вещество, есть
  отличия» with the warning «Дозировка отличается: проверьте дозы по своему препарату» (level 2;
  coordinator correction 2026-10-05: the level-1 label must not claim the same strength there); the source product (trade name, holder, form and
  strength as the registry states them) and its registration number; a note that it is not this
  product's instruction. A level-2 flag of an unstated strength reads «Дозировка в реестре не
  указана: проверьте дозы по своему препарату», a different form wording «Лекарственная форма
  отличается: проверьте дозы и способ применения по своему препарату».
- The product's own source line never claims ГРЛС for a fallback. Texts are not merged, shortened or
  rewritten; the product's own short card (ЕСКЛП, Allmed) stays under «Кратко».
- A product with an own document is never shown a fallback. When the group's instruction module is
  not installed, the existing download offer is shown, not a fallback.

### Source class `manufacturer-site` (D2)

The 240 registrations matched on holders' sites (M1: number in the text, number on the product page,
or `label-unique`: name, form and holder, no number printed) ship as their own module and source
class. Their documents carry the match method in provenance (`registrationMatches`,
`matchMethod`) and the drug screen names it («сайт производителя …, сопоставлено по названию, форме и
держателю»). An own registration match of this class is shown as the product's own text, with that
label; a ГРЛС text of the same registration outranks it. They may serve as donors, behind ГРЛС ones.
Ambiguous matches (several candidate registrations) are not attached to any registration.

## Excluded

- A fallback across different МНН or form classes; a fallback from a text in another language.
- Machine-translated foreign labels (D5), Belarus and Kazakhstan registers (D4), official requests
  (D3): not part of this decision.
- Merging two documents, inferring a dose, or choosing a donor by text similarity.
- Calculators and the clinical parser reading a fallback text: it stays reading material
  (`trustedDoseData: false` is unchanged).

## Consequences

- Positions with an official Russian text to read: own 43.7 % → own + level 1 (strength stated)
  88.7 % → own + level 1 + level 2 97.3 % (measured in `docs/CURRENT_STATE.md` «MED3»).
- The fallback is only as current as the asset: a collector window or module refresh needs the
  rebuild step (`docs/GRLS_INGESTION_HANDOFF.md`). A stale donor that is no longer installed simply
  stops applying.
- The label is the safety control, not a guarantee: generics differ in indications, doses and
  excipients. The text always tells the doctor to check against the product's own labelling.
