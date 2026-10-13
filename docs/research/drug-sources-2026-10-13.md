# Drug instruction sources, second look and the sister-register pilot (G2, 2026-10-13)

Owner request (2026-10-13): «Let's resurrect the collector, if possible — or search for a drugs db once again».
This note records (1) why the ГРЛС collector stopped and how it runs now, (2) a fresh check of every source of full
official Russian instruction texts / ОХЛП listed in the earlier notes, with numbers measured today against the
missing registrations, and (3) the pilot of the best new one: the registers of Belarus and Kazakhstan, wired as a
collector (`tools/ingest/src/localmed_ingest/eaeu_sister_registers.py`).

Builds on [grls-mirrors-2026-10.md](grls-mirrors-2026-10.md), [instruction-sources-2-2026-10.md](instruction-sources-2-2026-10.md),
[instruction-mirrors-3-2026-10.md](instruction-mirrors-3-2026-10.md), [manufacturer-instructions-2026-10.md](manufacturer-instructions-2026-10.md),
[medication-instructions-2026-10-05.md](medication-instructions-2026-10-05.md), [data-sources-2026-10.md](data-sources-2026-10.md)
and the G1/GI1/M1 sections of [../CURRENT_STATE.md](../CURRENT_STATE.md). What those established is not repeated.

Legend: ✔ requested or measured in this session; ◐ taken from an earlier note, not re-checked.

## 1. The ГРЛС collector

**Why it stopped.** The last line of `data/build/grls-collect/daily-loop.log` is `WAIT until 2026-10-06T06:46:39Z`
(written 2026-10-05 09:46 local). The host rebooted at 10:16 local the same morning (`last reboot`: 2026-10-05 10:16,
again 2026-10-08 16:54). There is no `LOOP stopped` line and no `STOP` file, so the process was killed hard; the loop
runs as a plain `nohup` process and nothing restarts it. Not a site block: the last CAPTCHA was the normal end of the
2026-10-05 window.

**Restart (2026-10-13 22:41 local, unchanged polite rate).** One detached instance (`pid 75803`, parent 1, own session,
`caffeinate -i -w` attached), same plan/state/log files, same parameters: probe with ONE registration, then at most 50
registrations, 10–20 s between requests, one request at a time, truthful `User-Agent`, backoff 300 s on 429/503,
stop at the first CAPTCHA, wait 24 h. No second instance, no host/cookie/IP/UA change, CAPTCHA never touched.

| Window (UTC) | Result |
| --- | --- |
| probe 19:41:25 | 1 success |
| batch 19:42:48–19:56:40 | 14 registrations: 7 stored, 7 «search-miss», then the usual CAPTCHA at `Р N002816/01` (page saved); next attempt 2026-10-14 19:56:49 |

Loop totals now: 47 successes, 8 windows, 4 CAPTCHAs; groups 2 973/4 383, ЖНВЛП groups 977/1 138.

**Yield finding (and one change).** Since the group queue started (2026-10-04): the EAEU numbers `ЛП-№(…)-(РГ-RU)`
chosen as group representatives succeeded 31 of 31 times; the older national numbers (`ЛС-`, `ЛСР-`, `Р N`, `П N`, `ЛП-00…`)
3 of 16 (13 «search-miss»). Half of every window's ~14 requests went to numbers the search rarely finds. The
representative choice (`grls_groups.build_group_queue`) now prefers a registration the search finds (an EAEU number)
before the foreign-originator and earliest-date rules; a group with only older numbers is still tried in its old
position. Test `test_representative_prefers_a_number_the_search_can_find`. The running loop (started from the same
code before this change) picks it up at the next restart (`scripts/grls-collect-daily.sh stop`, then `start`; the
script keeps `nextAttemptAt`, so a restart never adds a window).

**Made restartable.** `scripts/grls-collect-daily.sh start|status|stop` (one instance, `setsid` via perl, reads the
previous `nextAttemptAt`, removes `STOP`); the exact command is in `GRLS_INGESTION_HANDOFF.md` («Restart after a
reboot»). No LaunchAgent or other persistent system configuration was installed.

## 2. Sources, re-checked

Missing set (today, from `load_targets`: plan 02.10.2026 targets without a ГРЛС PDF on disk, no `ФС-`):
**8 278 registrations, ЖНВЛП 3 055; 6 286 of them are EAEU numbers.** (M1 counted 8 312 on 2026-10-02; the loop has
since stored ~35.)

