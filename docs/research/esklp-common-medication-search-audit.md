# ESKLP common-medication search audit

## Scope and evidence

This is a read-only, local audit. The official archive is
`/Users/d/Downloads/esklp_20260828_excel_00001.zip`, SHA-256
`157e9ef147d2f7139d1c81e362f469d92155c4e586c1f46ef993f41ce7ab9a02`. The verified ledger is
`/tmp/minimed-esklp-verify.Xi4mBd/ledger.json`, with `sourceEdition=2026-08-28`, the same
`sourceChecksum`, 3,324 active `esklp-mnn` records, `metadata-only` coverage, and no warnings.
Ledger counts below are measured from that file; record line references use its pretty-printed JSON.

The ledger contains MNN/SMNN, trade-name (TN), and KLP rows joined by MNN. The KLP form, strength,
unit, count, and package fields are the source of the quoted presentations
(`tools/ingest/src/localmed_ingest/esklp_rows.py:324-356`,
`tools/ingest/src/localmed_ingest/esklp_catalog.py:552-718`). “Generated aliases” below means the
aliases the current catalog builder produces from this ledger. A temporary 75-card audit pack was
built from the real records at `/tmp/minimed-common-drugs-audit.DNyba8/common-drugs-lite.db` after
trimming only repeated KLP positions; its MNN, TN, forms, strengths, and aliases remain source-derived.
The pack contains 75 documents, 366 sections, 606 chunks, and 1,421 aliases; its SHA-256 is
`0b3b05df5670cb29ca6688f08980fdc5d8aa8f90077a71c0e17f70af1ce760e6`. This is a measured targeted
audit, not a published or full-corpus ESKLP SQLite build.

## Ledger card facts

Counts are `SMNN / TN / KLP` nested under the canonical MNN record. Form and strength strings are
quoted from the ledger; presentation examples are intentionally limited to those relevant to the
queries.

