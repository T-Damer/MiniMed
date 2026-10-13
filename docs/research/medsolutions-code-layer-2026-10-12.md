# MedSolutions follow-up: the code layer (2026-10-12)

Task MS2-codes. Two additions built from official government data, both publishable in the public
repository: sick-leave periods on ICD-10 cards, and the medical-services nomenclature as a searchable
reference module. Nothing here uses MedSolutions text as content; its databases served only as a
cross-check.

## A. Sick-leave periods on ICD-10 cards

### Source

| | |
| --- | --- |
| Document | Рекомендации «Ориентировочные сроки временной нетрудоспособности при наиболее распространенных заболеваниях и травмах (в соответствии с МКБ-10)», Минздрав РФ 21.08.2000 № 2510/9362-34, ФСС РФ 21.08.2000 № 02-08/10-1977П (утв. 18.08.2000); cover letter ФСС РФ от 01.09.2000 № 02-18/10-5766 |
| Copy used | legal mirror pravo.ppt.ru, `https://pravo.ppt.ru/pismo/fss/n-02-18-10-5766-79960` — the only copy with the full text that web search and the usual mirrors turned up |
| Raw file | `data/raw/sick-leave-periods-2000/pravo-ppt-ru.html` (gitignored, checked with `git check-ignore`), unmodified; `SOURCE.json` next to it (url, fetched_at, sha256, title, number, date) |
| SHA-256 | `1e16401a23ae4b1a774c50a0f165b348a152da99e4c8eeb604ea2e6e8670aa18`, 734 281 bytes |
| Fetched | 2026-10-12, single requests one at a time, 4-6 s apart (this page, three other mirrors, two PDFs checked for a second copy), no crawling |

The letter is an unpublished departmental recommendation; no pravo.gov.ru, minzdrav.gov.ru or sfr.gov.ru
copy was found. consultant.ru (`cons_doc_LAW_24444` is a different letter), docs.cntd.ru (redirect, no
body) and guessed base.garant.ru / legalacts.ru addresses (404) gave no text. A second text copy was not
obtained on 2026-10-12; on 2026-10-13 three were (consultant.ru, docs.cntd.ru / library.mededtech.ru, forens-med.ru) —
see «Resolution of the conflicts» below.

### Build

`scripts/lib/sick-leave-letter.ts` (parser, no I/O) and `scripts/build-sick-leave-periods.ts`
(`bun run content:sick-leave`) write `apps/app/src/features/sick-leave/sick-leave-periods.json`
(161 KB, 109 601 characters; lazy chunk read through `?raw`). The script refuses a raw file whose SHA-256
differs from `SOURCE.json`.

The letter is 16 monospace tables inside `<pre>`. The parser reads each row group by its own `│`
marks (a widened code cell shifts the later columns), pairs every feature with its period (periods start
on a line that begins with a digit and follows no hyphen or comma), joins wrapped lines, undoes line-end
hyphens (a hyphen is kept when the compound occurs whole elsewhere in the letter), and moves footnote
marks (`<1>`) into per-row footnote lists. Counts: 16 tables, 142 blocks (section headings), 872 rows,
1 371 feature/period pairs, 9 distinct footnotes.

Asset shape: `source` (title, reference line, date, SHA-256, fetch time), `notes` (the letter's exact
sentences: the periods are recommendations; a deviation of 30 % or more is a reason for an expert review by
the head of department / КЭК), `footnotes`, `groups`, `blocks`, `entries`
(`[code, title, block, group, [[features, period, footnotes]], titleFootnotes, printedCode]`).

Edits to the letter's own text, all listed by the script and tested:

- **F18.1 → A18.1** (two rows, tuberculosis of the genitourinary organs, inside block A15-A19 between
  A18.0 and A18.2, MedSolutions has A18.1). The printed code stays in `printedCode`.
- Syntactic code clean-up: `I63.` → `I63`, `F10-19` → `F10-F19` (printed form kept).
- A stray `*` after five femoral-fracture periods (S72.0.0, S72.0.1, S72.1.0, S72.1.1, S72.3.0) has no
  footnote text in the source; it is dropped from the period text. MedSolutions shows it as `<*>`.
