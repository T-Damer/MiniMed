# GRLS ingestion handoff

The client package is text-only: source PDFs are build-machine inputs and must not be committed or
shipped. The current local GRLS catalog is ignored data and has edition `24.07.2026`.

## Implemented workflow

1. Build `grls-instructions-active-plan.json` from the catalog.
2. Canonicalize an EAEU registration only when trade name, INN, dosage form, and holder exactly match
   one current registration. Keep requested historical numbers as provenance; download only the current
   instruction.
3. Append checksum-backed PDF download results to the state ledger.
4. Generate a source registry only from successes with matching current plan target and checksum.
   No-text PDFs are marked in an OCR candidate report and passed to the local OCR fallback.
5. Extract to Markdown, lint, then build lexical-only SQLite packs. PDFs stay in ignored `data/raw/`.

## Current local corpus snapshot

- 19,335 current instruction targets; 2,205 deferred as legacy, ambiguous, or unmatched.
- 122 downloaded PDF files; 116 have a checksum-valid success matching the current plan. All 116 are
  currently classified as OCR candidates and remain build inputs, not client assets. Six older or
  non-current files are excluded by the registry builder.
- OCR preparation of all 116 current PDFs completed sequentially in 501.97 seconds. A preserved
  four-worker v2 run completed in about 237 seconds (2.1x faster) and recognizes exact standard
  instruction headings without relying on font emphasis. All documents remain marked for source review.
  The v2 pack contains 116 instructions plus 116 GRLS registration cards, 1,989 sections, 1,662 chunks,
  480 source-exact proposed facts, and 26,632,192 bytes. The original 22,282,240-byte pack remains
  available; raw-PDF staging is not part of either client pack.
- Exact registration + trade-name matching against the full ESKLP pack links 99 registrations,
  leaves 17 unmatched, and produces zero ambiguous links. Linked cards expose `mnnDocumentId`, all
  `smnnCodes`, `klpCodes`, and the exact `instructionDocumentId` to the runtime model.
- Targeted exact-registration downloads expanded the preserved corpus to 123 instructions. The latest
  v2 SQLite has 246 documents, 2,193 sections, 1,889 chunks, 632 entities, 176 presentations,
  548 proposed exact-source facts, 881 relations, and 761 document links. ESKLP links 106 registrations,
  with zero ambiguous and 17 unmatched. `--reuse-from` reused 121 prior extractions when the final two
  PDFs were added, so only those two were parsed. Three legacy Nurofen numbers still fail exact GRLS
  resolution and remain explicit gaps.
- A source-exact dose projection over the already prepared 123 documents adds 199 proposed dosage
  paragraphs with structured amount/range, frequency, interval, age, weight, and same-paragraph route
  values where explicitly present. It runs after OCR: normalization took about 19.5 seconds and the
  SQLite build about 4.5 seconds. The new
  `grls-instructions-current-123-dose-candidates-v2.db` is preserved next to the older v2 database; no
  source extraction was repeated. Exact-evidence, integrity, and foreign key checks pass. These
  candidates are searchable review data, not calculator-ready regimens.
- Failed batch items are capped by `--max-attempts` (default 3), so exhausted interactive-search
  misses no longer starve later registrations. A real 8-worker verification skipped 21 exhausted
  items and downloaded 8/8 new checksum-valid PDFs in 8.0 seconds. The additive 131-source registry
  was prepared with 123 reused extractions and only eight new OCR jobs in 25.0 seconds. The separate
  131-instruction v2 database has 262 documents, 2,336 sections, 2,020 chunks, 775 proposed facts,
  114 exact ESKLP matches, zero ambiguous matches, and 17 unmatched registrations. Older 116/123
  workspaces and databases were not replaced.
- The next bounded 8-worker batch attempted 32 registrations and added 29 checksum-valid PDFs in
  22.0 seconds; three failures remain retryable. The 160-source registry has 155 OCR candidates.
  Preparation reused all 131 previous extractions and processed only the 29 additions in about
  55.5 seconds. The preserved `grls-instructions-current-160-v2.db` contains 160 instructions plus
  160 registration cards, 2,870 sections, 2,486 chunks, 790 entities, 931 proposed facts, 1,123
  relations, 993 document links, and 193 review tasks. Exact ESKLP crosswalk coverage is 141 matched,
  zero ambiguous, and 19 unmatched. The 45,293,568-byte database has SHA-256
  `e40665735a04f7c17474e047a5d406ca3c67057b27e818f1562ca11e8837a04b`, integrity `ok`, and zero
  foreign-key violations. The 116/123/131 databases remain unchanged.
