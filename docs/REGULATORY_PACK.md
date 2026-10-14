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
   a table stands with that row.

Result (2026-10-14): 30 acts, 1 581 scanned PDF pages read by Marker and Vision (the other four acts are a text
layer, docx or HTML source), 624 pages flagged by the reconciliation, every one read against its page image (598
verdicts, 618 recorded corrections, 6 pages where Marker's text is kept whole). 374н alone is 469 pages: its two
ruled appendices (225 + 210 pages of criteria, 9 columns) were read cell by cell, 187 pages flagged, 325 corrections
(columns of the names and ICD-10 codes, MKF ranges, TNM stages, CRG, percent, look-alike letters in codes).

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

## Released module (2026-10-14, LEGAL1; 2026-10-13, REG1)

`minimed.regulatory.pediatrics.ru` **2026.10.14** (`minAppVersion` 0.6.59, kind `regulatory`, gzip, 4 836 762
bytes, 27 807 744 bytes decoded, 31 documents: 30 acts and the study-list crosswalk, 861 sections, 1 818 chunks) is
the full-text release and is the same content as the bundled `regulatory.db` (grew from 1.5 MB to 27.8 MB, below
the 32 MiB WASM limit by 5.7 MiB: a bigger pack has to leave the bundle). The file is committed as
`apps/app/public/content/modules/minimed.regulatory.pediatrics.2026.10.14.db.gz`; the catalog URL names the
GitHub release `regulatory-2026.10.14`, which the app resolves to the raw `main` copy (release asset hosts have no
CORS). 2026.10.13 (261 218 bytes, the paraphrase cards, replacing the 3-document 0.3.4 preview) stays committed
and is never overwritten. Build and publish:

```bash
bun run content:rebuild:regulatory          # sync + lint + build + benchmark
uv run --project tools/ingest medbase package-regulatory --database data/build/rf-regulatory-pilot.db \
  --output data/build/regulatory-module --version <YYYY.M.D> --min-app-version 0.6.59
cp data/build/regulatory-module/*.db.gz apps/app/public/content/modules/
bun scripts/upsert-catalog-module.ts apps/app/src/features/modules/catalog.preview.json \
  data/build/regulatory-module/*.catalog-entry.json   # then move catalog publishedAt forward
bun run catalog:shell
```

`package-regulatory` refuses a pack in which an act lacks number, signing date, issuer, edition,
review date, an official https source, a SHA-256 source checksum or (for publication.pravo.gov.ru) the
SHA-256 and page count of the official PDF, or in which a section is empty
(`regulatory_distribution.check_act_metadata`). A new version never overwrites a published asset.

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