- Two rows whose layout puts a feature and its period on different lines are fixed by name, each checked
  against what the parser produced: K35.0 (the features «прободением», «перитонитом» stand in the title
  cell) and T22.3 (the `<2>` mark takes the line of «С осложнением»; both rows carry it).
- Table 16 prints «Уровень и локализация» once for the rows under it: features read «Тела позвонка,
  со смещением» (level, then the kind of injury with its first letter lower-cased).
- A bottom-aligned period (I21.4) belongs to the feature above it.

Codes of Table 16 carry a last digit the ICD-10 code does not (`S02.0.0` closed, `S72.0.1` open); the
panel matches the card `S02.0` to them.

### Panel

`apps/app/src/features/sick-leave/` — `sick-leave-data.ts` (shape check, matching, lazy load),
`sick-leave-view.ts` (period text, header, footnote numbering), `SickLeavePanel.tsx`,
`sick-leave-panel.css`; mounted next to `Icd10ToIcd11Panel` in `OfficialDocumentReader.tsx`
(`<SickLeavePanel document={…} />`, one line plus the import). It reads only `documentIcd10Codes`.

Matching, by the card's normalised code: a row matches when its code is the card's code or a longer
one, when the card is the category above it (the card `A01` shows A01.0-A01.3), when it is `X.-` or a
three-character code of the card's category, or when the card lies inside a range row (`F04-F06`).
A range or unknown code shows nothing. Shape: one collapsed row «Больничный: 9–20 дней» (span of the card's
periods for one diagnosis, «сроки для N диагнозов» for several, up to 12 shown); the body lists feature
rows with the period at the right (`9–11 дней`, `4–5 мес.`, `35–50 дней, МСЭ`; «дней» agrees with the last
number), small numbered footnotes, and at the bottom one small reference line and a round «?» that opens
the letter's two sentences. No legal wording, no raw data.

Checked in a temporary harness page (deleted): cholera, tuberculosis (nine rows under one group
heading), a vertebral fracture, a category card, a clinical recommendation with five codes, a code with no
row (nothing rendered), light theme. Not seen: the panel inside the real reader with an installed МКБ-10
module, dark theme, a phone.

### Discrepancies: the letter against MedSolutions `estimated_periods.db`

`bun scripts/diff-sick-leave-medsolutions.ts` (compares per code; the letter wins). 796 codes in the
letter, 778 in MedSolutions (848 rows there, 872 here). 746 of the 776 shared codes agree on title and periods
after removing footnote marks, dash variants, spacing, the `мес.` spelling and letter case.

Period values that differ (letter | MedSolutions):

| Code | Letter | MedSolutions | Comment |
| --- | --- | --- | --- |
| A01.0 | 34-45 | 35-45 | one source each, undecided |
| H00.1 | 5-10, 7-14 | 15-10, 7-14 | MedSolutions value is impossible |
| H44.0 | 23-35 | 25-35 | undecided |
| L60.0 | 7-10 | 17-10 | MedSolutions value is impossible |
| E24.0 | 30-55 and 50-60 (second with `<1>`) | 30-60 `<*>` | letter prints two lines for one feature |
| S52.2.0 / S52.2.1 | closed 45-50 / 60-90, open 45-55 / 60-65 | the two codes swapped | MedSolutions swaps closed and open |
| S82.2.1 | two rows (tibia diaphysis; combined tibia and fibula diaphyses) | one row, the second coded S81.2.1 | the letter repeats S82.2.1 |
| T22.3 | third degree, 40-80 / 60-100 | first degree, 3-5 / 10-15 | MedSolutions title and values differ |
| A15.0, A16.0, A18.1, A19.8 | rows split by feature | rows merged | structure only; the periods agree (A18.1 also after the F18.1 fix) |

### Resolution of the conflicts (2026-10-13, task DQ1)

Second copies: consultant.ru (16 table pages, same text as pravo.ppt.ru on every row it carried), docs.cntd.ru and
library.mededtech.ru (Kodeks, with look-alike Latin/Cyrillic letters and typos such as A48.1 «28-0», I21.4 «60-0», J04.1
«8-0», B75 «18-25», H00.1 «15-10», L60.0 «17-10») and forens-med.ru (plain-text tables). MedSolutions follows the
Kodeks reading. Decision rule: a value changes only when two independent readings agree against the Consultant/pravo.ppt.ru
text; the printed letter itself (no scan of the 2000 letter exists online) cannot be consulted.

