# Content and data plan

Master roadmap for what goes into the content bank, in what order, and from what source. Each category
below has its own detailed doc; this file is the cross-category priority list referenced by
[CURRENT_STATE.md](CURRENT_STATE.md)'s "Ordered next work toward 1.0", item 1.

Rule for every category: grow the bank before spending more effort on retrieval/model work on top of it —
see the discussion that produced this doc. A thin, well-sourced bank beats a fast search over an empty one.

Detailed shortlist from the private library and OCR inventory: [CONTENT_BACKLOG.md](CONTENT_BACKLOG.md).

## Categories

| Category | Status | Source strategy | Detail doc |
| --- | --- | --- | --- |
| Clinical recommendations | 744 official recommendations synced, largest existing asset | Ministry API, official structured JSON | [CURRENT_STATE.md](CURRENT_STATE.md) |
| Regulatory acts | 32 drafted, `publicationState: local-dev`, unpublished | Official RF orders/laws | [REGULATORY_PILOT.md](REGULATORY_PILOT.md) |
| Pediatric norms / growth | WHO standards reference-carded but no calculator yet; private textbooks surveyed | WHO Child Growth Standards + cited textbook pages | [LITERATURE_BANK.md](LITERATURE_BANK.md), [CALCULATORS.md](CALCULATORS.md) |
| Calculators | Built-in `unit-conversion` plus seven downloadable DB modules (core-clinical, obstetrics-gynecology, psychology, gastroenterology, neonatology, pediatrics, emergency); Hadlock biometry stays TS-only; z-score/percentile spec written, not built | Authoritative source or cited book page | [CALCULATORS.md](CALCULATORS.md) |
| Assessments/questionnaires | Schema-defined clinical scales and psychology/obstetric instruments in downloadable tool modules only | Independent authored questions or validated instrument | [ASSESSMENTS.md](ASSESSMENTS.md) |
| Medications | one-drug pipeline proof (Miramistin), 9 pilot instructions syncing | Official GRLS + instruction PDFs | [DRUG_KNOWLEDGE_PIPELINE.md](DRUG_KNOWLEDGE_PIPELINE.md) |
| Diets (лечебные столы) | №1/5/7/8/9/15 + standard-diet-system drafted, `local-dev`, pediatric scope not reviewed | `reference` category (`content/reference-rf-pilot/`); relaxed sourcing (web/clinic sites), see below | this doc |
| Vaccination calendars | referenced by `order-1122n-vaccination-calendars.md` (regulatory pilot), not a standalone reference/calculator | Official immunization schedule order | [REGULATORY_PILOT.md](REGULATORY_PILOT.md) |
| Nutrition/feeding norms | candidate sources found (`ПДБ/PITANIE.pdf`, `ПДБ/кормление_1год.pdf`, `Нутрициология`), not extracted | Cited textbook page | [LITERATURE_BANK.md](LITERATURE_BANK.md) |

## Diets (лечебные столы / Pevzner system)

New category, added on request. The classical Pevzner therapeutic diet-table system (столы №0–15) is
still referenced in Russian clinical practice — diabetes (№9), hepatobiliary disease (№5), renal disease
(№7), GI ulcer disease (№1), obesity (№8), general/recovery (№15), and others. Several already-drafted
regulatory/clinical documents touch conditions where a diet table is the standard adjunct (pediatric
endocrinology/diabetes in `order-583n-pediatric-endocrinology.md`, GI conditions in the recommendation
corpus), so this fills a real cross-reference gap rather than adding an unrelated feature.

**Category confirmed**: this belongs in the `reference` content category — displayed in the UI as
"Нормы и расчёты" ([ModuleCatalogView.tsx:237-239](../apps/app/src/features/modules/ModuleCatalogView.tsx:237)),
physically `content/reference-rf-pilot/`, the same directory already holding the WHO growth-standards card
and the eGFR calculator references. No new category or navigation entry needed.

**Sourcing rigor relaxed for this category, by explicit user decision**: the numbered Pevzner tables
(0-15) were officially superseded by the standardized-diet system under Ministry of Health order №330
(2003) — they remain in wide informal/off-label clinical and patient use, but are not a currently regulated
document class, so this category does not need the same single-authoritative-source bar as calculators or
regulatory acts. General medical/nutrition web sources (including hospital and clinic sites) are an
accepted source here.

