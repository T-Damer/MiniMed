# Russian regulatory pack

## Scope

The regulatory pack contains current Russian acts, source-linked summaries, amendment chains, and
historical redirect cards for child and adult medical practice. The pediatric practice layer now
covers:

- the current pediatric-care, preventive-examination, dispensary-observation, education,
  neonatology, endocrinology, tuberculosis, vaccination, first-aid, and infectious-disease acts;
- child-care sick leave through Federal Law No. 255-FZ, Order No. 195n, and Order No. 1089n;
- the district pediatrician professional standard and the current/next qualification requirements;
- explicit redirects from 625n, 514n, 366n, 707n, 154, Order No. 5 of 1995, and 1346n;
- a status crosswalk for the pediatric study list and its medical-form identifiers.

Cards retain official publication and registration metadata where available, effective dates,
status, replacement links, and stable anchors. Since 2026.10.14 a card is the **full text of the act**
(`contentMode: source_text`; original publication, amending orders are named in the edition line but not
merged): headings, numbered items, tables as reader tables and the appendices, each paragraph with the PDF page
it came from. The short card description is the old summary; every card ends with a section «Источник и
редакция» (number, date, Minjust registration, edition, validity, link) as plain text at the bottom.
2026.10.13 (below) was the paraphrase release.

## Full texts (LEGAL1, 2026.10.14)

Pipeline (`tools/ingest`, `medbase-legal-texts`; every input outside the repository is read by absolute path):

1. `sources` records the official file of each act (publication.pravo.gov.ru, minzdrav.gov.ru, pravo.gov.ru IPS,
   rg.ru) with its SHA-256. Number, date and title of an act always come from the portal record, never from OCR.
2. Scans are converted page by page with Marker 2.0.0 (Surya, `scripts/marker_pages_run.py`, detached, resumable,
   one page at a time); the second reading is macOS Vision. Text-layer PDFs (366n, 521n) use the PyMuPDF layer,
   docx and HTML sources need no reconciliation.
3. `reconcile` (`legal_reconcile.py`) compares the two readings of every page: numbers, dates, codes, Roman
   numerals and order numbers must agree; token coverage, loops (a clause repeated), dropped spans, dropped table
   rows, a dropped last line (`page_end_missing`) and thousand groups are checked. A page that disagrees is
   flagged; Vision's reading of the disputed number is kept and marked.
4. Ruled tables are read cell by cell (`legal_cells.py`, `medbase-legal-texts cells`): the page is de-skewed, the
   ruling found, each cell cropped and read by Vision alone and compared with Marker's cell; the table is rebuilt on
   the ruled grid. A page whose grid does not agree with Marker is kept as Marker read it.
   Acts whose label column Marker loses (206н, 707н) are read with the labels painted out and the labels put back by
   order (`legal_unlabel.py`).
5. Every flagged page is read against its page image by a person or an agent, and only what the image shows is
   fixed. Each fix is a record in `content/regulatory-rf-texts/<act>.review.json` (`find`, `replace`, `why`; `find`
   occurs exactly once), each reviewed page has a verdict, `keepMarker` lists pages where Marker's text is kept whole.
   `assemble --strict` refuses a flagged page without a verdict. Provenance per page (page number, source checksum,
   reading, confidence, flags, review marks) is in `<act>.provenance.json`.
6. `assemble` writes the card (`content/regulatory-rf-pilot/*.md`); the pack builds, lints and is checked by
   `tools/ingest/tests/test_legal_texts_pack.py` (every page 1..N has provenance and a source span, flagged pages
   have a verdict, tables are rectangular, no empty section, `AWAITING_FULL_TEXT` is empty).

7. A table with more text than a search chunk (`SPLIT_TABLE_CHARS`, 24 000 characters: the two appendices of
   374н, 436н) is cut into pieces of about 6 000 characters; each piece repeats the header row, is its own reader
   table and chunk, and carries the PDF pages of its own rows (`pageEnd`). A page that only continues the last row of
   a table stands with that row; a lone cell that opens a page with a lower-case letter or a quotation mark («…»)
   continues the open cell of the row above.

Result (2026-10-14): 30 acts, 1 581 scanned PDF pages read by Marker and Vision (the other four acts are a text
layer, docx or HTML source), 624 pages flagged by the reconciliation, every one read against its page image (599
verdicts, 656 recorded corrections, 6 pages where Marker's text is kept whole). 374н alone is 469 pages: its two
ruled appendices (225 + 210 pages of criteria, 9 columns) were read cell by cell, 187 pages flagged, 363 corrections
(columns of the names and ICD-10 codes, MKF ranges, TNM stages, CRG, percent, look-alike letters in codes). Because the
flagged pages are the ones the two readings disagree on, the unflagged pages of 374н were also compared with Marker's
and Vision's cell readings (dropped tokens, rows with a percent but no text, names and codes counted against each other,
a word that occurs nowhere else): names lost in both readings (a position lists up to seven names, one paragraph each)
were restored from the image on 14 further pages, and every ICD-10 code of the card exists in the МКБ-10 pack except
C86. The same comparison over the other acts found only hyphenation and stamps.