| Code | Decision | Basis |
| --- | --- | --- |
| A01.0 | **35-45** (was 34-45) | Kodeks, forens-med and MedSolutions print 35-45 |
| H44.0 | **25-35** (was 23-35) | Kodeks, forens-med and MedSolutions print 25-35 |
| H00.1, L60.0 | kept 5-10 / 7-10 | Kodeks «15-10», «17-10» are impossible (min > max); forens-med agrees with us |
| E24.0 | kept two rows 30-55 and 50-60 | every letter copy prints two lines (the second with a footnote); MedSolutions merged them |
| S52.2.0 / S52.2.1 | kept (closed = .0, open = .1) | letter, Consultant and forens-med; MedSolutions swaps |
| S82.2.1 | kept two rows | the letter repeats the code; MedSolutions codes the second S81.2.1 |
| T22.3 | kept third degree 40-80 / 60-100 | letter, Consultant, forens-med |
| A15.0, A16.0, A18.1, A19.8 | kept split by feature | structure only; periods agree |

The full comparison with forens-med also showed it differing from the letter at I11.0 (II ФК 10-20, letter 10-15), S61.-
(13-20, letter 15-20) and S52.2.1 open (45-50, letter 45-55); in each the other two readings agree with the letter, so
nothing changed. Random sample of 50 rows (seed 20261013) against Consultant and forens-med: 0 disagreements. Over the
whole letter (1 371 period pairs) two values were wrong in the pravo.ppt.ru copy (0.15 %). The two changed values are in
`VALUE_CORRECTIONS` of `scripts/build-sick-leave-periods.ts` and in `valueCorrections` of the asset.

Titles: MedSolutions has typos the letter does not («очагоговый», «paдужной», «хроничеcкая», «однсторонний»,
«Поритонзиллярный», «вопалением», «прецребральных»), Cyrillic А/В/С in hepatitis titles, and a shortened
K35.0 title. The letter has «субэндокардинальный» (I21.4) and «Гипопаратироидизм» (E89.2), kept as printed.

Rows only in the letter (20): Table 16 from T23.1 on (T23.1-T23.3, T24.1-T24.3, T33.0, T33.5, T33.8, T42,
T51.1-T51.3, T52, T54, T60.0, T75.0, T75.4) and H43.1; MedSolutions ends Table 16 at T22.3. Only in
MedSolutions: its `S81.2.1`.

Letter quirks kept as printed: F10-F19 sits under the block heading F00-F09; `I05.-` and similar rows list
a heading feature without a period («С недостаточностью кровообращения») followed by rows with periods.

## B. Номенклатура медицинских услуг (module `minimed.reference.medical-services.ru`)

### Source

НСИ Минздрава России, OID 1.2.643.5.1.13.13.11.1070, version 2.10 (published 06.04.2021, last update
18.08.2022), fetched earlier from `nsi.rosminzdrav.ru` (not refetched): `data/raw/nsi/medical-services/v2.10/`,
`rows.json` SHA-256 `0c791dea…8e2f1`, 10 981 rows with `ID`, `S_CODE`, `NAME`, `REL`, `DATEOUT`. The passport
names order 1664н (2011) as the basis of the codes; the module text cites order 804н (13.10.2017), as the task
did. No section or class names are in the dictionary.

### Preparer

`tools/ingest/src/localmed_ingest/code_reference.py` writes a Markdown workspace into
`data/intermediate/code-reference/medical-services/` (725 files, 4.4 MB, deterministic; the task named this
path, not `content/`; deleted after the build, `bun run content:module:medical-services` recreates it in about 8 s): one document per class and section of the code (`A16.20`, `B01.003`; ids
`reference.medical-services.a16-20`), GFM tables `Код | Наименование услуги` split at 2 800 characters,
active services first, abolished ones in their own table with the date, a «Реквизиты» section last, and one
overview document (`reference.medical-services.overview`, «Номенклатура медицинских услуг (приказ 804н):
разделы кодов») listing every section with its count and first services. Names are the dictionary's
words, never rewritten. Document titles name the first two top-level services of the section.

