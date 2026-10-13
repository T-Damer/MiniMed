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
status, replacement links, and stable anchors. A card is a source-linked paraphrase of the act
(`contentMode: source_linked_paraphrase`), not a copy of its text: the official publication stays the
source for tables, forms and appendices, and every card ends with a section «Источник и редакция»
(number, date, Minjust registration, edition, validity, link) as plain text at the bottom.

## Current-edition rule

A familiar order number is not treated as current merely because it appears in an examination bank.
Historical cards remain searchable but point to the current successor. Future Order No. 436n is
marked `future` until 1 September 2026, while Order No. 206n remains the current qualification source
until that date.

The medical-form crosswalk is deliberately conservative. The source list does not identify the
approving act and edition for most forms, so only the verified 030-PO/u replacement chain is marked
as current or superseded. Other identifiers remain searchable and require source verification before
practical use.

## Released module (2026-10-13, REG1)

`minimed.regulatory.pediatrics.ru` 2026.10.13 (`minAppVersion` 0.6.59, kind `regulatory`, gzip, 261 218
bytes, 31 documents: 30 acts and the study-list crosswalk) replaces the 3-document 0.3.4 preview and is
the same content as the bundled `regulatory.db`. The file is committed as
`apps/app/public/content/modules/minimed.regulatory.pediatrics.2026.10.13.db.gz`; the catalog URL
names the GitHub release `regulatory-2026.10.13`, which the app resolves to the raw `main` copy (release
asset hosts have no CORS). Build and publish:

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