Limits: the review was done by an agent against the images, not by a lawyer or a clinician; amending orders are not
merged into the text (the edition line says so); a speck in a scan can still survive in an empty cell; the printed
typos of the originals are kept as printed (e.g. «B 117-139», «(тазоберденных)» in 374н).

## Current-edition rule

A familiar order number is not treated as current merely because it appears in an examination bank.
Historical cards remain searchable but point to the current successor. Future Order No. 436n is
marked `future` until 1 September 2026, while Order No. 206n remains the current qualification source
until that date.

The medical-form crosswalk is deliberately conservative. The source list does not identify the
approving act and edition for most forms, so only the verified 030-PO/u replacement chain is marked
as current or superseded. Other identifiers remain searchable and require source verification before
practical use.

## Bundled light pack and downloadable module (2026-10-14, REG2)

Owner 2026-10-14: the full texts are a downloadable section like the others; only the main law stays in the app.

- **Bundled `regulatory.db`** (pack `minimed.rf-regulatory-index`, 3.3 MB, was 27.8 MB): **323-ФЗ** in full text, the
  status crosswalk whole, and for each of the other 29 acts a **module-pointer card with the same document id**. A card
  is the act's official title (first paragraph of the act, with its PDF page), the short description the card always had,
  the headings of the act as one list («Содержание», levels 1–2), and the verbatim «Источник и редакция» section. Its
  metadata is `contentMode: module-pointer`, `targetDocumentId` = its own id, `primaryModuleId` = the module,
  `textTier: index`, `fullTextContentMode: source_text`; number, date, issuer, edition and source link are unchanged.
  Nothing is summarised or reworded (`regulatory_light.py`; test `test_regulatory_light.py`).
- **Why the same ids.** The reader already treats a pointer whose target is itself as «the file is here, the set is
  being installed»: the card shows the shared download offer (title of the set, size, progress), the search result
  offers the same download in place, and when the module is installed the bundled pack is not mounted next to it
  (`builtInCompanionMounts` skips it), so the module's document replaces the card under the same id, bookmarks, notes and
  links keep working. Installing never needs a handover to another document id.
- **Search offline.** The cards carry the 50 declared aliases of the pack, the title, the description and the heading list,
  so every act is found by number («приказ 192н», «закон 157-ФЗ»: top-2 for all 29 in
  `regulatory-bundled-search.test.ts`) and by topic (`benchmark:regulatory` against the bundled pack: 55 of 57 topical
  queries for an act that is only a card find it in the top 5, 0.965; the two misses are the 211н health-group
  queries). 323-ФЗ queries keep the full-text gates (section, context, metadata).
- **Module.** `minimed.regulatory.pediatrics.ru` **2026.10.14-r2** is the 2026.10.14 full-text pack unchanged (same
  decoded SHA-256 `03939d84…`, 31 documents including 323-ФЗ, 861 sections, 1 818 chunks, 27 799 552 bytes decoded) in
  framed **zstd**: **3 241 359 bytes** (was 4 831 841 as gzip), catalog `minAppVersion` **0.6.60** (the app that bundles
  the light pack; listed in `PENDING_RELEASE_MODULES` of `catalog.data.test.ts` until `release.json` reaches it, because
  0.6.59 bundles all 31 documents and does not know the mirror URL). Catalog URL
  `https://github.com/T-Damer/MiniMed/releases/download/regulatory-2026.10.14-r2/minimed.regulatory.pediatrics.2026.10.14-r2.db.zst`,
  which `artifact-url.ts` resolves to the git blob
  `https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/regulatory-2026.10.14-r2/modules/minimed.regulatory.pediatrics.2026.10.14-r2.db.zst`
  (branch `datasets/regulatory-2026.10.14-r2`, published with `scripts/publish-module-zstd-mirror.sh --family regulatory`;
  raw serves CORS and no LFS quota). The earlier gzip releases (2026.10.14, 2026.10.13) stay committed under
  `apps/app/public/content/modules/` and are never overwritten. The local release copy is
  `output/module-zstd-regulatory-2026-10-14-r2/` in the main checkout (file, catalog entry, package report).
- **Joins «Скачать всё» by itself**: it is an ordinary published catalog module (kind `regulatory`).