- The previous 24-instruction OCR sample remains available as a smaller fixture
  (284 sections, 279 chunks, 3,993,600 bytes).
- The PDF importer uses local macOS Vision OCR when the text layer is empty. Tesseract and the `omlx`
  launcher remain unavailable on this machine.
- The existing text-layer pilot remains valid: 8 instructions + 8 registry cards, 156 chunks, 2.7 MB.

## Polite collection of the missing instructions (G1, 2026-10-02)

Owner decision: ГРЛС will not grant database access and its `robots.txt` disallows crawlers; for this
personal single-user build the public instruction PDFs are collected anyway, slowly, and the run
stops as soon as the site starts blocking.

- Command: `medbase-regulated-catalog grls-collect --plan <plan> --output-root data/raw/grls-instructions-active
  --state data/build/grls-instructions-active-state.jsonl --log-dir data/build/grls-collect [--workers 1|2]`.
  Code: `grls_collect.py`. It sends the truthful `User-Agent` `MiniMed-GRLS-collector/1.0 (personal
  single-user offline medical reference; sequential, rate-limited)`, keeps at most two requests in flight,
  sleeps a random 1.0–2.5 s before every request and 2–5 s between registrations, backs off 60 s doubling
  on HTTP 429/503 (honouring `Retry-After`) and stops after five consecutive refusals or network failures.
  A CAPTCHA marker in any page stops the run at once, saves the page to `--log-dir`, and writes
  `BLOCKED-by-site`; a later run refuses to start until the owner deletes that file. It never solves or
  works around a CAPTCHA.
- Resume: state is the existing append-only ledger (`grls-instructions-active-state.jsonl`); the merged view
  takes the latest record per registration across catalog checksums and a success always wins. Order of work:
  transient failures first (connection refused, TLS handshake and read time-outs, 429), then registrations never
  attempted, then non-exhausted search misses. `ФС-` numbers are pharmaceutical substances (the form has a
  separate «Фармацевтические субстанции» switch) and are skipped unless `--include-substances`.
  `STOP` in the log directory ends a run after the current registrations; progress is in `progress.json`.
- Raw files: `pdf/<sha256(registration)>.pdf` as before; an existing file is never replaced (a different
  body is stored as `<name>.<sha12>.pdf`). Each success record keeps `pdfSha256`, `pdfBytes`, `instructionUrl`,
  `recordedAt` (fetch time), `httpLastModified`, `httpEtag`.
- New registrations: the registry export `02.10.2026` (39 481 records, +666 vs 24.07.2026) was fetched with
  `grls-sync` into new files (`catalog-02.10.2026.json`, `grls-02.10.2026.zip`) and planned with
  `grls-instruction-plan` (19 465 targets, 675 not in the old plan, mostly `ЛП-№(…)-(РГ-RU)`).
- Text extraction keeps the existing PDF text layer with the macOS Vision OCR fallback and now records how the text
  was obtained: `textExtractionMode`, `ocrEngine`, `ocrPages`, `ocrMeanConfidence`, `ocrLowConfidenceRatio` in
  the diagnostics and in the prepared document's `metadata.extraction`. `grls-additions-registry` builds a registry
  for downloaded PDFs no prepared workspace has yet; `grls-text-manifest` joins state, plans and workspaces by PDF
  checksum into `data/build/grls-instruction-text-manifest.jsonl` (one row per PDF: source URL, fetch date, OCR flag,
  Vision confidence when known, `unknownWordRatio` against a lexicon from native-text instructions, `textSha256`)
  and `grls-instruction-text-coverage.json` (before/after).

### Daily-batch loop (owner decision 2026-10-02: collect ГРЛС ourselves over time)