Repairs counted in `prepare-report.json`: one row without a code dropped (ID 12061, «признать утратившей
силу»); 57 codes whose first letter is a Cyrillic А/В made Latin; one code with a space (`A11. 19.006`);
59 abolished rows that repeat an active row (same code, same name) not shown twice; 13 codes the
dictionary reuses for a different name keep both rows (the old one under «Упразднённые услуги»). Result:
10 450 active and 471 abolished services, 724 section documents, 1 788 chunks. Package:
`tools/ingest/src/localmed_ingest/code_reference_distribution.py`.

Commands: `medbase prepare-code-reference`, `medbase package-code-reference`;
`bun run content:module:medical-services` runs prepare, lint, build (`--lexical-only
--compact-search-text`), package, copy, `scripts/upsert-catalog-module.ts` and `catalog:shell`.

### Search

`source_type = code_reference`: it is outside `SOURCE_TYPES_BY_SCOPE.guidelines`, `.conditions` and the
other typed scopes, so the cards stay out of «Клинические рекомендации» with no change to
`ScopedMedicalCore.ts`; they appear in «Все» as «Справочник» (kind and type fall back to `reference`). No core
pointer, no core rebuild. FTS5 `unicode61` splits `A16.20.005` at the dots, and the app's query plan turns
a typed code into `a16 AND 20` / `005` branches, so no aliases were needed: with the built database
`A16.20.005` and `A16.20.005.001` find the A16.20 section first, `A26.06.049` finds A26.06, `B01.003.004.001`
finds B01.003, `A05.23.009` finds A05.23, «кесарево сечение» finds only A16.20, «номенклатура медицинских
услуг», «804н» and «коды медицинских услуг» find the overview first. Abbreviations that the names do not
contain («МРТ») do not find the right section; that needs aliases from a reviewed list.

### Artifact

| | |
| --- | --- |
| File | `apps/app/public/content/modules/minimed.reference.medical-services.2026.10.12.db.gz` |
| Size | 1 604 420 bytes gzip, 8 491 008 bytes installed |
| SHA-256 | `94fc1ffc8003bf6575e248e3a30ddf15dbd985e84c3a49875b1ba3b4dfd513e8` |
| Catalog | `catalog.preview.json` entry (kind reference, collection `medical-services`, releaseState `preview`, minAppVersion 0.6.59, schema 2, no document list: 725 cards would add to every catalog fetch); the release URL `…/reference-medical-services-2026.10.12/…` resolves to raw.githubusercontent `main` through `artifact-url.ts`; `bun run catalog:shell` run (the shell file did not change) |
| Locale | `collection_medical-services` in `_locales/ru` and `_locales/en` |

## Not built, with reasons

- MedSolutions `fmes.sqlite` (federal standards of care): 727 of 732 are 2012 orders, many since replaced; showing
  them would present withdrawn standards as current.
- Moscow МЭС in `mes.sqlite`: obsolete.
- `opcodes.sqlite` (КСГ): the groups and coefficients change every year; the copy is stale.

## Untested

- The panel inside the real document reader with an installed МКБ-10 module, on a phone, in the dark theme.
- Installing the new module through the app (download, OPFS pool, search from the UI): only the database,
  the catalog schema (`upsert-catalog-module.ts` validates it) and the module vitest suites were run.
- A scan of the 2000 letter itself (A01.0 and H44.0 rest on two readings against one lineage).
- Android and iOS builds, e2e.

## Files

Part A: `scripts/lib/sick-leave-letter.ts`, `scripts/build-sick-leave-periods.ts`,
`scripts/diff-sick-leave-medsolutions.ts`, `apps/app/src/features/sick-leave/` (asset, code, CSS, three test
files), `OfficialDocumentReader.tsx` (two lines), `package.json` (`content:sick-leave`).
Part B: `tools/ingest/src/localmed_ingest/code_reference.py`, `code_reference_distribution.py`, `cli.py` (two
commands), `tools/ingest/tests/test_code_reference.py`, `package.json` (`content:module:medical-services`),
the artifact, `catalog.preview.json`, the two locale files.