**Drafted, complete set (2026-08-11)**: 7 cards written to `content/reference-rf-pilot/`, all
`authorityTier: third-party` except the standard-diet-system card (`clinical-guideline`, since that one
traces to the actual Ministry order rather than lifestyle sites), all `editionVerified: false` (matches the
relaxed-rigor decision above — flagged honestly rather than dressed up as authoritative), still
`publicationState: local-dev` pending rights/lint review like the rest of this pilot corpus. Lints and
builds cleanly (`medbase lint`/`medbase build --input content/reference-rf-pilot`, 17 documents, 0 errors).

- [`diet-table-1-gastric-ulcer.md`](../content/reference-rf-pilot/diet-table-1-gastric-ulcer.md) — стол №1
- [`diet-table-5-hepatobiliary.md`](../content/reference-rf-pilot/diet-table-5-hepatobiliary.md) — стол №5,
  primary source [stol5.ru](https://stol5.ru/) (user-designated)
- [`diet-table-7-renal.md`](../content/reference-rf-pilot/diet-table-7-renal.md) — стол №7
- [`diet-table-8-obesity.md`](../content/reference-rf-pilot/diet-table-8-obesity.md) — стол №8
- [`diet-table-9-diabetes.md`](../content/reference-rf-pilot/diet-table-9-diabetes.md) — стол №9, primary
  source [stol9.ru](https://stol9.ru/) (same publisher family as stol5.ru)
- [`diet-table-15-general.md`](../content/reference-rf-pilot/diet-table-15-general.md) — стол №15
- [`standard-diet-system.md`](../content/reference-rf-pilot/standard-diet-system.md) — the current
  regulated replacement (ОВД/ЩД/ВБД/НБД/НКД), sourced from Order №330 (2003) Приложение №4, Таблица 1,
  read via a mirror ([fiziolive.ru](https://fiziolive.ru/html/pitanie/prikaz-pit/prikaz-330-2003-tabl1.html))
  since consultant.ru/garant.ru don't serve appendix tables to a plain fetch; `officialSourceUrl` points at
  the actual consultant.ru order page, not the mirror.

Each Стол card and the standard-diet-system card explicitly cross-reference each other by exact
`short_title` text (e.g. "Стол №5", "Система стандартных диет") so the app's existing phrase-matching
auto-linker turns them into clickable links in both directions once opened — see "Explicit cross-linking"
below for why this needed a real code change, not just content.

Aliases added to `content/reference-rf-pilot/aliases.yaml`: `стол 1/5/7/8/9/15`, `диета номер 5/9`,
`приказ 330`, `ОВД диета`.

## Print and share (2026-08-11)

Reference-category documents (`sourceType: medical_reference`) — which includes every diet/standard-diet
card above — can now be printed and shared from the reader, per explicit request:

- New module: [`apps/app/src/features/library/document-print.ts`](../apps/app/src/features/library/document-print.ts).
  Renders the document's actual structured sections (real `<h2>`-`<h6>`, `<ul>`/`<ol>`, `<table>` — not a
  flattened plain-text dump like the existing calculator/assessment print) into a popup window, styled with
  the app's own "paper archive" theme (`--theme-accent` green, Georgia serif headings, warm parchment rule
  lines) rather than the plain/utilitarian look the two existing print paths have. QR-code + link footer,
  same pattern as `assessment-print.ts`.
- Share reuses the established Web Share API / clipboard-fallback pattern (`shareDocument`), returns
  `'shared' | 'copied'` exactly like `shareAssessmentRecord`/`shareCalculationRecord`.
- Wired into `OfficialDocumentReader.tsx`: two buttons in the paper header, gated to
  `sourceType === 'medical_reference'` (not shown on every document type — clinical-recommendation
  documents can be very long; printing those wasn't asked for and isn't verified safe to popup-render in
  one shot).
- Deliberately reuses the existing popup + `window.open()`/`window.print()` mechanism (already shipped and
  presumably field-tested for calculators/assessments on this app's Android/Capacitor target) rather than
  inventing a new in-page print mechanism — safer than an unverified alternative given no physical-device
  testing was available this session.
- Tests: `apps/app/src/features/library/document-print.test.ts` (3 tests — structured markup, blocked-popup
  fallback, share/clipboard contract). Full `bun run typecheck` and the `library` test suite pass.

## Explicit cross-linking (2026-08-11)

The app's document-to-document linking is **implicit phrase-matching**, not authored markdown links: if a
document's prose contains another document's exact `title`/`shortTitle` text, it becomes clickable
(`apps/app/src/features/library/document-medication-links.ts`). Two gates blocked this for `reference`
documents before today:

- `linkableSourceTypes` in `document-medication-links.ts:130-135` — didn't include `medical_reference` as a
  valid *link target* type. Fixed: added it.
- `showDocumentLinks()` in `OfficialDocumentReader.tsx:76-83` — didn't allow a `medical_reference` document to
  *show* outgoing links at all. Fixed: added the same condition.

**A real content bug surfaced and got fixed while verifying this**: Russian grammatical case broke the
literal substring match — "заменена **Системой** стандартных диет" (instrumental case) does not contain
the nominative phrase "Система стандартных диет" as a substring, so the matcher (which does no
lemmatization) would have silently failed to link. Reworded all 6 Стол cards to include the nominative
short_title verbatim. Verified against the actual matching function
(`findPhraseIndex`/`normalizePhrase`) run against the real compiled chunk text from a local
`medbase build`, not just by inspection — all 6 forward links (Стол → Система стандартных диет) and all 6
reverse links (Система стандартных диет → each Стол) confirmed matching.

Open questions before any of this moves further:

- **Pediatric scope not yet reviewed** — every drafted card explicitly limits itself to adults/adolescents
  in its "Ограничения" section pending a pediatric-specific pass; not verified against any pediatric
  endocrinology/GI/nephrology source yet.
- **Shape delivered as prose + lists, not yet a structured allowed/excluded-food table** — the
  references-as-table UI requirement from [CALCULATORS.md](CALCULATORS.md) is not yet applied to the diet
  cards' food lists themselves (only to the print/reader table-rendering *mechanism*, which now exists and
  works for any future table content in this category).
- **Now published as a real module (2026-08-11)**: `minimed.reference.pediatrics.ru` in
  `apps/app/src/features/modules/catalog.preview.json` flipped from `releaseState: "planned"` (empty
  `artifacts`/`documents`) to `"published"`, `version: "0.1.0-preview.1"`, pointing at
  `apps/app/public/content/modules/minimed-reference-pediatrics-0.1.0-preview.1.db` (913,408 bytes, 17
  documents) via the same `raw.githubusercontent.com/.../public/content/modules/` pattern already used by
  `minimed.regulatory.pediatrics.ru`. Verified mechanically, not just by inspection:
  `local-artifact-checksums.test.ts` recomputes the file's sha256 and compares it against the catalog entry
  — this test passed, confirming the checksum/size are correct, and the catalog still parses cleanly through
  `ContentModuleCatalogSchema.parse()` (the full `apps/app/src/features/modules` test suite — 9 files, 25
  tests — passed). Still not click-tested in a running browser session.

Next step: identify and cite a source before writing any content, same gate as every other category here.

## Declarative calculator schema (2026-08-11)

Investigation found calculator+assessment bundled content is ~100KB total — two orders of magnitude below
one real content module (5.8MB) — so the original "download to save bundle size" framing didn't hold up.
The actual want: a declarative calculator format, the same way `AssessmentDefinition` already is pure data
scored generically by `scoreAssessment()`. Calculators today are the opposite — bespoke hand-written TS
functions per calculator in `clinical-calculations.ts`. Full plan:
`/Users/d/.claude/plans/memoized-tinkering-starfish.md`.

Shipped:

- **`CalculatorSchemaSchema`** ([packages/contracts/src/calculator-schema.ts](../packages/contracts/src/calculator-schema.ts)) —
  Zod schema for inputs, ordered calculation steps (each a labeled expression + unit; some marked
  `isOutput`), sources, population/limitations. Mirrors the `ContentModuleCatalogSchema` pattern already
  used for content modules.
- **A restricted expression language**, not `eval`/`new Function`
  ([apps/app/src/features/calculators/calculator-expression.ts](../apps/app/src/features/calculators/calculator-expression.ts)) —
  arithmetic, comparisons, `min max abs sqrt round pow`, a `cond(test, then, else)` piecewise construct for
  branch logic (e.g. CKD-EPI's sex-dependent κ/α), variable references to declared inputs/earlier steps.
  This is the hard safety requirement: a downloaded or future LLM-authored calculator must never gain code
  execution, only the operations in this small hand-rolled recursive-descent parser/evaluator.
- **Generic engine** (`evaluateCalculatorSchema` in `calculator-schema-engine.ts`) — validates inputs
  against declared bounds, evaluates steps in order, produces the same `CalculationTraceStep[]` shape the
  UI already renders.
- **Proof-of-concept migration**: BSA (Mosteller) and adult eGFR (CKD-EPI 2021, the more structurally
  complex one — exercises `cond()` for sex-dependent coefficients) rewritten as schema instances in
  `calculator-schema-catalog.ts`. Regression-tested against the existing hardcoded functions across
  multiple real input combinations (different ages/sexes/creatinine units) — outputs match to full
  floating-point precision, not just "close enough."
- **Validation/lint**: `validateCalculatorSchema` (Zod parse + per-step expression parse + unknown-variable/
  forward-reference detection) and a CLI, `bun run content:lint:calculator -- <file.json>`
  ([scripts/lint-calculator-schema.ts](../scripts/lint-calculator-schema.ts)) — this is the concrete piece
  that makes "an LLM emits a schema, validate it before trusting it" possible next.

**Second batch (2026-08-11)**: wired the schema path into the live `CalculatorsView.tsx` UI (generic
schema-driven form renderer — `kind: 'number' | 'select' | 'date'` fields, plus a `<select>` fallback for
any `number` input that declares `options`, e.g. Bishop score's sub-scores) and migrated pediatric eGFR
(Schwartz 2009), maintenance fluids (Holliday-Segar), and 8 of the 9 obstetric calculators (Bishop score,
GA-by-CRL, and 6 date-based EDD/GA/maternity-leave calculators). This needed two real DSL extensions:

- `kind: 'date'` inputs plus `today()`/`addDays()`/`daysBetween()` expression functions, so Naegele's rule,
  gestational-age-from-EDD, and maternity-leave date arithmetic are expressible at all.
- `assertions` (fail the whole calculation on a derived-value guard) and `interpretations` (append a
  threshold-based message) on `CalculatorSchema` — closes a gap flagged in the first batch (the hardcoded
  eGFR calculators reject an implausible derived creatinine value; Bishop score has threshold bands).

`calculateGestationalAgeByBiometry` (Hadlock fetometry) stays hardcoded: it averages only whichever 2–4 of
its optional inputs (BPD/HC/AC/FL) were actually provided, which needs a variadic "average of present
values" primitive the expression language doesn't have yet. `unit-conversion` also stays hardcoded — its
family/unit-pair selection isn't expression logic. Regression-tested against every migrated calculator's
original hardcoded function in `calculator-schema-catalog-obstetrics.test.ts` /
`calculator-schema-catalog.test.ts`, including assertion-triggering edge cases and Bishop's interpretation
bands. Live-verified in the browser: Bishop score (option-labelled selects, correct interpretation banding),
EDD-by-LMP (date arithmetic + today()-relative gestational age), maternity leave (mixed date+number
outputs through the same text-rendering adapter), and the UZI assertion correctly rejecting >40 weeks with
a toast instead of a false result.

The downloadable tool modules are wired through the same SQLite installer as document modules:
`content/tool-modules/*.json` is the reviewable source of truth, `004_tools.sql` stores validated
definitions and normalized literature/KR links, and the generated DB is installed and read offline.
Runtime TypeScript keeps only `unit-conversion`; seven published tool modules cover core-clinical
preview.2 (22 calculators), obstetrics-gynecology (ObCalc plus perinatal assessments), psychology,
gastroenterology preview.2, neonatology, pediatrics, and emergency. Hadlock biometry
(`obstetric-ga-biometry`) remains TS-only. Further tools should be migrated in small, source-reviewed
batches rather than copied into the app bundle again.

Verification: `bun run typecheck` (all packages) and the full repo test suite (81 Vitest files, 477
tests, and 115 Python tests) pass with zero regressions.