The slow single-request run (10–20 s between requests) still hit an image CAPTCHA after 14 PDFs
(05:41 UTC); only the `.aspx` search/card/file-list pages are limited (about 40–50 registrations per window),
the `/InstrImg/` PDFs are static files whose GUID URLs cannot be derived
([research/grls-mirrors-2026-10.md](research/grls-mirrors-2026-10.md)). So the collector now runs as a
plain detached loop (`grls_daily.py`, command `grls-collect-daily`; no cron/launchd):

1. wait until the first attempt time, then **probe with ONE registration**;
2. probe passes → run a batch of at most 50 registrations (stops at the first CAPTCHA or after 5 consecutive
   refusals); probe hits a CAPTCHA → nothing more that day;
3. sleep 24 h, repeat. A CAPTCHA is never solved or worked around; no host, cookie or IP changes; one request at
   a time, 10–20 s pauses, backoff base 300 s on 429/503, truthful `User-Agent`.

Start (already running; first attempt 2026-10-03 05:45 UTC, 24 h after the CAPTCHA):

```
cd tools/ingest && nohup uv run --frozen medbase-regulated-catalog grls-collect-daily \
  --plan ../../data/build/grls-instructions-active-plan-02.10.2026.json \
  --output-root ../../data/raw/grls-instructions-active \
  --state ../../data/build/grls-instructions-active-state.jsonl \
  --log-dir ../../data/build/grls-collect \
  --catalog ../../data/raw/official-grls-registry/catalog-02.10.2026.json \
  --batch-cap 50 --wait-hours 24 --first-attempt-at 2026-10-03T05:45:00Z \
  >> ../../data/build/grls-collect/stdout-daily.log 2>&1 &
caffeinate -i -w <pid> &
```

- Watch: `data/build/grls-collect/progress.json` (`status` running/waiting/stopped/finished, `nextAttemptAt`,
  totals, last windows, `currentWindow.progress` while a batch runs), `daily-loop.log` (one line per window) and
  the per-window `run-*.log` / `window-progress.json`.
- Stop: `touch data/build/grls-collect/STOP` (the loop ends within 30 s, or after the current registration inside a
  window; delete the file before a restart) or `kill -TERM <pid>`. The loop ignores the old `BLOCKED-by-site`
  marker by owner decision; the manual `grls-collect` command still honours it.
- Queue order (`--catalog`): registrations likely to succeed (transient failures and never-attempted) before
  numbers the site did not find; inside each group essential drugs (ЖНВЛП, catalog `essentialDrug = Да`) first,
  then active ingredients with the most active registrations, then registration number; `ФС-` skipped.
  Current queue 8 325 registrations: 2 739 + 3 548 (likely, essential / other), 668 new, 1 370 not-found.
- Ledger: success records now also hold `idReg`, `routingGuid` and all `instructionUrls`; failures that got past the
  search keep `idReg`/`routingGuid` too. `grls-url-ledger` exports `data/build/grls-instruction-url-ledger.jsonl`
  (8 935 registrations with exact PDF URL, checksum, fetch time, ETag/Last-Modified where recorded). `idReg` and
  `routingGuid` could not be backfilled for earlier successes (never logged); a re-download of those needs the
  `.aspx` lookup once, a re-download of a known URL needs only the static file.
- Pace: unknown until the first windows complete. At ~85 s per registration a window of 50 takes ~70 min; at one
  window per day the remaining 8 325 would take years, so the order above matters.

### Restart after a reboot (2026-10-13)

The loop is a plain detached process, so a reboot or logout ends it (it died with the reboot of 2026-10-05 10:16; nothing
restarts it, and no LaunchAgent is installed on purpose). It is resumable: state is the append-only ledger and
`progress.json` keeps the next attempt time. To start it again, from any checkout (the private data lives in the
main checkout):

```
MINIMED_ROOT=/Users/d/Projects/Personal/MiniMed /Users/d/Projects/Personal/MiniMed/scripts/grls-collect-daily.sh start
```

`status` prints the pids, the loop status, next attempt and coverage; `stop` writes the `STOP` file. `start` refuses
to run a second instance, starts the same command as above (`--queue groups --manifest …`, 50 per window, 24 h) in its
own session with `caffeinate`, logs to `stdout-daily.log`, and passes the previous `nextAttemptAt` as
`--first-attempt-at` when it is still in the future, so a restart never adds a window. After a longer gap it probes
with one registration first. A CAPTCHA is never solved or worked around; do not run several instances.