| # | Source | Access / format | Measured today | Covers of the 8 278 missing | Rate limits, robots, licence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **ГРЛС** `grls.rosminzdrav.ru` | `.aspx` search → PDF per registration | CAPTCHA after 14 registrations per window ✔ (log) | the loop's ~7–14/day | `robots.txt` disallows all; owner decision G1 | keep running, polite; ~7 stored/day today |
| 2 | **Union register OData** `opendata.eaeunion.org/odata` (Eurasian Economic Commission open data) | OData v4 JSON; entity `DrugRegistrationDetailsType`; nested `$select` works, plain `$count`/`$expand` of the whole record hits a 504 «Обновление ресурса» | 55 563 records, 16 901 with a registration number (the rest are applications); per record the country entries RU/BY/KZ/AM/KG with national trade names and certificate ids ✔ | **0 documents**: the schema has `drugDocumentsDetails.drugUsageInstructionDetails` (ЛВ) and `drugGeneralCharacteristicDetails` (ОХЛП) with `pdfBinaryText`, but all 1 563 records sampled across the whole range (skip 0…55 400) hold `null` ✔ | «доступны для повторного использования с минимальными организационными и другими ограничениями» (`opendata…/about-html/reused.html`); no robots rules | useful only as the dossier → countries map; the old `portal.eaeunion.org/…/PMM01.svc` endpoint is gone (404) |
| 3 | **rceth.by** (Belarus, Центр экспертиз) | form POST; result table lists every EAEU registration with links to static PDFs `/NDfiles/pdfeaec/<dossier>/LV.pdf` (patient leaflet) and `OHLP.pdf` (professional text); a missing file answers with an HTML page and status 200 | 2 353 EAEU entries (search by `-BY`, 100 per page, paged by the `QueryStringFind` token) ✔; a PDF fetch takes 1.5 s | **283 registrations, ЖНВЛП 141**, each with ЛВ and ОХЛП | `robots.txt` is a one-line stub (no rules); no CAPTCHA seen; no terms found | **piloted** |
| 4 | **register.ndda.kz** (Kazakhstan, НЦЭЛС) | the site's own JSON endpoint `POST /register/api/v1/PharmaRegister/list/paged`, files by `registerId`: `getRegisterInstructionFile` / `GetRegisterOhlpFile` (`lang=ru`), PDF or DOCX, RU+KZ text | 1 583 EAEU entries (`sourceType == "Eaes"`), 8 pages of 200 ✔; some ids answer HTTP 500 (known) | **226 registrations, ЖНВЛП 110**, each with ЛВ and ОХЛП | `robots.txt` is the SPA shell (no rules); the site also documents a partner API (token + registered IP, request form) — not used; no terms found | **piloted** |
| — | BY ∪ KZ | | 120 registrations in both | **377 registrations = 4.6 %, ЖНВЛП 190 = 6.2 %; 1 018 documents (566 BY, 452 KZ)** | | |
| 5 | **lk.regmed.ru/Register/EAEU_SmPC** (НЦЭСМП, ОХЛП и ЛВ ЕАЭС) | HTML grid, 200 today; the page script shows a captcha popup before the document list/download (`ShowDocListAfterCheckCaptcha`) ✔ | — | would cover most of the 6 286 | `regmed.ru/robots.txt`: `Allow: /`; downloads gated by an image CAPTCHA | **not touched** (CAPTCHA) |
| 6 | Armenia, Kyrgyzstan | AM: SCDMTE `pharm.am`, open-data lists to 2023 (no texts); KG: no register with texts found | OData flags 39 missing EAEU registrations as registered in AM, 0 in KG ✔ | ≤ 39 | — | not pursued |
| 7 | **Manufacturer sites** (M1) | 7 adapters shipped (MED3: 272 documents / 240 registrations) | `ns03.ru`, `dalkhimpharm.ru`, `avexima.ru` sitemaps reachable today ✔ (robots: ns03 `Allow: /files/*.pdf`; dalkhimpharm `Disallow: *?*`, `/search`; avexima `/bitrix/`, `/search/` closed) | est. ≈ 100–150 by name (upper bound, from the earlier note), evidence level `label-unique` only | per-site robots respected by `PoliteFetcher` | adapters not added in this task: each needs a page pattern and a decision on the weaker evidence level |
| 8 | Mirrors, archives, datasets, pharmacies, medi.ru, РЛС/Видаль/Allmed | | nothing new; earlier notes stand | ≈0.3 % (Wayback) | rights / robots as recorded | no |
| 9 | Official request to НЦЭСМП / Минздрав; commercial contract (РЛС Aurora, ЛС ГЭОТАР) | | not tried | up to 6 286 | — | the only path that scales; owner decision |