| Key / canonical MNN card | Ledger coverage | Exact source forms and presentations |
|---|---:|---|
| **P** — `ПАРАЦЕТАМОЛ` (`esklp.mnn.парацетамол`, ledger `:11384347`) | 19 / 158 / 2,160 | `ТАБЛЕТКИ`; `ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ`; `ТАБЛЕТКИ ШИПУЧИЕ`; `ТАБЛЕТКИ РАСТВОРИМЫЕ`; `ТАБЛЕТКИ ПОКРЫТЫЕ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ`; `СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ`; `СИРОП`; `РАСТВОР ДЛЯ ПРИЕМА ВНУТРЬ`; `СУППОЗИТОРИИ РЕКТАЛЬНЫЕ`; `РАСТВОР ДЛЯ ИНФУЗИЙ`. Strength examples include `500 мг`, `200 мг`, `120 мг/5 мл`, `125 мг/5 мл`, `250 мг/5 мл`, `10 мг/мл`, and `0.5 г`. |
| **I** — `ИБУПРОФЕН` (`esklp.mnn.ибупрофен`, ledger `:9637039`) | 17 / 202 / 8,515 | The exact `Нурофен` TN is `ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ`, `200.0 мг`, `шт.`. `Нурофен для детей` is `СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ`, TN `20.0 мг/мл`, normalized source form `СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ (100 мг/5 мл)`, with KLP bottles of 100/150/200 ml; it also has `СУППОЗИТОРИИ РЕКТАЛЬНЫЕ`, `60.0 мг`, KLP pack of 10. Exact TN rows occur at ledger `:9641333` and `:9713207`. |
| **T** — `БУДЕСОНИД`, `БУДЕСОНИД+ФОРМОТЕРОЛ`, `ФОРМОТЕРОЛ` (ledger records `:12325431`, `:12332089`, `:12662987`) | 3 cards | All three queried TNs use `ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ`: `Пульмикорт турбухалер`, `0.1/0.2 мг/доза`; `Симбикорт Турбухалер`, `0.08 мг+0.0045 мг/доза`, `0.16 мг+0.0045 мг/доза`, `0.32 мг+0.009 мг/доза`; `Оксис Турбухалер`, `0.0045/0.009 мг/доза`. KLP examples are dosing inhalers (`ИНГАЛЯТОР`, including `ИНГАЛЯТОРЫ ДОЗИРУЮЩИЕ "ТУРБУХАЛЕР"`) with 100/200, 60/120, and 60 dose presentations in the respective rows. TN rows occur at ledger `:12327128`, `:12332230`, and `:12663381`. |
| **S** — `САЛЬБУТАМОЛ` (`esklp.mnn.сальбутамол`, ledger `:12608298`) | 6 / 39 / 122 | `РАСТВОР ДЛЯ ИНГАЛЯЦИЙ`; `АЭРОЗОЛЬ ДЛЯ МЕСТНОГО ПРИМЕНЕНИЯ ДОЗИРОВАННЫЙ`; `АЭРОЗОЛЬ ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ`; `ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ`; and three prolonged-release tablet forms. Strengths include `0.1мг/доза`, `0.25мг/доза`, `1 мг/мл`, `2 мг/мл`, `100 мкг/доза`, and `250 мкг/доза`. |
| **E** — `ЭРИТРОМИЦИН` (`esklp.mnn.эритромицин`, ledger `:3534947`) | 7 / 31 / 211 | `МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ`; `МАЗЬ ГЛАЗНАЯ`; `ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ`; `ТАБЛЕТКИ КИШЕЧНОРАСТВОРИМЫЕ ПОКРЫТЫЕ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ`; `ТАБЛЕТКИ ПОКРЫТЫЕ КИШЕЧНОРАСТВОРИМОЙ ПЛЕНОЧНОЙ ОБОЛОЧКОЙ`; `ТАБЛЕТКИ ПОКРЫТЫЕ КИШЕЧНОРАСТВОРИМОЙ ОБОЛОЧКОЙ`; `ЛИОФИЛИЗАТ ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИВЕННОГО ВВЕДЕНИЯ`. Strengths include `100 мг`, `200 мг`, `250 мг`, `500 мг`, `10000 ЕД/г`. |
| **C** — `ЦЕФТРИАКСОН` (`esklp.mnn.цефтриаксон`, ledger `:3462577`) | 9 / 129 / 812 | Six injection/infusion powder forms: `ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ИНФУЗИЙ`; `... ДЛЯ ВНУТРИВЕННОГО И ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ`; `... ДЛЯ ВНУТРИВЕННОГО ВВЕДЕНИЯ`; `... ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ`; `... ДЛЯ ИНЪЕКЦИЙ`; and the reversed `... ДЛЯ ВНУТРИМЫШЕЧНОГО И ВНУТРИВЕННОГО ВВЕДЕНИЯ`. Strengths include `250 мг`, `500 мг`, `1000 мг`, `2000 мг`, plus `0.25 г`, `0.5 г`, `1 г`, `2 г`. |
| **F** — `ЦЕФЕПИМ` (`esklp.mnn.цефепим`, ledger `:3378377`) | 5 / 80 / 727 | `ПОРОШОК ДЛЯ ПРИГОТОВЛЕНИЯ РАСТВОРА ДЛЯ ВНУТРИВЕННОГО И ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ` and `... ДЛЯ ВНУТРИМЫШЕЧНОГО ВВЕДЕНИЯ`. Strengths include `500 мг`, `1000 мг`, `2000 мг`, plus `0.5 г`, `1 г`, `2 г`. |

## Query audit

The alias generator starts with the MNN and MNN-plus-full-form aliases, then adds TNs, TN-plus-full-form aliases, and KLP TN-plus-form aliases (`tools/ingest/src/localmed_ingest/catalog_module_builder.py:428-466`). It does not emit the shorter human shorthand from a form fragment or `normalizedFormsStrengths`. Alias matching is exact phrase first, then bounded fuzzy matching (`packages/search-lexical/src/aliases.ts:22-94`; one-token queries can match a token inside a longer alias). MedicalCore’s displayed group heading is the exact TN alias only when it exactly occurs in the query and its canonical term equals the document title; otherwise it stays canonical (`packages/core/src/create-medical-core.ts:180-254`).