Group representatives now prefer an EAEU number (`ЛП-№(…)-(РГ-RU)`) over the older national formats: since 2026-10-04
31 of 31 EAEU picks were found by the search against 3 of 16 older numbers. A loop started before that change picks it
up after `stop` + `start` on a checkout that contains `grls_groups.py` from 2026-10-13 or later.

### Sister registers (Belarus, Kazakhstan; G2, 2026-10-13)

The EAEU dossier number is shared by all member states, and `rceth.by` and `register.ndda.kz` publish the dossier's
leaflet and ОХЛП without a CAPTCHA. `medbase-eaeu-sister-registers` (`eaeu_sister_registers.py`) lists their EAEU
entries, matches the missing Russian registrations by dossier number (377 registrations, ЖНВЛП 190, 1 018 documents),
downloads politely into `data/raw/eaeu-sister-registers/` (source class `eaeu-sister-register`, never into the ГРЛС
raw tree) and writes a manifest with country, URL, checksum and fetch time per file. Commands and numbers:
[research/drug-sources-2026-10-13.md](research/drug-sources-2026-10-13.md). Resume/finish the download:

```
cd tools/ingest && uv run --frozen medbase-eaeu-sister-registers collect --country BY --country KZ \
  --plan ../../data/build/grls-instructions-active-plan-02.10.2026.json \
  --grls-state ../../data/build/grls-instructions-active-state.jsonl \
  --catalog ../../data/raw/official-grls-registry/catalog-02.10.2026.json \
  --grls-raw-root ../../data/raw/grls-instructions-active \
  --raw-root ../../data/raw/eaeu-sister-registers --max-documents 2000
```

### Real-difference queue: one text per «МНН + лекарственная форма» (owner decision 2026-10-04)

A window reaches the CAPTCHA after only ~13–14 registrations (2026-10-03 and 2026-10-04 alike), so the queue
is no longer «every registration» but groups (`grls_groups.py`, pure and tested):

- Group key = normalized INN (components of a combination sorted; no INN → trade-name tail) + dosage-form
  class (`dosage_form_class`: parenteral — includes порошок/лиофилизат/концентрат «для приготовления раствора
  для … введения/инфузий» —, oral-solid, oral-liquid, topical, eye, ear, nasal, inhalation, rectal, vaginal,
  transdermal, dialysis, implant, dental, herbal; `субстанция…` and `ФС-` are excluded). 27 049 active
  non-substance registrations form 4 383 groups (852 without INN).
- A group is covered when any member holds an instruction PDF (a canonical EAEU item covers the registrations it
  requests). Each uncovered group gets ONE representative: a foreign holder (originator) first, else the earliest
  registration date; registrations already failed twice are skipped, so a dead representative is replaced at the
  next window. The catalog has no instruction-change date, so «latest instruction change» is not used.
- Order: ЖНВЛП groups (any member `essentialDrug = Да`), then larger groups, INN-less tail last. Second pass
  (appended): groups where we hold only a листок-вкладыш get one EAEU registration revisited for the ОХЛП.
- Every card visit now downloads ALL documents of the current edition (inside each instruction entry the newest
  «Изм. №»; at most 4) and keeps the raw card JSON in `data/raw/grls-instructions-active/cards/`. Per document the
  state/URL ledger keep `kind` — `ohlp` / `leaflet` / `national-instruction` / `unknown` — from the first pages
  (`classify_document_kind`); the text manifest re-derives it from the extracted text (`documentKind`, one row per
  document, extras as `<id>.d<k>`). Today's sample of 8 956 prepared PDFs: 3 816 leaflets, 4 677 national
  instructions, 5 ОХЛП, 465 unclassified (scans).
- `progress.json` now has `coverage`: `groupsCovered/groupsTotal`, `essentialGroupsCovered/Total` (ЖНВЛП),
  `ohlpDocuments`, queue sizes (`queueFirstPass`, `queueSecondPass`, `essentialInQueue`), `unreachableGroups`
  (only legacy-format numbers or twice-failed members) and `measuredAt`; totals survive a loop restart.