Build and publish (every input outside the repository by absolute path; outputs go to the main checkout's `output/`):

```bash
bun run content:rebuild:regulatory          # sync + lint + full build + benchmark, then the bundled light pack + its benchmark
uv run --project tools/ingest medbase package-regulatory --database data/build/rf-regulatory-pilot.db \
  --output <main checkout>/output/module-zstd-regulatory-<version> --version <YYYY.M.D[-rN]> --min-app-version <next app>
scripts/publish-module-zstd-mirror.sh --family regulatory --tag regulatory-<version> \
  --source-dir <that output dir> --create
bun scripts/verify-module-artifact.ts --module-id minimed.regulatory.pediatrics.ru \
  --url <raw mirror URL> --catalog <that output dir>/<file>.catalog-entry.json   # transport + decoded checksum
bun scripts/upsert-catalog-module.ts apps/app/src/features/modules/catalog.preview.json \
  <that output dir>/<file>.catalog-entry.json   # then move catalog publishedAt forward
bun run catalog:shell
```

`bun run content:build:regulatory:light` alone rewrites `apps/app/public/content/regulatory.db` and
`regulatory-report.json` from the committed full-text Markdown (`medbase prepare-regulatory-light` writes the cards to
`data/synced/rf-regulatory-light`).

`package-regulatory` refuses a pack in which an act lacks number, signing date, issuer, edition,
review date, an official https source, a SHA-256 source checksum or (for publication.pravo.gov.ru) the
SHA-256 and page count of the official PDF, or in which a section is empty
(`regulatory_distribution.check_act_metadata`). A new version never overwrites a published asset.

### History: the single bundled pack (2026-10-14, LEGAL1; 2026-10-13, REG1)

Until REG2 the module was the same content as the bundled `regulatory.db`: `minimed.regulatory.pediatrics.ru`
**2026.10.14** (`minAppVersion` 0.6.59, gzip, 4 831 841 bytes, 27 799 552 decoded; the bundled pack had grown from 1.5 MB
to 27.8 MB, 5.7 MiB below the 32 MiB WASM limit and read into memory at every start). It is committed as
`apps/app/public/content/modules/minimed.regulatory.pediatrics.2026.10.14.db.gz`; its catalog URL named the GitHub
release `regulatory-2026.10.14`, resolved to the raw `main` copy (release asset hosts have no CORS). 2026.10.13 (261 218
bytes, the paraphrase cards, replacing the 3-document 0.3.4 preview) stays committed too.

## Verification of 2026-10-13

`bun run regulatory:verify` (local, network) compares every card with the portal record (number,
date, pages), the official file (`sourcePdfSha256`) and the amending/repealing orders on
publication.pravo.gov.ru, and writes `content/regulatory-rf-verification.json`. Result: 25 acts
confirmed on the portal, 5 not checkable there (157-ФЗ, 255-ФЗ, 521н, 366н, 1346н: older acts, sourced
from pravo.gov.ru IPS, rg.ru and minzdrav.gov.ru). The portal files are scans without a text layer;
card text was compared with a macOS Vision OCR of every PDF (stem coverage and every number of every
section; no number of a substantive section was missing from its act). Tables do not survive OCR, so
nothing was transcribed from them.

Fixed: 1089н was missing amending order 222н of 31.03.2026 (valid until 01.03.2029, NPD payers,
items 9/30/49/86) and the 2023 effect of 790н; effective dates added for 1089н, 404н (until
01.07.2027), 313н (until 01.09.2027) and 213н; 306н moved from rg.ru to its portal publication; 436н
is current (since 01.09.2026), 206н history; «Ограничения» disclaimer sections removed from all cards;
study-list crosswalk refreshed.

Dropped (no official text could be verified): order 455 of 2003 (only a commercial database, legacy
model), orders 154 (1999) and 5 (1995) (historical, unofficial mirrors only) and the pediatric
medical-forms crosswalk (approving acts unknown, `editionVerified: false`). Not repealed-but-removed
acts: none; superseded cards (206н, 302н, 366н, 514н, 625н, 707н, 1346н) stay as marked redirects.

Limits: for federal laws the portal holds the original text, so the edition line names the last
amending law found by title (323-ФЗ: 114-ФЗ of 25.04.2026; 255-ФЗ: 455-ФЗ of 15.12.2025; 157-ФЗ:
316-ФЗ of 02.07.2021) and amendments inside other laws are not detected; the effective date of 222н
(2026) is not stated in the scan; cards cover the acts selectively.

## Validation

```bash
bun run content:rebuild:regulatory
bun run benchmark:regulatory
bun run regulatory:verify
```

Direct and declared-source builds must produce identical SQLite checksums. Retrieval contracts
validate the expected document, current or historical status, age audience, section anchor, context
resolution, and official metadata; `regulatory-rf-number-queries.json` requires «приказ <номер>» /
«закон <номер>» to return each act first.

## Next

Add clause-level cards for the most-used sections of 255-FZ, 195n, 1089n, and 521n after a clinician
review, then add focused pediatric-practice retrieval fixtures without weakening the existing release
thresholds.