| Query and classification | Canonical card(s), source collision, and exact forms | Current alias / MedicalCore inference | Concrete regression pass criterion |
|---|---|---|---|
| `парацетамол` — **MNN** | **P** is the exact single-ingredient card. The ledger has **55** standardized names containing the token: **1** single card, **53** cards whose component-MNN list contains paracetamol, and one additional semicolon-delimited set record (including `ИБУПРОФЕН+ПАРАЦЕТАМОЛ`, `ДИКЛОФЕНАК+ПАРАЦЕТАМОЛ`, `АСКОРБИНОВАЯ КИСЛОТА+ПАРАЦЕТАМОЛ`, and multi-ingredient cold/pain combinations). | Exact `ПАРАЦЕТАМОЛ → ПАРАЦЕТАМОЛ` is generated. Combination aliases may fuzzy-match the one-token query, but an exact canonical alias suppresses the fuzzy branch; FTS still sees the MNN in combination cards (`packages/search-lexical/src/analysis.ts:914-965`). Direct title matching should dominate combination titles. Base heading: `ПАРАЦЕТАМОЛ`. | `esklp.mnn.парацетамол` is rank 1 and in top-5; no fixed combination is above it. Heading is exactly `ПАРАЦЕТАМОЛ`; any form-specific result must show one of the quoted source forms, not invent a presentation. |
| `нурофен` — **TN** | Intended **I** via exact TN `Нурофен`, tablet `200.0 мг`. Plausible TN collisions are **I**, `ИБУПРОФЕН+КОДЕИН` (`Нурофен плюс`), and `ИБУПРОФЕН+ПАРАЦЕТАМОЛ` (`Нурофен Интенсив/Лонг/МультиСимптом`): **3** MNN cards. | Exact `Нурофен → ИБУПРОФЕН` is generated. The direct group can be headed `Нурофен · ИБУПРОФЕН`; combination groups remain canonical. | **I** is rank 1/in top-5; the two combination cards may follow but never outrank the exact TN card. Displayed heading: `Нурофен · ИБУПРОФЕН`. |
| `нурофен суспензия` — **TN + form fragment** | Intended **I** via exact source TN `Нурофен для детей`: `СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ`, TN `20.0 мг/мл`, normalized/KLP `100 мг/5 мл`, bottles 100/150/200 ml. The same TN also has 60 mg suppositories. The short pair `Нурофен суспензия` is not a source TN/form string. | Exact `Нурофен` still expands to **I**. The full generated alias `Нурофен для детей СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ` is too long to be an exact match for this query; no short pair alias is generated. Current heading is `Нурофен · ИБУПРОФЕН`; form relevance comes from body/section FTS, not the heading. | **I** is in top-5, preferably rank 1, with a result/snippet carrying the exact suspension form and `100 мг/5 мл`. Do not display the unverified shorthand as a product name; the desired verified disambiguator is `Нурофен для детей · ИБУПРОФЕН` (or canonical `ИБУПРОФЕН` plus the exact source form). |
| `нурофен детский` — **TN shorthand/descriptor** | Intended **I** via the exact ledger TN **`Нурофен для детей`**, not `Нурофен детский`; no exact TN named `Нурофен детский` was found. Relevant forms are the same children’s suspension (`100 мг/5 мл`, 100/150/200 ml) and 60 mg suppository. The same two combination cards remain plausible for the bare `нурофен` token. | Exact `Нурофен` matches; exact `Нурофен детский` does not. `Нурофен для детей` is not a bounded fuzzy match for the two-token shorthand under the current edit-distance rules. Current heading remains `Нурофен · ИБУПРОФЕН`. | **I** is rank 1/in top-5 and the result exposes the exact TN `Нурофен для детей` plus one exact children’s presentation. Never display `Нурофен детский` as if it were a source TN; use the verified TN in a heading or snippet. |
| `турбухалер` — **device/product-line fragment** | Three canonical cards are genuinely plausible: **T**=`БУДЕСОНИД`/`Пульмикорт турбухалер`; `БУДЕСОНИД+ФОРМОТЕРОЛ`/`Симбикорт Турбухалер`; `ФОРМОТЕРОЛ`/`Оксис Турбухалер`. All are dosing inhaler powder, with the exact strengths in the card table. | No standalone `Турбухалер` alias is emitted. The three full TN aliases do contain the exact token, so the current one-token fuzzy fallback should match all three and add their canonical MNN terms; headings remain canonical because the match is fuzzy, not an exact full alias. | All three canonical IDs are in top-5 (ideally top-3), with their exact TN and `ПОРОШОК ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ` visible. Do not collapse the query to one brand or display a fabricated `Турбухалер · ...` heading. |
| `турбухаер` — **typo of device fragment** | Same three cards as `турбухалер`; the typo omits `л` from `турбухалер`. | No exact typo alias is generated. The full TN aliases contain `турбухалер`, and `isCloseToken` permits one bounded edit for this token length (`packages/search-lexical/src/normalize.ts:192-200`), so current fuzzy alias inference should resolve the typo to all three MNNs. Heading remains canonical. | Same three canonical IDs in top-5 as the correctly spelled query; diagnostics should record a fuzzy alias match, while the UI shows a verified TN/canonical card rather than the typo as a source term. |
| `сальбутамол` — **MNN** | **S** is exact; six plausible competing MNN cards contain it: `АМБРОКСОЛ+ГВАЙФЕНЕЗИН+САЛЬБУТАМОЛ`, `БРОМГЕКСИН+ГВАЙФЕНЕЗИН+САЛЬБУТАМОЛ`, two further bromhexine/guaifenesin/menthol combinations, `БУДЕСОНИД+САЛЬБУТАМОЛ`, and `САЛЬБУТАМОЛ+ТЕОФИЛЛИН`. | Exact `САЛЬБУТАМОЛ → САЛЬБУТАМОЛ` is generated; the self-alias is not used as a presentation heading. | `esklp.mnn.сальбутамол` is rank 1/in top-5; no combination is above it. Heading is exactly `САЛЬБУТАМОЛ`. |
| `сальбутамол аэрозоль` — **MNN + form fragment** | Intended **S**. The direct card has the exact forms `АЭРОЗОЛЬ ДЛЯ МЕСТНОГО ПРИМЕНЕНИЯ ДОЗИРОВАННЫЙ` and `АЭРОЗОЛЬ ДЛЯ ИНГАЛЯЦИЙ ДОЗИРОВАННЫЙ`, with `0.1мг/доза`, `0.25мг/доза`, `100 мкг/доза`, and `250 мкг/доза`. Six combination cards remain plausible MNN collisions. | Exact MNN alias is present; exact short pair `САЛЬБУТАМОЛ АЭРОЗОЛЬ` is not. The builder emits the longer MNN-plus-full-form aliases, so current heading is canonical and aerosol matching is FTS/body evidence. | **S** is rank 1/in top-5 and its displayed source text contains one of the two exact aerosol forms and a matching dose unit. Do not label the heading `САЛЬБУТАМОЛ АЭРОЗОЛЬ` unless that exact alias is deliberately added; canonical `САЛЬБУТАМОЛ` is safe now. |
| `эритромицин` — **MNN** | **E** is exact; one plausible competing card is `ЦИНКА АЦЕТАТ+ЭРИТРОМИЦИН`. The direct card covers ointments, eye ointment, tablets, and IV lyophilisate, with 100/200/250/500 mg and 10,000 ЕД/г strengths. | Exact `ЭРИТРОМИЦИН → ЭРИТРОМИЦИН` is generated; self-alias does not change the heading. | `esklp.mnn.эритромицин` is rank 1/in top-5, ahead of the zinc-acetate combination. Heading: `ЭРИТРОМИЦИН`. |
| `цефтриаксон` — **MNN** | **C** is exact; one plausible competing card is `ЦЕФТРИАКСОН+СУЛЬБАКТАМ`. Direct forms are the six injection/infusion powders in the card table. | Exact `ЦЕФТРИАКСОН → ЦЕФТРИАКСОН` is generated. Existing fixture ranking explicitly protects an exact ceftriaxone title over a related antibiotic (`packages/core/src/query-group-ranking.test.ts:99-112`). | `esklp.mnn.цефтриаксон` is rank 1/in top-5 and the fixed combination follows. Heading: `ЦЕФТРИАКСОН`. |
| `цефепим` — **MNN** | **F** is exact; one plausible competing card is `ЦЕФЕПИМ+СУЛЬБАКТАМ`. Direct source forms are the two IV/IM powder forms, with 500/1000/2000 mg and 0.5/1/2 g presentations. | Exact `ЦЕФЕПИМ → ЦЕФЕПИМ` is generated. | `esklp.mnn.цефепим` is rank 1/in top-5, ahead of the fixed combination. Heading: `ЦЕФЕПИМ`. |
| `цефипим` — **typo of MNN** | Intended **F**; same one combination competitor as `цефепим`. | The typo itself is not an alias, but the one-substitution typo is within current fuzzy matching for the exact canonical alias. The fuzzy branch should add `ЦЕФЕПИМ`; because exact-title matching sees the misspelled query, direct-over-combination order is not guaranteed by the current ranker. | Fuzzy diagnostics must resolve to **F**, with `esklp.mnn.цефепим` rank 1/in top-5 and the combination below it. Heading must be the verified canonical `ЦЕФЕПИМ`, never the typo. |

