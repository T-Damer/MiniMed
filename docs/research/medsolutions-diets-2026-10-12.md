# Therapeutic nutrition: public official module and personal Pevzner module (2026-10-12)

Task MS2-diets. Two modules: a public one from the official orders, and a personal-use one from the
MedElement «Справочник врача» database.

## Documents in force (data/raw/diets-official)

| Document | Edition used | Reading text | Official page |
| --- | --- | --- | --- |
| Приказ Минздрава №330 от 05.08.2003, Приложение №4 (Инструкция) | ред. от 19.02.2024 | mirror legalacts.ru (no official consolidated text exists) | consultant.ru (title and contents only) |
| Приказ №395н от 21.06.2013 (нормы) | ред. от 19.02.2024 | mirror legalacts.ru; product rows compared cell by cell with the official 2013 DOCX | minzdrav.gov.ru |
| Приказ №1008н от 23.09.2020 (порядок, приложения 2 и 3) | original, in force | mirror legalacts.ru, cross-checked with Garant; official publication is an image scan | publication.pravo.gov.ru |
| Приказ №70н от 19.02.2024 | in force since 02.04.2024 | already merged into the consolidated 330/395н text | publication.pravo.gov.ru |

Table 2 of 330 is repealed (395н replaces it). Not packaged (status only): USSR order 540 of 1985
(not in force), letter 2510 of 2004.

## Public module `minimed.reference.diets.ru`, «Лечебное питание»

Preparer `diets_official.py` (`medbase prepare-diets`) reads the `extracted.md` files and writes
`content/diets-official/` deterministically (same raw files give identical Markdown; the packaged
gzip is byte-identical on rebuild). It selects and lays out source text; it rewrites no word.
Packaging: `diets_distribution.py` (`medbase package-diets`), script `bun run content:module:diets`.
Version 2026.10.12, kind reference, collection `diets`, releaseState preview, minAppVersion 0.6.59.

10 documents, 99 chunks:

- `reference.diets.ovd`, `shd`, `vbd`, `nbd`, `nkd`, `vkd` (short titles ОВД, ЩД, ВБД, НБД, НКД,
  ВКД): numbered tables of the variant («Стол №5»), 330 Table 1 indications and characteristics,
  composition table, Table 1a (natural vs specialised products), 395н food set (брутто/нетто),
  1008н adult row, reference lines.
- `children-pregnancy`: 1008н item 10 and Appendix 3 (ОВД, ЩД, ВБКД, НБД, НКД, pregnancy/lactation).
- `norms-395n`: the full 395н table (six variants, 12 value columns, split in whole pieces).
- `instruction-tables`: 330 Tables 2а, 3, 4, 5, 6, 7 with their notes. (The status line saying the tables
  were machine-extracted was removed on 2026-10-13 after the check below.)
- `system` (short title «Стандартные диеты»): variant to numbered-diet table, reverse table
  «стол → вариант», other diets of the Instruction, 1008н items 5-7 and 15 (when to prescribe).
  Diet 11 stays under ВБД and ВКД as in the source; the absence of №12 is noted once.

Choices worth knowing:

- Table 1a (ratio of natural to specialised products) belongs to the six adult variants, not to
  children, so it sits in the variant documents. 395н has no children or pregnancy columns, so the
  children document carries only 1008н (plus item 10, the legal basis with the list of products
  not used in children's diets).
- 330 Table 1 and 1008н Appendix 2 word indications differently (for example ВБД: «хронический
  гломерулонефрит нефротического типа» vs «хроническая болезнь почек»); both are shown, each under
  its own order.
- Products with a dash in both columns of a variant are left out of that variant's food table; the
  `norms-395n` document keeps every row.
- Title of the overview is «Стандартные диеты», not «Система стандартных диет»: the pilot card
  `reference.order330.standard-diet-system` in `minimed.reference.pediatrics.ru` already owns that
  short title, and phrase auto-linking would collide. The pilot cards (`reference.pevzner.*`, third
  party, unreviewed) are untouched and now duplicate this module for столы 1, 5, 7, 8, 9, 15.
- Search: table numbers are exact `navigationAliases` of the document (plus `aliases.yaml`); the
  numbered-table row of the overview would otherwise outrank the variant on «стол 5».
- Source corrections: one, 1008н Appendix 3 row 2 label «(ЩЦ)» in the mirror is «(ЩД)» in the
  Российская газета scan (page 12 of 16) and in Garant; the scan wins. The Latin `N` before a number
  in quoted text («диеты N N 1 - 15», «приложению N 3») is printed as «№».

## Mapping (330 Table 1, column 2)

ОВД: 1, 2, 3, 5, 6, 7, 9, 10, 13, 14, 15. ЩД: 1б, 4б, 4в, 5п (I вариант). ВБД: 4э, 4аг,
5п (II вариант), 7в, 7г, 9б, 10б, 11, R-I, R-II. НБД: 7б, 7а. НКД: 8, 8а, 8о, 9а, 10с. ВКД: 11.
The preparer stops if the parsed list differs from this constant
(`OFFICIAL_NUMBERED_DIETS`), which the personal module also uses.

## Personal module `minimed.local.pevzner-diets.ru`, «Диеты по Певзнеру (личное)»

Preparer `local_reference_pevzner.py` (`prepare-local-pevzner`, `package-local-pevzner`), script
`bun run content:local:pevzner`. Built on `local_reference_common` / `local_reference_html` (HTML to
clean Markdown, gitignore guard, packaging). Source: `mes.sqlite`, table `therapeutic_diets`
(27 rows). One document per table («Стол №1а» … «Стол №15»; short title «Стол №5 (Певзнер)») with
the sections Стандартная диета, Показания, Цель, Общая характеристика, Химический состав и
энергоценность, Режим питания, Рекомендуемые и исключаемые продукты, Примерное меню (a section is
omitted when the field is empty: products and menu of one table). The «Стандартная диета» line uses
the official mapping above; столы 1а, 4, 5а, 10а, 10и are not in 330 Table 1 and get no line.
`standard_diets` and `standard_therapeutic_diets` were only compared with the official mapping:
identical (the database names the tuberculosis variant ВБДт, official ВКД).
`rightsStatus: personal-use-only`, `localOnly: true`. Workspace
`data/intermediate/local-reference/pevzner/`; artifacts and the install bundle
`output/local-modules/minimed-local-pevzner-diets.minimed-module.zip` (all gitignored, verified
with `git check-ignore`). No source row is in git: the tests use synthetic rows.
Two `memo` cells hold only a download link to an external image; not included.

## Open problems

- 330 and 395н (current edition) come from a mirror; no official consolidated text was found.
- Tables 2а-7: checked cell by cell on 2026-10-13 (DQ1; `docs/CURRENT_STATE.md`): identical to the
  Kontur.Normativ copy of the 2024 edition and consistent with the rulaws 2016 edition, the 2013 text and the 70н
  items; three mirror artefacts in Table 6 were repaired (hyphenated «коровье», the bracket of «(с уменьшением»,
  the fraction «0,8/0,73»). The official 2003 scan was not available; footnote marks `<*>`, `<2>` stay as printed.
- Typos kept as in the mirror, official scan of 330 not checked: «акоголизмом», «профвредностью»
  (ВКД, Table 1). In 1008н Appendix 2 (НКД) the mirror reads «при наличие избыточного веса»
  (Garant: «при наличии»); not checked against the scan.
- 1008н and 70н official texts exist only as image scans locally (no OCR done).
- Catalog URL resolves to `raw.githubusercontent.com/.../main/apps/app/public/content/modules/`,
  which works only after the gzip file is pushed to `main`.

## Not checked

Visual rendering in the running app and on a device (tables were checked with the reader's own
GFM table parser on all 99 chunks: no table is cut, no ragged row); module install on a device;
the personal bundle was not installed through the app's file import; clinical review of any text.