- Restarting the loop (new code, same wait): stop with `STOP`, then start the same command with
  `--queue groups --manifest data/build/grls-instruction-text-manifest.jsonl --first-attempt-at <nextAttemptAt>`.

State on 2026-10-04: groups 2 954/4 383 covered (67 %), ЖНВЛП groups 958/1 138 (84 %); first-pass queue 1 041
groups (177 ЖНВЛП), second pass 854 leaflet-only groups, 388 groups unreachable. Pace stays ~14 registrations per
window, i.e. per day: the ЖНВЛП groups take ~2 weeks, the first pass ~2.5 months (40–100 days if windows vary
between 10 and 25), the ОХЛП pass another ~2 months, and whether cards of leaflet-only groups hold an ОХЛП at all
is unknown until the first revisits (the one EAEU card read for this work listed a single document).

First run (2026-10-02 05:02–05:09 UTC): 30 new PDFs, then a CAPTCHA page after about 140 requests at roughly
2 requests per 5 s with two workers; collection stopped and is not resumed (see `BLOCKED-by-site`). Coverage:
12 659 of 28 731 active registrations had instruction text before (44.1 %); against the 02.10.2026 registry
12 579 of 29 365 (42.8 %; the registry grew by 634 active registrations and some left it). Distinct texts 8 874 → 8 904,
OCR share 25.8 % of documents with text (2 290 → 2 298). Failures by reason for the active registrations: transient
6 319, search-miss 1 224, substance (`ФС-`) 2 291, deferred legacy/ambiguous numbers 2 420, forbidden 72, no PDF 73,
not attempted 675. To resume, the owner decides; a cautious restart would use one worker and several seconds
between requests, and must stop again on any CAPTCHA.

## Released instruction modules (GI1, 2026-10-05)

The prepared instructions (`data/intermediate/grls-full-final` + the G1 addition workspaces, joined by
`grls-instruction-text-manifest.jsonl`) are built into one module per ATC level-1 group by
`tools/ingest/scripts/build_grls_instruction_modules.py build --out data/build/grls-instruction-modules`
(group = the ЕСКЛП module listing the registration, otherwise «без АТХ»), then
`medbase compact-module-search`, `bun scripts/package-instruction-modules.ts --family grls …` and
`scripts/publish-module-zstd-mirror.sh --family esklp --tag grls-instructions-<date>-<digest> --create`; numbers,
paths and the browser check are in `CURRENT_STATE.md` («GI1»). The builder keeps the PDF's prepared Markdown body
byte-exact and adds the manifest's kind, fetch date, OCR flag and quality values to the front matter. A later
collector window is a new module version (or extra modules) through the same steps; a registration the daily
loop adds reaches users only with such a refresh.

The manufacturer-site documents (M1) are a separate module with their own source class, built by
`tools/ingest/scripts/build_manufacturer_instruction_module.py` and packaged with `--family manufacturer`; see
`CURRENT_STATE.md` «Manufacturer-site instruction module».

After every instruction-module refresh (new GRLS documents, a new manufacturer-site module) rebuild the same-substance fallback
asset with `bun run content:substance-fallback` and commit `apps/app/src/features/medications/substance-fallback.json`: it lists,
for registrations without an own text, the donors whose documents the modules now hold
([ADR-0023](adr/0023-same-substance-instruction-fallback.md), `CURRENT_STATE.md` «Same-substance instruction fallback»).

## OCR quality pass (OCR1, 2026-10-14)

The OCR-derived texts are re-prepared by `tools/ingest/scripts/grls_ocr_vision_cache.py` (the same Vision engine,
raw payload and per-line confidence cached in `data/build/grls-ocr-vision`, intermediate) and
`tools/ingest/scripts/grls_ocr_requality.py lexicon|run|siblings|manufacturer`. Rules and measurements:
[research/ocr-quality-2026-10-14.md](research/ocr-quality-2026-10-14.md), `CURRENT_STATE.md` «OCR1». The result is a
second prepared workspace (`data/intermediate/grls-ocr-cleaned`) and the overlay `data/build/grls-ocr-quality.jsonl`
(one row per PDF checksum: workspace, content kind, quality grade, confidence, counters); the text manifest and the
collector's workspaces are not modified. `read_manifest_rows` of the module builder joins the overlay, so
`build_grls_instruction_modules.py` builds from the cleaned text, and `content/grls-reviewed-ocr/` still wins for a
reviewed document. New OCR documents the collector delivers are cleaned by running the same two scripts (the cache
step takes `--checksums`).