## Measured MedicalCore result

All 13 regression queries passed through the public `MedicalCore.search()` seam against the temporary
real-record pack. Direct `ПАРАЦЕТАМОЛ`, `САЛЬБУТАМОЛ`, `ЭРИТРОМИЦИН`, `ЦЕФТРИАКСОН`, and `ЦЕФЕПИМ`
cards rank first, ahead of fixed combinations; `цефипим` resolves to `ЦЕФЕПИМ`. `нурофен` returns the
exact TN row with tablets 200 mg; `нурофен суспензия` returns `Нурофен для детей` with suspension
100 mg/5 ml; `нурофен детский` displays the source TN rather than inventing a new one. Both
`турбухалер` and `турбухаер` return exactly the three source-backed cards for budesonide,
budesonide+formoterol, and formoterol, with a Turbuhaler TN in each first snippet. Form-specific
queries for salbutamol aerosol and erythromycin ointment expose the matching source form, and snippets
do not leak `<details>`/`<summary>` markup.

## Prioritized regression-query set

1. **P0 — ambiguity and typo:** `турбухалер`, `турбухаер`; require all three Turbuhaler MNN cards in top-5 and canonical/verified headings.
2. **P0 — TN plus children’s form:** `нурофен`, `нурофен суспензия`, `нурофен детский`; require exact `Нурофен для детей` evidence for the latter two and no invented `Нурофен детский` source label.
3. **P0 — fixed-combination collision:** `парацетамол`; require the single MNN card above all 53 fixed combinations.
4. **P1 — MNN plus aerosol form:** `сальбутамол`, `сальбутамол аэрозоль`; require the direct card and an exact aerosol form/dose in the result evidence.
5. **P1 — typo and fixed-combination guards:** `цефепим`, `цефипим`, `цефтриаксон`, `эритромицин`; require direct canonical cards above their one known combination competitor.

No full 3,324-card SQLite result or production-pack publication is claimed in this audit.