Why the sister registers: Belarus and Kazakhstan publish the **ОХЛП** as well, and ГРЛС gave us 5 ОХЛП in total; every
one of the 377 registrations gains a professional text and a leaflet from an official state register without a
CAPTCHA. Caveats (from the earlier comparison notes, 7 + 5 pairs): the texts are the dossier's common documents, a
member state may stamp them with its own approval, the edition can differ from the Russian one in either direction
(Jaccard 5-grams 0.56–0.99), the Kazakh files are Russian + Kazakh. Hence a separate source class
(`eaeu-sister-register`), the country on every row, and no silent substitution for the ГРЛС document.

**OData flags understate Belarus.** HEAD probes (2.5 s apart, about 570 requests): of 195 missing dossiers that OData flags
as registered in BY, 133 (68 %) have a `LV.pdf` at rceth.by; of 77 unflagged controls 2 (2.6 %) have one. The listing
tables are authoritative for document existence, so the collector builds candidates from the listings, not from the
OData index.

## 3. The pilot

Collector `medbase-eaeu-sister-registers` (`eaeu_sister_registers.py`, 15 tests on fixtures, no network):

1. `lists --country BY --country KZ`: snapshot of each country's EAEU listing (`entries-BY.jsonl`,
   `entries-KZ.jsonl` + `.meta.json` with URL, fetch time, sha256). 2 353 + 1 583 entries in 33 requests.
2. `report`: coverage of the missing registrations (numbers above).
3. `collect`: resumable download, one request at a time per host (4–6 s), `robots.txt` honoured, a CAPTCHA, 3 refusals/
   network errors in a row, or 12 per-record server errors stop the run. Only a body that really is a PDF
   (`%PDF-` + content type) or a DOCX is stored (rceth.by answers 200 with HTML for a missing file). Ledger
   `state.jsonl`, files `files/<country>/<sha256>.pdf|docx`, never overwritten.
4. `manifest`: per (missing registration, document) row with source class, country, dossier, sister certificate and
   trade name, document kind (`leaflet`/`ohlp`), URL, sha256, bytes, fetch time, `Last-Modified`, match method
   `shared-dossier-number`, and a text check (`trade-name`, `inn`, `no-text-layer`, `mismatch`; a mismatch is kept
   with `accepted: false`). `index` dumps the Union OData dossier → countries map (56 requests) for the pre-release
   freshness check (R1).

Pilot check on the first 61 stored files (text layer via PyMuPDF, no OCR): 0 mismatches; 48 name the trade name, 3 the
INN, 10 (5 BY dossiers) are scans without a text layer and go through the existing macOS Vision OCR path. BY files take
~1.5 s, KZ ~2 s.

Download result (2026-10-13/14, ~2.5 h at the polite pace): **950 of 1 018 documents stored (565 BY, 385 KZ; 867 PDF +
51 DOCX + earlier 32 PDF; 711 MB)**; 68 failed, all but a few Kazakh ids that answer HTTP 500/400 on both files
(33 registers, repeatable) and three timeouts. **370 of the 377 registrations hold at least one stored document (ЖНВЛП
186), 369 of them both a leaflet and an ОХЛП.** `manifest` was run on the 30-file pilot only (OCR of scans on a loaded
machine took 31 min): 32 rows, all accepted, 0 mismatches; it was not run on the full set (the scans, ≈15 % of BY
files, need Vision OCR; ~hours).

Group coverage (INN + form class, my approximation of the loop's metric): 3 559 → 3 625 groups covered (+66, +20 of
them ЖНВЛП), i.e. 8 % of the groups still uncovered, about as many as 9 daily ГРЛС windows at today's yield.

Not built into a module: no module builder exists for this source class yet, the OCR share and the acceptance policy
for another state's stamped text are an owner decision, so no pack, catalog or release asset changed.

## 4. Recommendations

1. Keep the ГРЛС loop running (restart command in the handoff); restart it once after the next `git pull` so the
   representative change applies.
2. Run `manifest` over the 950 files (OCR for the scans), then add a module builder next to
   `manufacturer_instruction_modules.py` (source class `eaeu-sister-register`, country visible, ОХЛП shown as such). Owner
   decision needed on showing a Belarus/Kazakhstan-stamped text for a Russian registration.
3. Ask НЦЭСМП for the ОХЛП/ЛВ of the ~6 300 EAEU registrations (the only scaling path); the CSV exists (plan 02.10.2026).
4. Optional: apply for the Kazakh partner API (metadata only), add the three manufacturer adapters.

## 5. Not tested

Texts were not compared with the Russian ГРЛС originals beyond the trade-name/INN check; OCR of the scans and the
module build were not run; the KZ DOCX path has one live example; `index` (the Union OData dump) was run once as an
exploratory script, not through the final command; Armenia/Kyrgyzstan registers were not opened.