## Leaflet contents lists (LEAF1, 2026-10-15)

The table of contents of a patient leaflet («Содержание листка-вкладыша») is kept as one list. The recogniser
(`tools/ingest/src/localmed_ingest/leaflet_contents.py`) reads the extraction JSON that sits next to every prepared
Markdown; `render_body(..., contents_lists=True)` writes the list as one block (source marker `"role":"contents"`
with the ids of every block it covers) and `tools/ingest/scripts/grls_contents_lists.py plan|apply|manufacturer`
re-renders only the bodies of the documents that have one into a new workspace
(`data/intermediate/grls-contents-lists`, front matter byte for byte) plus the overlay
`data/build/grls-contents-lists.jsonl` (new workspace and `textSha256` per document id, the recognised lists).
`read_manifest_rows` joins it after the OCR1 overlay. A new collector delivery needs `apply` again before
`build_grls_instruction_modules.py` (the manufacturer workspace: `manufacturer`, which writes `prepared-contents`).
Measurements and the modules rebuilt from it: `CURRENT_STATE.md` «LEAF1».

## Re-extracting the text-layer PDFs (MOD-REBUILD, 2026-10-20)

A change to the PDF extraction (heading rule, private-use glyphs) reaches the modules only through a new `medbase
prepare` of the workspaces. Without re-running OCR: hardlink the extraction JSON of every non-text-layer document
(`diagnostics.textExtractionMode != "pdf_text_layer"`) of `grls-full-final`, `grls-g1-additions` and
`grls-g1-additions-2` into one reuse workspace (`<dir>/.localmed/extractions/`), prepare each workspace with
`--workers 8 --reuse-from <dir>` into a new directory (registries: `data/build/grls-instructions-full-registry.json`,
`data/intermediate/grls-g1-additions(-2).registry.yaml`; source root `data/raw/grls-instructions-active`; ≈ 55 min on
a busy machine), swap it in, refresh `textSha256` of the changed manifest rows (the digest of
`grls_text_manifest._text_digest`), then `grls_contents_lists.py apply`. The preparer writes the leaflet contents
list itself since LEAF1, so `apply` re-renders only the OCR-cleaned leaflets and reports the rest as `notReproduced`
(already re-rendered). A render-only change (heading levels, `render_body`) needs the same prepare with
`--reuse-from <the workspace itself>` (no extraction, minutes). Bump `PACK_VERSION` before the build, or installed
copies keep the old module. Numbers and the procedure for the other families: `CURRENT_STATE.md` «MOD-REBUILD».

## Next action

Continue the repaired current-site resolver in bounded eight-worker batches. Use
`medbase prepare --workers 8`; output remains deterministic and memory is bounded to eight in-flight
extractions. Use `--reuse-from <previous-workspace>` when extending a checksum-compatible snapshot so
successful OCR is not repeated. Exact instruction sections may be stored as proposed official-label
facts. Run automated structural and applicability review over the proposed dosage candidates before
promoting any regimen to calculator-ready support; do not infer missing medical claims or join a dose
to a population across ambiguous paragraphs.

### Targeted fetch for the herbal book (2026-10-19)

Five registrations of plain herbal raw material (бессмертник ×3, бузина, тмин) were fetched outside the daily loop with
`grls-collect --registration … --workers 1 --min-request-delay 10 --max-request-delay 20 --include-exhausted
--log-dir data/build/grls-collect-herbal` (same plan, ledger and raw root, so the loop sees them as covered), then
registered with `grls-additions-registry` (filtered to those five), prepared with `medbase prepare` into
`data/intermediate/grls-herbal-additions` and given a separate text manifest
`data/build/grls-herbal-additions-manifest.jsonl` (rows of `grls-text-manifest` for those five). The global text manifest
was not regenerated. grls.rosminzdrav.ru needs no Russian root certificate.
