# Current state

> Updated: 20 October 2026
> Released version: `0.6.62` (public prerelease toward `1.0`)
> Next planned step: the WebView (Capacitor) app is the product again and the native port is frozen
> (user decision, 2026-10-01, after [native-vs-webview-2026-10-01](research/native-vs-webview-2026-10-01.md);
> the HyperOS 60 Hz cap was per package, not WebView). Ordered work: smooth first boot (W1), the
> Chromium-like reader (W3) and the knowledge-base audits K1/K2 — see `STATE.md`.

This file records what exists now, its trust boundaries and the ordered next work. Keep it short:
append dated measurements to `docs/state/` or `docs/research/`, and link them from here. The target
architecture and acceptance gates live in [TECHNICAL_PLAN.md](TECHNICAL_PLAN.md).

Detailed history, moved verbatim on 2026-09-24:

- [state/branch-log-2026-09.md](state/branch-log-2026-09.md) — dated PR #174/#180 entries
  (definition reference R1–R2, source intake, spelling, reverse definitions, RapidFuzz).
- [state/implemented-0.6.39.md](state/implemented-0.6.39.md) — implemented behaviour, verified
  baseline and runtime benchmark up to the 0.6.39 release.
- [state/ecg-research-log.md](state/ecg-research-log.md) — ECG digitizer, rule layer and every
  measured or rejected model/engine candidate.

## Next after 0.6.60 (ordered) — 2026-10-15

**Added 2026-10-20 (PHONE-QA), first:** a release so `org.med.web` and the drug-screen rework reach the phone. The
modules with the ingest fixes are already published (MOD-REBUILD below); the catalog reaches an installed app by
itself (`publishedAt` 2026-10-20T19:00Z, `minAppVersion` unchanged).

Release 0.6.60 shipped after two QA passes (docs/research/qa-release-0660-2026-10-15.md; re-check: 11 of 15
fixed, 3 partly, 1 not, 2 new low). Ordered next work:

1. **Device check of the module shelf (MEM1)** on a phone / Android WebView: ~800 OPFS handles in one pool,
   memory, first-start migration time (7–10 s for 774 modules on desktop), startup-to-searchable after a
   full install (13–17 s on a loaded desktop; a cold query took 9–10 s).
2. **Drug search leftovers (QA 12)** — owner 2026-10-15: fix generally, cards from fields (search step 1). Started and paused
   (owner's weekly limits): the label prose is in the core pointers too («Стандартизированное МНН: …», «ТН: …; форма/дозировка:
   …», «Полные данные находятся в скачиваемом модуле «minimed…»»), so the fix is a builder change + core rebuild + the 15
   ЕСКЛП modules, then deleting the regex layer in `search-result-presentation.ts`; gates: every benchmark before/after. «МНН записи: …, ~.» still on cards/snippets; «АМОКСИЦИЛЛИН» and
   «Амоксициллин» still two cards; «статины при беременности» lists «Острый промиелоцитарный лейкоз».
3. **Drug screen class line (QA 13)**: primary class shows the long registry phrase + code, not
   «N02BE51 · анилиды» on cards that have a pharmacological-group link; Цитрамон has no «также:» (by
   decision, owner may override).
4. **Downloads**: «Скачать всё · 3,1 МБ» stays offered after everything is installed and queues nothing;
   «передач: 4 из 3»; the downloads page fetches the sqlite wasm ~30× in 12 s.
5. **Interaction checker**: no suggestions and no loading line for 14–30 s while its index loads.
6. **Drug card**: mixed decimal separators («0.58 мг» vs «0,58 мг») in «Доступные дозировки».
7. **Core rebuild** (`content:core:build`) to pick up DOSE1's pointer repair (2 815 titles, «(НЕ УКАЗАНО)» in
   1 872 chunks); the app hides them meanwhile. Refresh `packages/test-fixtures` core-slice titles.
8. **ЕСКЛП source**: the str1 modules were repaired from the published packs (source archive not on this
   machine); the next ЕСКЛП refresh rebuilds them from source with the fixed builder.
9. **Owner decisions (2026-10-15)**: МКБ-11 gets its own search section (expected to come into use in Russia
   soon) — done (ICD11-SEC, «МКБ-11 search section» below); pheniramine and the five «противоаллергическое» cold remedies keep the antihistamine
   class (the component's own ATC R06AB backs it; rule: a secondary class needs the component's
   classification or a clearly similar effect, not every listed effect); the «Результат записан в
   защищённую карточку» toast stays; the superseded first-pass dataset branches
   `datasets/grls-instructions-2026.10.15-8e814530e861-kd1` and
   `datasets/manufacturer-instructions-2026.10.15-230904b5fadb` were deleted (owner, 2026-10-15; superseded
   by the `…36a501e7f136-kd1` and `…4054ceb93a8a` builds).
10. **Weaker TOOLS-A/B sources — reviewed 2026-10-19** (owner): APRI keeps 0.5/1.5/2.0 with WHO 2016 HCV
    table 6.4 as a second source and the WHO hepatitis B cut-offs as a limitation; GCS bands 13–15/9–12/3–8 now
    cite Rimel 1982 (NICE NG232 gives action thresholds only) and the Teasdale PMID is fixed (4136544); ATLS
    10th-ed. classes via Rossaint 2023 table 2 — ≤30 % is class II, 31–40 % class III, >40 % class IV, with
    Mutschler 2013 as a limitation; GIR stays unbanded with the ESPGHAN 2018 ranges and 12 mg/kg/min ceiling in
    its limitations; Silverman–Andersen bands 0 / 1–3 / 4–6 / 7–10 (Hedstrom 2018: thresholds not validated);
    CPR and UtA-PI stay unbanded (Ciobanu 2019 is not open; INTERGROWTH-21st UA-PI equations are CC BY and could
    be added later). Still no clinician sign-off.

## Modules rebuilt with the 2026-10-20 ingest fixes — 2026-10-20 (STATE MOD-REBUILD)

The PHONE-QA ingest fixes (private-use bullet glyphs, Excel dates, mid-word chunk cuts, heading levels) reach the
phone through four new additive mirror branches; nothing published earlier was touched. Catalog `publishedAt`
2026-10-20T19:00Z, `catalogVersion` `mod-rebuild.2026.10.20`; 389 entries changed (only `version`, `artifacts`,
`sizes`, КР `documentTable`, the manufacturer `sourceSetDigest`), `minAppVersion` unchanged (0.6.46 КР, 0.6.48 drugs).

| family | branch (version) | modules | download | installed |
| --- | --- | ---: | --- | --- |
| ГРЛС instructions | `datasets/grls-instructions-2026.10.20-4b6befe857de-kd1` (`grls-2026.10.20.kd1`) | 15 | 222.5 → 221.3 MB | 1 306.3 → 1 293.5 MB |
| manufacturer site | `datasets/manufacturer-instructions-2026.10.20-cb9d2ece8ef5` (`manufacturer-2026.10.20`) | 1 | 7.2 → 7.1 MB | 45.2 → 44.7 MB |
| ЕСКЛП | `datasets/esklp-2026-08-28-str2` (`2026-08-28.str2`) | 15 | 68.7 → 69.0 MB | 1 429.7 → 1 438.5 MB |
| JSON КР | `datasets/clinical-json-2026.10.20-23375280029c` (`0.6.0-json.f6fc344ca9b8.kd1`) | 358 | 370.0 → 370.0 MB | 912.5 → 914.5 MB |

- **ГРЛС** (8 946 documents): the 6 663 text-layer PDFs were extracted again (`medbase prepare`, the 2 302 OCR
  extractions reused from a hardlinked reuse workspace), the workspaces `grls-full-final`, `grls-g1-additions(-2)`
  replaced, `textSha256` of the text manifest refreshed for the changed bodies. The preparer now writes the leaflet
  contents list itself (`contents_lists` for official instructions), so `grls_contents_lists.py apply` re-renders only
  the 196 OCR-cleaned leaflets (3 592 others already hold the list; 3 788 in all, LEAF1 had 3 787). Private-use glyphs
  in chunks: **94 411 in 12 507 chunks of 2 295 documents → 0**; chunks cut mid-word 175 → 0; sections 197 336 → 199 415,
  chunks 229 370 → 227 984. KD1: 2 512 indication passages encoded, 6 924 vectors reused byte for byte.
  Spot checks: Анаприлин Реневал «Показания к применению» is a list («- при артериальной гипертензии;» where the
  published module had a tofu box); Ибупрофен opens with registration, composition, pharmacology, then indications.
- **Manufacturer site** (271 documents): the 251 PDFs re-extracted (16 OCR reused); the 21 DOCX texts regenerated
  from the raw files with the new `docx_text` (19 changed: Word tabs are spaces now, «сахароза (сахар)42,2 мг» →
  «… 42,2 мг»; symbol bullets and numbered lists kept). Private-use glyphs 220 chunks / 67 documents → 0, mid-word
  cuts 27 → 1. The workspace is `data/intermediate/manufacturer-instructions-m1` (rebuilt in place).
- **ЕСКЛП**: `repair_esklp_strengths.py apply` from the pre-str1 published copies (9 groups ATC3, 5 ATC2, antiparasitic
  the original compacted build; the str1 modules themselves are refused because their card text is already repaired),
  so str2 = the STR1 dosage repair + `esklp_text`: Excel serial dates in **112 583 chunks and all 3 324 cards → 0**
  («Период действия: 45674.0» → «17.01.2025»), damaged primary-package quantity tails dropped from the text of 10 129
  chunks (the raw value stays in `primaryPackageRaw`). Chunk ids, sections and anchors unchanged.
- **JSON КР**: all 774 current КР built from the raw JSON (`build-documents`, committed July + 2026-10-02 plans) with
  this code and, as the control, with the code before the PHONE-QA fixes (worktree at `42330703`):
  **360 modules changed** by the fixes, 414 identical. 694_2 and 713_2 are among them but stay as published (their
  importer drift hides three appendix titles, as in KR5), so 358 were republished. Their chunk text is unchanged
  except the private-use glyphs of 15 modules (bullets → «-», «≤», «λ», «[160, 161]», Wingdings checkboxes → «☐»; in
  845_1/846_1/847_1 two marks after a fill-in line became «χ», a guess of the Symbol font). No section title that was
  visible in the published module is hidden in the rebuild (checked on all 358); 7 483 of 51 766 chunk ids changed,
  34 section ids. KD1: 7 575 passages encoded, 44 191 reused.
- **Fixed while rebuilding** (`tools/ingest`, tests added):
  - `markdown_parser.expand_grls_instruction_sections`: a standard heading found inline in the text of a section
    that is itself a standard heading becomes its sibling unless it names a part of the same kind («Передозировка»
    was under «Побочное действие», «Беременность» under «Противопоказания»; wrong canonical nesting in a 1 500-document
    sample 6 972 → 3 582, the old text with the same rule 3 337); a section whose text opens with another standard
    heading keeps its own title (the leaflet's «2. О чем следует знать перед приемом препарата …» was dropped).
  - `pdf_import._split_heading_block`: a bold run followed by an all-capitals rest is one title set in two styles
    («Амлодипин Реневал ИНСТРУКЦИЯ» + «ПО МЕДИЦИНСКОМУ ПРИМЕНЕНИЮ …» became two level-1 headings; 5 ГРЛС PDFs).
  - `numbered_headings.reconcile_heading_levels`: a sub-part that repeats its part's number («3.3 Подраздел 1» under
    «3.3 Иное лечение»), a misnumbered sub-part («2.1.5 …» under «2.5 Иные исследования») and unnumbered labels under a
    moved numbered heading («Показания для плановой госпитализации:» under «6.1 …») keep their place; «3.1.Особые …»
    (no space) is read as a number. The first rebuild had hidden a visible title in 13 КР; now in none.
  - `scripts/republish-clinical-modules.ts --marker kd1` (the version suffix was fixed to `.e5`).
  - Module versions: `grls-2026.10.20`, `manufacturer-2026.10.20` (a same-version rebuild would not reach installed copies).
- **Derived data rebuilt** from the new local copies (`MODULE_DIRECTORIES` of the five builders and
  `content:substance-fallback` point at them): interaction, safety, comparison (`CMP1_ESKLP_DIR` = the str2 modules)
  and dose-rule indexes; the substance fallback is identical. Dose rules: cards with a rule 2 231 → 2 242 (1 lost, 12
  gained), 2 804 documents with identical values, 121 changed (80 gained rules from text that is no longer glued or
  boxed), 66 documents added and 51 dropped (their cards are covered by another document of the same registration).
- **Verified:** every new mirror URL (31 drug modules, 358 КР) returns the catalog's size and SHA-256 and decodes to its
  decoded checksum (`verify-module-artifact.ts --url`), `access-control-allow-origin: *`; per document, no word of the
  published chunk text is missing from the rebuild except rejoined hyphenated fragments («заболеван|иями»), the
  re-segmenter's own canonical titles where the PDF now gives the real heading («Хранение препарата» →
  «5. Хранение препарата Кладрибин-Промомед») and headings glued to their first sentence that are now split.
- **ЕСКЛП mid-word cuts — re-chunk repair not worth doing now:** of the 112 727 continuation chunks
  (`sourcePartOffset` > 0) of the 15 modules, 112 707 are in «Торговые наименования» and 18 in «Формы и дозировки»,
  the two registry sections the drug screen no longer shows (PHONE-QA); a repair would change ≈ 113 000 chunk ids for
  text no reader shows. The next ЕСКЛП refresh from the registry archive builds them with `split_long_text`.
- **Local copies:** `output/module-zstd-{grls,manufacturer}-h2-2026-10-20`, `output/module-zstd-esklp-str2-2026-10-20`,
  `output/module-zstd-json-2026-10-20` (the LEAF1/STR1/KD1 copies stay as rollback). Build intermediates deleted.
- **In the app** (Chromium, production build, `E2E_PORT=4398`, the local copies of the published bytes): 10 of 10 e2e
  pass — `drug-leaflet-contents` (Вермокс, Декарис, Гелмодол, Празиквантел: one contents list of six entries),
  `medication-instruction-fallback`, `module-pointer` (5, ЕСКЛП str2 + КР), `kr-appendix-heading-modules` (655_2 and the
  rebuilt 283_2, 739_2). The e2e fixtures (`medication-module-fixture.ts`, `module-pointer`, `kr-appendix-heading-modules`,
  `many-modules-reload`) read the 2026-10-20 copies. The mirror-download spec (`GI1_MIRROR_E2E=1
  grls-instruction-modules.spec.ts`) downloaded the ЕСКЛП group and its instructions from the new branches and showed the
  text once, then failed at the «Информация» source link; on two more runs Мефлохин (whose only document is an
  amendment sheet, unchanged by this rebuild) stayed «Официальной инструкции … нет» — a drug-screen flow left from
  PHONE-QA, not the data.
- **Not verified:** a phone; the e5/KD1 search quality on the changed indications (benchmarks run on the core and the
  older local КР set only); a physician review of any text.

## Owner phone QA — 2026-10-20 (STATE PHONE-QA)

The owner tested 0.6.62 on a Xiaomi/HyperOS phone (21 items + three extras). What changed:

- **Drug card leads with clinical content (items 10, 21).** The ЕСКЛП card never shows its registry
  sections as the body (`substance-reading.ts` `withoutRegistrySections`: «Торговые наименования» — 111
  chunks / 344 KB for propranolol, the «144 pages» —, «Формы и дозировки», «Сведения о
  стандартизированном МНН», «Ограничения данных»). One tap from search on a substance lands on: name,
  a folded «Формы:» line (`substanceForms`: «Таблетки 10 мг, 40 мг · Раствор для приема внутрь 3,75
  мг/мл»), class/ATC, trade names, then the official instruction of the best-fitting trade name
  (`representativeInstructionProduct`: own text, ГРЛС before a holder's site, tablets/capsules, adult
  before children's forms, the INN-named trade name, most presentations) with a small «Инструкция:
  Ибупрофен · ЗАО МЕДИСОРБ» line that opens that trade name. While it is looked up a small loader sits
  under the header. A trade name opens on its reference text (Allmed/Видаль) when there is one, else on
  the instruction (`medicationReadingChoices`), never on the bare registry card.
- **«Информация» (items 10, 19).** Every official reader has «⋯» → «Информация»
  (`DocumentInfoDialog`): kind, edition, status, audience, sources, the instruction's kind/edition/source
  link/fetch date and, on a drug card, the registrations one line each (`registrationRows`: name, forms,
  holder, number; packages, prices and barcodes left out). The title line shows only kind and audience
  (`readerMetaParts`); the drug footer, the outline's «Сведения об источнике» (which printed raw
  `sourceType`) and the instruction panel's edition/source/date rows are gone from the page.
- **One download (item 16).** Installing a drug group's ЕСКЛП module queues the same group's ГРЛС
  instruction module in the same step (`module-companions.ts`, called from
  `BrowserContentModuleRuntime.install`, so pointer, ATC group, section and «Скачать всё» paths all
  get it); the pointer's size includes it (`companionBytes`), and a drug card whose instructions are
  already downloading follows that task («Скачиваем инструкции · N %») and opens the text when done.
  Verified in the dev app with ибупрофен (19 МБ → card → instruction). Groups installed before this
  change still show the one-tap offer.
- **Header tools (items 15, 20).** No bookmark and no recipe icon beside any title
  (`ReaderTitleRow`, `DrugScreenHeader`): «Рецепт» (drug cards) and «Сохранить в коллекцию» are «⋯»
  items; the collections panel anchors on the menu (`ItemBookmarkMenu hiddenTrigger`). Drug titles are
  smaller and balanced. The recipe sheet has no «Ребёнок / Взрослый» switch (the group follows from age,
  or mass via `assumedGroup`), and «Расчёт доз в этой версии выключен» is gone. The patient row's button
  is a chooser chevron, not the avatar's people glyph.
- **Search (item 17).** A result card shows one fragment; tapping it or the title opens the document at
  that fragment. «Ещё N фрагментов» and the in-search context card are gone.
- **Onboarding (items 2–4).** One line while the base downloads («Продолжаем настройку приложения в
  фоне. Давайте посмотрим возможности!»), no download speed anywhere (`download-speed.ts` deleted),
  back is an arrow icon, and a first run pins five catalog tools under the search field
  (`STARTER_TOOL_IDS`: CKD-EPI 2021, CHA₂DS₂-VASc, CURB-65, GCS, PHQ-9; a test keeps them in the
  bundled catalog).
- **Disclaimers (owner rule).** Removed: the ECG tour notice (item 5), «Решение за врачом» on the safety
  card, «не заменяет…» lines (search help, herbal book, ECG report, user calculators), «не является
  диагнозом» of user questionnaires, «версия бланка не проверялась», «требует проверки специалистом» in
  the ECG calculator, the ЕСКЛП «Ограничения данных» block. AGENTS.md «Interface rules» now says so.
- **Pause badge (item 1).** Already removed in main by 472f3808 (after the 0.6.62 build the owner
  has); `download-pause.spec.ts` now asserts nothing floats above «Настройки».
- **120 Hz (item 18).** The Android application id is `org.med.web` (HyperOS keeps a per-package 60 Hz
  cap on `dev.localmed.search`; the same app as `org.med.web` ran at 120 Hz on the owner's phone,
  docs/research/native-vs-webview-2026-10-01.md). The Java namespace stays `dev.localmed.search`. The new
  id installs as a separate app: the old app's local data (patients, notes, downloads) does not move; a
  debug-signed `org.med.web` from the 10-01 measurement must be uninstalled first.
- **Downloads page / not found (owner, same session).** The downloads footnote («Одновременно идёт до
  трёх…») and the idle «через одну очередь» line are gone; the empty state sits on paper for contrast.
  «Документ не найден» (damaged address and in-reader) is a centred state with a mark, one line and
  «Искать в базе».
- **Smaller.** «Тесты и опросники» cards lost the repeated «Раздел тестов» kicker and are compact.
- **Toasts (item 7).** At the top edge (safe-top + 0.5 rem; below the recorder bar while recording), on the
  `.paper-card` surface with `--shadow-paper` and a close shadow, radius 1.25 rem, slide + fade on the motion
  tokens; the card lets taps through except its close button and action (`styles/notifications.css`, e2e
  `notification-style.spec.ts`).
- **Feed (item 8).** With no subscription the suggested sources are a two-column grid of tiles
  (`NewsSourceGrid`): a tap opens the source sheet (preview only then), a «+» subscribes in one tap; nothing is
  requested before a tap (ADR-0024). The web build lists only the four sources a browser can read and has no
  APK banner (owner, same day).
- **Keyboard (item 6).** Capacitor `SystemBars` pads the WebView by the IME height, so the fixed bar rode up.
  While a text field is focused (from focus on touch devices, before the resize) `html.app-keyboard-open`
  slides the bar below the edge, with a 700 ms grace while the keyboard closes; the focused field is scrolled
  into view (`app/soft-keyboard.ts`, e2e `soft-keyboard.spec.ts`). Other bottom-fixed controls (reader dock,
  history button) still ride up.
- **Ibuprofen ranking.** «Ибупрофен: официальная инструкция» put a qualifier-only document first: «инструкция»
  is two edits from the alias «деструкция» (its terms «вирусные бородавки» joined the query and the speller
  rewrote the query), and «официальная» counted as a subject word. Meta words never fuzzy-match an alias, the
  speller skips them, «официальн»/«аннотац» are meta stems (`packages/search-lexical` `lookup-subject.ts`,
  `aliases.ts`, `analysis.ts`; `packages/core` `name-variant-fallback.ts`). Now: ibuprofen instruction, then the
  ИБУПРОФЕН card. New `tools/benchmarks/lookup-qualifier-queries.json` (4 queries × «Все»/«Препараты») is part
  of `benchmark:all` (core 0/8 → 8/8, release 4/8 → 8/8); every other benchmark unchanged.
- **Source text (items 12, 14, headings) — fixed in `tools/ingest`, NOT yet in the published modules.**
  Symbol/Wingdings private-use glyphs (U+F0B7 ×76 523, U+F02D ×13 536 …; 2 295 of 8 947 ГРЛС instructions)
  become Markdown list items or the real character (`private_use_glyphs.py`, applied at PDF extraction, Markdown
  rendering and module build); ЕСКЛП Excel serial dates become dd.mm.yyyy (`esklp_text.py`; 46069 = 16.02.2026);
  long paragraphs are no longer cut mid-word at 3 200 characters (`split_long_text`; the source of «у мл / паковка»
  and «Период действи | я»); heading levels follow the numbering in JSON КР (`reconcile_heading_levels`, 419 of
  1 259 КР change) and the PDF heading rule no longer promotes sentences, references, dates or contents lines and
  joins wrapped titles (230-PDF audit: anomalies 18 → 1). On screen today the ЕСКЛП listings are simply not the
  body any more; the modules were rebuilt and published the same day (MOD-REBUILD, the section above this one).
- **Checks.** `bun run check`, `typecheck`, `test` (unit 13 930 + Python 1 976), `build`, `python:check`,
  `benchmark:all`, `native:source:check` pass. E2E run on the build (port 4397): search, first-screen,
  drug-screen-first-screen, prescription(-facts), medication-instruction-fallback, medication-safety,
  user-calculators, ux7/ux8, reader-layout-preview, download-pause, news-feed, notification-style,
  soft-keyboard, native-chrome, reader-open-once, offline-shell, module-lifecycle all pass; specs were updated
  for the intended changes (starter pins, no search context card, edition in «Информация», drug cards opening
  on the instruction, companion download). The search «Разделы» count test had been failing since the
  «Травник» shortcut (HERB1) and now counts section buttons only. A trade name whose instruction is found
  after it opened (another registration's text, or instructions that just arrived) moves to it unless the
  doctor chose a tab (`adoptResolvedProduct`).
- **Not tested on a phone:** 120 Hz under `org.med.web`, keyboard/IME and nav behaviour with 3-button navigation,
  the status-bar strip under a real inset, toasts on device. Checked in Chromium at 375×812 and by the specs above.

### Reader opening, status-bar strip and loading skeletons (items 9, 11, 13)

Owner (0.6.62 on HyperOS): a gradient at the bottom while a document loads, a see-through strip under the
status bar while reading, spinner-only loading screens without a back button.

- **Opening (generic reader).** Measured on the production build, 375×812 Chromium, CPU throttled 4×, КР
  «Гастрит и дуоденит у детей» (41 sections), warm app: first section painted 2.0–2.4 s → 0.85–1.05 s, longest
  main-thread task 1.0–1.2 s → 0.32 s, every section mounted 3.9 s → 2.4 s. Causes, in order of cost: the tool-link
  matcher ran one alternation of ~700 phrases at every position of every paragraph (now a first-word hash scan and
  a per-word phrase check, `tool-link-matcher.ts`; cold 250 → 14 ms per 220 k characters at 1×) and re-read both
  registries per paragraph (`document-tool-links.ts` rechecks at most every 750 ms); every embedded picture's data
  URL was validated by a regexp three times (`readDocumentRenderBlock` is now kept per metadata object); the
  «same document family» exclusion of the link matcher was recomputed per candidate (memoised); table width was
  read per table (batched read-then-write in `document-rich-block.tsx`). Sections are mounted by text weight, not
  by count: the first slice is about one screen (2 400 characters), later idle slices about two pages
  (`document-reader-batches.ts`); the bottom spinner while the rest mounts is unchanged. Not changed: the drug
  screen (propranolol card: header at 0.2 s, first section 2.6 s behind the drug panels — the coordinator's area).
- **Status-bar strip.** `.document-overlay-paper::before` named `--z-heading-h6`, which 33a8269f removed with the
  stacked headings, so the strip had `z-index: auto` and paragraphs painted over it. It now uses
  `--z-reader-status-fill` (19, above the section path, below the chrome). Guards: `styles/z-index-tokens.test.ts`
  (every `var(--z-…)` in a `z-index` must be declared; the fullscreen note editor's `--z-modal` is a known open
  finding) and the `native-chrome.spec.ts` section-path test (z-index not `auto`, above the section line).
- **Loading skeletons.** `components/PageSkeleton.tsx`: header row (working back through `navigateBack`, held
  contents button, breadcrumb bar) and a paper with title/meta/line bars. Used by both Suspense fallbacks in
  `App.tsx` (root tabs without the header), `DocumentCoreWait` (status inside the paper) and, as `PageSkeletonBody`,
  the reader's own loading body (`.document-page__loading`). The spinner CSS (`app-view__loading`,
  `document-page__loading-spinner`) is gone. The bottom paper fade over the reader is removed (coordinator).
- **Not verified:** a real phone (HyperOS compositing, status-bar inset, 60 Hz), WebKit, the drug screen opening,
  documents with a very large single section (a section is still mounted whole).

## PHQ-9 and GAD-7 — 2026-10-20 (STATE PSY-PHQ)

Owner question: iOS Health offers PHQ-9 and GAD-7, MiniMed did not. Both are now questionnaires in the
psychology module (`minimed.tools.psychology.ru` 0.1.0-preview.8, «Психиатрия» → «Депрессия и тревога», next to
Zung SDS/SAS and HAM-D), 253 tools in all.

- **Text:** the official Pfizer Russian forms «Russian for Russia» from phqscreeners.com, word for word (free to
  reproduce, translate and distribute). Original scoring: 0–3 per item over the last 2 weeks.
- **PHQ-9** (Kroenke, Spitzer, Williams 2001): sum 0–27, bands 0–4 / 5–9 / 10–14 / 15–19 / 20–27, actions per band
  from Kroenke & Spitzer 2002. The difficulty question is its own scale and track (0–3) and stays out of the sum.
  Item 9 > 0 raises the declared alert (`answer_phq9_09 > 0`) above the result whatever the total.
- **GAD-7** (Spitzer et al. 2006): sum 0–21, bands 0–4 / 5–9 / 10–14 / 15–21; source link to КР «Генерализованное
  тревожное расстройство» (2024, `457_3`, section 2.5 and appendix Г2, which recommends GAD-7 for screening, uses
  the same cut-points and quotes Zolotareva's 2023 adaptation, whose wording differs).
- Method notes, attribution and sources sit in the shared «Информация» dialog; nothing in the UI names these tools.
- Search: the PHQ-9 title is the official name without «(депрессия)», and GAD-7 has no disease-name alias, so a
  bare «Депрессия» or «Генерализованное тревожное расстройство» still shows the article before the tools. The
  catalog-wide score-scale test now matches each interpretation against the scale it names.
- Checked: unit tests for every band boundary, the item-9 alert and the required difficulty answer; both scales
  filled in the browser at 375 px (127.0.0.1). Not tested: Android/device, print; no Russian validation study of
  the Pfizer PHQ-9 text was reviewed.

## Settings and download queue UI — 2026-10-19 (owner screenshots)

- **«Профиль врача»** (Settings → Основные): the «?» sits inline after the label, the specialties
  (or «пока пуст») are the helper line under it, «Сбросить» is the row's action.
- **«Скачать всё»** in «База знаний» is a plain button under the page description that opens the
  existing confirmation sheet; it no longer sits in the sticky search toolbar (it shifted the field).
- **Compact bar:** every «База знаний» route (`view === 'modules'`) lights «Мои файлы», since the
  knowledge base is a folder there (`compactRootView`).
- **Bottom bar:** no controls above «Настройки» any more (download pie, pause badge and the update
  hint removed, `ContentDownloadNavIndicator` deleted); downloads live in Settings → Загрузки and on
  the cards, a waiting update is the dot on the tab.
- **Queue icon and «Скачать сейчас».** A waiting download shows Phosphor `queue` instead of a clock.
  «Скачать сейчас» (⚡ on a Загрузки row, a button next to a module offer, tapping a queued section
  or document button in the catalog) calls `DownloadQueue.prioritize(ids)`: the chosen module
  downloads run first, even while the queue is paused; other module transfers are interrupted like a
  pause (bytes kept) and resume in their previous order when the last chosen one ends. The module
  installer gives a prioritized task that still waits for an install slot one at once
  (`ForegroundContentModuleInstaller.prioritize`, driven by `BrowserModuleRuntime` from the queue).
  No library: the shared queue already admits every transfer. Priority is not persisted across a
  reload. Verified in the dev app (Травник jumped ahead; Лекарства held at 26 % and resumed from it).
- **Follow-up (same day).** The «Скачать всё» sheet names both sizes («Скачается 1,5 ГБ, после
  распаковки на устройстве — 6,6 ГБ»). «Травник» is a row of the search home «Разделы» (a shortcut
  to the book, `sectionShortcutRows`, shown once the release offers it); the book keeps the bar tab it
  was entered from (`herbalBookOrigin`, read from the addresses), «Поиск» or «Мои файлы».
  `module-queue-reload.test.ts` waits until the stalled streams really stall before pausing (it failed
  once under full-suite load when a stream had not yet sent its chunks).

## Herbal book «Травник» pilot — 2026-10-19 (STATE HERB1)

Owner request 2026-10-18: a downloadable herbal book with pictures — effects and the components behind
them, how to brew and take a plant, who may take it; for self-education and situations with only herbs at
hand. EMA limits and doses are Russian structured fields with the English quote on tap (owner choice «a»).
Plan and source survey: [herbal-pilot-plan-2026-10-18](research/herbal-pilot-plan-2026-10-18.md).

- **Modules** (2026.10.19, `minAppVersion` 0.6.61, preview, experimental + requires-review; published since
  2026-10-20, see «Review and release» below):
  `minimed.reference.herbal` «Травник» — 30 plant chapters (36 since the second wave) + ГФ XV «Настои и отвары», 495 chunks, 3.0 MB
  index, 1.0 MB gzip; `minimed.reference.herbal.plates` «Травник: иллюстрации» — 30 plates (≤1200 px JPEG
  q85) in one STORED source-assets ZIP, 7.0 MB, plus a 19 KB credits index. Both committed under
  `apps/app/public/content/modules/`. «Скачать всё» leaves the plates out (image pack rule). Built by
  `bun run content:module:herbal` (EMA quote check → prepare → lint → build → package → catalog → shell).
- **Inputs**: `content/herbal/plants.yaml` (the only hand list: ГРЛС names, EMA page, Commons plate);
  `medbase fetch-herbal-sources` → `data/raw/herbal` (EMA monographs/statements, assessment reports, public
  summaries; public-domain plates with the Commons licence checked; the ГФ XV article page and its approving
  order №448). Dr. Duke's database and the ГФ articles on tinctures/teas/extracts (lab QC only) were dropped.
- **ГРЛС text**: per plant the best active registration of the plain raw material (text layer before OCR,
  loose herb before filter bags, newest edition, an amendment-only file skipped); its sections are copied
  verbatim with PDF page/block markers under «Как заварить и принимать», «Противопоказания», «Показания»,
  «Действие и состав», «Побочное действие…», «Особые указания», «Сырьё и хранение». Brew cells (сырьё, вода,
  баня, настоять, сколько раз, разовая доза, курс) are parsed from the dosage text and keep their sentence.
  Gaps: viola has no usable ГРЛС text (only an amendment notice) — EMA only; anise is OCR (badge «скан»).
- **EMA facts**: `content/herbal/ema/<plant>.yaml`, 30 files, status `proposed` (draft badge «черновик»):
  indications, doses per age, age/duration limits, contraindications, pregnancy, interactions, adverse
  effects, overdose and 2–5 constituents with evidence level. `medbase check-herbal-ema` refuses any quote not
  on its cited PDF page (content order, or reading order with spaces ignored for PDFs whose spans are out of
  order, e.g. oak) and any number in a Russian field the quote lacks. Written by the agent on 2026-10-19 (the
  Sonnet extraction agents hit their weekly limit); no clinician review yet.
- **App**: tile «Травник» in «База знаний» (`#/modules/documents/herbal`): search, action chips (kept in the
  address), the ГФ guide card, the plates offer, a thumbnail grid. A chapter opens in the standard reader:
  the plate is the hero (`ReaderHero` now takes any picture source; portrait pictures fit the stage), then
  identity, action chips, brew cells, «Кому нельзя», «Дозы EMA», «Показания EMA», «Действующие вещества»;
  every cell opens its source sentence in a sheet. A public statement (celandine: oral use not approved)
  comes before the recipe. Search finds the chapters in «Все источники» (`herbal_monograph`, kind reference).
- **Checks**: `tools/ingest/tests/test_herbal.py` (quote check, section split, brew parsing, ГФ HTML, EMA
  selection, plant list), `apps/app/src/features/herbal/herbal-chapter.test.ts`; browser run at 375×812 on a
  clean profile: install text + plates, reload, chamomile/St John's wort/celandine chapters, quote sheets.
  Known: rebuilding a module under the same version leaves an installed copy pointing at a stale shelf file
  («no such table: content_packs») — release a new version for every rebuild.
- **QA pass 2026-10-19** (HERB1-QA, [qa-herbal-2026-10-19](research/qa-herbal-2026-10-19.md)): text module
  re-released as `2026.10.19-qa1` (`content:module:herbal` builds the text only, `content:module:herbal:plates`
  the plates, still `2026.10.19`). Fixed: the ГФ guide now carries «Особенности технологии» and the storage
  temperature (the parser skipped `class="Default"` paragraphs); 4 of 5 spot-checked EMA files had Russian
  lines adding claims beyond their quote (chamomile, St John's wort, senna, celandine — re-quoted or split;
  viola was clean; the other 25 files are not re-read); Back from a full-screen picture closed the reader
  (`MediaViewer` is now a history layer); a ГРЛС course longer than the EMA limit is marked «EMA: короче»;
  search matches EMA indications with a stem fallback («кашель»); an «Обновить» offer for a newer text module;
  one «Открываем травник…» state after install; brew dose without the repeated frequency; plates lie on a
  herbarium-paper sheet (`--herbarium-paper`, multiply) in the grid and the hero (owner request).
  Not done: a phone/WebView run, clinician review of the EMA fields.
- **EMA re-check 2026-10-19** (HERB1-QA2): the other 25 EMA files read fact by fact against their PDF pages;
  ~270 items changed (Russian lines adding reasons, advice, populations or limits from neighbouring sentences:
  quotes extended, facts split, Russian trimmed; populations follow the posology headings; modals as in the
  source; constituent evidence corrected, e.g. valerian 6-methylapigenin animal, uva-ursi metabolites
  in-vitro). All 30 files now pass `check-herbal-ema` after a fact-level read; text module `2026.10.19-qa2`.
- **Page breaks and missing lines 2026-10-19** (HERB1-QA3): the quote check now bridges a page break past
  the page's footnote block and a running title that wraps differently on some pages, so ten quotes cut at a
  break are whole again (frangula and senna «short-term», fennel estragole, melissa duration as one fact,
  salvia tea «3 times daily», the mentha/quercus use-type lines, hypericum GI indication, betula duration,
  senna contraindications as one fact). New facts quoted from the monographs: mentha tincture, linum
  traditional duration, abdominal-pain, fluid/obstruction and debilitated-patients warnings, quercus capsules,
  dry extract, rinses/poultices and the hot-bath caution. Text module `2026.10.19-qa3`. Open: salvia thujone
  (Symbol-font α/β), no clinician review.
- **Field identification and look-alikes 2026-10-19** (HERB1-ID, owner request): every chapter has «Как
  узнать», verbatim from the plant's ГФ raw-material article (ФС; ГФ XV for 14 plants, else the ГФ XIV article
  still in force — `gf` in `plants.yaml`, pages fetched by `fetch-herbal-sources --gf-only` into
  `data/raw/herbal/gf/`): the definition (what is collected, when, species, family) and the appearance of the
  whole raw material (shape, size, colour, smell; cut herb, powder, microscopy and lab tests left out). The
  panel gains «Не спутать» where a source names look-alikes: horsetail (ГФ XV note on four other Equisetum
  species incl. marsh horsetail; EMA: palustre «potentially toxic», «only quality controlled horsetail»),
  juniper (EMA: other Juniperus species, J. oxycedrus and J. sabina berries described) and lime (EMA: Tilia
  tomentosa) — new EMA fact kind `lookalike`, quote-checked. Source lines now cite the ГФ article; the
  illustration line no longer prints raw Commons date markup.
- **Look-alikes from teaching manuals 2026-10-19** (owner decision): where no official source names
  look-alikes, `content/herbal/lookalikes.yaml` quotes two pharmacognosy teaching manuals, pinned in
  `data/raw/herbal/manuals/` (`fetch-herbal-sources`, manifest «manuals»): НФаУ 2016 lecture notes, Приложение
  4 «Примеси к лекарственному растительному сырью», and Коломиец и др., «Учебная практика по фармакогнозии»
  (СибГМУ, 2013). Every name, Latin name and quote must occur on the cited PDF page (`check_lookalikes`,
  run by `prepare-herbal`); the chapter's «Не спутать» gains the manual's key line on the genuine herb
  («Признак») and one cell per admixture (label «Пособие», «Ядовито» for savin), the quote and «НФаУ, 2016,
  с. N» behind a tap. Now 11 plants have look-alikes: chamomile (Matricaria inodora, four Anthemis),
  valerian, oak, frangula, St John's wort, nettle, wormwood, bearberry (lingonberry, bilberry, bog bilberry,
  Chimaphila), juniper (+ J. sabina, poisonous), horsetail (+ E. hyemale) and lime. 19 plants have none in
  either manual (mint, melissa, sage, yarrow, senna, liquorice, centaury, dandelion, fennel, anise, flax,
  tormentil, corn, viola, eucalyptus, birch, calendula, motherwort, celandine) and get no warning. Not used:
  the НФаУ bearberry row (both columns carry the same text) and the multi-column СибГМУ tables whose text
  interleaves. Text module `2026.10.19-id2`; e2e opens horsetail and checks chamomile's look-alikes.

- **Second wave 2026-10-19** (HERB1-W2, owner request «add more»): 36 plants. Added where a local
  ГРЛС raw-material text and an EMA monograph of the same species and part exist: алтей (корни),
  пастушья сумка, горец птичий (спорыш), ортосифон (почечный чай), тыква (семена) and чабрец (тимьян
  ползучий; EMA covers T. vulgaris/T. zygis, shown as a different species like eucalyptus). Pumpkin
  has only an amendment notice in ГРЛС, so its chapter is EMA-only (as viola). EMA files written by
  three Sonnet agents, quote-checked, then read fact by fact (two constituent evidence levels and one
  4.4 warning filed as an interaction corrected). New plate books: Curtis's Botanical Magazine 1870
  (ortosiphon) and Vietz 1804 (pumpkin); ГФ definitions opening «Зрелые …» are parsed. No look-alikes
  for the six in either manual. Dropped: ispaghula husk (EMA monograph exists, but no ГФ raw-material
  article and no plate of the species). Text module `2026.10.19-w2` (1.4 MB gzip), plates
  `2026.10.19-w2` (8.1 MB). Not done: ~14 plants with a ГРЛС text but no EMA document (шиповник,
  череда, душица, брусника, мать-и-мачеха, пижма, …).
- **Third wave 2026-10-19** (HERB1-W3, owner request): 39 plants. The five active raw-material
  registrations of EMA-covered plants without a text (бессмертник ×3, бузина, тмин) were fetched with
  the polite collector (`grls-collect --registration …`, one worker, 10–20 s pauses, separate log dir
  `data/build/grls-collect-herbal`, same ledger; 5/5, no CAPTCHA). grls.rosminzdrav.ru verifies against
  the system trust store, so no container was needed (only nsi.rosminzdrav.ru uses the Russian root).
  Prepared into `data/intermediate/grls-herbal-additions` with their own text manifest
  `data/build/grls-herbal-additions-manifest.jsonl`; `prepare-herbal` now takes repeatable
  `--instructions` / `--instruction-manifest`, and splits run-in headings inside one PDF block (the
  caraway pack insert ran six sections into «Способ применения»). EMA check: a footnote line without a
  space («3For…») now counts as a footnote when bridging a page break. Not fetchable: эхинацея, черника,
  элеутерококк, родиола, женьшень, гинкго, овёс, тимьян обыкновенный — no active raw-herb registration
  (only tinctures/extracts or expired ones); the pumpkin and viola raw-herb registrations have legacy
  numbers the ГРЛС search cannot find, so both stay EMA-only. Text `2026.10.19-w3` (1.5 MB gzip), plates
  `2026.10.19-w3` (8.9 MB).
- **Fourth wave 2026-10-19** (HERB1-W4, owner: «ГРЛС is not a good source about herbs»): 71 plants. Only
  a monograph is required now — `plants.yaml` needs exactly one of `ema` / `who`; ГРЛС (Russian recipe),
  ГФ (field identification) and the plate are optional, and a chapter without a plate shows a leaf
  placeholder on its card. +27 EMA-only plants (эхинацея, черника, элеутерококк, женьшень, гинкго, хмель,
  конский каштан, пассифлора, первоцвет, подорожник ланцетный, мальва, земляника, вахта, лопух, родиола,
  донник, расторопша, ревень, фасоль, плющ, лабазник, кипрей, лаванда, коровяк, репешок, исландский мох,
  овёс), plates from five more public-domain books (Curtis 1787/1870, Vietz 1804, Siebold's Flora Japonica,
  Flora Danica). +5 WHO plants where EMA has no monograph (череда, душица, облепиха, подорожник большой,
  укроп): `content/herbal/who/*.yaml`, same fact schema, checked by `medbase check-herbal-who` (quote on its
  page and inside the monograph's page range). WHO volumes 1–4 come from WHO IRIS; the NIS volume (2010)
  is only described in IRIS, so the PDF is the e-lactancia.org copy, pinned by sha256 and named as a copy
  in the chapter's sources. The app labels facts by authority («Дозы ВОЗ», «монография ВОЗ, с. N»,
  «Традиционное применение»). The EMA section-2 preparation lists («Препараты: a) … b) …») are no
  longer facts: every dose cell names its preparation, and they showed as «Вывод» under «Кому нельзя».
- **Owner picture and Red Book** (2026-10-19): женьшень has no public-domain plate; the owner supplied
  one (`content/herbal/pictures/panax-ginseng.png`, 240 px, `plate.book: owner`, licence
  «Owner-supplied», credit «Рисунок: от владельца»). Plants of the federal Red Book carry
  `redBook: {number, page, category, note}` from the official list (приказ Минприроды России от
  23.05.2023 № 320, publication.pravo.gov.ru `0001202307210008`; category names from п. 3.7 of приказ
  № 306 of 2016). Both are scans: the list was read with the Vision OCR, every genus and Russian name of
  our plants matched against it, and the two hits checked on the page image — женьшень настоящий (№ 48,
  category 1) and родиола розовая (№ 156, category 3, except the populations of the Altai and
  Krasnoyarsk krais, Tuva and Magadan oblast). The 2026 amendment (приказ № 313) changes only the animal
  list. The PDFs are pinned in `fetch-herbal-sources` (manifest «redBook»); the chapter shows a red
  «Красная книга РФ» badge with the category and the row's own note, the grid card a «Красная книга»
  mark. Text `2026.10.19-w4` (2.5 MB gzip), plates `2026.10.19-w4` (20.9 MB). Not done: regional Red
  Books, clinician review, phone run.
- **Safety lines** (2026-10-19, owner-approved plan): `content/herbal/safety/<plant>.yaml` for 37 plants,
  a «Безопасность» block (draft badge) after «Кому нельзя». NCCIH «Herbs at a Glance» (17 plants;
  peppermint skipped — its page is about the oil, our chapter the leaf) and LactMed (30 chapters) give
  Russian lines, each with the English sentence it was read from; `medbase check-herbal-safety`
  refuses a quote not in the saved page/chapter and a number not in its quote. Lines were drafted by
  three Sonnet agents and reviewed line by line (duplicates of «no data» dropped, wording and kinds
  corrected). LiverTox (20 chapters): the likelihood score is read by code from the chapter's own
  sentence and translated by a fixed table — an unknown wording fails the build. ТР ТС 021/2011
  annex 7 (official EEC PDF, base text; the 2019 amendment touches no plant of ours): п. 1.1 «запрещено в
  составе БАД» — донник аптечный, крушина (only unripe fruit and fresh bark), полынь (all species),
  чистотел; п. 1.2 «не допускается в однокомпонентных БАД» — валериана, гинкго, женьшень, зверобой,
  родиола, элеутерококк; each row is checked on its PDF page (a row may run past the repeated table
  header). LactMed «Buckthorn» covers alder buckthorn (крушина) and says it is not sea buckthorn, so
  облепиха has no LactMed line. `fetch-herbal-sources` stores the NCCIH pages, the PDF and only the
  needed LactMed/LiverTox chapters (the ≈200 MB NCBI Literature Archive tarballs are read once and
  deleted; `data/raw/herbal/safety`, 12 MB). Text module `2026.10.19-w5`.
- **Review and release** (2026-10-20, owner «check the draft and release it as non-draft», STATE
  HERB1-REV): every Russian line of the 71 EMA/WHO files (1 639 facts, 293 constituents) and the 112
  safety lines was read against its quote and the surrounding page by eight Sonnet reviewers; every
  finding was checked on the page before it was applied (308 changes). Fixed: populations that dropped
  «пожилые» (valerian, St John's wort, viola, chamomile, senna «старше 12 лет»), lines adding claims
  (St John's wort interactions — no warfarin/HIV, serotonergic effects not «syndrome», contraceptives;
  celandine HMPC wording; equisetum palustrin), quotes cut before their qualifier (hyperforin ≤ 1 mg,
  overdose doses, reproductive toxicity «in animals», chamomile/lemon balm LactMed premises, thujone
  stays cut), constituent evidence (isolated organs → in vitro, literature attributions → review),
  the elder decoction (3–6 g a day in 2 doses, no «2 р/день» on the dose), WHO lines labelled by
  their own heading («подтверждено клиническими данными», «описано в фармакопеях», «описано в
  традиционной медицине» — the merged label is gone). Dropped as carrying no information: «no studies
  on driving» (33), «no fertility data» (34), ethanol labelling rules (22); kept «may impair driving».
  The thyme chapter says above the EMA facts that the monograph covers T. vulgaris/T. zygis
  (`otherSpecies` in `plants.yaml`). The quote check bridges a WHO page break past the page number and
  running title, and treats a ligature glyph followed by a space («inﬂ ammatory») as one word. All
  files are `status: reviewed`: no «черновик» badge on «Кому нельзя» or «Безопасность»; the guide no
  longer calls the lines a draft. Catalog: text `2026.10.20` and plates (unchanged `2026.10.19-w4`
  files) are `published` without the `experimental` tag; the documents keep the shared
  `requiresReview` reference-content flag. This is a source-fidelity review, not a clinician's review.
- **Doctor's-eye pass, conflicts, regional Red Books** (2026-10-20, owner «clinician review and regional
  Red Books», STATE HERB1-CLIN):
  - Seven Sonnet reviewers read every chapter as physicians against the whole monograph and the ГРЛС
    text (≈340 findings); seven more turned them into content edits per plant batch, each checked by
    the quote checks; every addition was then read here (63 re-added no-information lines removed:
    ethanol labelling, «not tested», species statements).
  - `content/herbal/conflicts/<plant>.yaml` (new, `herbal_conflicts.py`): where the ГРЛС instruction
    and EMA/WHO disagree — 98 items in 39 chapters (age limits, course length, daily amount, indications
    the monograph contraindicates such as oedema in heart failure for horsetail/orthosiphon/juniper,
    pregnancy/lactation allowed vs not recommended, interactions one names and the other denies). The
    ГРЛС sentence must be in the instruction text, the monograph sentence on its page, every number of
    the line in one of them (`prepare-herbal` refuses otherwise; `medbase check-herbal-conflicts`
    checks against the built chapter). The chapter shows «ГРЛС и EMA расходятся» after «Как заварить»;
    a cell opens both sentences.
  - About 110 new monograph facts (frangula/senna toxic hepatitis and QT drugs, estragole limits,
    thujone cap, chamomile bath contraindications, case reports from assessment reports), dose cells
    with the monograph's daily total (new `daily` field, shown «в сутки …»), preparation names with
    DER/solvent, and the WHO oregano dose fixed (a tablespoon of infusion, not 10 g herb 3× a day).
  - «Вывод» (statement) facts now follow the contraindications except in a public statement; the
    draft EMA monograph (zea mays) is tagged «проект монографии»; eucalyptus gets the other-species
    note (EMA: E. globulus).
  - Regional Red Books (`herbal_regions.py`, `medbase fetch-regional-red-books`,
    `content/herbal/regional-red-books.yaml`): from Plantarium's index (259 lists) and each plant's
    taxon page; a region counts when its newest edition known to Plantarium lists the plant (87
    current regions; other countries, Soviet-era and merged regions left out). 27 plants, 170 rows
    (rhodiola 24 regions, helichrysum 19, uva-ursi 18, …). The chapter shows «Красные книги регионов —
    N регионов» opening the list with edition years («изд. 2019») and the source. Plantarium is the
    only source (owner decision 2026-10-20): a spot check of 14 rows against the official acts found
    no wrong listing, only newer amendments some regions passed after the edition (Коми 2024,
    Хабаровский 2024, Ленобласть, Московская 2023, Краснодарский from 2027), so rows are not
    verified one by one and categories are not shown; re-fetch about once a year. Text
    `2026.10.20-c2`. Raw pages: `data/raw/herbal/plantarium` (11 MB).
  - Clinician review page (claude.ai artifact «Травник: проверка врачом»,
    https://claude.ai/artifact/1WmXzFQk2nVsDRznfn6voL): all 2 401 lines (facts, doses, constituents,
    safety, conflicts, brew cells) with «Верно»/«Ошибка» + comment, stored in the artifact's database
    (`marks/<line key>`), read back with ArtifactData to apply. Not yet used by a clinician.

## Query model bundled in the Android APK — 2026-10-15 (STATE QM-BUNDLE)

Owner decision 2026-10-15 («under 300 Mb apps are fine»): meaning search needs no download on Android. The build
step `bun scripts/fetch-query-model.ts --stage android` (part of `native:sync:android`, `android-release.yml`,
`android-build.yml`) fetches the pinned KD1 query model from its mirror branch into a gitignored cache, checks
every SHA-256 from `e5-model.ts`, joins the ONNX parts and stages the files in the APK's web assets
(`models/kd1-query-encoder/`, `*.onnx` stored uncompressed). The app decides at run time (`e5-model-source.ts`:
Android and a manifest matching the pinned revision): a bundled model counts as installed, so Settings reads
«Встроено в приложение» and «Скачать всё», onboarding, the queue restorer and the `model-missing` offer skip it;
a leftover IndexedDB copy is deleted after the first bundled query. Web and iOS keep the optional download; a
developer build synced without the model falls back to it. Trust, loading, cleanup and what is not measured
(phone cold-start latency and memory): `docs/SEMANTIC_RETRIEVAL.md` «Bundled in the Android APK». Tests:
`e5-model-source.test.ts` (platform switch), `semantic-settings-view.test.ts` (Settings, native vs web),
`apps/app/src/scripts/fetch-query-model.test.ts` (join, checksum mismatch fails the build, cache reuse,
staging, APK check). Not yet built into an APK: this machine has no Android SDK, so the first real build is the
next `release:` workflow run (its `--check-apk` step fails the release if the model is missing); not tried on a phone.

## Search home: tools capsule, sections wait for the core, carousel switch — 2026-10-15 (STATE HOME-UI)

Owner screenshots 2026-10-15. «Все инструменты» is an icon-only capsule as tall as the chips (always: the row starts with
favourites). Sections whose page lists core documents (`search-section-gate.ts`: all but «Все», personal files, calculators,
assessments) cannot be opened, nor the clinical analysis switched on, while the core opens or downloads: the tap shows one
notice «Загружаем ядро знаний, подождите» (offline / error / other-tab wordings), the rows are dimmed with the core's download
share; a section reached by address shows `SearchSectionWait` (message + progress) and then the catalog in place. The feature
carousel's «Скрыть» became an eye-slash icon; hiding shows «Вернуть можно в настройках» with a «Настройки» action, and Settings
→ Оформление has «Полезные функции на главной» (lightbulb); the bottom «Показать полезные функции» link is gone. e2e
`home-core-gate.spec.ts`; the shared helpers (`openHomeSection`, `selectSearchSection`, `setClinicalAnalysis`) wait for the
core. Not tried on a phone.

## МКБ-11 search section — 2026-10-15 (STATE ICD11-SEC)

Owner decision 2026-10-15: МКБ-11 (expected to come into use in Russia soon) gets a search section of its own, next
to «МКБ, симптомы и состояния». The module is `minimed.reference.icd11.ru` (collection `icd11`, preview, 45 МБ, 37 052
entries: 35 664 rubrics, 1 360 blocks, 28 chapters; installable from its mirror since DL3).

- **Scope.** `SearchScope` gains `icd11` (list in `features/search/search-scopes.ts`, import-free, shared by the type, the
  saved history and the saved preferences, which had two hand-kept copies). `documentMatchesSearchScope`: an ICD-11 card
  belongs to «Все источники» and `icd11` only, and `icd11` holds nothing else, so the ICD-10 section, the clinical
  scopes and «Клинический разбор» stay free of it exactly as before (`ScopedMedicalCore` still drops ICD-11 groups from
  scopes without a source-type list). `SOURCE_TYPES_BY_SCOPE.icd11` makes the section search only ICD-11 documents; with
  no pack installed it searches nothing (the empty-scope sentinel), it never falls back to the whole core. Mode is
  lexical, as for the other reference sections.
- **Lookup order.** In this scope only, `preserveStrictIdentities` ranks a card whose WHO code is the typed text first
  («BA41.0», any case) and then one named exactly as typed («астма» → CA23 «Астма», not the «Аллергическая астма»
  sub-rubrics that outranked it); `icd11TitleCode` / `icd11BareTitle` read the card title (code + name + «, МКБ-11
  (ВОЗ)»). Other scopes, «Все источники» included, keep the core's order. ICD-10 codes already reach their ICD-11 rubric
  through the crosswalk text («I21» → BA41, «E11» → 5A11); the ICD-10 → ICD-11 panel on МКБ-10 cards (ICD11-MAP) is
  unchanged.
- **Home and picker.** `SEARCH_SECTIONS` lists «МКБ-11» (count noun «запись»: chapters, blocks and code cards are not
  diseases or documents) right after «МКБ, симптомы и состояния»; the section picker, the home list and `#/search/section/icd11`
  (the route regexes now accept digits in the id) work as for every section, so back is the same one history step
  (NAV1). The placeholder reads «Код МКБ-11 или название» and the examples are `1A00`, `BA41`, «Холера».
- **Count.** `catalog.shell.json` `sectionDocumentCounts.icd11` = 37 052 (`deriveSectionDocumentCounts`: the module's
  preview count, as the pack lists no documents), so the number does not change when the pack is installed, and «Все
  источники (N)» — the sum of the section counters of the catalog manifest plus the questionnaire and calculator cards —
  includes it (it grew by 37 052). Regenerate with `bun run catalog:shell` when the module is republished.
- **Download.** The pack lists no documents, so `searchSectionDownloadBlocks` offers it from the module entry
  (`icd11/` and `all/`), when `isModuleReleased` (a preview pack needs the Experimental switch, on by default).
  Not installed: the section opens on one row («МКБ-11 не скачана» + the usual download chip with the size, 45 МБ;
  «Включите Experimental в настройках…» when the switch is off) instead of an empty library, and a query in it ends in
  «Ничего не найдено» with the chip «Скачать: МКБ-11». Installed: the section opens on the 28 chapters (read from the
  titles «Глава NN.»; the navigation list has no class kind), each opening the card with its children; a query lists
  cards.
- **History and preferences.** `localmed.search-history.v4` and the remembered scope accept `icd11`; a replay opens the
  section. History label «МКБ-11».
- **Tests.** Unit: scope membership and ordering (`ScopedMedicalCore.test.ts`), counts and the «Все источники» sum
  (`searchCatalog.test.ts`), download blocks, route, history, preferences, title/chapter helpers. `bun run benchmark:icd11`
  (`tools/benchmarks/icd11-queries.json`, `run-icd11-queries.ts`): 16 code, 13 word and 4 ICD-10-code lookups over the
  released core plus the module (code or the rubric in the first 1–10 cards, expected codes chosen from the WHO
  rubrics, not from the results), and 11 isolation checks (no other scope lists an ICD-11 card); 44/44. It needs the
  local release file (`data/build/icd11-module/release`, read from the main checkout; decoded into a temporary
  directory and removed) and skips without it. `bun run benchmark:all` unchanged (the core carries no ICD-11).
  e2e `search-icd11-section.spec.ts` (home row and count, offer with size, «Все источники» = sum of the rows, search
  without the pack, history scope, install → chapters → code/word lookups → card → back with the query, isolation);
  `icd11-module-fixture.ts` now holds the module routing/install helpers `icd11-module.spec.ts` shares.
- **Not done.** The exclusion/inclusion targets and postcoordination axes (see the ICD11 section); no semantic search
  in this section (lexical only); the Android device was not tested.

## Module shelf: search after a full install (SQLITE_NOMEM) — 2026-10-15 (STATE MEM1)

QA before 0.6.60 ([qa-release-0660-2026-10-15](research/qa-release-0660-2026-10-15.md) item 1): after «Скачать всё»
(840 modules) search worked until the first reload, then every search failed with `SQLITE_NOMEM`.

- **Cause.** Every module index ≤ 32 MiB (all 774 clinical recommendations, 1.65 GB decoded, plus tools and small
  references) was `sqlite3_deserialize`d whole into the wasm heap of the **main thread**, which sqlite-wasm caps at
  2 GB (`maximum: 32768` pages). The images alone filled it; page caches and sort buffers of the first searches did
  the rest. Only modules > 32 MiB (ЕСКЛП, ГРЛС) were in OPFS, one worker per module. A ~210-module profile (≈0.5 GB)
  fit, which is why it survived.
- **Fix — the module shelf** (`apps/app/src/composition/module-shelf*.ts`): a small module is a file of **one** SAH pool
  (`minimed-shelf`) owned by **one** worker (`module-shelf.worker.ts`), with a SQLite connection per file. Install
  (`BrowserModuleBackend.activate`) writes the image to the shelf (row `indexStorage: 'shelf'`, no bytes in
  IndexedDB); a row that still holds bytes (older install) is written to the shelf when it is mounted and its bytes
  dropped. `ShelfModuleStore` is a plain `MedicalStore`, so `MultiMedicalStore` and the core are unchanged. Calls made
  in one turn travel as one message (a search asks every module); `getHealth` and the whole-pack listings are asked
  once per open file. Page cache: `shelfCacheKiB` shares a budget (256 MiB, scaled by `navigator.deviceMemory`: 96 MiB
  at 2 GB, 384 MiB from 8 GB) between the connections, floor 256 KiB each; lookaside off. Orphan files are swept with
  the module pools (`sweepOrphanedModulePools`, under the staging lock). Where no Worker/OPFS exists, or the shelf
  fails to start or store a file, modules stay in memory (IndexedDB bytes) as before. Large modules keep their own
  pool and worker (31 workers with the full set; moving them onto the shelf is the next step if a phone needs it).
- **Measured** (`e2e/many-modules-reload.spec.ts`, persistent Chromium profile, real KD1 modules from
  `output/module-zstd-kd1-2026-10-11`, 20 queries after a reload; Playwright's default incognito contexts make OPFS
  reads ~10× slower, so latency is never measured there):

  | modules | storage | startup (reload→editable) | first search | median search | failed searches | browser RSS start → end |
  |---|---|---|---|---|---|---|
  | 200 | in memory (before) | 1.8 s | 2.2 s | 0.30 s | 0 | 1.8 → 2.8 GB |
  | 200 | shelf | 1.5–1.8 s | 2.2 s | 0.31–0.34 s | 0 | 1.4 → 2.2 GB |
  | 774 | in memory (before) | 2.7 s | 3.1 s | — | **19 of 20** (`SQLITE_NOMEM`) | 3.1 → 3.9 GB |
  | 774 | shelf | 2.1–2.6 s | 3.2–4.2 s | 0.8–1.1 s (load-noisy) | 0 | 1.5 → 3.1 GB |

  Shelf worker wasm heap at 774 modules: 133 MB open, 275 MB after 20 different queries, bounded by the cache budget
  (an unbounded 4 MB cache per connection reached 571 MB and was still growing). First start after the update moves
  the old rows onto the shelf: 3.3 s (200 modules), 7–10 s (774), once. The remaining RSS growth is the rest of the
  app (main-thread JS heap 310 MB with no module, 550 MB with 774: ≈0.3 MB per module of listings and results).
- **Errors.** `withCalmCoreErrors` (`composition/calm-core-errors.ts`, applied in `createBrowserCore`) turns every
  failed result with a storage code (`DATABASE_UNAVAILABLE`, `FTS5_UNAVAILABLE`, `UNKNOWN`) into one calm Russian line
  (the engine's text moves to `details.raw`); the search error card offers a retry icon (`search-error__retry`).
  The interaction checker separates `DocumentState` `missing` (core said not found → «Инструкция не установлена», the
  download offer) from `unreadable` (any other failure → «установленную инструкцию сейчас не удалось прочитать»,
  no offer). The drug comparison, safety card and prescription still read any failed `getDocument` as «не установлена»
  (not changed: CLS3/DOSE1 areas).
- **«Все источники (N)»** has one meaning: the sum of the other counters of the search-section picker (catalog
  manifest counts of МКБ, рекомендации, препараты, нормативные документы plus the questionnaire and calculator cards),
  independent of what is mounted (`searchCatalogSections`). It was the mounted-document count: 20 308 / 25 019 / 257.
- **Not tested:** a phone / Android WebView (SAH handle limits with ~800 files, memory), Safari, the full 840-module
  install through the UI (modules were seeded into IndexedDB), multi-tab.

## Class lines, per-drug instruction state, ATC group card — 2026-10-15 (STATE CLS3, QA 0.6.60 items 13 and 12 «J05AX»)

- **Why Колдакт had no «также:» line.** Not the screen: `secondary-classes.json` is read by the card slug the screen derives from the card id, and
  a test (`secondary-classes.test.ts`) now checks every recorded slug against the comparison index and that every recorded card yields a line
  naming all its classes and components. The card `парацетамол + фенилэфрин + хлорфенамин` (Колдакт Флю Плюс, ТераФлю Экстратаб, АнтиФлу) simply
  had no entry: CLS2 declared a component class only on a quote from the card's own instruction, and the product holds no instruction of this card.
  The same missing class kept «Колдакт + лизиноприл» from reaching lisinopril's sympathomimetic sentence.
- **New basis for such cards.** `addClasses` evidence has a second kind, `component-atc` (the component and its own ATC code, secondary only):
  24 entries on 18 cards with no instruction (phenylephrine 7, chlorphenamine 7, codeine 8, pseudoephedrine 1, paracetamol 1). The build refuses
  one as soon as the card has an instruction (quote it then), when the component is not one of the card's, or when the class repeats the card's own code
  (`verifyComponentBases`, `atc-codes.ts` `parseEvidence`). Record: `OD8` in `docs/research/atc-index-review-2026-10-14.{json,md}`. Колдакт + лизиноприл
  0 → 1 sentence. **Цитрамон is deliberately left without a line:** its own class N02B is already an analgesic-antipyretic, so «также: анальгетик (через
  парацетамол)» would repeat it, and its caffeine stays out (OD7).
- **The primary code is named.** `DrugAtcChip` shows «N02BE51 · анилиды»: the НСИ name of the deepest known level 2–4 group (`atc-group-name.ts`), in the same
  tap target, plain text face beside the mono code. Named on the screen of a drug whose module is not installed (first two codes) and on an installed drug
  that has no pharmacological-group link; where the group link is shown the name stays off.
- **Interaction checker.** Under each pair's status line a small list says per drug «инструкция установлена / не установлена / нет инструкции в источниках
  приложения» (`sideSourceState`, `data-testid="interaction-source"`); every missing instruction is offered for download with its size (`pairOfferModules`
  no longer needs an indexed sentence), and the status never reads as a plain «не найдено» while one is missing («проверено не полностью» / «По указателю
  приложения упоминаний не найдено»; the print and share text name the drugs in the sentence). Class sentences of the installed side still appear through
  secondary classes. Tests: `interaction-view.test.ts`, e2e `drug-interactions.spec.ts`.
- **ATC group code in the main search.** A typed code of level 2–4 («J05AX») shows the group card first (`classOfCode` in `drug-class-lookup.ts`: the НСИ name as
  label, the code as its one group; skipped when the letters and digits are also an МКБ-10 card, as for `M05`), then the group's drugs by common use
  (`compareDrugsByUse` in `@localmed/search-lexical`: readable names before chemical ones — `looksLikeChemicalName`, a name heuristic — single substances before
  combinations, more registrations first). A stub card no longer leads a group query; a substance code keeps the exact drug first. Tests: `atc-query.test.ts`,
  `srch1.test.ts`, `atc-drug-search.test.ts`, `drug-class-lookup.test.ts`, e2e `atc-search.spec.ts`. Not measured on a phone.

## QA 0.6.60 UI fixes: age restore, term links, printed contents, name breaks, update button — 2026-10-15 (STATE UI-FIX1)

From `docs/research/qa-release-0660-2026-10-15.md` items 2, 7, 9, 10, 14 (pill) and 15 (placeholder).

- **Prescription age (item 2).** The draft stores what was typed (`patient.ageInput`: «5», «8 мес») next to the derived
  `ageDays`; the field shows it again after a reload while it still means `ageDays` (`restoredAgeText`,
  `features/prescription/prescription-age.ts`), the dose bands keep reading `ageDays`. `ageText` no longer floors:
  5 × 365.25 = 1826 days read «4 года», 8 months «7 мес.»; it counts with a one-day margin (never «4 года» on the fifth
  birthday, leap years included), and the printed recipe line uses it too. Tests: `prescription-age.test.ts` (ages 0–18, months,
  birth dates over leap and common years), e2e `prescription-facts.spec.ts` (reload after each typed age).
- **Ambiguous term links (item 7).** `createToolLinkMatcher` leaves an abbreviation right after a number as text («+1 SDS» is a
  standard deviation score, not the Zung scale); any all-capitals abbreviation, not only SDS. Search: an abbreviation before the
  dash of a document's short title («ИМТ — взрослые и дети») is an exact short-title identity (`QueryDocumentIndex`), so «ИМТ»
  puts the BMI reference first (before P07.1/R63.4); `benchmark:all` within tolerance.
- **Printed contents (item 9).** A guideline PDF's own contents («Оглавление … Список сокращений ……… 4») became the first 29
  «sections» of the older PDF-derived modules (e.g. «Педиатрия: дыхание и аллергология», 632 of 723 July builds; the current
  KD1/JSON modules have none). `splitPrintedContents` (`features/library/printed-contents.ts`) splits the leading run (dot leaders,
  an «Оглавление» heading, a section called «Оглавление», after a short title page) off the reader's sections; the reader shows
  it as one collapsed block «Оглавление печатной версии» (`PrintedContentsBlock`) above the text, open when the opened place is
  inside it. Source text is kept whole (a title-page chunk is cut into prefix and contents). The search card header and
  «Открыть полный документ» now open the reader at the found fragment's anchor (they dropped it); drugs keep their screen.
  Tests: unit, data test on the committed module, e2e `reader-printed-contents.spec.ts` (module installed from a file).
- **Printed contents only for guidelines (E2E3).** A section called «Содержание» counts as printed contents without leader dots
  only in a clinical recommendation (`splitPrintedContents(…, { titledContents })`, the reader passes
  `isClinicalRecommendationSource`); a legal act's own «Содержание» (the annexes of the order 1122н) stays text, so the block no
  longer pushes its text below the first 375×812 screen.
- **Overflow and name breaks (item 10).** A long combined name was one unbreakable word. `SoftBreakText` (and
  `HighlightedText` for search snippets, and `QueryHighlightedText` only where `softBreaks` is set: the reader titles) puts
  `<wbr>` after «+», «/», «-» between letters, text unchanged; running document text is never split (E2E3: «г/сут» was cut
  into two text nodes, which a text-node highlight selection could not find); the drug
  suggestion lists, chosen items, the «Назначение» item title and the checker suggestion card use it. The candidate lists and
  their parents have `minmax(0, 1fr)` tracks, so a long row no longer widens the page and clips the header buttons.
- **Update button (item 14).** Superseded 2026-10-19: nothing floats beside or above the bar; a waiting update is the dot on
  «Настройки» (see «Settings and download queue UI» below).
- **Placeholders (item 15).** One token `--theme-placeholder` (light and dark) for every input, textarea and editor hint; the
  fields used `--theme-text-faint`, which VIS1 darkened to near ink.
- **Not done:** the PCE calculator page overflow (TOOLFIX1); the toast «Доступно обновление» (separate notification).

## Calculator and questionnaire fixes from the 0.6.60 QA pass — 2026-10-15 (STATE TOOLFIX1)

Findings 3, 8, 10 (PCE overflow), 11 and 14 of [qa-release-0660](research/qa-release-0660-2026-10-15.md). Modules rebuilt:
core-clinical 0.1.0-preview.7, emergency 0.1.0-preview.6, obstetrics-gynecology 0.1.0-preview.10, psychology 0.1.0-preview.7
(**need publishing** with the 0.6.60 release; the app stays offline-first and nothing else depends on them).

- **Inputs accept normal values (3).** A native `step` makes every value off `minimum + k·step` «invalid» with the browser's own
  English tooltip (4 months against minimum 0.33 and step 0.1; 5,2 against 3.36). Number inputs now always render `step="any"`
  (`calculator-number-input.ts`, also in the search calculator card), both forms are `novalidate`, and the range, the
  whole-number rule and the message come from `calculatorNumberInputError` (Russian, decimal comma). `inputStep` is only the
  declared precision grid. `calculator-number-input.test.ts` walks every number input of the 251 tools and requires every value
  on its grid (and the minimum-anchored grid) to be accepted natively and by the engine. It also found a real data bug:
  **Cockcroft–Gault creatinine had a maximum of 30 for both units, so a normal 80 мкмоль/л was refused**; now 3000 plus a
  per-unit assertion (30 мг/дл, 2652 мкмоль/л).
- **Counted units agree with the number (8).** `countable-unit.ts` declines баллов/балла/баллы, пунктов, дней/дни, календарных
  дней, недель/недели, месяцев, лет, критериев, признаков, сегментов, единиц, капель, раз for the displayed (rounded) number
  (a fraction takes «балла»). It is used by every place that writes a value with its unit: result tiles, print and share text,
  score-scale text, the preview and trace lines, note cards, user calculators and the input summary. Abbreviations (нед, мес, дн,
  шт.) and measurement units never change. The maternity-leave text «194 календарных дня» came out wrong in its own code; fixed.
- **No horizontal overflow (10, PCE).** Citation text (`.calculator-footnote`, `.calculator-source-reference`,
  `.assessment-footnote`) breaks anywhere. `tool-pages-overflow.spec.ts` opens all 251 tool pages at 375 px and fails on any
  element or page wider than the viewport.
- **One verdict per result (11).** `evaluationNotice` no longer writes a verdict whose title is the page's headline (the
  headline's own summary is the fuller text). EPDS: two bands («ниже ориентира» / «достигает ориентира или выше», no «нижний»
  for 21/30), and the item-10 answer is a new declared **`alerts`** list on an assessment (`when` over scores and
  `answer_<question id>`): a red `role="alert"` block above the verdict, also first in the print/share text. Braverman, PAEI,
  egogram and team roles name a leader only when its percentage is strictly the highest; tied top values say «Ведущего … нет».
  Percentages everywhere go through `formatPercent` («83,3 %»).
- **Calculator details (14).** Editing any field removes the result computed from the old values (it stays in the history);
  a disabled «Рассчитать» lists the required fields still empty («Нужно заполнить: …») once the form was touched; the
  «Расчёт сохранён локально» toast is gone (the result header says «сохранён на устройстве», so nothing covers the heading).
  New optional **`when`** on a schema warning shows it only when the expression holds: CKD-EPI 2021, Cockcroft–Gault and
  Schwartz warn when creatinine is below 0,2 мг/дл (18 мкмоль/л). GCS: V4 «Спутанная речь (дезориентирован)», V3 «Отдельные
  неуместные слова», and the **flexion/extension labels were swapped** (flexion is decorticate, extension decerebrate, now
  as in Teasdale & Jennett); verdicts speak of impaired consciousness and name head injury only as the NICE reading.
- **Not done / open:** the «Обновление» pill belongs to UI-FIX1. Plausibility notes exist only for creatinine; other tools
  can add `when` warnings the same way. The EPDS ≥13 level (Cox 1987) is deliberately not added: the module cites only the
  Golubovich 8–9 guideline.
## Downloads after the QA pass: «Скачать всё» failures, МКБ-11, pause labels, long queue — 2026-10-15 (STATE DL3)

From `docs/research/qa-release-0660-2026-10-15.md` items 5, 6 and the download parts of 15.

- **Why 31 modules ended «Набор не установлен» (item 5): the pause is not the cause.** Reproduced in headless Chromium (an
  ephemeral profile, like the tester's) on the built app with the real catalog: «Скачать всё», **with or without** a
  pause/reload, fails from about the 665th of 799 modules (≈1.5 GB of decoded indexes in; the calculator packs and the last КР
  are at the tail of the catalog) with the browser's `NotReadableError` («The requested file could not be read…»; 390 failures
  in one no-pause run). The throw is the last step of `downloadWithResume`: it wrote the received bytes to IndexedDB as ever
  larger `Blob`s every 256 KB (a quadratic pile of Blobs and rows to delete), **deleted the row first and read the Blob after**,
  and the browser had lost the file behind a Blob it had handed to IndexedDB. Small modules (most of them) were hit as much
  as big ones. The pause logic itself holds: `module-queue-reload.test.ts` runs the real module runtime, download queue,
  resumable transport, pending-install list and installer over a reload (new module graph, same storage) — the queue stays
  paused, no byte is requested, «Продолжить» resumes the cut transfers with `Range` and every module installs with no failure,
  also when modules are cut in the middle of their check.
- **Fix** (`features/network/resumable-download.ts`): a file below 4 MiB is kept in memory only and never wrapped in a Blob
  (`FLUSH_BYTES` 256 KB → 4 MiB; the partial is also written at once on an abort, so a pause still keeps its bytes); the
  finished file is read before its row is deleted; a stored partial is verified readable (first and last byte) before a `Range`
  request builds on it; a `NotReadableError` anywhere drops the partial and fetches from the first byte, once; a partial the
  device is too full to store no longer fails the download (it goes on in memory). `download-retry.ts` treats `NotReadableError`
  (and the installer's message for it) as transient; the module runtime's automatic re-queue of a transient failure is bounded
  to 5 tries (`MODULE_REQUEUE_LIMIT`; «Повторить» starts over). The installer now reports a browser storage error with its name
  (`QuotaExceededError: …`), and `module-failure-message.ts` turns it into «Не хватает места на устройстве…» (a 404 into «Файла
  набора пока нет на сервере…») instead of one line for every cause.
- **Measured after the fix.** Same build, same 799 modules, 3 concurrent transfers: a normal (persistent) profile installs
  all of them with zero failures — also through pause → reload → resume at 100 modules (`PAUSE_AT=100`, see the run notes in
  the commit). The ephemeral profile now fails only from about the 760th module (≈1.9 GB decoded + the 130 MB model) with
  `QuotaExceededError` on `versions`/`active`: that profile's IndexedDB quota is smaller than the whole library. It is a
  property of the headless test profile, and the message above now says so; a phone with free storage does not hit it.
- **Tests.** Unit: `resumable-download.test.ts` (unreadable partial, unreadable finished file, one restart only, small file
  never in a Blob, full device), `download-retry.test.ts`, `module-failure-message.test.ts`, `module-queue-reload.test.ts`; e2e
  `download-pause-queue.spec.ts` (8 real calculator packs, the pending list and the paused journal as a reload leaves them, hero
  «На паузе», no request while paused, resume finishes all, no error row).
- **«Поиск по смыслу» after a reload.** Its task (kind `model`) had no restore recipe, so it stayed «Прервано перезапуском».
  `DownloadResume` has a new kind `semantic-model`; `restore-downloads.ts` revalidates it against `E5_DOWNLOAD_ID`/`E5_MODEL_REVISION`
  and starts `installE5Model()` again (kept partial bytes, `Range`). Unit in `download-queue.test.ts`; e2e `download-model-resume.spec.ts`.
- **«На паузе» everywhere.** The hero of Settings → Загрузки (`fullDownloadLabel(plan, active, paused)`) says «На паузе» with a
  pause glyph instead of «Скачиваем…» and a spinner. Section rows, the ATC group rows and the «Препараты» button, the section cards
  and the open section of the knowledge base and the search section block read the queue-wide hold through
  `moduleGroupTaskState(modules, tasks, paused)` (new `paused` result) and `ModuleInstallerSnapshot.paused`.
- **МКБ-11 module 404 (item 6).** The module was released only as the GitHub release asset `reference-icd11-2026.10.6`; a
  release asset has no CORS, so `artifact-url.ts` fell through to `…/main/apps/app/public/content/modules/<file>`, which does not
  exist. The local release copy (`data/build/icd11-module/release/`, 47 662 744 B, sha256 194b8953…) equals the catalog entry; it is
  now a plain git blob on the new mirror branch `datasets/reference-icd11-2026.10.6` (`modules/`), and `artifact-url.ts` maps
  `reference-icd11-*` `.db.gz` there (`scripts/publish-module-zstd-mirror.sh --family reference`, a step in `docs/RELEASES.md`);
  `bun scripts/verify-module-artifact.ts` against the raw URL: sha and decoded size match, `ok`. Every other catalog URL was
  resolved and probed: this was the only 404 (the Pages-mirrored terminology/КрасотаИМедицина/РЛС-МКБ files exist only on the
  deployed site). The catalog entry is unchanged.
- **A module that keeps failing no longer keeps «Скачать всё · 49 МБ» alive.** `fullDownloadPlan` takes `failed(module)` (the
  queue's failed `module:<id>@<version>` task, read in `use-full-download.ts`, throttled): failed modules leave `pending`
  and the byte total; with nothing else left the offer is gone and the overview card offers «Повторить ошибки».
- **Onboarding (item 15).** Before the app knows whether the base is missing, the download scene said «Скачиваем в фоне» although
  nothing had started (it flipped to «Что скачать сейчас?» ~4 s later): it now says «Проверяем, что уже есть на устройстве…» until a
  download runs or a choice is made (`OnboardingIntro` gets `coreDownloading`; the arrow waits for a real download). The disabled
  «Назад» of the first tour step is hidden (`visibility: hidden`, layout kept). e2e `onboarding.spec.ts`.
- **One Russian number format.** `i18n/format-number.ts`: `formatDecimal` (comma, real minus, no «−0,0»), `formatPercentValue`,
  `formatByteSize` (КБ/МБ/ГБ). Used by the downloads page rows («1,4 МБ из 1,1 ГБ»; was 1.4 МБ / 1.14 ГБ), the module/file/note sizes,
  the ECG package size and the number outputs of calculator schemas (`calculator-schema-engine.ts`, was `toFixed` with a point).
- **Long queue.** The downloads page drew every row (~700 after «Скачать всё»). `DownloadTaskList` shows the first 6 rows of a group
  (20 of the history) and one «Показать все · N»; the waiting line keeps its order (next to start first); the page follows the queue
  at most 4 times a second. e2e `downloads-long-queue.spec.ts`.
- Not done: the `-0.7 %` of the report was not located beyond the calculator outputs above; Android native transfers and a
  physical device are untested; the ephemeral-profile quota limit is not worked around (a storage-pressure pre-check before
  «Скачать всё» would be the next step).

## Result interpretations, part B — 2026-10-15 (STATE TOOLS-B)

The other nine tool modules (gastroenterology, neonatology, neurology-rehab, obstetrics-gynecology, pediatrics,
pediatrics-growth, psychology, rheum-gi-onco-uro, surgery-trauma) have no `unavailable` evaluation any more
(`bun scripts/audit-tool-interpretations.ts`). Test: `apps/app/src/features/calculators/tool-interpretations-b.test.ts`.

- **Verdicts with cited bands (30 tools).** Assessments that already carried bands got matching verdict rules: PUCAI,
  Vesikari, partial Mayo (score-only: score 1 is «ремиссия, если нет кровотечения»), Downes–Vidyasagar, NIPS, Apgar,
  EPDS (score 8), Ferriman–Gallwey (8), Whooley. **Silverman–Andersen now follows its cited AIIMS text** (none 0, mild <3,
  moderate 4–6, severe >7; 3 and 7 are not assigned by the source and are shown as borderline bands) instead of the
  earlier 0–4/5–6/7–10. **FLACC** gets 0 / 1–3 / 4–6 / 7–10 from the authors' scoring form (not in the 1997 paper; stated in
  the evidence note). New calculator bands: fetal weight percentile from the protocol (ISUOG 2020: <3rd, <10th),
  Gail/BCRAT 5-year risk (≥1.66 %, NSABP P-1; none for the lifetime risk), blood loss by hematocrit (ATLS classes by %
  of blood volume), hypogalactia degree. Doppler indices (CPR, UtA-PI) stay unbanded: they need gestational-age charts.
- **`not-applicable` with a reason (quantities, 31 tools).** ORS volume, GIR, gestational age by CRL/biometry, EFW by maternal
  anthropometry and Rudakov, VBAC probabilities, corrected age, five feeding calculators, BASFI, SLICC/ACR, MELD-Na,
  MELD 3.0 (Wiesner groups are for MELD without Na), prostate volume, carboplatin dose, TRISS, POSSUM, Evans, local-anaesthetic
  dose; the seven EDD/leave calculators and Rivermead already were. Nothing is shown on a result page for them.
- **Non-clinical profile tests** (Braverman, egogram, PAEI, team roles): the interpretation names the highest scale from
  the tool's own scale description with the model's author named and no clinical claim; temperament keeps its quadrant text.
  All five are `not-applicable` (no norms). The Braverman items are MiniMed's adaptation, so there is no author text to quote.
- **WHO growth wording.** Option labels say how length was measured («По возрасту: до 2 лет лёжа, с 2 лет стоя» …), outputs name
  their reference («Масса к возрасту (ВОЗ 0–5): отклонение от среднего» …), BMI → ИМТ, a «?» on length, head and arm
  inputs, and each of the ten z-scores sits on a band track (WHO 2008 training course; 5–19 BMI: >+1 overweight, >+2 obese,
  <−2 thin). The tool is not-applicable as a whole (no single verdict). Module 0.3.2 (0.3.1 was released). AAP BP got the
  four category texts next to its verdict.
- **UI:** an assessment verdict that repeats the result's headline and summary is written once (`evaluationNotice`).
- **Not resolved:** none left `unavailable`. Unverified against the primary text (kept conservative): the FLACC bands come from
  a hospital form of the authors' scale, ATLS 10th ed. was cited from memory of the class table, the GIR guideline PDF was not
  reachable. Modules rebuilt in place (versions unchanged since the 0.6.59 release; pediatrics-growth bumped);
  **needs publishing** with the 0.6.60 release, `minAppVersion` left to the coordinator.

## Result interpretations, part A — 2026-10-15 (STATE TOOLS-A)

Five tool modules (core-clinical, emergency, intensive-care, medication-dosing, metabolic-lab; the other eleven are
TOOLS-B) no longer have an `unavailable` evaluation. `bun scripts/audit-tool-interpretations.ts` now prints three groups:
missing bands, `unavailable`, and an informational list of `not-applicable` / `missing-context` with the declared reason
(`--strict` exits 1 while either of the first two is not empty).

- **15 verdicts with cited bands** (each band: a rule in `evaluation`, an `interpretations` line with the same wording, a
  `scoreScales` track where the cascade is one number): CKD-EPI 2021 and bedside CKiD (KDIGO G1–G5; CKiD says nothing for
  under 2 years), FENa (Espinel 1976: <1 %, 1–3 %, >3 %), FeUrea (Carvounis 2002: ≤35 %), urine output by weight (KDIGO
  criteria with the observation time), corrected sodium (<135, ESE/ESICM/ERA-EDTA 2014), effective osmolality (>320, ADA 2004),
  Winter (new optional input «Измеренный PaCO₂» → below / within / above the expected range, Albert 1967), FIB-4 (Sterling
  1.45 / 3.25), APRI (Wai 0.5 / 1.5 / 2.0), ANC (CTCAE v5 grades), CHA₂DS₂-VASc (ESC 2020, sex-specific via the new step
  `scoreWithoutSex`), HAS-BLED (≥3), GCS and Alvarado (their existing bands as verdict rules).
- **When two sources differ the tool's own source is kept and the other is named in `limitations`**: FIB-4 (NAFLD 1.3/2.67),
  FENa (textbook >2 %), effective osmolality (consensus 2024: ≥300), CHA₂DS₂-VA of ESC 2024.
- **Declared, nothing shown:** `not-applicable` — Cockcroft–Gault, anion gap (analyser-dependent limit), Parkland,
  Mosteller, Holliday–Segar, SAPS II, MPM II ×2, BMR, albumin-corrected calcium, atherogenic coefficient (+ the 9 that already
  were); `missing-context` — QTc (sex-specific limit, not verified against the AHA statement) and calculated free
  testosterone (age and laboratory interval).
- **UI:** `evaluationNotice` no longer shows a `not-applicable` reason on an assessment result; the patient dynamics table
  prints the verdict title or «—», never the raw status word.
- Modules rebuilt as core-clinical preview.6, emergency preview.5, intensive-care preview.4, metabolic-lab preview.4 (old
  files kept); the landing calculator copy follows core-clinical. **Needs publishing** with the 0.6.60 release.
- **Rebuilding a tool module** (`bun run tools:module:rebuild -- <group>... | --all`, `scripts/rebuild-tool-module.ts`): after
  editing `content/tool-modules/<group>.json` and bumping its `version`, it builds the pack with `medbase build-tool-module`, rewrites
  the catalog.preview entry (version, digest, sizes, artifact sha256) and re-derives `tools` and the shell via `buildToolCatalog.ts`.

## e2e sweep before 0.6.60 — 2026-10-15 (STATE E2E1)

The whole Playwright suite (single worker, `E2E_PORT=4791`, `bun run build:app` first) after the NAV1, DL1, VIS1/2,
DOC-UI1, DRUG-UI1/2, NOTE1/2, SRCH1, REG2, CLS1, ATC3–5 changes: **573 passed, 11 skipped, 0 failed** (1.4 h; one
rerun of the failures and of every spec the first run had skipped is in the table below).

Failures of the first run (583 tests, 12 failed) and what each was:

| Spec | Class | Cause → fix |
| --- | --- | --- |
| `app-first-paint` ×2 | stale | the desk colour became the tan `--theme-background` (VIS1); the test read the token instead of a hard-coded grey |
| `patient-vault` (the three scenarios) and `obstetric-calculators` :140, `diary-doctor` (via `createDoctorCard`) | stale (NAV1) | «Отмена» on a new-card form opened from Notes now returns to Notes; a created card replaces the form, so back is the list it was opened from; a tab tap returns to the tab's last place (the card), a card's back steps one entry. Specs reach the list by its address (`e2e/patient-list.ts`: `openPatientList`, `patientCard`) or by the back button |
| `patient-vault` :88 (once, second run) | flake | the card was found by role + name, which also matched the patient picker's option kept in the hidden calculator screen; cards are now located by their class |
| `ecg-close` | stale (NAV1) | closing the editor is one history step back to the place it was opened from (not a replace by search); the test opens it from Notes and expects Notes |
| `ecg-manual-fallback` | regression | «30 признаков для модели» swapped the editor dialog for the numbers dialog (one history layer replaced by another): the editor's layer became a dead entry and closing the numbers stepped past the editor to the search page. Fixed at the cause: the numbers open as a layer **over** the editor (`EcgPhotoCaliper`) |
| `user-calculators` | regression | calculator ⇄ editor ping-pong piled entries (back from the calculator led to the editor, back from it to the calculator): «Изменить калькулятор» and «Открыть» now go through `visitRoute`; the import dialog closed (a deferred step back) before the async import navigated, so the step back landed after the push and ended on the list — now navigate, then close (same in the questionnaire import) |
| `vaccination-calendar` desktop | regression (VIS1) | the 13 px floor made the capitals «ВЗРОСЛЫЕ» wider than their one-column group header, spilling 12 px past the table; the group header is no longer upper-cased/letter-spaced |
| `offline-shell` offline | flake (race in the test) | the background warm-up of the held-back chunk failed while still online and the app (correctly) reloaded once; the request is now held until the connection is cut and fails then |
| `item-bookmarks` 375 | flake | `page.reload()` raced the history step of the just-closed save panel (a history layer); the test waits for the panel to go |
| `note-persistence` visit row | flake under load | passes alone and in the rerun; no change |
| `prescription` search card (failed 2 of 3 alone, 1 of 1 under load) | race in the test | the helper tapped the already chosen form again, which resets the strength; the strength group (a form with one strength shows no chips) vanished between its `count()` and its click and the click waited 5 minutes. The helper now taps only what is not chosen yet and waits for `aria-pressed`; 4 repeats × 4 tests pass |
| `core-identities` :168 | stale (REG2) | the fixture copied the regulatory module's `minAppVersion` 0.6.60; the fixture now lowers it like the definition module |
| `packaging-image-source` | stale (pending release) | the photo pack is listed for 0.6.60; the catalog chunk is served with the pack's floor lowered (as the severity fixture does) instead of skipping |
| `reader-layout-preview` illustration | — | not a failure: it passes (the suspected stale image-mirror route is not stale) |

**Harness fix — 103 tests silently skipped in a worktree.** Fixtures chose the data root by `existsSync(<checkout>/output)`;
a test run creates `output/playwright` (screenshots), so in an agent worktree the root flipped to the worktree after the
first screenshot and every spec that needs a local release copy skipped as «local-only». `e2e/local-data.ts` now exports
`LOCAL_DATA_ROOT` (a path under `.claude/worktrees/` → the main checkout) and all fixtures and specs that read `output/` or
`data/` use it (no copies or symlinks). After the fix those specs run from the main checkout's copies.

**Back labels (NAV1 step-back vs the words on the button).** A back button whose label names a destination was kept only
where it is the destination in the common flows: «Назад к заметкам» (patient list, forms, templates; «К файлам» when opened
from the files), «К карточке пациента» (dynamics, patient forms), «К ленте», «К моим калькуляторам» (editor) stay. Made
neutral («Назад», aria-label too):

- the patient card (was «Пациенты») — it is opened from Notes, the list, search hits, forms and attached conversations;
- the sub-pages of Settings (was «К настройкам») — «Загрузки» is opened from the search section picker and the download
  indicator;
- the assessment result (was «К тесту») — results open from the records list as well.

**Still skipped (10) and why** (`module-pointer` «zstd MKB» runs since DL2): `dev-server-smoke` (needs a dev server), `ecg-photo-benchmark` and `ecg-success-path`
(need an external ECG folder / file), `grls-instruction-modules` (`GI1_MIRROR_E2E=1`, downloads from the mirror),
`ios-layout` (WebKit behaviour), `live-prototype` (`MINIMED_LIVE_URL`), `local-model-smoke` (scheduled workflow),
`pdf-viewer-perf` (`PDF_PERF=1`), `search.spec` ×2 (the 500 MB medication companion pack is not in
this build's `dist/content`; copying it into a worktree is not allowed). Not run at all: `webkit-ios` project, native/device
checks.

## Leaflet table of contents as one list — 2026-10-15 (STATE LEAF1)

DRUG-UI2 (2026-10-14) found that «Вермокс» opened with a lone heading «Прием препарата», «4. Возможные нежелательные реакции.»,
a lone «5.» and «6.» before «1. Что из себя представляет …». Measured and fixed in the preparer; method, shapes and the numbers
per module: [research/ocr-quality-2026-10-14.md](research/ocr-quality-2026-10-14.md) §7.

- **Cause** (not what DRUG-UI2 suspected: the text layer keeps every entry in one block). The generic PDF heading rule made
  «4. Возможные нежелательные реакции.» a heading (a block that *ends in* a heading phrase); the instruction re-segmenter then
  cut «3. Прием препарата Вермокс.» and «5. Хранение препарата Вермокс.» at the standard phrase and left the numbering
  prefix behind as a one-token chunk.
- **Measured**: **3 787 of 8 947** ГРЛС instruction documents (3 782 of the 3 818 leaflets; 3 588 text layer, 199 OCR) and **91 of 272**
  manufacturer-site documents hold a contents list; all of them were damaged (2 588 with an entry made a heading, 3 765 cut at
  a heading phrase). Lone list-number chunks in the shipped modules: **5 683 chunks in 2 800 documents → 24 in 24** (the 24 are step
  labels, table cells and a footer inside PDF blocks); manufacturer 138 chunks in 74 documents → 0.
- **Fix at the cause** (`tools/ingest`): `leaflet_contents.py` recognises the list in the extracted blocks; `source_registry.render_body(contents_lists=True)`
  (for `official_drug_instruction`) writes it as one list block with a `"role":"contents"` marker listing every block it covers
  (what the extraction put before or after it in the same block stays an ordinary block with its `offset`); `markdown_parser`
  keeps such a paragraph whole (one entry per line, the text after it a chunk of its own, chunk metadata `contentsList`) and
  `grls_instruction_sections` keeps a numbering prefix with the heading it numbers. The original text is unchanged: every
  changed document keeps all its characters (checked on the 3 787 + 91) and the list stays a compact numbered list in the reader.
  A genuine numbered heading, a numbered list of steps, a list whose titles do not come back, a numbering with a gap are not
  taken for contents (`tests/test_leaflet_contents.py`, excerpts of real documents).
- **Delivery**: `scripts/grls_contents_lists.py plan|apply|manufacturer`. All 8 947 stored bodies re-render to the stored Markdown
  byte for byte, so only the documents with a list are re-rendered (front matter verbatim) into
  `data/intermediate/grls-contents-lists` (262 MB) with the overlay `data/build/grls-contents-lists.jsonl` that
  `read_manifest_rows` joins after the OCR1 overlay (workspace and `textSha256`; `contentsLists` goes to the document
  metadata); the manufacturer workspace gets `prepared-contents` (7 MB, first in `PREPARED_DIRS`). The old workspaces, the
  manifest and the PDFs are untouched.
- **Modules republished** (versions `grls-2026.10.15.kd1`, `manufacturer-2026.10.15`): 15 ГРЛС modules → `datasets/grls-instructions-2026.10.15-36a501e7f136-kd1`, 222.5 MB download / 1 306.3 MB installed (was 224.9 / 1 328.7), largest blob 38.8 MB, 8 946 documents (the OCR-noise heading still fails the builder's guard), sections 210 052 → 197 336, chunks 239 720 → 229 370; the manufacturer-site module (271 documents) → `datasets/manufacturer-instructions-2026.10.15-4054ceb93a8a`, 7.2 MB / 45.2 MB, sections 5 691 → 5 405, chunks 7 158 → 6 946. Additive new mirror branches, nothing published earlier touched; all 16 URLs return the catalog's bytes with CORS (`verify-module-artifact.ts --url` per module); catalog `publishedAt` 2026-10-14T23:45Z; `minAppVersion` stays 0.6.48. Local copies: `output/module-zstd-grls-leaf1-2026-10-15`, `output/module-zstd-manufacturer-leaf1-2026-10-15` (the OCR1 copies stay as the rollback ones). Documents changed
  3 865 of 8 946 (the 3 787 with a list and 78 whose numbering prefix moved from the end of one chunk to the start of the next; 5 081 identical); manufacturer 109 of 271 (91 + 18); unchanged documents are identical row for row (sections, chunks and `documents` hashes), the KD1 vectors of the
  9 419 chunks present in both releases are byte-identical (`embed_modules.py --reuse-from` copies them; 27 chunks of the numbering-prefix
  change were encoded again), `compare_instruction_modules.py` is the report.
- **Dependent data rebuilt** from the shipped modules (they record the module versions and checksums): interaction, safety,
  comparison and dose-rule indexes (byte-reproducible: a second run gives the same bytes) and the substance fallback
  (identical, 12 185 registrations with text). Dose values are unchanged in every document (only section references and
  character offsets moved, 5 documents without any dose rule dropped out of the dose index); comparison index: the module record
  and 24 `y` values.
- **Rendering** (Chromium, 375×812, e2e `drug-leaflet-contents.spec.ts`, local module bytes): Вермокс opens with the intro and one
  numbered list of six entries, then «1. Что из себя представляет …» as the first section; the same for Гелмодол-ВМ,
  Празиквантел МИРФАРМ, Декарис (list cut out of a long block); Немозол, Пирантел, Албендазол-Алиум are national-format
  instructions without a list.
- **Not done / not tested**: 21 documents that mention «Содержание листка» in a shape the recogniser does not know are
  unchanged; lone numbers inside PDF blocks (20 documents) are left; the other 14 modules were checked on the database, not in the
  app (only the antiparasitic group was installed in the browser); Android/WebView and a physical device were not run; the
  Allmed instruction module (HTML source) has no such list.

## Readability: contrast, chrome, typography, strips — 2026-10-14 (STATE VIS1)

From the Haiku QA pass ([qa-haiku-2026-10-14](research/qa-haiku-2026-10-14.md) «Visual readability», items tagged
VIS1) and the coordinator's scrollbar decision. Screens: search home and results, global chrome, shared typography.

- **Contrast.** Light paper tokens darkened a step (`--theme-text-muted` #524d43, `--theme-text-faint` #58534a) and a
  new `--theme-accent-text` for accent-coloured text (`--theme-accent` stays the fill). Text that sits straight on the
  tan route desk (`.page-surface`, `.search-home`, `.assessments-page`, `.calculators-page`, …) takes the
  `--theme-desk-*` tokens: `styles/readability.css` (loaded last) remaps the text tokens inside those containers, and
  paper surfaces nested in them (`.paper-card`, `.result-group`, `.home-feature`, …) take the paper values back. Dark:
  `--theme-danger`/`--theme-kicker` #e8a094, `--theme-accent` #8fb59a, `--theme-warning-soft` 30 % mix. After:
  desk description/footnote/label/crumb 5.2 (4.6 on the darker chip), desk kicker 5.1, desk accent code 4.9, ATC row
  meta 7.4, ATC row code 5.0, home title icon 4.9, home description 5.8; dark «Удалить» 5.2, ATC head 5.1, tag 5.0,
  kicker 6.5. Tests: `src/styles/theme-contrast.test.ts` (token pairs, light, dark, desk) and
  `e2e/readability.spec.ts` (in-page WCAG audit of ten offline screens × light/dark × phone/desktop,
  `e2e/readability-audit.ts`; hidden, `aria-hidden`, disabled and half-visible carousel neighbours are skipped).
- **Fixed chrome.** `.page-surface`, `.search-home`, `.model-status-view`, `.patient-notes-view` pad their bottom by the
  navigation clearance (`--bottom-nav-clearance`); the scroll-to-top button (and the floating tools above it) now stands
  in the navigation's own row beside the bar (`--floating-control-bottom`), never over page content; the download ring
  is a 16 px badge pushed to the corner with a 44 px hit area that reaches away from the tab. The test scrolls ten
  screens to their end at 375×812, 812×375 and 1280×800 and fails when the bar covers a visible in-flow control or
  text (`coveredByNavigation`). Not covered: the six-tab navigation (`splitNavigation: true`) is wider than a phone, so
  the scroll-top button cannot stand beside it at 375 px there.
- **Result cards.** Titles wrap (`overflow-wrap: anywhere`, a soft break after «+»); the «[НАБОР]» marker moves into a
  meta line (`splitResultTitle`); a snippet cut by the core in the middle of a word loses the stub
  (`tidySnippetEnd`); the type badge and title lead, then the text, then **one footer line**: «Ещё N фрагментов» (a
  `Disclosure` with the new `action` slot) and the download offer or «В том же наборе» on the right
  (`result-group__foot` for a card with one fragment). The search grid uses `LayoutVirtualizedGrid align="start"`, so
  cards keep their own height at 768/1280. The meaning-model offer is one slim row (title + «Жалобы своими словами ·
  129 МБ» + «Скачать»); «Клинический разбор» above the results is one line with a «?» popover.
- **Source picker.** Names wrap to two lines at a word (no marquee: `MarqueeText` removed), rows, expand and download
  buttons are 44 px, counts 13 px.
- **Typography.** `text-wrap: pretty` on the body, `balance` on headings and `*__title`; `bindNumberUnits` /
  `joinNumberUnit` (`i18n/no-break.ts`) keep a number with its unit, «%», «°» and «№» (used for download sizes on
  search chips; other number formatters can adopt it); text floor 13 px (`--type-micro`, `--theme-type-*` and every CSS
  font size below it raised by `bun scripts/css-font-floor.mjs`, re-run it after a rebase; the print sheets, image
  viewers, ECG/drawing editors, PDF viewer, diary and nav badges keep their sizes); reading blocks stop at 66ch from
  760 px; the desk behind the pages is a darker tan (`--theme-background`), not grey.
- **Tap targets.** `.ui-button` 44 px, icon buttons, nav, search chips and the named small controls (help «?»,
  carousel arrows and dots, form rule «?», toast close, pin stars, clear) 44 px by size or by an `::after` hit area;
  `e2e/readability.spec.ts` checks the home screen controls. Still under 44 px: the vaccination chart cells and
  age buttons (dense grid, VIS2), calculator-section download buttons (44×40, VIS2), onboarding and tour buttons that
  set their own smaller `--ui-button-height`.
- **Home.** Capability cards are compact (icon + name + «?», one line of text, actions); the kicker row is gone.
  Лента stays in the web build (PubMed and the four browser-readable sources work there): the dead-end line now carries
  a «Скачать APK» link.
- **Scrollbars.** Fine pointers get thin, ink-coloured scrollbars for the page and inner containers
  (`scrollbar-width: thin`, `--theme-scrollbar-thumb`, OverlayScrollbars handles; `.scrollbar-themed` carries the
  WebKit fallback on `<html>`); touch keeps its overlay bars. **Horizontal strips show no scrollbar and show arrows**:
  `HorizontalScroller` always did, the native strips (news sources, recent calculators, search suggestions,
  spreadsheet sheet tabs) now use `<ScrollStripArrows>` inside a `scroll-strip`. Wide content (tables,
  code, charts, PDF columns) keeps a thin scrollbar: it is content, not a strip.
- **Not done / not tested.** Real devices and WebKit (Safari/iOS) were not run. The e2e ran against the production
  build served by `vite preview`; under parallel load the core sometimes fails to open in time (network error /
  timeouts in `search-ui-revision`, `search-subgroup-kinds`, `ux8-search-header`), they pass alone. Tool screens that
  need downloaded modules (calculator results, assessment forms, comparison, ATC tree) are covered by the token tests
  and the shared rules, not by the in-page audit; their own owners (VIS2, DRUG-UI1, DOC-UI1) check them.

## Drug screen: plain text links, no bubbles — 2026-10-14 (STATE DRUG-UI2)

Owner 2026-10-14 (screenshot of «Вермокс», 375×812): «too many bubble buttons». The first paragraph of the
instruction now starts at y = 421 px at 375×812 (was 497) and 416 px at 768×1024 (was 479); e2e
`drug-screen-first-screen.spec.ts` asserts the layout and that nothing on top is a bordered pill.

- **Text links, not chips** (`.drug-link`): «Мебендазол · Антигельминтное средство · P02CA01» and
  «Аналоги: Вермокс (Венгрия), Вормин (Индия), Гельмедазол (Россия), ещё 2» are two lines of accent-coloured text that wrap like
  prose; underline on hover and focus; the country is small muted text; «ещё N» opens the rest in place
  (fade-in) and turns into «свернуть». Separators stay on the line of the link before them (a real space is the only
  break). Each link is a 44 px hit area made of block padding cancelled by a negative margin, so the lines stay tight. The
  ATC code keeps its behaviour (opens the code sheet); a two-code drug adds a quiet «в реестре L03AX» link.
- **Header tools**: only the bookmark and the recipe stay beside the title, borderless icons (40 px hit areas,
  `--item-bookmark-border-width` / `--item-bookmark-background` custom properties on `ItemBookmarkMenu`).
  «Сравнить с…» (`data-testid="drug-compare-link"`) and «Поделиться» are items of the reader header's «⋯» menu
  (`ReaderActionsMenu`, passed as data; `AppContextMenuAction` gained an optional `testId`).
- **«Беременность, ГВ, дети»** is a quiet disclosure row (title, bare chevron), not a bordered card
  (`--ui-disclosure-chevron-fill*` variables on `Disclosure`).
- **Вермокс instruction body.** The oddities (a lone «Прием препарата» heading, «4. Возможные нежелательные реакции.»
  with empty sections, lone «5.» and «6.») are in the stored module text, not rendering: document
  `drug.rf.7687a385d1076d10a7d7.instruction` (module `minimed.medications.instructions.antiparasitic.ru`, ГРЛС leaflet ЛП-№(002347)-(РГ-RU), 7 pages)
  holds the leaflet's own table of contents («Содержание листка-вкладыша»): the PDF text layer puts a list number («3. », «5. », «6. ») in
  a block apart from its text, and the preparer turned the tail of that list («Прием препарата Вермокс.», «4. …», «Хранение
  препарата Вермокс.», «Содержимое упаковки…») into headings with one-line chunks placed before «1. Что из себя представляет…». Open for
  the preparer; fixed at the cause by LEAF1 (the section «Leaflet table of contents as one list» above): the contents stay one list.
- Not changed: the other readers, stored module text.

## Drug screen: the text on the first screen — 2026-10-14 (STATE DRUG-UI1)

Owner 2026-10-14: opening a drug, the instruction text must start on the first screen, everything
above it small and calm. Measured on «Вермокс» with the ГРЛС instruction (Chromium, e2e
`drug-screen-first-screen.spec.ts`): the first body paragraph sat at y = 1 169 px (375×812) and
1 540 px (768×1024); now 497 px and 479 px, above the bottom navigation.

- **Header** is flat: the name, the tools on the same row (bookmark, recipe; compare and share moved to the «⋯» menu by DRUG-UI2) and one line of Latin name, country, form and
  manufacturer. The kicker is kept only on the substance card; a packaging photo still tints the
  band, but no longer forces a tall header.
- **Quick links** are two small chip rows: substance · pharmacological group · ATC code, and
  «Аналоги» / «Торговые названия» with their country; past four chips (two on the substance card) «ещё N»
  ends the row and the rest opens under it. No headings, no full-width «Сравнить с…» button.
- **The ATC chip is one control** (`.drug-code`): the code and, beside an agreed code the registry holds only as a
  group stub, «в реестре L03AX» in the same pill. A registry stub another node of the card holds is no
  chip of its own. Each part opens the code sheet on its own ladder: the sheet is titled by the tapped
  code and highlights that ladder (`data-focus`, both ladders carry a heading). Codes use lining
  figures / the mono font (the serif drew «L03AX» as «Lo3AX»).
- **Without the module** the code still shows: on a drug card whose set is not installed
  (`DrugIndexAtc`) it is read from the comparison index that ships with the app.
- **Switch row**: «Кратко | Инструкция» with a «Разделы N» button on the same row (opens the reader's
  contents drawer; hidden where the outline stays beside the text, ≥ 761 px). The scrolling strip of
  truncated section chips is gone. The kind of text («Листок-вкладыш») is one small line; edition,
  publisher, fetch date and the registers behind the card are small plain text at the end
  (`DrugReferenceFooter`). The «Беременность, ГВ, дети» block is one slim row.
- **Page bubble** («1 / 138») over the first screen: handled with the reader chrome by DOC-UI1 (hidden at the
  top, then in the section-path line); the drug screen does not touch it.
- **QA fixes**: strengths that differ only in notation («100.0мг» / «100 мг») are one presentation
  (`uniquePresentations`); the registry's dosage-form code («smnnCode: 21.20.10.194-…»), the machine
  status («Статус записи ЕСКЛП: active») and a guideline's source number are dropped from reader text
  and result snippets (`dropRegistryIdentifiers`); a source's own id («site-4df3e404f895», «459_2»)
  is never a card qualifier (`resultQualifier` reads `documentVersionLabel()`: «ред. 2» for «459_2», nothing for `site-…` or a hash; SRCH2); the legal citation of the read instruction
  («ЛП-008472, 2022 · ГРЛС · получена …») stands at the end of the compare view
  (`ComparisonSources`) and of the recipe card, in small text.
- Not changed: the stored module text (the identifier lines are hidden at display, not rewritten —
  a module rebuild would drop them), the other document readers (DOC-UI1).
## Pause and resume for module downloads — 2026-10-15 (STATE DL2)

- One switch for the module download queue: an icon button (`DownloadsPauseButton`, aria-label «Приостановить загрузки» /
  «Продолжить загрузки») in the Settings → Загрузки overview card and a badge beside the download ring on the settings
  tab (`content-download-nav__toggle`). The glyph is a new node per state with a 120 ms fade-in; nothing blocks input.
- `DownloadQueue.setPaused()` (state `paused` in `DownloadPhase`, only for kind `module`): running module transfers get
  an attempt-level abort (`transfer(…, (attempt) => …)` now hands the operation its own signal; `retryTransfer` passes it
  to the transport), the aborted transfer is re-queued at the head instead of failing, waiting ones are not admitted
  (`drain` skips held jobs), and task views read `paused` whatever the installer still reports. The transport already
  keeps partial bytes (`downloadWithResume` flushes before it rethrows an abort), so «Продолжить» re-runs the same
  operation and continues with a `Range` request: finished bytes are not fetched again. Verifying/installing are never
  interrupted.
- Persistence: the journal `minimed.download-queue.v1` carries `paused`; after a reload unfinished module tasks are
  restored as `interrupted`, the runtime re-attaches them (pending installs) and they show «На паузе» without a request.
  A pause with no unfinished module download left ends by itself, so the next download is not silently held. Other kinds
  (core, images, models, ECG, OCR, speech, APK) are not paused. Download offers show «На паузе»
  (`ModuleDownloadPhase` `paused`, search chip too); Settings row status «На паузе · N».
- Tests: `download-queue.test.ts` (interrupt/resume with partial bytes, held admission, only modules, cancel while
  paused, persisted pause, auto-end), `download-retry.test.ts` (real `downloadWithResume`: pause mid-stream, `Range`
  continuation), `module-download-view`, `settings-status`; e2e `download-pause.spec.ts` (pause, reload, still paused with
  no request, resume, installed). Android native transfers: pause aborts the native task like a cancel; resuming
  restarts the same id. Not tested on a device.
- «Module-pointer zstd MKB release copy missing» was a stale spec path, not a missing file: the released
  `minimed.reference.rls-mkb.2026.9.30.db.zst` (sha256 779540a8…, equals the catalog) is kept in
  `output/release-rls-mkb-2026.9.30/` (ledger entry exists); `e2e/module-pointer.spec.ts` looked in
  `data/build/rls-mkb-module/release`, which holds only the 2026.9.28 files. The spec now reads the release copy and
  passes.

## Downloads and modules — 2026-10-14 (STATE DL1)

Source: the «Downloads and modules» findings of [qa-haiku-2026-10-14](research/qa-haiku-2026-10-14.md)
and the owner decisions of the same day.

- **Nothing downloads before the person chooses (owner 2026-10-14).** The first launch no longer
  starts the main database by itself. The onboarding's last intro scene asks «Что скачать сейчас?»:
  «Скачать всё · N» (recommended: the main database, every released content module and the
  130 MB meaning-search model; the image packs stay out — a pack whose download is ≥ 90 % source
  assets, today the Allmed packaging photos — and are offered separately), «Только основа · 76 МБ»,
  «Позже». Sizes come from the catalog through `formatModuleBytes` (`features/setup/full-download.ts`
  is the pure plan, `use-full-download.ts` queues it; a module added to the catalog, such as the
  regulatory pack of REG2, is included without special-casing). The catalog (~10 MB) is read only
  when the choice scene is reached. «Позже» leaves «Скачать» on the progress line, in search and
  on the boot screen; Settings → Загрузки has the same «Скачать всё · N» card.
- **Consent.** `minimed:core-download-consent:v1` (`features/setup/setup-state.ts`) is set by every
  button that starts the base download and read by `use-app-session.ts`; with it a later launch
  (a reload mid-download) continues without asking. A retained partial download resumes as before.
  E2E mounts set it through `mountBuiltApp` (the same preference the buttons set, not a UI branch).
  The old «metered connection only» rule is gone; the connection hint now only gates the catalog
  refresh.
- **Cancel / pause of the first-launch download — what exists.** The core download is a `core`
  task of the shared queue: Settings → Загрузки lists it (the bottom-bar pie was removed
  2026-10-19), where each task has «Отменить» and the page has «Отменить все»; a cancelled or failed
  core offers «Повторить» there and on the boot screen, and a retained partial file resumes. The
  onboarding progress line itself has no stop control and there is no separate «pause»: cancel +
  retry is the pause. A real pause button is not built.
- **One download state for every offer** (`features/downloads/module-download-view.ts`, hook
  `use-module-download-view.ts`): derived from the persisted download queue (available on the
  first frame), the module runtime's tasks once loaded and the durable install intents, so a
  download that reached 30 % shows «Скачиваем · 30 %» immediately after leaving and reopening a
  screen, and a reload shows «Продолжаем…» until the runtime picks it up. Unit-tested.
  A download resumed after a reload now also connects to the search core when it completes
  (`BrowserContentModuleRuntime.subscribeRecoveredInstalls`, used by `use-app-session.ts`).
- **One compact offer per module** (`features/modules/ModuleDownloadOffer.tsx`, used by
  `InstructionDownloadOffer`, `SafetyDownloadOffer`, `SeverityDownloadOffer`): «Скачать · 37 МБ» with
  the group as a small line under the button; the first offer created for a module on a screen
  draws, the rest stay hidden (`features/downloads/offer-claim.ts`), so the interaction and
  comparison screens show one. The comparison copy no longer says «скачайте её ниже».
- **Remove a downloaded section** (Settings → Загрузки): a trash button on any section row that has
  something on the device, a confirmation that says what is freed, then
  `ModuleInstaller.remove` → `BrowserContentModuleRuntime.remove` per module (registry + OPFS
  pool + sweep) and `onContentChanged` (core reconnect). The plan (`section-removal.ts`) removes the
  section's recommendations and the drug packages no other downloaded section names. A complete
  section shows a check mark instead of a disabled checkbox.
- **State labels.** A section row shows queue state from its own recommendations (and from its drug
  groups only once those are installed), so a shared drug group in flight no longer marks every
  other section «в очереди»; «скачивается…» replaces «в очереди» for work that has started. The
  calculators' «Скачиваем модуль…» notice resolves the moment the download completes; connecting
  the tools runs after it.
- **Sizes.** Calculator and questionnaire downloads show the catalog size («Скачать · 3,4 МБ» on
  the pack-required page, the questionnaire section header, the missing-test page, card tooltips).
- **ATC tree.** Rows show state only («не скачано · 10 МБ», «в очереди», «скачивается · 40 %») and
  counts only for an installed package; one «Скачать всё · N МБ» action replaces the 14 buttons; a
  single group downloads from its own page.
- **Offline first visit.** A download asked for while offline waits for the `online` event
  («Нет сети … скачается сама»), a start-up failure that happened offline reloads once when the
  network returns.
- Tests: unit for the download view, offer claims, section removal and queue labels, ATC labels,
  the full-download plan and the consent; e2e `download-offers`, `module-removal`, `core-offline`,
  and the updated `boot-screen`, `onboarding`, `medication-atc-tree` specs.

## Regulatory full texts are a downloadable module — 2026-10-14 (STATE REG2)

Owner 2026-10-14: make the regulatory full texts downloadable like the other sections, keep **323-ФЗ** in the app. Details,
commands and limits: [REGULATORY_PACK.md](REGULATORY_PACK.md) «Bundled light pack and downloadable module».

- **Bundled `regulatory.db` is a light pack** (3.3 MB, was 27.8 MB): 323-ФЗ in full text, the status crosswalk whole, and
  a module-pointer card for each of the other 29 acts under the **same document id** (official title, card description,
  list of headings, verbatim «Источник и редакция»; `medbase prepare-regulatory-light`, `regulatory_light.py`). The card
  shows the shared download offer; the search result offers the same download in place; installing the module replaces
  the card (the bundled mount is skipped), so ids, links and notes survive. DL1 owns the offer's wording.
- **Module** `minimed.regulatory.pediatrics.ru` **2026.10.14-r2**: the unchanged 2026.10.14 full-text pack (decoded SHA-256
  `03939d84…`, 31 documents) as framed zstd, 3 241 359 bytes (was 4 831 841 as gzip), `minAppVersion` 0.6.60 (listed in
  `PENDING_RELEASE_MODULES`: 0.6.59 still bundles all 31 documents and does not know the mirror URL). Published on the git
  branch `datasets/regulatory-2026.10.14-r2` (`modules/…db.zst`, raw serves CORS); `artifact-url.ts` resolves the
  `regulatory-<version>` release URL to it. The mirror download was verified byte for byte
  (`scripts/verify-module-artifact.ts --url …`: transport SHA-256 and size, decoded SHA-256 through the app's own zstd
  reader) and installed in the browser in e2e. Local release copy: `output/module-zstd-regulatory-2026-10-14-r2/`
  (`docs/data-ledger.json`, added by hand: the ledger script cannot see `output/` from a worktree).
- **Measured (same machine, before → after).** Bundled file 27 799 552 → 3 309 568 B. Web precache (`build-manifest`
  `precacheBytes`, the file is the only difference) 97 206 304 → 72 716 320 B. Opening the pack at start the way
  `create-browser-core` does (Node, same `SqliteMedicalStore`, 3 runs each): RSS +138 → +44 MiB (about 40 MiB of it is the
  sqlite-wasm runtime), ArrayBuffers +29.4 → +4.4 MiB. In Chromium (4 cold starts each, core ready + 4 s): JS heap
  170 → 141 MiB, whole browser process tree RSS median 1.67 → 1.57 GiB (noisy: one light run read 0.97 GiB, the others
  1.52–1.65 GiB; the memory of the 445 MB core dominates).
- **Search.** Every act is still found offline by number (top 2 for all 29 cards, test) and by topic from the card
  (`benchmark:regulatory` on the bundled pack: 55 of 57 topical queries for card-only acts in the top 5, gate 0.9); the
  323-ФЗ queries keep the full-text gates. `benchmark:regulatory` on the full pack still passes (Recall@1 0.978,
  Recall@2/5 1.0, section recall 1.0).
- **Tests.** `regulatory-module-catalog.test.ts` (entry, mirror URL, every card resolves to the module by exact
  membership, bundled pack < 5 MiB), `regulatory-bundled-search.test.ts` (323-ФЗ whole and searchable, all acts found by
  number, no module), `artifact-url.test.ts`, `test_regulatory_light.py`, `catalog.data.test.ts` (honest pending-release
  allowance), e2e `regulatory-module.spec.ts` (card offer, install from the local release copy or the real mirror with
  `REGULATORY_E2E_MIRROR=1`, the act opens whole). Not run: Android/iOS, a physical device, the Pages deploy. Known gap
  (not changed here): `contentModuleCatalogFingerprint` ignores `compatibility`, so a remote catalog that only changes a
  module's `minAppVersion` is not applied by the running app until `catalogVersion`/artifacts change.

## Typed note text is never lost — 2026-10-14 (STATE NOTE1)

QA ([qa-haiku-2026-10-14](research/qa-haiku-2026-10-14.md) «Data safety») lost typed text twice. Causes and fixes:

- **Plain note lost on reload (roots).** (1) `NotesView` wrote its localStorage draft from an effect that returned
  before reading the draft signals when `editorReadyKey` was not set yet. Solid does not fix the order of two effects
  that depend on the same route signal, so after a route change the draft effect could run first, subscribe to nothing
  and never write again: the typed text never reached a draft (traced: `D/new-record` ran before `E/new-record`). It
  now reads every field first and only then checks readiness. (2) The editor (Milkdown) reports its text through a
  ~200 ms debounce, so a reload, a hidden tab or a back tap inside it saw the previous text. `note-editor-flush.ts`
  flushes every open editor on `pagehide`, `beforeunload`, `freeze`, hidden `visibilitychange`, on the editor's
  unmount and in `onHashChange` before the note is committed.
- **Visit note lost (roots).** «Краткая запись осмотра» was only the text of a *new* visit: nothing was bound to an
  open one, `episode.text` was stored but rendered nowhere (the QA1 change emptied the box after «Создать осмотр»), and
  ✓ only picked the visit for tool recordings. Now the field is the note of the current open visit (picked, else the
  newest open); every change is saved through `createVisitNoteSaver` (`state/patient-visit-note.ts`) after 350 ms,
  ordered through the vault mutation queue, flushed on the same page events (`state/debounced-saver.ts`), when the
  field loses focus, when another visit is picked, when a visit is closed and when the card is left. With no open
  visit a typed note becomes one after 2.5 s (or at once on «Создать осмотр», hide, leave, reload recovery). Closed
  visits show their note under the row.
- **Write-ahead copy, encrypted.** Each keystroke also seals the text with the vault key (`sealPatientVaultText`, the
  vault's AES-GCM scheme and AAD; plain only in a deliberately plain vault) into
  `localStorage["minimed.patient-visit-note-ahead.v1"]` (opaque patient/visit ids + ciphertext). It is removed when
  the newest text is in the vault; a copy left by a reload inside the debounce, or by a vault locked at that moment
  (`pagehide` locks the vault synchronously), is applied by `recoverVisitNotes()` when `PatientWorkspace` reads or
  unlocks the vault. Copies a live autosave of the page still owns are skipped (they are newer); unreadable ones (vault replaced) are dropped with a console warning that carries no text.
- **One open visit.** `recordVisitNote` (patient-domain) is the only writer of the note: it picks the open visit,
  creates one only when none is open, and runs inside the vault mutation, so a double tap (or the autosave racing the
  button) cannot make a second open visit. «Создать осмотр» is shown only while no visit is open; ✓ only when several
  open visits exist (older data).
- **Rows.** `.patient-workspace__episode*` had no CSS: the status text ran into the ✓/✕ icons. Row = head (title that
  wraps, status label, icon buttons that keep their size) + the note preview.
- **Not covered.** Diagnosis, code and the form-data panel — done in NOTE2 below; the manual measurement form is
  unchanged (listed there).
- **Tests.** Unit: `debounced-saver.test.ts` (debounce, ordering, no overlap, failure retry, lifecycle flush),
  `patient-domain.test.ts` (visit note rules), `patient-vault.test.ts` «visit note autosave» (sealed copy, recovery
  after a simulated reload, plain vault, one open visit, seal/open). E2E `note-persistence.spec.ts`: plain note and
  visit note reloaded 0.5/2/5/12 s after typing and at once, visit note kept after create and after a closed visit,
  double «Создать осмотр», row layout at 375 px.

## Back returns where the user came from — 2026-10-14 (STATE NAV1)

Owner principle (QA pass `docs/research/qa-haiku-2026-10-14.md` «Navigation»): a tool opened from search returns to the
search results — same query, same scroll — not to the tools catalogue; the in-app ‹, the browser back and Android's
hardware back agree, and each peels exactly one layer. One model, in `state/app-back.ts`:

- **Back is a history step.** ‹ is `navigateBack(parent)`: with an app entry below (`hasInAppPreviousEntry()`) the history
  steps back (`stepHistoryBackOnce()`, so a double tap cannot take the page two levels up); with none (a deep link in a
  fresh tab, a reload of an old entry) the screen is *replaced* by its logical parent — a back control never pushes. All
  ‹ controls of the app (calculators, assessments, news, settings, notes, knowledge base, conditions, forms, ATC list …)
  and `returnFromTool` / `restoreReturnTo` / `leaveTool` use it. The reader's ‹ was already right and is unchanged.
- **Android back** (`use-native-back.ts`, `native-back.ts`): open dialogs first (their close button), then any history layer
  (`popTopHistoryLayer`), then the DOM-owned modes (find bar, search drawer, section ‹, print), then `backOneLayer`:
  history step → parent screen → home tab (`#/search`) → minimise, only from the home tab. Native validation needs a
  device and was **not run**; the web history model is what the native handler calls.
- **Layers** (`state/history-layer.ts`, `use-history-layer.ts`): `OverlayDialog`, `SheetPopover` (the «?» help and the
  «Раздел поиска» menu, sheet and wide popover alike), the inline link preview and every other sheet push one stamped entry
  at the same address; back, Android back and a swipe close exactly that layer; Escape and a tap outside close the
  component, whose cleanup takes the entry off (deferred one task, so *close, then navigate* never races its own step back).
  A navigation made from a layer (a level link in the ATC sheet, a section chosen in a menu) closes it and leaves a *dead*
  entry; the history steps over dead entries in the direction it was going, so one back from the destination lands on the
  page under the layer (no phantom step). A reload on a layer entry turns it into a page. The ATC sheet no longer closes
  and then navigates with a timer.
- **Entry classification** (`state/history-entries.ts`): `history.length` cannot tell a push that cut off forward entries
  from a replaced state, so a link taken after a back step was stamped as "no app entry below" (‹ then replaced instead of
  stepping back). The tracker now reads the Navigation API (`navigate` events: push / replace / traverse) where it exists
  (Chromium, Android WebView) and keeps the length heuristic elsewhere. The tracker also keeps the address of every entry of
  the branch (`stepsBackToPlace`) and notifies arrival listeners.
- **Tabs share the one history.** A tab tap goes to the place the tab was left at (hash and query): if the branch already
  holds that place the history steps back to it (`visitRoute`), otherwise it pushes; re-tapping the active tab steps back to
  its first screen or replaces. So a round trip A → B → A adds no entries, back from a tab's first screen returns to the tab
  used before, and the app is left only from the entry the session began on (Android: minimise only from the home tab). The
  tab bar no longer replaces the entry (which left the previous tab's layers in the history and reset the depth stamp).
  Rejected: per-tab stacks inside the one browser history (a tab's layers would leak into the next tab's back).
- **Scroll** (`state/scroll-restore.ts`): `history.scrollRestoration = 'manual'`; the position is remembered per entry (and
  in session storage for a reload) and restored when the history arrives on the entry, re-applied every frame until the page
  height has been still for 10 frames, the user touches the page, or 2.5 s pass (late-loading results). Readers keep their
  own section + offset position.
- **Reader contents jumps are history steps** (`features/library/reader-jump-history.ts`, `OfficialDocumentReader`): a jump
  from the contents / page bubble saves the place on the current entry, pushes a step at the same address and, on back or
  forward, restores the saved place in the same document. A jump writes its landing place at once.
- **Interaction checker and comparison keep their drugs in the address** (`#/notes/drug-interactions?c=…`,
  `state/tool-url-state.ts`), so back from a drug screen, a tab round trip and a reload bring them back. Drug names in the
  checker's list and the comparison's column titles open the drug screen.
- **Second tab.** A tab waiting for the database now has «Использовать здесь» (`state/tab-takeover.ts`): the owner receives
  a BroadcastChannel request, marks itself *standby* in session storage and reloads — the reload ends every worker, so every
  OPFS pool lock is released before the asking tab opens the pool (AGENTS.md single-owner rule) — and the standby page opens
  nothing and offers the same button back. A tab that is itself waiting never yields.
- **Console warning** «Blocked aria-hidden … descendant retained focus»: left root panes are `inert` (not `aria-hidden`).
- **Unchanged on purpose:** the drug screen and reader first-screen layouts (DRUG-UI1 / DOC-UI1).

Tests: unit `state/{app-back,history-layer,history-places,tab-takeover}.test.ts`,
`features/library/reader-jump-history.test.ts`, `app/native-back.test.ts` (a stand-in session history,
`state/history-test-double.ts`); e2e `navigation-back`, `navigation-reader`, `navigation-drugs`, `navigation-takeover`
(addresses, screens and `history.length` at every step).
## Typed text is never lost, part 2 — 2026-10-15 (STATE NOTE2)

NOTE1's remaining gaps: «Диагноз осмотра» / «Код МКБ-10» and «Данные для справок и форм» needed an explicit
save, so typed text was lost on reload. They are now autosaved drafts on the same machinery, which was generalised.

- **Machinery (`state/draft-write-ahead.ts`).** `createDraftWriteAheadStore({storageKey, sealType, label})` is the
  sealed localStorage copy (key = patient id + record id, vault key, plain only in a plain vault) with `write`, `read`,
  `remove`, ownership of copies a live autosave holds, and `recover(apply)` (applies earlier-session copies inside one
  vault mutation; a copy the handler `keep`s stays, one it throws on stays with a warning, unreadable ones are
  dropped). `createDraftAutosave({store, patientId, target, serialize, save})` = write-ahead at every change +
  `debounced-saver` (ordered, flushed on pagehide/beforeunload/freeze/hidden/online); the record a change belongs to is
  fixed **when it is typed** (a flush after switching visits cannot save into the wrong one). `save` returns
  `{complete}`: when false the copy is **kept** (and still written even if the save wins the race with sealing).
  `createCopyDraft` is a draft whose only home is the copy (creation forms). `patient-visit-note.ts` is now a thin
  user of this (visit-note copies: field `targetId`, was `episodeId`; DEV format).
- **Validation never blocks a draft.** `applyFormDraft` / `applyDiagnosisDraft` (`features/notes/patient-form-data.ts`)
  save the valid part and leave a group with an error at its **last stored value**: SNILS and the OMS policy are
  separate groups (the rest of the form still saves); wording + ICD-10 code are one unit (never a new wording with an
  old code). The typed text stays in the copy, the editor reads it back after a reload (`readFormDraft`,
  `readDiagnosisDraft`) and shows the inline error (error shown after the debounce, cleared as soon as the field is
  edited) and a quiet status line «Сохраняем… / Сохранено / Черновик: исправьте отмеченное» (`draft-status.ts`; the
  form panel also gets a «Черновик» badge on its header). A draft equal to the stored value writes nothing and keeps
  `updatedAt`. Recovery on vault open (`recoverPatientDrafts`, called by `PatientWorkspace` before the vault is read)
  applies notes, form data and diagnoses; invalid ones remain as drafts (idempotent).
- **«Сохранить» decisions.** Form data: removed — it is the patient's own record, nothing to approve. Diagnosis: removed
  — the visit's «Закрыть» is the sign-off. «Создать карточку» / «Создать осмотр» stay (they create a record).
- **New-patient form** (`NewPatientForm`) keeps name, number, birth date, sex, mass, height as a copy draft until
  «Создать карточку» (or «Отмена» discards it); the photo is not kept. `PatientDetail` is keyed by patient id, so
  another patient is a new card with its own savers (the NOTE1 note saver used to keep the first patient's id).
- **Note toolbar.** The fullscreen formatting toolbar of `NoteMarkdownEditor` scrolls with `ScrollStripArrows` (VIS1's
  request), no scrollbar.
- **Audit of other personal editors** (loses typed text on reload?):
  - plain note, visit note, diagnosis, ICD code, form data, new patient: fixed (NOTE1/NOTE2).
  - **Forms (`features/forms/FormFillPage`) and prescription (`prescription-controller`)** (fixed in DRAFT1 below): autosave to the vault
    after 700 ms but flush only when the screen unmounts, not on pagehide/hidden, and have no write-ahead copy, so a
    reload inside the debounce loses the last edits (anonymous prescription draft: same). Not fixed here (VIS2's
    paths; Request in STATE.md): `registerNoteEditorFlush(flush)` in both would close the unload case; a write-ahead
    copy needs a blob `recover` variant of the store.
  - **Calculators / assessments**: inputs and mid-way answers live in memory only (by design: transient); «Записать» /
    «Сохранить в карточку пациента» are single explicit actions. The assessment result note
    (`AssessmentResultPage`, «Сохранить в карточку пациента») is typed text with an explicit save: loses on reload.
    Fixed in DRAFT1 below.
  - **Manual measurement form** («Быстрая запись» → «Записать») and **observation correction**: one number and one tap,
    transient; not changed.
  - **Listed, not touched (other owners / larger editors)**: `NoteTranscriptPanel` («Сохранить правки»),
    `NoteDrawingEditor` («Сохранить схему»), `UserDocumentReader` («Сохранить черновик» is an explicit draft save),
    `SpreadsheetRenderer`, `PatientDiaryPanel` («Сохранить в карту»), `VisitRecorderPanel`
    («Сохранить в осмотр»), reminder text and completion note in `NotesView`, tag input of a record form. Each has an
    explicit save over typed text and no write-ahead copy.
- **Tests.** Unit: `draft-write-ahead.test.ts` (generic store/autosave/recovery/copy draft with a vault double),
  `patient-form-data.test.ts` (partial patch, apply, no-op, serialisation), `patient-vault.test.ts` «form data and
  diagnosis drafts» (real vault: sealed copy, invalid SNILS/code kept and fixed, recovery after a simulated reload,
  idempotent second open). E2E `note-drafts.spec.ts`: diagnosis + code, malformed code kept with its error, form data
  with invalid SNILS kept, new-patient form — each reloaded 0.5/2/5 s after typing; cancel discards; diagnoses of two
  visits; toolbar arrows at 375 px; a save that lands must not reset the field (an effect `on(() => props.episode.id)`
  re-ran for every new copy of the same visit and reset the text to the stored value; the id is now a `createMemo`).
  `official-forms.spec.ts` seeds through the autosaved panels (waits for «Сохранено» instead of the removed buttons).
  Known unrelated failures on the merged build: the notes FAB under the bottom nav at 375–390 px (`openPatientVault`,
  STATE request by VIS2) and, in the 070/у test, «К карточке пациента» from the forms list not leaving it (line 245).

## Typed text is never lost, part 3 — 2026-10-15 (STATE DRAFT1)

The gaps NOTE2 listed (forms, «Назначение», the assessment result note) are closed; no typed text waits only in a
debounce any more.

- **Official forms (`FormFillPage`).** The 700 ms vault write now runs through `createDraftAutosave` on a new store
  `formDraftCopies` (`form-draft-store.ts`, key `minimed.form-draft-ahead.v1`, owner = patient or empty + `form/episode`).
  Every change is sealed with the vault key at once; the vault write is flushed on pagehide / hidden / freeze. A copy
  newer than the vault file is restored by `loadFormDraft` (it is stored into the vault and the copy goes; an older or
  unreadable copy is dropped). A closed vault keeps the draft in memory only and its copy stays.
- **«Назначение» (`prescription-controller`).** A patient's draft: same machinery (`prescriptionDraftCopies`, key
  `minimed.prescription-draft-ahead.v1`, restored by `loadPrescriptionDraft`). A draft without a patient is written to
  browser storage on every change (`rememberPrescriptionDraft`). Age / weight / height are handed to
  `controller.rememberPatient` at every keystroke (the 300 ms input debounce still delays only the recalculation). Two
  older defects fixed on the way: a draft with only a typed age/weight counted as «empty» and was never stored
  (`isUntouchedDraft`), and after a reload a patient's draft was never read because the screen hydrated before the vault
  opened (now re-hydrated when the vault opens; locking drops patients' drafts from memory).
- **Assessment result note.** The only typed text there is the name of a new card under «Сохранить в карточку
  пациента». It goes to browser storage at once (`assessment-note-draft.ts`, per result, newest 20), because the card it
  ends in lives in the same plain storage and no vault is involved; the panel reopens with the name after a reload;
  «Сохранить» and «Отмена» remove it.
- **Copies of deleted patients** are pruned by metadata only (`store.prune`), when the form / prescription screen has the
  vault snapshot.
- **User calculator editor.** Saves are synchronous browser storage after 350 ms; `onPageLeave` (`state/page-leave-flush.ts`)
  flushes them on pagehide / beforeunload / freeze / hidden.
- **Checked, nothing to add.** Plain note, visit note, diagnosis, ICD code, form-data panel, new-patient form (NOTE1/2).
  User questionnaire editor: saves on every change (no debounce), only the async write itself is open. Calculator and
  questionnaire inputs, answers of a patient-bound questionnaire and the manual measurement form are transient by design
  (a tap or one number, an explicit «Записать»). Still explicit-save editors, unchanged: `NoteTranscriptPanel`,
  `NoteDrawingEditor`, `UserDocumentReader`, `PatientDiaryPanel`, `VisitRecorderPanel`, reminder text and completion note,
  tag input.
- **Tests.** Unit: `draft-write-ahead.test.ts` (patient from a function, `prune`), `form-draft-store.test.ts` and
  `prescription-draft-store.test.ts` (restore newer copy / keep newer vault draft / unreadable copy dropped without text
  / closed vault / prune / lock), `assessment-note-draft.test.ts`, `page-leave-flush.test.ts`. E2E
  `form-prescription-drafts.spec.ts`: form, patient prescription, prescription without a patient and calculator editor
  reloaded 0 and 300 ms after typing; the assessment card name reloaded at once and saved. Known unrelated failure:
  `note-drafts.spec.ts` «the fullscreen note toolbar scrolls with arrows» (the outline backdrop intercepts the click).

## Regulatory acts as full texts — 2026-10-14 (STATE LEGAL1)

Owner 2026-10-14: «legal acts are just copies of documents — release them». The 30 cards of
`minimed.regulatory.pediatrics.ru` are now the **full texts of the acts** (module 2026.10.14, bundled `regulatory.db`,
file `minimed.regulatory.pediatrics.2026.10.14.db.gz`; 2026.10.13 stays as the paraphrase release). Pipeline, limits and
numbers: [REGULATORY_PACK.md](REGULATORY_PACK.md) «Full texts»; tests: [DATA_TESTS.md](DATA_TESTS.md).

- **What is in a card.** Headings, numbered items, tables as reader tables (cells, header row), annexes, each paragraph
  with the PDF page it came from (`localmed:source` span); the old summary stays as the short description; the section
  «Источник и редакция» is last. Number, date and title come from the portal record only. Amending orders are named in
  the edition line, not merged into the text.
- **How the text was made (`tools/ingest`, `medbase-legal-texts`).** Official PDFs with SHA-256 (outside the repository,
  by absolute path); Marker 2.0.0 one page at a time, detached and resumable (about 13 h in all); macOS Vision as the
  second reading; the reconciliation (`legal_reconcile.py`) requires numbers, dates, codes and order numbers to agree and
  flags silent Marker failures (dropped rows and spans, loops, a dropped last line); ruled tables are read cell by cell
  (`legal_cells.py`). 624 of 1 581 scanned pages were flagged; each was read against its page image (599 verdicts, 656
  recorded corrections in `content/regulatory-rf-texts/*.review.json`, provenance per page in `*.provenance.json`).
  `assemble --strict` refuses an unreviewed flagged page.
- **374н** (469 pages, two 9-column appendices of criteria, ICD-10/ICF codes, TNM stages, CRG): 187 flagged pages, 363
  corrections; a table above 24 000 characters (the two appendices, 436н) is cut into pieces of about 6 000 characters,
  each with the header row repeated and the pages of its own rows, so that search and the reader get chunks, not one
  366 kB cell. Printed typos of the originals stay as printed.
- **Module.** 31 documents, 861 sections, 1 818 chunks, 4.8 MB gzip / 27.8 MB decoded; the bundled `regulatory.db` grew
  from 1.5 MB to 27.8 MB (superseded by REG2 above: the bundle is now 323-ФЗ plus cards, the texts are the module). `regulatory:verify`: 25 acts confirmed on the portal, 5 not checkable there (as before).
- **Search.** «приказ <номер>» still finds each act first; the four 374н section queries were retargeted to the real
  sections (`regulatory-rf-major-queries.json`), `benchmark:regulatory` passes.
- **Feeding (Капитан, chapter on feeding).** Cross-checked against the book pages: three omitted paragraphs added,
  `minimed.reference.feeding.ru` 2026.10.14 (earlier commit).
- **Not done / honest limits.** The review was an agent reading images, not a lawyer or a clinician; no amending order
  was merged into any text; a speck of a scan can survive in an empty cell; the 5 acts not on the portal were converted
  from their own sources (IPS, rg.ru, minzdrav.gov.ru, docx) and only checked by the pack tests.

## Dose semantics, prescription tool and the dose card in search — 2026-10-14 (STATE RX1, RX2, RX3, RX4, RX5)

Owner 2026-10-13: «semantics on drugs … select a drug, patient age/weight/state, a duration, a form → a printable prescription,
more drugs, a recipe in a modal». Decision: [ADR-0025](adr/0025-dose-rule-index-and-prescription-draft.md); numbers, audit and
limits: [research/dose-rules-2026-10-14.md](research/dose-rules-2026-10-14.md).

- **Dose-rule index** (`scripts/build-dose-rules.ts`, `bun run content:dose-rules`; asset `features/prescription/data/dose-rules-index.json`,
  3.2 MB / 738 kB gzip, lazy; offsets + section checksums + the gate shape `gc`, no instruction text): deterministic pattern parser over
  «Способ применения и дозы» of 9 216 official instructions. **ЖНВЛП: 668 of 905 cards have ≥ 1 parsed dose rule** (770 have an
  instruction in the modules), 654 an adult and 299 a child rule, 249 a cap, 387 a course length; 22 344 dose, 4 009 cap, 5 932 course
  rules. **Only the rules the confidence gate passes produce numbers** (RX2 below): 275 cards. Population (age bounds with the
  upper bound exclusive, weight, group words), per-kg / per-m² doses, frequency, route, form words; renal / hepatic / dialysis rules and
  sentences without a population are quoted only. Unparsed sentences are not rules (the section is shown).
- **«Назначение»** (route `#/notes/prescription`, tool `minimed.app.prescription`, also in the search tools): compact patient row (age,
  weight, pregnancy, lactation; from the patient card), the app's drug search, form and strength from the registry, the dose sentences that
  fit the patient and pass the confidence gate (the chosen one quoted with «Открыть в инструкции», every other sentence in one «Ещё N
  фрагментов из инструкции» disclosure grouped by section), computed single dose / frequency / daily dose / units per intake (a half tablet
  only when the instruction allows division), course chips 3/5/7/10/14 + custom, quantity and packages, neutral cap comparison,
  SAFE1 quotes for the patient state, several drugs with the INT1 check, editable Rp / signa (Latin when Allmed has the name), a blank
  107-1/у (148-1/у-88 by choice) as a live thumbnail, the «Рецепт» modal (copy / share / print), autosaved drafts, «Сохранить» writes
  start events to the patient. No rule for the patient: the instruction «не указывает» and the section is quoted. An uninstalled
  instruction is offered in place with its size.
- **Search card** («амоксициллин ребенок 20 кг», «парацетамол 15 кг», …) above the results of «Все источники» and «Препараты»;
  deterministic `parseDoseQuery`; additive: no search or ranking code changed. **Benchmark** `bun run benchmark:dose` (needs
  `DOSE_DECODED_DIR`): 134 cases; after RX2 **exact 83, missing 51 (no number, the sentence is quoted), wrong 0** (before the gate:
  exact 134, but 38 % of random rules were wrong, see below). `benchmark:all` within tolerance.
  `benchmark:real:release` cannot run in a worktree (no baseline for the mounted packs); search code is unchanged.
- **Precision (RX2, replaces the RX1 estimate of 5–10 %).** A blind random sample of 200 ЖНВЛП rules, each judged by hand against its
  sentence (`tools/benchmarks/dose-rule-precision.json`, `bun run benchmark:dose-precision`): the RX1 parser was **wrong in some field in
  77/200 = 38.5 % (95 % CI 31.7–45.6 %)**, in a dose-relevant field in 70/200 = 35.0 % (28.4–42.0 %). The confidence gate
  (`features/prescription/dose-gate.ts`) lets only sentence shapes that measured 0 wrong on a separate development sample produce numbers:
  of the 200, 36 still compute and **0 of 36 are wrong (CI 0–9.7 %)**; 82 % of the rules are now quoted without numbers. **Coverage: 275 of
  905 ЖНВЛП cards (30.4 %; 35.7 % of the 770 with an instruction) still get a computed dose** (245 adult, 68 child, 101 with a cap, 45
  with a course length). The gate is tuned on its development sample; on unseen rules of seen documents its first measurement (68 rules)
  still found 4 dose-relevant defects (5.9 %), fixed at their cause afterwards but not re-measured out of sample. Not a clinical review;
  see the research note §2 for the protocol and the caveats.
- **Independent audit (RX3, 2026-10-14).** 120 gate-passing rules from 739 instructions that no sample or benchmark case had touched
  (`tools/benchmarks/dose-rule-audit-2026-10-14.json`, `draw-dose-audit.ts`, seed `rx3-audit-2026-10-14`), judged by an auditor who had not
  read the earlier judgements and run through the screen's own analysis: **wrong 4/120 = 3.3 % (95 % CI 0.9–8.3 %)**, dose rules 2/86 = 2.3 %,
  caps 2/20 = 10 %, course lengths 0/14, incomplete 4 more. Causes: a population qualifier on the line after the sentence (weight ≥41 kg),
  a population read from «ребенок» while the heading above bounds age and weight plus a co-medication condition (cap), a cap range kept at
  its upper end, «суточные дозы» read as per-day for «N таблетки M раз в сутки». Also: 21 % of the sentences are one indication of several;
  the signa prints «Внутрь» for rectal / vaginal / sublingual forms and «1 шт.» for a spoon, rounding to a registry strength has no ceiling
  (+100 … +300 %), and `analyzeItem` passes every cap, rejected shapes included, to `checkCaps` (167 of 881 documents with a computing dose
  rule). Recommendation: do not ship computed doses as they are; fix the causes and re-audit on a new sample (research note §2) — the
  causes are fixed by RX4 below, the new sample has not been drawn.
- **Fixes after the audit and a release switch (RX4, 2026-10-14).** All nine RX3 findings fixed at their cause (ADR-0025 decisions 8–9, research
  note §2 «Fixes after the audit»): a weight / age on the line after the sentence is joined to it (or the sentence is rejected), a group-only
  clause is read within the bounds of its heading, co-medication conditions («если … не принимает вальпроат») reject, a range cap keeps both ends and is
  rejected, a day's total of pieces smaller than the intakes is rejected, **only gate-passing caps are compared**, the route of the sign comes from
  the dosage form and a spoon / ampoule / vial is named as the instruction names it, **rounding to a registry strength moves a dose by ≤ 10 %**
  (else the dose stays a mass, no count, no quantity), the **counts an instruction prints are tied to the registry rows of its own registrations**
  (index field `ps`; another strength: a mass rule is recomputed, otherwise no count), and a sentence **bound to an indication** («при амебиазе»,
  «Для лечения», one of several regimens: 460 of 1 425 computing dose rules) shows the indication beside the number while the general sentence
  comes first. Results on the current (OCR1-republished) modules, rules the gate lets compute / wrong in some field: blind 33 / 0, development 178 / 0,
  fresh 144 / 0 (all unchanged by the fixes), audit **115 / 4 → 111 / 0** (not independent any more: the four causes are fixed, not a new
  measurement; on the modules of the audit itself 120 / 4 → 116 / 0), `benchmark:dose` exact 82 / missing 52 / wrong 0 (six first answers re-read and
  accepted, three of them only while the screen marks them as one regimen of several). Coverage: 280 of 905 ЖНВЛП cards (30.9 %) unchanged (adult 251, child 68,
  cap 99, course 46), computing rules 1 434 / 331 / 292 → 1 425 / 328 / 292 (dose / cap / course); 218 of those cards keep a general (not indication-bound) dose
  sentence. On the 184 screens of the audit's computing rules 19 show no count (another strength than the instruction's) and 18 show the dose without a count
  (rounding beyond 10 %). **Release switch:** `features/prescription/data/prescription-settings.json` `{"computedDoses": true}` (default ON) turns every
  computed number off at once — sentences stay quoted, the registry choices, the blank, the Rp / signa text and the «Рецепт» modal stay; a release ships
  with `false` if the next audit fails. The fresh audit was run afterwards (RX5, next bullet) and failed.
- **Independent audit 2 (RX5, 2026-10-14, after RX4).** 170 gate-passing rules from the 634 instruction documents no earlier set or benchmark card touched
  (797 excluded; all 16 modules; `tools/benchmarks/dose-rule-audit-2-2026-10-14.json`, `src/draw-dose-audit-2.ts`, seed `rx5-audit2-2026-10-14`), judged field by
  field and through the screen's own analysis for a realistic patient on up to 3 registry forms × 3 strengths: **rule wrong in a dose-relevant field 7/170 = 4.1 %
  (95 % CI 1.7–8.3 %); screen output wrong 13/170 = 7.6 % (4.1–12.7 %; 7 numbers or cap checks, 6 route / product words); rule or screen wrong 15/170 = 8.8 %
  (5.0–14.1 %)**; 12 more incomplete. Ten new causes, none a repeat of RX3: a piece strength before the count read as the dose («Капсулы по 250 мг: по 2 капсулы»),
  a course size read as the dose («курс лечения 10 суппозиториев», a child), a cap sentence's rate dropped («1 каплю … 2 раза в сутки», flagged EXCEEDED on the
  instruction's own regimen), «каждые 6 часов» = 4 a day above the next sentence's 3-sachet maximum, a concentration qualifier («0,05 % раствор») not carried so
  a 0,1 % product gets the count, weight / renal limits in dash lines after the sentence, «школьного возраста» read as < 18 y, `routeOfForm` taking the first route
  of a multi-route form name and `formClassOf` tying an injectable instruction to an inhalation product and an oral one to vaginal tablets, a multi-strength
  piece count, a float-rounding false «exceeded». 42 % of the 48 indication-bound sentences carry no mark. Details and file / function per cause: research note
  §2 «Independent audit 2». **Recommendation: (b) ship the release with `computedDoses: false`**; the defects are not in separable shapes (seven mechanisms,
  every stratum but course lengths). The setting is **not** changed by RX5 (audit only).
- **Result page (RX2).** At 375 px one drug is about 1 000–1 200 px tall (was ~4 100): the chosen sentence with its quote, the intake
  and course, the cap line, one «Ещё N фрагментов» disclosure (other rules to pick, quoted-only sentences, conditions, ceilings, by
  section), one «Цитаты из инструкции» disclosure for the patient-state quotes with a few calculated lines in view.
- **Next (dose):** fix the ten RX5 causes at their cause (set `computedDoses: false` for the release until then), then a third audit of ≥ 150 gate-passing
  rules from documents no set has touched (464 documents of the audit-2 frame are left; a later module publication refills it) — numbers ship only if it
  finds none wrong; then judge more rules per gate family and keep growing coverage family by family
  (age-or-weight children's sentences such as amoxicillin's, headings with an age range such as «от 6 до 12 лет», a heading line that is
  a plain noun phrase as the indication); a fresh out-of-sample sample after each parser change.
- **Not tested:** Android / native, physical devices, a real printer, a clinician's review, any other instruction group than the
  anti-infectives (e2e) and antiparasitics; instruction modules downloaded by the end user (the e2e serves the local release copies).

## Web offline shell and stale-bundle recovery — 2026-10-14 (STATE SW1)

QA of the published web app (0.6.59, Chromium, 375×812) found two faults: a document installed from
a guideline module did not open after the network was cut (its lazy chunks `DocumentPageHost-*`,
`safety-document-*`, `atc-names-*` could not load, the reader spun forever, an offline reload gave
`ERR_INTERNET_DISCONNECTED`), and a browser holding an older `main-*.js` got a 404 for
`CalculatorsView-<oldhash>.js` with no way back.

- **Root cause 1.** A worker existed (`public/sw.js`, registered from `state/app-update.ts`) but its
  `install` called `cache.addAll` on a fixed list that included `content/medications.db`, which
  Pages does not ship (404): one rejected URL fails the whole install, so no worker was ever active.
  The list also named `core.db` (440 MB), which would have doubled the core in Cache Storage.
- **Root cause 2.** Pages replaces the whole site on every deploy and every chunk name carries a
  content hash, so an old page asks for names that no longer exist. Nothing handled the failure, and
  Solid's `lazy` without an `ErrorBoundary` leaves the Suspense spinner on screen forever.

**Design.**

- `public/sw.js` is hand-written (no Workbox, no new dependency). The build
  (`dev-server/service-worker-precache.ts`, a Vite plugin in `vite.config.ts`) lists the build's
  files into it and writes `build-manifest.json`. **Precached at install** (538 files, 64.7 MB raw,
  about 20 MB gzip on the wire): `index.html`, manifest and icons, every `assets/*` script, style,
  font and wasm up to 3 MB (the 10.7 MB module-catalog script is a script, so it is in), `fonts/`,
  `onboarding/`, and the three small files the app fetches on every start to open its core:
  `content/core-report.json` (names the OPFS file of the core), `content/regulatory.db` and
  `content/reference.db` (2.6 MB together, read into memory at each start; without them an offline
  reload shows «База не открылась»). **Kept after first use only** (runtime cache `minimed-runtime-v1`, ≤ 40 MB per
  file): the ONNX runtime (24 MB wasm), the Tesseract core, and the `pdfjs/`, `cornerstone-codecs/`
  and `excalidraw/` directories. **Never touched**: the rest of `content/` (the 440 MB `core.db`,
  modules, releases: OPFS and IndexedDB hold them), `tessdata/`, the patient diary (`diary/` keeps its own worker and scope; the
  app worker leaves `diary/` navigations alone), cross-origin requests, non-GET and Range requests.
- **Cache per build**: `minimed-shell-<build id>`, the id is a hash of the version, every hashed
  asset name and the digest of each non-hashed file. Install is all-or-nothing (a failed file fails
  the install and the browser retries; files cached by an earlier attempt are kept). A new install
  copies unchanged `assets/*` from the previous build's cache instead of downloading them again;
  `index.html`, manifest and icons are fetched with `cache: 'reload'` (Pages sends `max-age=600`).
  Activation deletes other `minimed-shell-*` caches, the former `localmed-shell-*` cache and runtime
  entries the new build no longer ships. A script asked for with a query string (the SQLite OPFS
  worker is started as `…proxy.js?vfs=opfs`) is answered from the entry stored without it, as a
  response without an address of its own, so the worker still sees its `?vfs=` (a cached response
  keeps the stored address and the worker failed to start offline until this was found by the e2e).
- **Navigation** to the scope root or `index.html` is answered from the cache (cache-first), so an
  offline reload works and the page, its chunks and its styles always belong to one build. The scope
  is the folder `sw.js` lives in (`/MiniMed/app/` on Pages, `/` in `vite preview`): every URL is
  resolved against `registration.scope`; the build keeps `base: './'`.
- **Cross-origin isolation.** The app does not use `crossOriginIsolated` or `SharedArrayBuffer`
  (OPFS works through the `sahpool` VFS in workers); Pages sends no COOP/COEP and the repository has
  no `coi-serviceworker` shim, so nothing was there to integrate. The headers `vite dev` / `vite
  preview` send are stored with the cached page, so an offline reload keeps them (the e2e compares
  `crossOriginIsolated` before and after).
- **Capacitor.** `registerAppServiceWorker` returns on every platform except `web`; the Android and
  iOS builds contain the same `sw.js` and `build-manifest.json` (about 45 KB) but never register it.
- **Update flow.** A new deploy is a byte-different `sw.js`. The browser installs it in the
  background (precaching its build) and it waits. The page announces it with the existing
  `minimed:app-update-ready` event: a quiet toast «Доступно обновление — Обновить» (once per worker,
  12 s), the settings dot and the «Обновление» hint above «Настройки» stay as before, and the
  Settings checker's «Обновить» does the same. Only a tap posts `SKIP_WAITING`; the new worker
  activates, claims the page and `controllerchange` reloads it. Nothing reloads by itself. A tab left
  open looks for a new build when it is shown again or the network returns (at most every 15 min,
  `watchForAppUpdates`), and «Проверить обновления» now waits (≤ 30 s) for a build that is still
  installing instead of answering «последняя версия».
- **Stale chunk recovery** (`state/chunk-recovery.ts`). `vite:preloadError` and unhandled rejections
  of a failed dynamic import (Chromium, Firefox and Safari wording) trigger **one** reload when
  online. A `sessionStorage` timestamp guards against loops (no second reload within 60 s; an
  in-memory flag when storage is blocked). Offline nothing reloads. The event is never cancelled, so
  the failing screen still throws and `app/LazyBoundary.tsx` (an `ErrorBoundary` around the root
  views and the document host) shows «Экран не загрузился» in place with «Повторить»; that button
  unregisters the app worker, deletes the shell caches (online only) and reloads from the network.
- **Previous build stays reachable.** `scripts/carry-previous-build-assets.ts` (a step of
  `landing-pages.yml`) reads `build-manifest.json` from the live site and downloads the scripts,
  styles and fonts it lists that the new build dropped into `assets/` (≤ 16 MB per file, ≤ 120 MB
  in all, best effort: a missing manifest or failed file never fails the deploy). Exactly one build
  is kept: the manifest lists a build's own files, never the ones it had carried, so the copies
  expire at the next deploy. Reason: an old tab with its worker still serves from its own cache, so
  the grace copy only covers browsers without a worker, a tab claimed by a new worker, and the
  window before first install; a longer window would grow the 1 GB site for a rare case, and the
  guarded reload covers the rest.
- **Tests.** Unit: `dev-server/service-worker.test.ts` (runs the real `sw.js` in a `vm` with a fake
  `CacheStorage`: install, resume, reuse, activation, offline answers, diary, content, size cap,
  old/new build), `service-worker-precache.test.ts`, `carry-previous-assets.test.ts`,
  `state/chunk-recovery.test.ts`, `state/app-update-web.test.ts`. e2e `offline-shell.spec.ts`
  (`E2E_PORT=4197 bunx playwright test apps/app/e2e/offline-shell.spec.ts --workers=1`): install a
  КР module, cut the network, reload, open the document; a simulated new build through a proxy that
  swaps `sw.js` shows the prompt and switches only on tap; a removed chunk reloads once; a chunk
  that stays missing and an offline lazy load show the in-place error. The Playwright config now
  blocks service workers by default (`serviceWorkers: 'block'`; `offline-shell` and `diary-install`
  opt in) and launches Chromium with `--mute-audio`.
- **Not tested**: the real Pages deploy (the base path `/MiniMed/app/`, the carry step against the
  live manifest, Pages' `max-age=600` on `sw.js`), Safari/WebKit (including iOS storage eviction of
  Cache Storage), Firefox, a real flaky mobile network during the 19 MB install.
## Green suites before 0.6.60 — 2026-10-14 (STATE TEST2)

- **Reader find counts only what is shown.** `OfficialDocumentReader` builds its find units from
  `presentReaderChunkText(...)` (the reader-word text), not from the stored `originalText`; hidden catalogue
  labels («Официальный идентификатор»), identifiers and boilerplate no longer produce matches, and a reworded
  chunk keeps exact highlights and jumps (the old fallback highlighted by the query only). Covered by
  `search.spec.ts` (outline test: a visible word marks, the hidden label gives `0/0`).
- **Search skeleton shift.** The 16 px between the tool strip and the next block came from the catalog's own
  `margin-block`, which an empty catalog leaked (a typing query moved the skeleton by 16 px) and which the
  chip list's `-1.6rem` bottom margin relied on. `.search-tool-strip` now owns the gap
  (`margin-block: 0.75rem 1rem`) and an empty `.unified-catalog` is `display: none`; skeleton and results sit at
  one position from the first frame.
- **Unit tests have no wall-clock budgets.** `KnowledgeGraph.test.ts` asserted 250 000 pairs with one `expect`
  each (1.4 s of assertion bookkeeping, the layout itself takes ~20 ms): one assertion over the collected
  violations. `document-medication-links.test.ts` checks every paragraph links the right document instead of
  timing the matcher. `personal-notes-backup.test.ts` warms the dynamic import once in `beforeAll` and settles
  fire-and-forget cleanup by macrotask turns. `vitest.config.ts` sets `testTimeout: 30 s`, `hookTimeout: 60 s` as
  hang guards only; speed is measured by `benchmark:all`. (`text-anchor.performance.test.ts` is the one
  deliberate timing test left, with 4 s budgets.)
- **e2e specs follow the app.** Calculator sources live in «Информация» (menu) and the footnote; the
  Calculators tab opens the list, so `patient-vault.spec` reopens the tool after locking; the age filter's radios
  are the only radios under a replayed search; a menu next to the right edge flips to end at its button; the
  section menu waits for the document kinds; the ICD index card no longer shows the builder's boilerplate; the
  cardiology section is checked as «N из N» offline, not a fixed 43.
- **Specs that need `data/` skip with a reason.** `e2e/local-data.ts` (`missingLocalData`) is used by
  `core-identities`, `module-lifecycle` and `terminology`; `module-install-timing` points at the release copy of
  the published ЕСКЛП edition (`output/module-zstd-esklp-str1-2026-10-15`). Specs that read release copies
  from `output/` (clinical-module fixture, Allmed, severity) skip in a worktree, which has no local data:
  never link `data/` or `output/` into a worktree (AGENTS.md; a committed link once made a pull delete every
  release copy). Run them from the main checkout, or give the spec the main checkout's absolute paths
  (`module-install-timing` and `reader-hero` already look in `<worktree>/../../..` as well). Reader
  specs that need the КР fixture: the glossary-first «Термины и определения» now sits at the top (the abbreviation
  list moved behind the chapters), so `reader-back-position` clicks a term deeper in the text.
- **Source gate.** `scripts/check-browser-integration.mjs` compares whitespace-insensitively (formatter
  re-wraps no longer fail it) and its patterns follow the current code (speech-model removal dialog, worker
  request guard, patient backup copy, diary list/entry form/theme, diary service worker); 58/58.
- **Lint.** The recorded EAEU sister-register responses (`tools/ingest/tests/fixtures/eaeu_sister`, third-party
  HTML/JSON kept as received) are excluded from Biome like the ICD-11 API fixtures.

## Fixes from the first-time-user and power-user QA passes on 0.6.59 — 2026-10-14 (STATE QA1)

Two QA reports on the published web app at 375×812 (screenshots in `/private/tmp/claude-501/minimed-qa-naive/`
and `…/minimed-qa-power/`). What changed, at the cause:

- **Form drafts.** The vault hook cleared the in-memory drafts every time a form screen mounted while the
  vault was still closed; a blank form (no patient) never wrote anywhere. Now the drafts are dropped only by
  the vault lock event (`form-session.ts`), and a blank form opens the vault silently
  (`openPatientVaultSilently`: open session, encrypted vault unlocked, missing vault created encrypted) and
  keeps its draft there like a patient form's. A plaintext vault or a browser without a key falls back to
  memory, and the state line says «Черновик · до закрытия приложения». The state line reads
  «Черновик сохранён» once something is typed; progress reads «4 из 5»; «Сбросить» has a label.
- **Saved items.** New Files folder and page «Избранное» (`features/collections/SavedItemsPage.tsx`, route
  `#/notes/saved`): favourites and collections of documents, notes and catalog tools; the Files search finds the
  folder and the saved items by title. The Files tab always opens the file list unless an open personal
  document or a library folder was left (`filesTabHash`): drafts autosave and reading positions resume, so a
  half-filled form no longer stands in for «Файлы». Searches are recorded when typing pauses and the entry is
  replaced while the same words are extended (`appendSearchHistory(…, { auto })`).
- **Downloads.** «Ядро знаний» is «основная база» everywhere the user reads it; the onboarding step names its
  size; «Скачать всё» shows the total transfer (`estimateDownloadSize`, `formatModuleBytes` knows ГБ). The tour
  and its views are addressed with «Вы»; «Соединяемся с сервером…» became «Начинаем загрузку…». The module
  catalog still has a set called «Ядро» (many e2e specs address it): not renamed.
- **Raw text.** The reader shows catalogue text in reader words (`reader-text-presentation.ts`): technical cards
  lose catalogue labels, identifiers, empty fields and English specialty slugs; ЕСКЛП lines read
  «Амоксициллин — Таблетки, 500 мг»; headings made of a registry code say form and strength; one strength format;
  raw source URLs and «Ограничение покрытия» are gone from the page; ICD cards offer «Препараты РЛС для этого
  кода» instead of «Полная версия»; instruction editions read «ЛП-009219, 2025» (`presentInstructionEdition`).
  Only the display changes: stored text, anchors and checksums are as before; in-document find is built from
  the shown text (TEST2 below), so its count and highlights match what is on the page.
- **Overlaps and waiting.** A paper fade behind the floating tab bar in readers; the toast sits under the route
  header; the tour prefetches its views. Drug, ICD-11 and sick-leave panels read through quiet resources, so an
  install no longer swaps the whole page for a spinner (≈ 5 s blank before); the module offer says
  «Устанавливаем…», instruction and severity offers show a percentage. Document links are underlined
  with a solid line, not a squiggle.
- **Result cards.** Same-titled cards carry a qualifier (publisher · registration, or edition); snippets start at
  a boundary («…» for a cut); «( Очаговая … )» loses the inner spaces; the «★ — добавить сюда» hint is gone.
- **Calculators.** A section card under a search lists the matching tools (closest first); the age filter counts
  say what is hidden («Скрыто по возрасту: 3 калькулятора»); the result's input line names only marked yes/no
  answers; the general «decision-support» warning moved into «Источники и ограничения»; the two detail buttons
  are icon buttons; the header kicker no longer repeats the toast. 245 in the release notes counts 221
  calculators and 24 questionnaires; the app's 223 + downloaded ones are calculators only (not an age filter).
- **Second report.** Interaction pairs with sentences say «Степень не указана» and one inline offer (size,
  percentage) replaces the licence card (the licence stays in the source note); one short line instead of the
  long safety disclaimer; «Привет» does not return after «Пропустить обучение»; the bar keeps «Поиск» lit for
  interaction, comparison and vaccination tools; the vaccination orders left the subtitle; the reader opens a
  recommendation on its text, the abbreviation list moves behind the chapters; «Препараты» opens on names that
  begin with a letter; «Препараты по группам АТХ» is a tool in «Все инструменты»; the episode actions are icon
  buttons (the box emptied after «Создать осмотр» then; NOTE1 keeps the note in it).
- **Data.** `reference-report.json` regenerated from the checksum-matching `reference.db`; landing
  `calculator.json`/`questionnaire.json` are copies of the authored definitions; both `.fails` markers removed
  (`docs/DATA_TESTS.md`).
- **Not done.** ОКУД/ОКПО prefill (the 107-1/у header fields are not defined by the order, the schema is
  generated from the official PDF and the prescription work is owned elsewhere); the calculator form's
  native «Пациент*» select (a label in the tool-module JSON, owned by the calculator-data agent); «Номенклатура
  услуг» and «Лечебное питание» entry points (preview modules, product decision); note on a highlight (no note
  field in the highlight data model); form 057/у statutory labels; «Масса тела | Масса тела» and «Исправить
  значение» in the patient card; the 96 MB download repeated on result cards; «Проверяем…» in Settings →
  Изображения. The «Не заполнено N обязательных полей» plural was already correct in the catalog. The five
  colour swatches already carry aria-labels («Выделить: …»).
- **Tests.** Unit: form session/state, root-view, saved items, search history, reader text presentation,
  presentation of snippets and titles, instruction edition, download size, calculator input summary,
  glossary order, document order. e2e `first-time-qa.spec.ts` (draft survives leaving and a reload; Files tab opens
  the list; favourites found in Files) on `E2E_PORT=4195`. `patient-vault.spec.ts` fails at its last step
  (the calculators tab is expected to restore the open tool, which the 2026-10-09 «opens at the list» rule
  contradicts), not by this change; `check-browser-integration.mjs` has many stale-pattern FAILs unrelated to it.

## Reader dictionary on selection — 2026-10-13 (STATE DICT1)

Owner question: «select a word to see its definition, origin and links, plus links to terms from a
medical list — does that already work "Auto"?» Answer, measured in the code before this change:

- **Automatic inline links exist only for documents, not for dictionary terms.** The reader's text
  (`components/DocumentText.tsx`, matcher `features/library/document-medication-links.ts`) links a
  phrase to a catalog document when the phrase is that document's short title, the part of its title
  before «—» (КР prefix and trailing parentheses removed), or an editorial `navigationAliases` entry
  (min. 3 letters, drug names ≥ 4; only linkable source types: drug registry, КР, regulatory,
  reference, МКБ, pointers). Matching is case/ё-insensitive on whole words, longest phrase first, so
  multi-word titles link; inflected forms («пневмонии») do **not** link. It is an allow-list of
  catalog titles, not a stop-list; the reader does not link a document's own family. The preview
  shows the document's `canonicalDefinition` (when its metadata has one) with a source link, or the
  drug card summary (substance, trade names, group, ATC, one quoted effect line) with «Открыть»;
  several documents behind one phrase offer a chooser. Nothing links to the definitions dictionary
  (38 572 entries) and no preview shows etymology, a «Файлы на тему» list or any drill-down.
- **Selecting text offered only highlighting** (five colours, «Убрать выделение») in КР and user
  documents and EPUB; official non-КР documents and the PDF text layer had no selection menu.
- **Etymology data**: the dictionary reader serves `annotations` of kind `etymology` (verbatim
  source statements); how many entries of the 2026.10.08 edition carry one was not measured, and the
  sourced origin dictionary is still R5 of `DEFINITION_REFERENCE_PLAN.md`. The orphaned `DefinitionReferenceAnnotations` component
  is not mounted anywhere.

Added: **«Найти в словаре»** in every reader's selection menu (КР/user text via the highlight popup,
EPUB, official non-КР documents and the PDF text layer through `ReaderSelectionLookup`; one action,
icon + label, hidden for a selection that is not a word or a phrase of ≤ 6 words / 80 characters).
It opens a sheet (`features/reader-dictionary/`, mounted once in `App.tsx`, code lazy):

- `selection-term.ts`: the selection is cleaned (whitespace, line-end hyphenation, edge punctuation)
  and asked as ≤ 8 ordinary `core.search` lookups — as selected, then its nominative candidates
  (`nominativeForms`: case-ending rules, ё folded; the whole phrase in nominative; shorter parts of a
  phrase, so «лечение пневмонии» reaches «пневмония»). The first answer that names a dictionary entry
  **with a definition** wins; a bare name or document title found earlier stands only if nothing
  better turns up. Matching, name variants and the spelling correction (`correctWord`, TYPO1) stay
  in the core, so «оменция» finds «Аменция» there; the sheet shows «Показано по: …» when the core
  corrected the query.
- With a definition: the same card search shows (`CoreIdentityMatches`: definition in the source's own
  words, source link, other senses, «Подробнее») plus a «Происхождение» block only when the
  installed edition holds an etymology annotation for the entry (none is invented).
- Without one: «В словаре нет определения», the documents found for the selection (up to five, each
  opens at its anchor) and **«Искать везде»**, which opens search on «Все источники» with the text
  (`requestSearchEverywhere`, a `SearchHome` listener).
- Tests: `selection-term.test.ts` (17: inflected forms, multi-word, phrase part, no match, bare name vs
  headword, correction, failure), `e2e/reader-dictionary.spec.ts` (КР reader at 375 px: no entry +
  «Искать везде»; inflected «бронхитом» → «Бронхит» card, light and dark; misspelt «оменция» →
  «Аменция»; a long selection offers no lookup; the PDF text layer), run on `E2E_PORT=4193`.
- **Not done / not tested**: the Android WebView selection menu (the system menu and the popup were
  checked only in Chromium with touch emulation of the existing popup placement); the lookup of text
  selected in spreadsheets and in the notes editor; automatic term links from the dictionary and
  «Файлы на тему» (B1 idea queue) remain open; nominative candidates are heuristic endings, not a
  morphological dictionary, so irregular forms fall back to the core's own matching.
## Highlights across editions — 2026-10-13 (STATE R1, sub-item «highlights survive edition updates»)

Owner request 2026-10-13: a selection made in one edition of a document follows its text into a newer
edition, even at another position and with different punctuation. Pure engine in
`apps/app/src/features/anchoring/`, persistence in `state/user-library-highlights.ts`.

**What existed (mapped before the change).**
- Highlights were the only text-anchored user data. Stored in IndexedDB `minimed-user-highlights-v1`
  (store `highlights`, index `documentId`): `{id, documentId, pageAnchor, start, end, quote (≤ 400
  chars), color, createdAt, cfiRange?}`. `pageAnchor` is the text container: a user text page / section
  (`user-doc-anchor-<doc>-<n>`), a КР text chunk (the chunk anchor, offsets over the rendered text
  nodes), or an EPUB CFI. A selection over several containers is one record per container.
- PDFs had no highlights at all (the text layer was selectable, nothing was saved).
- A newer edition: a КР successor is another document id (`kr.rf.507_4`, chain in
  `catalog.clinical-editions.json`, `supersedesDocumentIds` in metadata), so the old highlights stayed on
  the old document and never reached the new one; a replaced user file (`replaceUserLibraryFile`), a
  module update or a changed reading rule kept the document id and the highlight was hidden when its
  quote no longer matched (КР) or painted on the wrong words (user documents, unverified).
- Bookmarks (`item-collections`) are per document, reading positions per document anchor, section links
  per anchor; none are text-quote based and none are changed here.

**Design.**
- `TextQuoteSelector` (W3C Web Annotation style): `{exact, prefix, suffix, tail?}`; 80 characters of
  context taken across neighbouring units, `exact` up to 2 000 characters plus the last 300 for longer
  selections. New highlights store it next to the position; the position stays the fast path.
- Matching (`text-anchor.ts`, `text-fold.ts`, `approximate-search.ts`, all local, no library): the
  document's units are folded (case, ё/е, quotes « » „ “ " ', dashes, nbsp and soft hyphens, every
  punctuation mark; letters, digits and `< > = ≥ ≤ ± +` kept) with a map back to the original offsets.
  1. exact / normalised: all occurrences of the folded quote, anywhere in the document; the candidate
     whose surroundings (prefix/suffix, paragraph-local part first so reordered neighbours do not
     hurt) agree and which is nearest the old place wins; identical candidates that context cannot
     separate are flagged `approximate`, not guessed.
  2. fuzzy: the quote's rarer word stems vote for windows (diagonal clustering), each window is aligned
     by edit distance (Sellers, free ends, traceback); accepted up to 30 % of the quote (15 % under 40
     characters), up to 40 % (22 %) when the surrounding text agrees (≥ 0.7). The match is widened to
     whole words. A quote longer than one alignment pass, or one that gained a sentence inside, is
     located by its two ends (head and tail at two sizes; the span must stay within 0.6–1.8× the quote,
     so a different passage that merely shares boilerplate ends is rejected).
  3. A match may span two units (a reflowed paragraph): the record keeps the first piece as its
     position and the rest in `more`.
- Status per highlight (`anchorStatus`): `exact` (same unit and offset, verbatim), `moved` (same words
  elsewhere or after typography changes), `approximate` (reworded, or ambiguous duplicate) — drawn with
  a dotted underline (`::highlight(user-doc-highlights-approximate)`) and named in the popup —
  `missing` (kept, not painted, listed as «Не найдено в новой редакции»). `anchorMethod`, `anchorScore`,
  `origin` (the first anchor, never rewritten) and `anchoredRevision` are saved with it.
- `syncHighlights` (`highlight-sync.ts`, pure) runs once the whole text is on the page (КР: all sections
  mounted; text pages loaded; PDF: text of every page read): a highlight still at its saved place is left
  alone (a record without selector context gains it from the text); a moved one is re-anchored and
  saved; a missing one keeps its position and is searched again only when the text changes (or revived
  when it fits again); highlights of earlier editions (`earlierEditionDocumentIds`: КР chain from the
  sidecar + `metadata.supersedesDocumentIds`, nearest first) are **carried over as separate records**
  (`carriedFrom`) once each — the old edition keeps its own, untouched. A copy the reader removes stays
  as a tombstone (`dismissed`) so it is not carried again. Not found in the successor → a `missing` copy
  in the new edition, so it is listed there; nothing is ever dropped.
- Migration: IndexedDB version 2 upgrades every stored record in place (`upgradeHighlight`: selector from
  the saved quote, `exact`, origin); the same function runs on load, idempotently. Context
  (prefix/suffix) is filled from the text the first time the document is opened.
- UI: reader menu «Выделения» (user text/Markdown/DOCX documents, PDFs, КР) opens a
  sheet listing the highlights, the not-found ones first with their words, jump, remove, and «open the
  earlier edition» for carried ones (`DocumentHighlightsSheet`). The popup of an existing mark names its
  origin/uncertainty.
- PDF viewer: `PdfHighlights` (opt-in via `PdfViewer highlightDocumentId`, used for «Ваши документы»)
  saves a selection on the text layer as `pdf-page-<n>` + offsets into the pdf.js page text (the units
  find searches; `pdf-selection.ts` maps the touched text-layer spans), paints it with the same CSS
  highlights, and re-anchors across a replaced file through the same engine over all pages' text. Scanned
  pages without a text layer carry none; note attachments (`PdfFileViewer`) do not offer highlights;
  no drawing.
- Not done: EPUB (CFI-anchored, unchanged), highlight copies for documents whose predecessor ids are
  unknown to the app, a diff/compare view between editions (rest of R1).

**Measured.**
- Unit tests (`anchoring/*.test.ts`, 50 cases): moved paragraph, punctuation/quotes/dashes/ё/case,
  inserted sentences before/after/inside the quote, reworded, reflowed across two units, duplicates told
  apart by context, deleted, changed number, long selections; 11 edition scenarios: every present
  quote found, both absent quotes refused. 1 400-page (3.0 M characters) document: fold + index ≈ 0.4 s,
  locate a reworded quote ≈ 60 ms, prove a quote absent ≈ 40 ms.
- Real data: the 11 КР edition pairs of the registry (`data/raw/official-clinical-documents`, older
  edition → successor; every third sentence of 40–400 characters, 3 268 highlights): verbatim in the new
  edition 1 828 → 793 exact, 988 moved, 47 flagged approximate (repeated boilerplate such as «Уровень
  убедительности рекомендаций C …»), 0 lost; same words with other typography 247 → 228 moved, 19
  approximate, 0 lost; changed text 1 193 → 655 carried as approximate (mean text similarity to the old
  wording 0.88, 15 below 0.6), 538 kept as not found; ≈ 2 ms per exact, ≈ 20 ms per fuzzy search.
- e2e (`E2E_PORT=4191 bunx playwright test apps/app/e2e/highlight-editions.spec.ts`): text highlight in
  edition A → B (moved, « » and ; changed, sentence inserted) → C (reworded) → D (deleted, listed as not
  found, kept) → B again (found); a version-1 database with a legacy record opens, is upgraded and
  painted; a PDF line highlighted, repainted after reload, then a replaced PDF with reordered pages and a
  reworded sentence re-anchored to page 3. 375 × 812 checked by screenshot (dotted mark, popup note, sheet).
- **Not tested:** a КР successor edition in the browser (needs two installed edition modules; the carry
  logic is covered by `highlight-sync.test.ts` and the real-data run above), Android WebView, a scanned
  PDF, a PDF of several hundred pages in the browser, the carried-over flow for regulatory acts.

## Allmed packaging photos published, «?» source on every photo — 2026-10-13 (STATE IMG1)

Owner 2026-10-13: «just show a "?" on the image; clicking it shows the image source».

- **Pack published:** 4 214 photos (279.0 MB, original bytes), 16 ZIP shards of 15.8–22.2 MB + a 442 KB
  index on `datasets/allmed-images-2026.10.13-c8e85a688094` (plain blobs, raw.githubusercontent.com,
  CORS and checksums verified against the local copy), catalog entry `minimed.medications.packaging-images.ru`
  (`kind: reference`, opt-in in Settings → Изображения, not in «Скачать препараты»), `minAppVersion` 0.6.60,
  `publishedAt` 2026-10-13T21:30Z. The catalog test «never requires a newer app» lists the module in
  `PENDING_RELEASE_MODULES` until release 0.6.60 (remove that allowance in the release commit). Details, rebuild and publishing commands: `docs/DRUG_KNOWLEDGE_PIPELINE.md`.
- **Why shards:** GitHub blobs are limited to 100 MB and the old single 281 MB ZIP would have been read into
  memory whole (IndexedDB clone + copy + JSZip) for every photo. The shard of a photo is the first hex digit
  of the SHA-256 of its reference; each ZIP is its own row in a new IndexedDB store (`source-assets`,
  database version 2) and the resolver keeps two open.
- **UI:** a round «?» (aria-label «Источник изображения») over the photo in the drug-screen header and in the
  Allmed supplement panel opens a popover (sheet at phone width): «Allmed», the source file address as a link,
  «Получено 13 октября 2026 г.». The credit line, the caption and the settings card's «Experimental» badge
  and raw version were removed.
- **Checks:** pytest (pack builder, published-pack integrity: every image has checksum, source URL and drug
  link; since 2026-10-14 the shard and index checksums are read from the committed `catalog.preview.json`, the
  build's `catalog-fragment.json` having been lost with `output/`), vitest (resolver, shard rule, popover view, URL mapping, catalog entry, IndexedDB shards), targeted
  e2e `packaging-image-source.spec.ts` (real Allmed module + photo pack from local copies, install through
  the UI, popover at 375×812 light/dark and wide). Not tested: a phone/Android WebView (install stages all 17
  artifacts in memory, 279 MB), the app update path from IndexedDB v1 on a device with installed modules,
  other drug photos than Немозол.

## Feeding norms from books — 2026-10-13 (STATE FEED1)

Owner request «Feeding norms should be extracted from books». The private library `Med/` was surveyed
and seven books were used; the text is published for personal use while the repository is public
(owner decision 2026-10-13; `rightsStatus: personal-library-private-use`, rights not cleared).

- **Module `minimed.reference.feeding.ru` «Нормы питания»** (2026.10.13, `minAppVersion` 0.6.59, preview):
  16 documents, 47 tables / 484 table rows, 138 cited blocks, 198 search aliases (including «прикорм»,
  «объём кормления», «сколько молока ребёнку 3 месяца»), 178 chunks, 1.8 MB index, 390 KB gzip
  (`apps/app/public/content/modules/minimed.reference.feeding.2026.10.13.db.gz`). Prepared Markdown lives in
  `content/feeding-norms/` (reference.feeding.*), built by `bun run content:module:feeding` (prepare →
  lint → build → package → catalog entry → shell).
- **Sources** (every block names book, edition and page): the national feeding programme (Союз педиатров
  России, НМИЦ здоровья детей, 2019, ISBN 978-5-6042256-5-3; the current edition in the library) printed pp.
  12–45, 49–52, 83–86, 90, 94; Почивалов и др. «Детские болезни» (Воронеж 2014) and «Клиническое
  исследование ребенка» (2021); the ВГМУ nutrition workbook (с. 40, 41, 46, 47); Шабалов «Неонатология»
  (7-е изд., т. 1, гл. 6); Т. В. Капитан «Пропедевтика детских болезней» (6-е изд., 2019, с. 458–461, a scan
  transcribed from the page images); the student summary `PITANIE.pdf` (2022, author unknown, used only where
  no textbook has the same content and labelled as a summary). Not used and why: the document «Источники,
  расхождения и проблемы» in the module.
- **Content:** pregnancy and lactation norms and food sets (tables 1.1–2.4); breastfeeding rules (regime,
  colostrum volumes 3.1, top-up indications, weight gains, expressed-milk storage 3.2, contraindications);
  formula feeding; the complementary schedule (5.1) and rules; five volume formulas of three textbooks and a
  summary (Finkelstein–Tur, Filatov–Zaitseva, rule of ten, Shabalov, volumetric, caloric, Shkarin) plus
  Kapitan's solved examples; feeding regime; infant norms (appendix 1, 7.3) and the full МР 2.3.1.2432-08
  table for children 0–18 (from the workbook, merged cells expanded, checked against the scan); milk
  composition; weight/length gains (6.1, 7.1, WHO monthly increments by z-score for boys and girls); vitamin D
  prophylaxis; preterm feeding after discharge; undernutrition, ХСН (7.4–7.8) and overweight.
- **Verification:** `medbase verify-feeding --input content/feeding-norms --library Med` compares every verbatim
  block with the PDF text layer (878 blocks checked, 0 failed; 107 table rows only cell-wise because the print
  merges cells; 9 Kapitan blocks are scan transcriptions). Tables whose cells the text layer flattens
  (Table 6.3, the МР table, Table 7.1, schedule table) were checked against page images. CI cannot run it (no
  library); `tools/ingest/tests/test_feeding_norms.py` checks the citation contract (marker, book, SHA-256,
  pages, visible «Источник» line per block), the book values of the main tables and the build.
- **Problems marked** (details in the module and `LITERATURE_REVIEW_QUEUE.md`): sources disagree (kcal/kg by
  quarter 120–125…100–105 vs 115/110; daily-volume caps 850/900/1000 vs 1000 vs «may exceed 1 L»; calorie
  split of meals 2014 vs 2021; complementary schedule tables of 2014/2021 vs the 2019 programme; vitamin D
  400 vs 1000 IU; niacin 7–12 мес 4 vs 7 mg; zinc/magnesium/iodine of Kapitan vs appendix 1); OCR defects of
  the two Voronezh textbooks; the Kapitan OCR draft has a wrong example (1/8 for 1/6); Table 3.1 first row «24»;
  Shabalov Table 6.7 units (B12 «мг»); not carried: programme chapters 9, 11–19, 21 (disease diets), brand
  tables 20.2/20.3, growth charts, Kapitan Tables 16.5–16.7 and the PITANIE sample-day table (ambiguous cell
  grouping).
- **Calculators** (pediatrics tool module 0.1.0-preview.7, 5 → 11 tools, 221 → 227 calculators in the
  catalog; schema data only, sources carry book/edition/page and link to the module documents):
  `newborn-feeding-volume` (Finkelstein–Tur, Filatov–Zaitseva, rule of ten, Shabalov, days 1–10),
  `infant-feeding-volume-methods` (volumetric, Maslov range, Programme 2019 with the 850/900/1000 ml caps,
  Kapitan, Shkarin, single feed), `child-energy-volume-over-one-year` (1000 + 100n, 1200 + 100n, meal shares of
  both textbook editions, МР norm), `fruit-puree-juice-volume` (10 × n and table 5.1), `hypogalactia-degree`
  (deficit %, degrees I–IV) and `undernutrition-energy-protein-target` (120–160 kcal/kg, 3–4.5…6 g/kg).
  Worked examples of Kapitan (Tur 4 days 3000 g = 280 ml; Shabalov 5 days 3300 g = 50 ml; volumetric 5200 g;
  Maslov 6400 g and 3800 g) and of Почивалов 2021 (2 months, 5 kg, 857 ml) are tests in
  `apps/app/src/features/calculators/feeding-tool-module.test.ts`. The existing `pediatric-feeding-plan`
  was not touched. No UI code changed; the frozen native golden exports were not regenerated.
- **Checks:** `python:check` (ruff, pyright strict, 1 478 pytest) and `typecheck` pass; `vitest run` 16 549
  passed with one failure outside this work (`KnowledgeGraph.test.ts` layout test exceeds its 5 s timeout
  here); `lint-calculator-schema.ts` 227 calculators / 24 assessments; `bun run check` has no errors (warnings
  pre-existing). **Not run / not tested:** `benchmark:all` and `native:source:check` (need `core.db`, not
  restored in the worktree), a phone, browser or device (no UI run), search ranking inside the app (aliases and
  FTS checked against the built index only), a clinician's review of the numbers; МР 2.3.1.2432-08 itself is not in
  the library (child values come from the workbook).

## Score scales and tool information — 2026-10-13 (STATE SCALE1)

Owner request: results of tools with score bands were text only. Every numeric result with bands now draws a banded
track with a marker at the value (colour by severity, band labels and cut-points, the band's interpretation under
it); equal-width segments for classes (NYHA, KDIGO, ASA), a plain gauge for risk percentages. Declared as data
(`scoreScales`, optional, so older apps ignore it), rendered on screen and in print, covered by a catalog-wide test.
179 of 251 tools have one — see [CALCULATORS.md](CALCULATORS.md) «Score scales and tool information». The calculator
result is scrolled into view after «Рассчитать» (smooth unless animations are off). Licence, attribution and source
notes moved out of the page body into an «Информация» menu item plus one small source line at the bottom of calculator
and assessment pages; assessments gained the section «Депрессия и тревога» (Zung SDS/SAS, HAM-D 17; psychology module
0.1.0-preview.6 needs app 0.6.60, the other 13 rebuilt modules stay at 0.6.59 since `scoreScales` is optional).
Not tested: Android/device, Safari, a real printer; the verdict `attentionLevel`s of about 25 tools are still all `none`.

## Computed doses off for release — 2026-10-14 (after RX5)

The second independent audit (RX5, 170 gate-passing rules from untouched instructions) found 15
wrong (8.8 %, CI 5.0–14.1 %) from ten new causes, none repeating the first audit's. Following its
recommendation, `apps/app/src/features/prescription/data/prescription-settings.json` ships
`computedDoses: false`: every dose, cap and duration sentence is quoted with «Открыть в инструкции»;
the registry choice, the 107-1/у / 148-1/у-88 blank, Rp. / D.S. (written by the doctor) and the
«Рецепт» modal stay; the search dose card quotes. The engine stays tested with the switch on
(`ENGINE_ON` in `prescription-model.test.ts`). Turning numbers back on needs a fix of the RX5 causes
and a further independent audit with no wrong dose-relevant output.

## Complaints and descriptions in «Все» — 2026-10-14 (STATE CMPL1)

Owner: complaint → recommendation search «is for you»; two QA passes (2026-10-13) found that «Все»
answered «боль в груди при вдохе» and «таблетки от головы» with МКБ codes only: «Все» runs lexical
lookup and never used the query model. Roadmap items 5 and 14 ([SEARCH_ROADMAP.md](SEARCH_ROADMAP.md)).

- Core: a lookup that names nothing, has at least two Cyrillic words and was not rewritten or
  corrected also runs the clinical hybrid search; up to three recommendations found by meaning go
  right behind the first lexical group (`SearchResponse.descriptionRecommendations`, option
  `descriptionRecommendations`, on by default). Without the model: `model-missing`, and «Все» shows
  one row «Жалобы и описания своими словами находит поиск по смыслу — Скачать · 130 МБ»
  (`SemanticModelOffer`), which re-runs the search once the model is installed.
- Measured (`run-description-recommendations.ts`, released corpus + 774 КР modules with KD1 vectors,
  the app's `ScopedMedicalCore('all')`): owner queries hit@5 0.463 → 0.833 (rush 0.677 → 0.903,
  thoughtful 0.174 → 0.739), hit@1 0.296 → 0.315; one forbidden hit («аг лечение», abbreviation);
  Latin-term controls untouched after the Cyrillic rule. Lexical gates run without a model and are
  unchanged by construction.
- Also measured and not kept: clause mixing, document evidence and more vector candidates in the
  KD1 hybrid (Q1 test complaints R@5 0.633 → 0.646 at best; «Measured and rejected»).
- Spelling (QA): «пневмания» (the trade name «Внеплания» counted as close) and «амоксицилин» (a
  missing doubled letter read as a word form) are now corrected; first-letter typo hit@1 0.845 →
  0.990.
- Not tested: a phone (the extra clinical search costs ~0.2 s in Bun, ~0.7 s per КР query measured
  on the emulator earlier), the installed-model path in the browser (unit tests and the benchmark
  cover it).

## Misspelt words in search — 2026-10-13 (STATE TYPO1)

Owner report: «Помоач» (for «Помрач») and «Оменция» (for «Аменция») found nothing, although most
typos work. Cause: lookup matches words from their start, so a late slip is forgiven and a slip in
the first letters is not. Roadmap item 19 ([SEARCH_ROADMAP.md](SEARCH_ROADMAP.md)), design in
[SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md) «Misspelt words».

- Core: after the name-variant fallback, a word that begins no name is corrected to the closest
  beginning of a title / alias / terminology / exact source name (weighted edit distance; a
  neighbouring ЙЦУКЕН or QWERTY key, a sound-alike letter, a sign or a doubled letter is half an
  edit); the corrected query replaces the response only when it names what it was corrected to, or
  the typed query found nothing. New storage method `listCoreIdentityNames` (SQLite, Capacitor, OPFS
  worker, multi-pack).
- «Все» kept a drug only when its title stem was in the query, so a drug the medication spelling
  branch found («обакавир», «цефтриаксн») was dropped; it is kept now (roadmap item 13 closed).
- Search box: the typed text is drawn over the field with the wrong letters struck out in red and
  the right ones added in green; a tap puts the corrected text in the field
  (`SearchCorrectionOverlay`).
- Measured (`run-typo-queries.ts`, 929 generated cases + 220 controls): first-letter slips hit@5
  0.328 → 0.984; controls unchanged 220/220; no case lost a hit.
- Not tested: a phone (vocabulary build ~0.4 s on a laptop on the first miss, then cached), the
  Android WebView rendering of the overlay; body-text words are not corrected.

## MedSolutions follow-up: diets, code layer, modules from a file — 2026-10-12 (STATE MS2)

- **Diets (public):** `minimed.reference.diets.ru` «Лечебное питание», 10 documents (153 KB): the six standard
  diet variants (ОВД, ЩД, ВБД, НБД, НКД, ВКД) with the exact №330 Table 1 rows (ред. 19.02.2024, as amended by
  №70н), the №395н food sets and the №1008н rows; children over 1 year / pregnancy / lactation (№1008н
  Appendix 3); the full №395н norms; №330 Tables 2а–7 (verified against three more copies, DQ1); the variant ↔
  numbered-diet map. Numbered tables («стол 5») are navigation aliases of their variant. Tables 2а–7 were
  verified on 2026-10-13 (DQ1, below): no status note any more, module 2026.10.13. Prepared Markdown in
  `content/diets-official/` is regenerated from `data/raw/diets-official/` by `bun run content:module:diets`.
  Research: `docs/research/medsolutions-diets-2026-10-12.md`. The numbered (Певзнер) diets have no official
  text (USSR order №540 only names them), so their details are a personal-use module (below).
- **Sick-leave periods on МКБ-10 cards:** the Минздрав/ФСС letter of 21.08.2000 №2510/9362-34 (text from the
  pravo.ppt.ru mirror; 872 rows, 1 371 period pairs) → lazy chunk `features/sick-leave/sick-leave-periods.json`
  (`bun scripts/build-sick-leave-periods.ts`), a folded «Больничный: N–M дней» panel under the title of an
  ICD-10 card (its `mkbCode`) or a КР (its `icd10Codes`) — never on drug, TNM or other documents that only
  mention codes. Diff against the MedSolutions copy: 746/776 agree; the 8 conflicts were resolved on 2026-10-13
  against three more copies of the letter (DQ1, below; `docs/research/medsolutions-code-layer-2026-10-12.md`).
- **Номенклатура медицинских услуг (№804н):** `minimed.reference.medical-services.ru`, НСИ OID
  1.2.643.5.1.13.13.11.1070 v2.10 (2021-04-06; `scripts/fetch-nsi-dictionary.sh … medical-services`), 725
  documents by class + section (10 450 active and 471 abolished services, 1.6 MB), new source type
  `code_reference` (outside «Клинические рекомендации»), `bun run content:module:medical-services`. Code search
  (`A16.20.005`) finds the section; abbreviations like «МРТ» do not.
- **Not taken:** MedSolutions federal standards (`fmes.sqlite`, 727/732 are 2012 orders, many replaced), Moscow
  МЭС (obsolete), КСГ op-codes (yearly, stale). Current standards of care would need pravo.gov.ru.
- **Install a module from a file:** Settings → «Загрузки и разделы» → «Модули из файла». Bundle
  `<stem>.minimed-module.zip` = STORED ZIP with `module.json` (one catalog entry, artifact URLs
  `minimed-local:artifacts/<file>`) + the artifacts; `medbase bundle-local-module` writes it. Entries persist in
  IndexedDB, carry an «Из файла» badge, are never offered for download or updated, and a remote catalog with a
  `minimed-local:` URL is rejected. Format in `docs/CONTENT_MODULES.md`. Web e2e
  `module-file-import.spec.ts`; Android file picker and a ~100 MB bundle not tested.
- **Personal-use modules (never committed, pushed or uploaded — the repo is public):** built into the gitignored
  `output/local-modules/` from `data/raw/medsolutions-spravochnik-vracha/`:
  `bun run content:local:lab-tnm` → «Лабораторные нормы (личное)» (1 668 analyses, ranges by sex/age exactly as
  the source, 13 MB) and «TNM (личное)» (59 sites, UICC/AJCC 8th edition, 0.6 MB); `content:local:pevzner` →
  «Диеты по Певзнеру (личное)» (27 tables, 0.2 MB); `content:local:vidal` → «Видаль (личное)» (6 269 monographs,
  92 MB download / 517 MB installed; shown on the drug screen like Allmed through a data-driven source label;
  «zip and full» in the app were one database, `db_archive` is the compressed download). Guard test
  `personal-use-modules.test.ts` fails if a `minimed.local.*` module or a `personal-use-only` entry reaches the
  public catalogs or `public/content/modules/`.
- **App version:** all new modules and bundles require **0.6.59** (the calculator categories in the same catalog
  already make 0.6.58 reject it).
- **Checks:** vitest 16 313, pytest 1 446, Biome, typecheck, build, native source check, `benchmark:all`; browser
  (dev): module-file import of the real TNM bundle, search and reader, panel placement. Not tested: Android
  device, an МКБ-10 card with the panel inside the real app (unit + harness only), the Vidal bundle through the
  import, clinical review of the diet tables 2а–7 (their text now matches the order; nobody judged it clinically).

## Data quality pass — 2026-10-13 (STATE DQ1)

Owner: «data with quality problems — fix it». Three data sets, each checked against independent copies and covered by
tests per data type.

- **Diets (module `minimed.reference.diets.ru` 2026.10.13).** Tables 2а, 3, 4, 5, 6, 7 of the №330 Instruction were
  compared cell by cell with the Kontur.Normativ copy of the 2024 edition (identical after layout normalisation),
  the legalacts mirror (the source), the rulaws copy of the 2016 edition (every difference is a №70н / №901н change),
  the 2013 consolidated text (sartfoms.ru PDF; all numbers of tables 2а–6 equal, table 7 differs only by the rows 70н
  added) and the 70н items 4–10 (every changed row matches). No value was wrong. Three mirror artefacts were repaired
  in Table 6 (`TABLE_CORRECTIONS` in `diets_official.py`, listed in the prepare report; each must match exactly one
  cell): «Молоко ко- ровье цельное сухое» → «коровье», «Сливки сухие с уменьшением …» → «Сливки сухие (с уменьшением
  …» (the 2013 text has the opening bracket; all three mirror copies lost it), «0,8/ /0,73 <5>» → «0,8/0,73 <5>».
  The «Статус» section and `machineExtracted` are gone. New file `minimed.reference.diets.2026.10.13.db.gz`
  (152 225 bytes), catalog entry and `publishedAt` 2026-10-13, `catalog:shell`; the 2026.10.12 file stays in
  `public/content/modules/` (published files are never overwritten). Tests: `tests/test_diets_official.py` (corrections
  applied, note absent), new `tests/test_diets_content.py` (numeric columns with units, gross ≥ net, table 7 macros and
  «масло ± N г», table 6 masses and no mirror artefacts) over the committed Markdown. Not verified: the official scan
  of the 2003 text (it was never published online); the 1008н/70н scans were not OCR'd.
- **Sick-leave periods.** Second independent copies of the letter 2510/9362-34 found: consultant.ru (16 table pages),
  docs.cntd.ru / library.mededtech.ru (Kodeks) and forens-med.ru (plain-text tables). Consultant and pravo.ppt.ru
  are the same text (identical on every row the Consultant pages carried, same parser); Kodeks and forens-med form the second reading. The eight
  MedSolutions conflicts: A01.0 and H44.0 **corrected** to 35–45 and 25–35 (Kodeks, forens-med and MedSolutions agree;
  the Consultant/pravo.ppt.ru text has 34–45 and 23–35); H00.1 (5–10) and L60.0 (7–10) kept (Kodeks/MedSolutions print
  the impossible 15–10 and 17–10, forens-med agrees with us); E24.0 kept as two lines 30–55 and 50–60 (all letter
  copies; MedSolutions merged them); S52.2.0/S52.2.1 kept (closed = .0, as the letter and forens-med print;
  MedSolutions swaps them); S82.2.1 kept as two rows (the letter repeats the code; MedSolutions codes the second
  S81.2.1); T22.3 kept (third degree 40–80 / 60–100; MedSolutions has a first-degree row). Beyond those, the full
  comparison with forens-med found three more places where it differs from the letter (I11.0 II ФК 10–20 vs 10–15,
  S61.- 13–20 vs 15–20, S52.2.1 открытый 45–50 vs 45–55) and the Kodeks copy has typos (A48.1 «28-0», I21.4 «60-0»,
  J04.1 «8-0», B75 18–25): each time the other two readings agree with us. Random sample of 50 rows (seed
  20261013) against Consultant and forens-med: 0 disagreements; whole letter (1 371 period pairs): 2 corrected values
  (0.15 %). Residual doubt: for A01.0 and H44.0 it is two readings against one lineage (no scan of the 2000 letter).
  `scripts/build-sick-leave-periods.ts` has `VALUE_CORRECTIONS` (printed value must be found once) and writes
  `valueCorrections` and `provenance` (`[table, form line]` per entry) into the asset; the form-line cell is empty in
  the letter itself for D65, H43.1 and L40.1. New `sick-leave-asset.test.ts`: code shape, title, min ≤ max and a
  plausible magnitude for every period, a source row for every entry, the settled values above.
- **Oseltamivir instruction.** No text-layer official copy exists: the ГРЛС card (ЛП-№(002417)-(РГ-RU), ООО «Атолл»,
  amendment 0 of 2023) carries only a 29-page raster PDF; the holder's own site and the ЕАЭС portal gave nothing;
  reference sites (Vidal, tabletka, …) are not official and were not used. The scan was re-OCR'd (macOS Vision, 300 dpi
  with the red ГРЛС stamp masked), compared with the first OCR run and two more variants and with a word list from
  5 478 text-layer instructions, then **all 29 pages were read against the image**: the red stamp «СООТВЕТСТВУЕТ
  ЭКСПЕРТНОМУ ОТЧЕТУ …» lies over the first line of most pages and had garbled it; short words («и», «в», «к», «с»)
  were dropped; ≥, n, ³, III, H1N1 were misread; the seven tables (resistance, two dose tables, the suspension
  tables, adverse reactions in adults and children) were retyped from the scan. Result: `content/grls-reviewed-ocr/
  drug.rf.b9f41580e1cecf8dc2e7.instruction.md` (every section of the instruction, 9 tables, a source span per block with its page) and its
  `.review.json` log; metadata `ocrReviewed: true` with the remaining doubts (first lines read through the stamp;
  look-alike Latin/Cyrillic letters; sub/superscripts plain). The module builder (`reviewed_override`) uses the file
  instead of the OCR while the PDF checksum is unchanged; the drug screen shows «Текст распознан со скана и сверен
  со страницами оригинала…» (`ocr-reviewed`). **Not done:** the antiinfectives module (40.9 MB) was not rebuilt or
  republished — the next GRLS module build picks the file up; no second reader, no clinical review. Tests:
  `tests/test_grls_reviewed_ocr.py` (required sections once and in order, dose numbers, table columns, spans for all
  29 pages, no stamp or mixed-script residue, contacts), `test_grls_instruction_modules.py` (override only for the same
  PDF), `instruction-source.test.ts`.

## MedSolutions gap calculators — 2026-10-12 (STATE CALC-ALL)

- **Source of the list:** the friend-shared MedElement «Справочник врача» databases
  (`data/raw/medsolutions-spravochnik-vracha/`, gitignored). Its 253 calculators (`mes.sqlite`) are HTML prose,
  so nothing was imported: each missing tool was rebuilt as a schemaVersion 2 definition from its primary
  publication or current КР, with MedSolutions used only as a checklist and cross-check. Many MedSolutions
  errors were found and the primary source followed (list in `docs/research/calculator-review-queue-2026-10-12.md`).
- **Catalog:** 86 → 245 tools (221 calculators, 24 assessments) in 16 modules. New modules
  `minimed.tools.{intensive-care,surgery-trauma,neurology-rehab,metabolic-lab,pulmonology,medication-dosing,rheum-gi-onco-uro}.ru`
  0.1.0-preview.1; extended cardiology 0.2.0-preview.1 (GRACE, SCORE2/SCORE2-OP, Framingham, PROCAM, PCE,
  EuroSCORE II, DAPT, SAMe-TT₂R₂, ESRS, ABI, Smith, LVMI, Mehran, CEAP, ХАН), obstetrics-gynecology preview.8
  (RCOG VTE risk), pediatrics preview.6 (CDS dehydration, WHO acute malnutrition), psychology preview.5 (Zung
  SDS/SAS, HAM-D 17), gastroenterology preview.5 (partial Mayo: correct Lewis 2008 PMID, bands from КР 193_2).
  All updated modules require app **0.6.59** (`minAppVersion`), because they use the new categories and `ln()`.
- **Engine and sections:** `ln()` in calculator expressions, the user formula editor and the frozen Kotlin twin;
  nine calculator sections (intensive-care, surgery, neurology, pulmonology, endocrinology, laboratory,
  rheumatology, oncology, urology); `lint-calculator-schema.ts --modules <paths>` lints draft modules.
- **Left out on purpose:** licensed item wording (MMSE, Beck, FIM, 16PF, Rorschach, MoCA, GMFCS, MACS, PPS, EDSS,
  CAT, IIEF-5, GerdQ, Lazarus, PARI), unpublished models (FRAX, GRACE 2.0), items without a verifiable primary
  source, obsolete Clark/Young dose rules. Review queue with secondary-source items and licence questions
  (Zung, Barthel, Rivermead, PAINAD, FINDRISC, BASDAI/BASFI): `docs/research/calculator-review-queue-2026-10-12.md`.
- **Not covered by this batch:** Vidal, the Citilab lab reference, TNM, diets and the code layer — done in MS2
  (next section).
- **Checks:** vitest 16 241, pytest 1 382, typecheck, build, schema lint (221/24), native source check and
  `benchmark:all` pass; `bun run check` fails only on the pre-existing `docs/data-ledger.json` formatting. No
  browser/device run; frozen native golden exports not regenerated.

## Calculator source verification — 2026-10-13 (STATE CALCV)

- **Owner 2026-10-13 «data with quality problems — fix it».** The ~60 calculators the CALC-ALL review queue listed as
  built from abstracts or secondary pages were re-read against the primary full text (CRUSADE, Rockall, ARISCAT,
  RECIST 1.1, SLEDAI-2K, SCORE2, MELD-Na, WHO 2023 wasting, Kirshblum 2011), official documents (Russian КР with full scale
  appendices for NIHSS, Hunt–Hess, Rivermead; «Указания по военно-полевой хирургии» МО РФ 2013 for the ВПХ scales; the
  Russian diabetes algorithms for the HOMA-IR / Matsuda thresholds; the Harris–Benedict 1919 monograph) or the best open
  reproduction. The per-tool list (what was read, what changed, what is still unverified) is in
  `docs/research/calculator-review-queue-2026-10-12.md` («Verified», sections A / B / C).
- **Corrected in the schemas** (record version 1.0.1; modules cardiology 0.2.0-preview.2 and intensive-care, surgery-trauma,
  neurology-rehab, metabolic-lab, pulmonology, rheum-gi-onco-uro 0.1.0-preview.2, DB files and catalog regenerated with
  `bun run content:catalog:tools`; the preview.1 DB files stay for the 0.6.59 catalog): Wells DVT (wording, pooled
  prevalence), NYHA and CCS (class wording), CEAP and CEAP extended (2020 update), ХАН (Rutherford wording), SCORE2 /
  SCORE2-OP (text), APACHE II (A-aDO₂ convention stated), MPM II 24 / 48 h (sources, 72 h constant flagged), RASS (three
  descriptors), MEWS (limitation), PSI (class IV mortality 8,2–9,3 %), Mannheim, Pusajó / Ranson / TRISS / Goldman /
  Detsky (limitations and tooltips), ARISCAT (published PPC rates), Evans, Caprini, Hunt–Hess (grade II label),
  Ruffier, SLEDAI-2K, Lille, Calvert (the 125 mL/min cap is a documented convention, not Calvert's), MELD-Na (the
  schema implements the OPTN 2016 variant; Kim 2008 has a different equation), basal metabolic rate (1919 source).
  No scoring arithmetic changed: the content changes are the PSI class IV mortality figure, the CEAP 2020 options and
  wording, bands, limitations and sources.
- **Tests:** one `*-primary-source*.test.ts` per group in `apps/app/src/features/calculators/` with worked examples and
  every cut-point edge (about 260 cases). Existing assertions touched: cardiology tests accept any https source URL (PMC and
  KR sources), cardiology module version, PSI class IV text, a TRISS describe title.
- **Still unverified** (reasons in the queue file): Pusajó, Ranson gallstone set and mortality, TRISS primary papers,
  SCORE2-OP supplement constants, MPM II 72 h constant, nitrogen-balance constant, Goldman / Detsky primaries, ВПХ-У(Л) CK-MB unit.
- **CEAP / ХАН decision:** all three tools kept (verified lookups that Russian documents quote side by side); they would
  fit a future «reference / classification» kind better than the calculator one.

## Cardiology and thromboembolism calculators — 2026-10-12 (STATE CALC-CARDIO)

- **New tool module** `content/tool-modules/cardiology.json` → `minimed.tools.cardiology.ru` 0.1.0-preview.1
  (17 calculators, `category: cardiology`, built DB `apps/app/public/content/modules/minimed-tools-cardiology-0.1.0-preview.1.db`,
  catalog entry + shell regenerated with `bun run content:catalog:tools`): Wells PE (Wells 2000), Wells DVT
  (Wells 2003, three-tier cut-points from Wells 1997), revised Geneva (Le Gal 2006), PERC (Kline 2004/2008),
  TIMI UA/NSTEMI (Antman 2000), TIMI STEMI (Morrow 2000), RCRI (Lee 1999), CRUSADE (Subherwal 2009), Killip
  (1967), NYHA (1994), CCS angina class (Campeau 1976), HEART (Six 2008; bands from Backus 2013), Duke
  treadmill score (Mark 1987/1991), PESI (Aujesky 2005), sPESI (Jiménez 2010), Padua (Barbar 2010),
  HEMORR₂HAGES (Gage 2006). Points, cut-points and rates come from the publications (PubMed abstracts or
  the paper itself); bands carry the published event rates and say which cohort they come from. Behaviour
  is schema data only (`interpretations` + `evaluation.rules`); no UI change.
- **Not added, on purpose:** GRACE 2.0 and SCORE2 / Framingham / PROCAM / ACC-AHA PCE / EuroSCORE II
  (regression coefficients or nomograms that were not reproduced from the publication), SAMe-TT₂R₂ (the paper's
  abstract cuts at ≥2, widely cited as >2), DAPT, Duke endocarditis criteria (diagnostic criteria, not a score).
- Tests: `apps/app/src/features/calculators/cardiology-tool-module.test.ts` (worked cases from the published
  point tables with every cut-point edge), `tools/ingest/tests/test_tool_modules.py`; counters in
  `tool-catalog.test.ts`, `tool-age-scope-audit.test.ts` (86 tools, 69 calculators in the registry) and the
  `lint-calculator-schema.ts` totals (67 calculators, 19 assessments) were updated. The frozen native golden
  exports (`native-tools-golden.json`) were not regenerated.

## «Препараты» search with every drug package installed — 2026-10-11 (STATE PERF3)

With all 32 drug packages installed (343 MB, about 3 GB on the device), a search in «Препараты» took
5–14 s on an Android 16 emulator, and the first one after a cold start several minutes. Measured
with `tools/benchmarks/src/run-medication-latency.ts` (host, native SQLite) and by timing the
app's calls to its 23 OPFS pack workers through the WebView DevTools protocol; two causes:

- **Lexical window over the FTS source view.** The per-document window step of lexical search read
  `chunk_id` / `document_version_id` back from `chunks_fts`; on external-content packs (migration
  010) that materialises one row of the source view (four joins, chunk text, JSON) per window row.
  It now reads them from `chunks` by rowid (the FTS rowid is the chunk rowid there); older packs
  keep reading the FTS columns. One ЕСКЛП module: 790 → 9 ms natively, 1 221 → 9 ms in SQLite
  WASM, same rows. Both stores (`storage-sqlite`, `storage-capacitor`).
- **Vector joins scanning `documents`.** Vector hydration, the vector-index build and filtered
  vector scoring joined `documents d ON d.current_version_id = c.document_version_id`, which no
  index serves: SQLite scanned the whole documents table per chunk row (Allmed: 4 708 documents) —
  4.2 s to hydrate 50 hits over OPFS, minutes to build a large module's vector index on first use.
  They now reach the document by primary key (`d.id = dv.document_id AND d.current_version_id =
  dv.id`, the same rows).

Results: host, medications scope, lexical, warm (145 queries): indication p50 1 055 → 938 ms, p90
2 401 → 1 544 ms; trade names p50 744 → 597 ms, p90 2 446 → 1 182 ms; top five identical for 145 of
145. Emulator: first query after a cold start minutes → 21 s; later queries p50 ≈ 8.5 → 5 s
(2–10 s by query). What remains is FTS ranking in WASM — 23 pack workers on 4 emulator cores, a
common prefix («таблетк»*, «витамин»*) matching thousands of rows per module; a 16 MB page cache
per pack did not change it (kept at 2 MB). `benchmark:all` within tolerance. Not measured on a phone.

## Semantic search: strong build-time model, distilled query model — 2026-10-11 (STATE KD1)

- **What changed.** The КР modules and the indication sections of the ГРЛС instruction and Allmed
  modules carry `localmed.kd1-giga480m.384.int8.v1` vectors: passages encoded on the build machine
  by Giga-Embeddings-instruct 480M and projected to 384 dimensions. «Поиск по смыслу» downloads the
  matching query encoder (multilingual-e5-small distilled from Giga and trained on train-split
  complaint/diagnosis → КР pairs, student v4c, 130 MB) instead of the Xenova e5 export; the e5
  profile is gone (DEV format policy). Fusion `KD1_FUSION` (band 0.5, lexical 0.3) was chosen on the
  Q1 dev split.
- **Measured** (MedicalCore, clinical hybrid): Q1 test R@1 0.301 → 0.454, R@5 0.497 → 0.718,
  complaints R@5 0.278 → 0.633 (labels share Q1's ICD mapping); the owner's own queries naming a КР
  (45, independent): R@5 0.667 → 0.822, R@1 0.400 → 0.578; drug indications hit@1 0.600 → 0.578, hit@5 0.911 → 0.867 (45 queries);
  trade-name top-1 1.00. [`research/embedding-distillation-2026-10-09.md`](research/embedding-distillation-2026-10-09.md),
  [`SEMANTIC_RETRIEVAL.md`](SEMANTIC_RETRIEVAL.md).
- **Data.** Model files on `datasets/kd1-query-encoder-2026.10.11.2` (ONNX in two parts below the git
  blob limit, joined and verified on the device; earlier model revisions are deleted from IndexedDB
  on install). Modules on `datasets/clinical-kd1-2026.10.11` and `datasets/<source tag>-kd1`.
- **Build.** `tools/ingest/scripts/embed_modules.py --projection data/build/kd1/giga480m-projection-384.npy`
  (renamed from `embed_modules_e5.py`; every КР rebuild uses it now, ≈ 1 h of GPU for all 774) and
  `scripts/reframe-modules.ts --marker kd1`. Student training: `tools/benchmarks/embedding_distill.py`
  (pairs: `tools/benchmarks/src/build-distill-pairs.ts`).
- **Emulator** (Android 16 arm64, debug APK, published data): model download 130 MB verified in
  60–80 s; owner case queries over 26 installed КР found in the top 5 for 39 of 45, results in 685 ms
  (p50); the first semantic query after installing or updating the app or model takes 6–9 s once.
  `tools/ingest/scripts/verify_embedded_release.py` verifies the release (790 modules, model).
- **Fusion confidence.** `KD1_FUSION.confidence` lets a query whose vectors are unsure (best cosine
  below 0.25–0.35) rank by its lexical evidence: «от молочницы» finds fluconazole; owner queries
  unchanged. «депрессия ST» in a short query still reaches the depression КР.
- **Drug search latency.** With all 32 drug packages installed, «Препараты» queries took 5–14 s on
  the emulator (lexical work over ~3 GB of modules; KD1's vector stage is cheap there) — open.
- **Not done.** A physical phone; an installed e5 model must be downloaded again (the profile
  changed, so search stays lexical until then).

## Owner UI batch — 2026-10-08 (STATE UX13)

Owner screenshots and requests of 2026-10-08, applied by eight Sonnet worktree agents and merged on
`main`. The rules behind them are recorded in AGENTS.md «Interface rules (user decisions,
2026-10-08)». A user-eyed QA pass follows in [qa-ux13-2026-10-08](research/qa-ux13-2026-10-08.md).

- **Route header.** `Page` puts the title between the back button (`navigation`) and the tools; a `help`
  prop renders a round «?» (sheet on phones, popover on wide screens). Settings sub-pages, drug
  interactions/comparison, calculators, conditions, medications, modules, knowledge, notes, ICD-11,
  medication safety, tools and the library list follow it; `FeatureCard` details and the AI page intro
  are behind «?». Not yet: the sticky back+search bars of the knowledge-base sections (ICD-11 collection,
  core library, law documents, user library, note templates) still put the heading under the bar.
- **Settings.** «О приложении» (`about`) is removed; its content is in «Основные».
- **Drug interactions.** One field; debounced suggestions; no pre-suggested «Алкоголь»; the second field
  slides in after the first drug; missing data offers the download in place; print/share icon buttons.
- **Patient row.** `components/PatientPickerRow.tsx` («Пациент — выберите…» → avatar, name, birth date,
  age, change) in forms, questionnaires, calculators and vaccination (`standIn`/`chooserExtra` for a
  birth-date-only child). `PatientCaseCombobox` is deleted. Questionnaires/calculators lost the toolbar
  free-text subject label (typed in the note panel). Opening the chooser creates the empty vault DB.
- **Forms.** Header `FormThumbnail` (real print rendering, 350 ms debounce, tap = preview/print); order,
  validity and publication as small text at the bottom; larger inputs; a field's fill rule is a «?» in
  the label only when it has one; drafts autosave (700 ms, `form-draft-store`, vault-backed) and
  «Сохранить» approves; one progress bar; the print dialog is a printer icon + one-line banner.
- **Vaccination calendar** (supersedes the VAC2 page below; data JSON unchanged). One ages × vaccines
  chart with a «Национальный / Эпид. показания» switch; a child (patient card or birth date only)
  colours cells done/planned/now/overdue with a «сейчас» line and four count tiles; tap cycles empty →
  done → planned, long-press/age header opens a dose sheet (date, official PDF page link); marks per
  patient card in `vaccination-record*.ts` (old diary/attachment format replaced); header print
  thumbnail of the one-page plan for the mother (`vaccination-handout*.ts`); «Порядок» behind «?»; only
  «Приказы № 1122н, № 677н» up front, edition/validity at the bottom; no «врач не проверял» note.
- **Conversation recording.** In-place speech-model card (`AsrModelCard`, «Скачать · 81 МБ», progress,
  transcription starts mid-recording from the beginning); the transcript autosaves encrypted as vault
  blob `conversation-transcript-<recordingId>`, is filed on the card with the audio and shown on reopen
  (crash-safe). When it cannot be saved, a chip «Текст не сохранится · Создать хранилище» /
  «Зашифровать хранилище» creates or encrypts the vault in place.
- **Patient vault.** New mode `browser-device-key` (non-extractable Web Crypto AES-GCM key in IndexedDB)
  is the default in browsers and on phones without a keychain; `unencrypted` only as fallback; a
  plaintext vault is encrypted in place in one transaction (ADR-0016 amendment). Blob writers share the
  mutation queue (never call them inside `updatePatientVault`). Fixed: encryption inside an open IDB
  transaction, and a spurious lock (cleared form drafts) when opening an open vault.
- **Search.** Cards name the document type (`SearchResultGroup.documentType`: Клинические рекомендации,
  Определение, Препарат, Приказ, Закон, МКБ-10/11, Калькулятор, Опросник, Справочник); no section
  kickers; three-line fragments unroll in place; «Найдено ещё в N фрагментах». Background data changes
  never show the page loader. Result cache IndexedDB `minimed-search-results` v2 keyed by
  `app|core|modules digest|semantic` + query + scope, 50 entries LRU; history re-runs the query (no
  snapshots). The tools strip stays under the field after a search; «Все инструменты» goes icon-only;
  tool collections hidden (`TOOL_COLLECTIONS_VISIBLE = false`).
- **Reader.** Page bubble bottom-left (tap → in-place input with a go arrow, instant jump, rolling
  digits); contents rows show page numbers; uppercase path kicker removed; a document opens through one
  loading state (`DocumentPageHost` waits for pointer/summary lookups); illustrated articles open on a
  blurred hero picture (`ReaderHero`, fullscreen on tap; inline duplicate hidden via
  `DocumentText.hiddenImageSource`); wide tables pan sideways by touch (`horizontalPan`).
- **КР headings.** Extractor revision 4 promotes appendix titles («Приложение Б1. …»): 238 headings in
  78 modules — rebuilt and republished in [KR4](#кр-appendix-headings-republished--2026-10-08-state-kr4). Revision 5
  promotes the known labels of the official template («Целевая аудитория…», «Показания к выписке …»): 3 935 headings in 741
  modules, 737 republished in [KR5](#кр-template-labels-as-headings--2026-10-09-state-kr5); other bold lines stay text.
- **News («Лента»).** Twitter-like feed (avatar inline, name · domain · time, titles ≤ 6 lines,
  scroll-past marks read in batches), header «Лента» + PubMed/refresh/settings, source-suggestion rail
  with a View-Transition sheet (description, latest items, subscribe), add-by-URL preview in the same
  sheet, merged «Источники» page (avatar, name, site + update, switch, delete). In-app article reader:
  X-Frame-Options ignored, the page fetched over the native/CORS-capable transport, readability-style
  extraction cached in IndexedDB `minimed-news` v2 `articles`; raw page in a sandboxed `srcdoc`. Avatars
  in `localStorage` `minimed.news.icons.v1`. ADR-0024 amended. Not tested on a device.
- **Definitions.** «Депрессия» was a real rare sense (КР 904_1, fracture) ranked by coverage only. Senses
  now carry field, usage (КР paragraphs closest to the sense), independent documents and authority; the
  card shows the likeliest sense first and other senses as field chips; an on-device doctor profile
  (`localStorage` `minimed.doctor-profile.v1`, decayed per-field weights from chip taps/opens, needs
  several signals) adds up to 0.35. The term dialog lost the draft banners, its search field and the
  raw-JSON tab. Registry-HTML КР glossary extraction: 9 170 entries, 0 defective headwords (was 222 of
  8 260). Candidate dictionary 2026.10.08 (38 572 entries; 237.5 MB / 52.3 MB gz) is local only in
  `data/build/definitions-ux13/` — publishing needs a core rebuild, framing/upload, a catalog entry, an
  app release and the owner's OK to extend the KiM decision to symptom pages. Not done: profile feeds from
  opened КР/sections and a Settings reset row.

Not tested in this batch: physical Android/iOS devices, native Keychain/Keystore, Safari/WebKit, real
GigaAM/Whisper downloads, real printers.

## Follow-ups after release 0.6.57 — 2026-10-09 (STATE UX14)

- **Module install.** A hash-verified index above the 32 MiB WASM limit is validated with a sampled scan
  (`inspectIntegrity('sampled')`: first/last rows, chunk count, FTS count from `chunks_fts_docsize`)
  instead of `integrity_check`/`foreign_key_check`/FTS `count(*)` over OPFS, which took 100–200 s; small
  indexes keep the full scan. After the download: 96 MiB reference pack 109–133 s → 4.6–8 s, 8.9 MB drug
  pack 199 s → 2.3–3.4 s (loaded machine). Phases are User Timing measures `minimed:install:*`;
  `module-install-timing.spec.ts` guards 12 s / 30 s budgets. Opening the target right after install
  waited behind `current_version_id` stored after the metadata blob and single-query listings on the
  pack worker; listings now read in yielding slices, identities come from `document_versions`, sections
  and chunks are asked of every mount, and the route reuses the target just read.
  `minimed:install:target-first-paint` (install complete → painted): drug group 3.7–4.3 s → ~1.0 s,
  reference pack 1.4–1.8 s → ~0.4 s (guards 3 s / 1.2 s). Optional with a rebuilt pack: migration 012
  (title index or a light navigation table).
- **Home counters** come from `sectionDocumentCounts` in `catalog.shell.json` (`bun run catalog:shell`
  after every catalog change; a unit test fails when stale): conditions 15 904, КР 763 (active
  editions), препараты 3 324 действующих вещества, нормативные 3, plus tool counts; `formatCount` +
  `pluralRu` everywhere on the home and the section picker. The КР list still shows all 774 pointers.
- **Search by source name** (`features/search/source-names.ts`, `SearchResponse.sourceScope`,
  `SearchRequest.sourceNames`; docs/SEARCH.md «Search by source name — 2026-10-09»): a source/collection
  name in the query searches inside it («Красота и медицина пневмония»), a bare name lists the source,
  «Искать везде» widens; names come from document metadata, not UI lists. A bare drug name opens with the
  linked Allmed card's «Фармакологическое действие» line. `benchmark:source-names` 17/17, 13/13, 5/5;
  other benchmarks unchanged. Not covered: «Видаль» (not in the corpus). КР developer societies are not
  a search source (owner decision 2026-10-09: the registry publisher is enough).
- **Calculators.** The tab always opens the list, with a recent-calculators row
  (`minimed.recent-calculators.v1`). The due-date calculators and the feeding plan declare patient
  bindings again (`profileContext` binding over the card's `profile.context`: `lastMenstrualPeriod`,
  `conceptionDate`, `gestationalAgeDate/Weeks/Days`, `quickeningDate`, `parity`); short text results
  (the due date) are the card event's text. Tool modules obstetrics-gynecology preview.6, pediatrics
  preview.4 (artifacts load from `main`). The five due-date calculators write `estimatedDueDate`; «Срок по
  ПДР» and maternity leave read it (obstetrics-gynecology preview.7, pediatrics preview.5). No screen
  branches on a tool id: the unit converter is a built-in schema, and `resultLayout`, `bundled` and the
  registry `surface` replace the old id checks (guarded by a unit test).
- **Doctor profile** is also fed by opened КР (0.3) and queued section bundles (0.6); Settings →
  «Основные» shows it with «Сбросить».
- **E2E.** Shared `waitForSearchReady` / `waitForSearchEditable` helpers; default expect 45 s, test
  150 s; `core-identities.spec.ts` runs serially (shared fixture directory).
- Removed dead code: `SearchHistoryView`, `PackageDownloadRow`, `drugDownloadPlan`; `PatientQuickCreate`
  has its own BEM block.

## Fixes from the UX13 QA pass — 2026-10-08 (STATE UX13-QA)

A Sonnet agent used the merged app as a doctor ([qa-ux13-2026-10-08](research/qa-ux13-2026-10-08.md),
37 findings); seven worktree agents fixed them and the e2e failures of the full run.

- **Downloads.** The dev/preview release cache streams uncached assets (it used to fetch the whole
  file before the first byte: the «0%» chip). Chip phases «Скачиваем…» → % → «Устанавливаем…» →
  «Готово»; one offer per pack in a result list («В том же наборе» on the others); the home document
  list drops a pointer once its target is installed (МКБ no longer doubles); the КР counter counts
  recommendations only. Open: installing the 96 MB pack took ~2.5 min on a loaded machine, not
  investigated; counters are not yet sourced from the catalog manifest (both fixed in UX14 above).
- **Search ranking.** A typed МКБ code puts its own card first; form numbers are phrases (no I07.x for
  «070/у»); the 13 official forms are tool cards in «Все»; complaint lists favour symptom-level
  documents; synonym-only words no longer rescue unrelated КР; tools follow the article for a bare
  disease name unless a tool is asked for. Benchmarks unchanged; doctor-lookup 14 cases, R@5 1.0.
- **Search screen.** History drawer: plain meta line, trash icon. `html` scroll-padding clears the tab
  bar. (The «Калькуляторы» tab restored the last tool; UX14 makes it open the list again.)
- **Reader.** Wide tables scroll in their own box with a pinned header row and first column; the
  picture preview is a dark full-bleed stage; the hero shows the picture sharp above the title (the
  stored reference images are the source's ~200 px thumbnails); stacked sticky headings are replaced
  by one sticky section-path line (`ReaderSectionPath`). «Красота и медицина» as a query finds nothing
  (the source name is not indexed) — open.
- **Patients and recording.** Russian sex labels and metric names; silent encrypted vault creation
  (help behind «?»); compact patient card header with a «…» menu; whole-card notes sections; the
  recording window opens ready and starts on the record button; real duration after stop; patient
  chosen with `PatientPickerRow`; Settings → «Пациенты и данные» has backup rows.
- **Tools.** Forms list cards show number + name; lighter official field labels; shared zoomable
  `PaperPreview` (forms, vaccination handout); vaccination tap dates the dose today with an undo toast
  (closed when the preview opens); ECG help behind «?» with one primary action; Cyrillic units; the
  patient row only for tools whose schema uses patient data (`calculatorUsesPatientData`); phone
  wording on the imaging entry; calculators/tests roots with back and compact own-tools rows.
- **Shell.** In-app theme «Системная / Светлая / Тёмная» (`minimed.theme.v1`, `data-theme`, a PostCSS
  step keeps every `prefers-color-scheme` block in sync — combined media conditions there now fail the
  build); dark CSS no longer loads before `main.css`; settings number formatting; news web build says
  once that feeds load in the Android app; tour 8 screens; open home sections hide the carousel;
  knowledge-base section bars put the title beside back.

## Definitions dictionary 2026.10.08 and core 0.6.57 — 2026-10-08 (STATE DEF4)

Owner approved on 2026-10-08 («Publish»), including the Красота и медицина symptom pages on the terms of the
2026-09-28 disease-article decision (`REFERENCE_SOURCE_POLICY.md`). Data published; the app release is **not** cut.

**Dictionary 2026.10.08.** Rebuilt from committed tooling (`definition_candidate` with tag `candidate-2026.10.08`, then
`scripts/prepare-definition-reference.py --version 2026.10.08 --built-at 2026-10-08T12:00:00Z --publication-state
experimental-preview`): the source manifest (sha256 `2de20659…`), the SQLite, the gzip, the catalog entry and the build
report are **byte-identical** to the UX13 candidate, so the build is reproducible. The shard directory (74 MB) is a
build input, not committed; it is regenerated from `data/raw` by the first command and deleted after the build.
38 572 entries (15 669 clinical definitions, 8 369 abbreviations, 6 939 lexical glosses, 7 595 names to complete),
237 481 984 B installed, sha256 `4580dd8b…`. Verified: SQLite integrity ok, 0 foreign-key violations, 46 387 content rows =
46 387 FTS rows, `verify-definition-reference.ts` (all 31 315 source name surfaces resolve), sense benchmark 6 of 6 authored
cases (the first sense of «Депрессия» is the mood disorder, psychiatry), every entity/link/chunk checked against the
validation rules of the v0.6.56 reader (0 violations, metadata ≤ 2 857 characters).
- Published as the data prerelease `definition-reference-2026.10.08` (new tag, nothing overwritten):
  `minimed.definition.reference.2026.10.08.db.zst` 27 800 502 B sha256 `208c1e77d0023fb47c82cda9de35edc0823f58a96d45d797d33223d6ac5c7726`
  (framed zstd, decoded again with the app's reader and the reference `zstd` CLI), `.db.gz` 52 275 358 B
  `bf888f98…` (kept for rollback), the build report and `verify-report.json`. The Pages build mirrors the `.zst` from
  the catalog (the tag matches `MIRRORED_DATA_RELEASE_TAG`); the mirror exists only after the next Pages deploy.
- Catalog: `minimed.definition.reference.ru` 2026.10.08, zstd, **`minAppVersion` 0.6.57**. Old readers tolerate the new
  `sense` metadata (they select only named keys) and zstd needs ≥ 0.6.45, but the core identities pin the edition id:
  an older core (edition 2026.9.30) paired with the new catalog entry gets no navigable dictionary hit, so the new
  dictionary and core 0.6.57 are released together. The 2026.9.30 entry's own `minAppVersion` 0.6.41 was already below
  the zstd floor; it is replaced. `catalogVersion` `definitions-2026.10.08.kr4-appendix-headings.2026.10.08`, `publishedAt`
  2026-10-08T17:40:00Z (after KR4); `catalog.shell.json` and `section-manifest.json` regenerated.

**Core 0.6.57** (`CORE_BUILD_VERSION=0.6.57 CORE_BUILT_AT=2026-10-08T12:00:00Z bun run content:core:build`, identity
inputs now the 2026.10.08 dictionary). Documents, sections, chunks and aliases are byte-identical to core 0.6.47
(20 002 / 57 264 / 57 276 / 62 960; compared row by row); only the exact-name identity index changed: 31 599 names /
31 508 targets → 44 269 / 38 592 (the 38 572 dictionary entities + 20 documents). 445 677 568 B (+4.1 MB), `core.db.gz`
75 935 899 B (Node gzip level 9), page size 16 KiB, integrity ok, 0 FK violations, FTS 57 276 = chunks. Built against
the KR4 catalog (rebuilt after rebasing onto it: identical output checksum, the core does not depend on the КР module
set). Published as the prerelease `core-0.6.57` (`core.db.gz`, `MiniMed-0.6.57-core.db`, `core-report.json`,
`core.manifest.json`; `core-0.6.47` stays for rollback). `content/bundled/core.db.gz`, `apps/app/public/content/core-report.json`
and `ANDROID_CORE_DOWNLOAD` point at it; db sha256 `56ca3ba7…`, archive `8033cf48…`.

**Checks.** `benchmark:all` and `benchmark:real:release` within tolerance (baseline unchanged), typecheck, `python:check`
(1 357 tests, ruff, pyright), vitest 9 141 passed (one KnowledgeGraph layout test hit its 5 s limit on a machine at load 25
and passes alone with a longer limit), Playwright `core-identities` and `experimental-reference` (6 of 6) against the
rebuilt core on `E2E_PORT=4194`. The e2e fixture now reads the 2026.10.08 files and sets its own `minAppVersion`.

**The app release must include:** version 0.6.57 (the dictionary entry requires it) with the already committed core
files; push of `main` so that Pages deploys the `.zst` mirror (check `…/app/content/releases/definition-reference-2026.10.08/…db.zst`
for size, sha256 and `access-control-allow-origin: *` once deployed); the Pages size budget grows by 9 MB (27.8 MB
replaces the 18.8 MB of 2026.9.30).

**Not verified:** the Pages mirror and its CORS (needs the deploy), Android download/install of the new gzip core and of the
zstd dictionary on a device, any older app build against the new entry (reader rules checked in code only), a
physician review of any text.

## КР template labels as headings — 2026-10-09 (STATE KR5)

Owner decision 2026-10-09 («only known template labels»): the fixed labels of the official Minzdrav КР template, which the
source JSON keeps as bold standalone lines, become headings; every other bold line stays text. The affected modules were
rebuilt and republished the same way as [KR4](#кр-appendix-headings-republished--2026-10-08-state-kr4).

- **The label list** (`tools/ingest/src/localmed_ingest/clinical_template_labels.json`, with the counts): 78 normalised
  wordings (case, ё/е, spaces, a trailing colon or full stop, spaces around «/», Unicode form — the source mixes composed and
  decomposed «й») in 7 sections: hospitalisation indications of section 6 (19: «Показания для плановой / экстренной
  госпитализации …», «Показания к выписке пациента …» and their «… являются:» forms), diagnosis criteria of section 2 (6), the
  quality-criteria groups (2), Appendix А1 (5: «Конфликт интересов», «Блок по организации медицинской помощи» …), А2 (33:
  «Целевая аудитория данных клинических рекомендаций:», «Порядок обновления клинических рекомендаций.», the methods of evidence
  collection, analysis and validation, «Экономический анализ», «Консультация и экспертная оценка» …), А3 (3: «Связанные документы» …)
  and the passport fields of the Г scales (10: «Содержание (шаблон):», «Ключ (интерпретация):», «Тип (подчеркнуть):» …). Mined
  from the bold standalone lines of the 774 current КР (15 049 distinct lines, 28 053 document occurrences;
  `tools/ingest/scripts/mine_clinical_template_labels.py candidates`) and reviewed by hand: a label must recur in at least 6
  documents, be template wording, and be taken **only inside its section** (a generic «Содержание:» or «Рабочая группа:» is a label
  in Appendix Г or А2 only). Left out on purpose: evidence-level lines («Уровень убедительности …», «УДД 4 УУР С», «ЕОК …»),
  «Комментарии:» after single recommendations, table and scale captions («Таблица 1. Шкала оценки …»), «Схема N», «N баллов», doses,
  author lists («РУКОВОДИТЕЛИ:», «Президиум рабочей группы:»), patient-information topics of Appendix В, disease-specific
  sub-headings («Диетотерапия», «Обезболивание»), and template-adjacent wording below the threshold (e.g. «Показания к госпитализации»,
  4 documents; «Условия оказания медицинских услуг.», «Форма помощи.»). `recount` re-checks the counts from the raw files.
- **Extractor revision 5** (`clinical_json_import`): the parser now knows whether a paragraph is all bold (bold punctuation
  aside); a bold paragraph whose normalised text is a listed label of the section it sits in becomes a heading **one level below the
  latest heading that is not itself a label** (level 2 under a stored section, 3 under a promoted «Приложение Г1. …»; stored deeper
  headings give 4–5), keeping its wording, source section id and block id (`promotedFrom: template-label`). Hidden headings are
  avoided with the same fixed point as KR3/KR4 (`_demote_hidden_promoted_headings`, now run with levels recomputed after each
  round): of 3 963 candidate lines in the 774 documents 3 935 are headings, 28 stay paragraphs because nothing sits under them
  (10 «Методология сбора доказательств» followed directly by the next label, 5 «Методология валидизации рекомендаций», single
  Г fields). The first build showed a second hiding mechanism: `source_registry._contents_entry_ids` treats any heading containing
  «содержание» as the start of a table of contents and turns the headings after it into plain text, so «Содержание (шаблон):» of a
  scale passport swallowed the next appendix titles (130 modules lost headings); template labels are now excluded from that
  detector. Tests: `tests/test_clinical_template_labels.py` (24, with real source lines and a pack-level case for «Содержание
  (шаблон):»), `tests/test_clinical_json_numbered_headings.py` (revision).
- **Rule effect vs importer drift** (`compare_clinical_modules.py`, plus a control build of all 774 modules with only the label
  rule switched off): control → final: **741 modules differ** in structure (3 944 sections added = promoted headings, 1–45 per
  module; 3 204 at level 2, 638 at level 3, 102 at level 4), 33 identical. Published → control: 202 identical, 564 importer drift
  only (image label, table captions attached to their figure), 8 structure differences older than the rule (see below). Four of
  the 741 were **not republished**: 385_3, 406_3, 694_2 and 713_2 carry stored `<h2>«Приложение А3.6 …»</h2>` headings that the
  current importer folds into the restated paragraph after them (the published build kept them as headings); rebuilding them would
  hide 3 visible appendix titles each, with or without the label rule. They need an importer decision (the `h2` followed by an
  identical paragraph is turned into body text) before they are rebuilt, and remain as published. The other 4 of the 8 older
  differences (507_3, 571_2, 723_2, 988_1) keep their section count and lose no visible title.
- **Published** to the new additive mirror branch `datasets/clinical-json-2026.10.09-17bb72b87531` (737 `.db.zst`,
  **664.4 MB** instead of 662.2 MB, 1 660 MB installed; version `0.6.0-json.24c087c586ee.e5`, same e5 profile with recomputed
  vectors; 92 339 chunks). Nothing existing was touched, no release, `main` not pushed. `minAppVersion` stays 0.6.46 (plain sections;
  an older app shows the labels as body text exactly as today). Catalog `publishedAt` 2026-10-09T07:10:00Z, `catalogVersion`
  `kr5-template-labels.2026.10.09`; `catalog.shell.json` and `section-manifest.json` regenerated (the whole КР download is 691.6 MB).
  Catalog diff: only the 737 clinical entries (`version`, `sizes`, `artifacts`, `documentTable`, `sourceSetDigest`) and the two
  top-level fields `catalogVersion` and `publishedAt`; no capability changed. The 11 re-saved editions (115_2, 25_2, 507_3, 535_2,
  758_1–762_1, 771_1, 937_1) now record their current raw-file checksum in digest and document table (as 998_1 did in KR3); the
  editions sidecar (`catalog.clinical-editions.json`) rebuilt from the registry is byte-identical, so it needed no change. Local
  copy: `output/module-zstd-json-2026-10-09/` (the KR4, KR3 and E2 copies stay for the 37 modules not republished and as rollback copies).
- **Identifiers** (737 modules). Document ids, titles, version labels and document-table rows are identical. Sections (34 192
  before): 34 183 ids kept, 3 925 added, **9 changed** (stored headings whose path-derived id moved because a label heading now sits
  above them). Chunks (91 855 before): 79 695 ids kept, **12 160 changed** (12 644 new) = 12.7 % of the 95 611 chunks of the 774 КР
  modules; the rule alone moves 7 013 of them (control → final), the rest is the importer drift of the modules rebuilt with the
  current importer. The released core 0.6.57 holds none of the changed chunk or section ids, nor do the
  `clinical-medication-relations` and core-pointer assets; the only hits are committed provenance files that cite chunks of the
  pinned dataset commit and are not resolved against modules (`content/definition-drafts/clinical-*` — 1 039 + 775 + 253 + 205 + 2 ids,
  and one generated report, `packages/tester-box/reports/latest.json`). Stored on a device: KR highlights (keyed by chunk anchor,
  quote-checked), copied section links and a remembered reading position fall back to the document top for a moved anchor;
  bookmarks are per document and survive. No core, query-model or index rebuild is needed.
- **Verified:** all 737 `.db.zst` decode with the reference `zstd` CLI to the catalog's decoded checksums and sizes, SQLite
  integrity and foreign keys ok, one e5 vector per chunk, no orphan vectors; every mirror URL returns the catalog size and SHA-256 with
  `access-control-allow-origin: *` (3 SSL resets retried and ok); token check control → final: text lost from chunks = exactly the
  promoted headings, nothing gained, in all 741; no section that is visible in the published or control module is hidden now and none
  of the 3 944 new headings is hidden (the four exceptions above are excluded). `bun run typecheck`, `bun run check` (no errors),
  `vitest` (modules and sections), `bun run python:check` (1 381 tests, ruff, pyright), `bun run build:app`. In a Chromium
  build (`E2E_PORT=4215`) the new `kr-template-label-modules.spec.ts` installs 655_2, 283_2 and 1062_1 from the catalog, opens them
  and clicks the outline entry of two labels each: each label is one outline entry and one title, never body text, and the outline
  scrolls it into view; the KR3/KR4 specs (visible-section counts updated for the labels), `kr-reader-structure`, `module-pointer`
  and four reader specs are green with the e2e fixtures reading the new local copy first.
- **Not verified:** Android/WebView or a phone, a visual check at 375 px (no UI code changed), an older app against the new data (it
  reads plain sections), a physician review of the 78 labels and their levels, lexical/semantic search quality on the rebuilt
  modules (label titles now reach FTS through `section_path`; no КР benchmark was re-run, the core is untouched so `benchmark:all` was not
  re-run), the Pages deploy.
- Intermediates (builds, control builds, compacted and e5 databases, decoded published copies) were deleted; reports, scripts, the
  id lists and the removed-id lists are in `data/build/official-clinical-2026-10-09/`.

## КР appendix headings republished — 2026-10-08 (STATE KR4)

Owner OK 2026-10-08: rebuild and publish the clinical-recommendation modules touched by extractor revision 4
(appendix titles «Приложение Б1. …» become headings), the same way as
[KR3](#кр-modules-rebuilt-with-numbered-sub-headings--2026-10-07-state-kr3). All 78 modules the rule
reaches changed because of it and were republished; the other 696 keep their catalog entry, version and URL.

- **Rebuilt from the raw JSON** (`data/raw/official-clinical-documents/<id>.json`, nothing re-fetched) with the
  committed July plan (all 78 are among the 744 earlier modules; none of the 30 newer editions): `build-documents` →
  `compact-module-search` → e5 vectors (`embed_modules_e5.py --from-dir`, 11 373 chunks) → framed zstd. The source
  checksum of every module is the published one, so no source-set digest or edition-sidecar row changed
  (`catalog.clinical-editions.json` untouched).
- **Rule effect vs importer drift** (`compare_clinical_modules.py`, plus a control build of the same 78 with only the
  appendix rule switched off): rule off → rule on: 78 of 78 modules differ in structure, 246 sections added = **238 promoted
  headings** (all start with «Приложение», all at level 2, every one with text of its own; 1–13 added sections per module) + 8 stored headings
  whose path-derived section id moved because a promoted heading now sits above them (720_2 ×1, 739_2 ×6, 905_1 ×1; two of them,
  «Приложение Г2» in 720_2 and 739_2, are now one level deeper), 380 more sections only shifted their `order_index`. Published →
  control: 26 modules identical (the ones KR3 had already rebuilt with the current importer) and 52 with importer drift
  only (image label «image.png» → «Иллюстрация», table captions attached to their figure; same text, other chunk ids).
  Republished all 78: each has the rule effect.
- **Published** to the new additive mirror branch `datasets/clinical-json-2026.10.08-f3039e82214e` (78 `.db.zst`,
  **85.0 MB** instead of 84.8 MB, 205.0 MB installed instead of 198.9 MB; version `0.6.0-json.a547c8490524.e5`, same e5 profile
  with recomputed vectors). Nothing existing was touched; no release. `minAppVersion` stays 0.6.46 (plain sections, any app
  reads them; an older app shows the appendix titles as body text exactly as today). Catalog `publishedAt` 2026-10-08T17:05:00Z,
  `catalogVersion` `kr4-appendix-headings.2026.10.08`; `catalog.shell.json` and `section-manifest.json` follow; the whole КР
  download is 689.4 MB (was 689.2). Local copy: `output/module-zstd-json-2026-10-08/` (the KR3 copy stays for the 96 modules
  it still serves and as the rollback copy of 26; the E2 copy for 52).
- **Identifiers.** Document ids, titles, version labels and document-table rows are identical in all 78 modules. Sections
  (3 697 before): 3 689 ids kept, 246 added, **8 changed** (the stored headings above). Chunks (11 544 before): 10 111 ids kept,
  **1 433 changed** (1 262 new): 881 removed / 829 added because chunks moved under a new appendix sub-section (the rule
  alone), the rest are the importer drift of the 52 modules. That is 1.5 % of the 95 827 chunks of the КР modules. Nothing
  shipped references them: the released core 0.6.47 holds none of the changed chunk or section ids, nor do the
  `clinical-medication-relations`, drug-comparison, interaction and pointer assets or any committed test or fixture; the only
  hits are `content/definition-drafts/clinical-source-excerpts-*` (433 ids), which cite chunks of the pinned dataset commit
  `77fe143a…` as provenance and are not resolved against modules. Stored on a device: KR highlights (keyed by chunk anchor,
  quote-checked), copied section links and a remembered reading position fall back to the document top for a moved anchor;
  bookmarks are per document and survive. No core, query-model or index rebuild is needed.
- **Verified:** all 78 `.db.zst` decode with the reference `zstd` CLI to the catalog's decoded checksums and sizes, SQLite
  integrity and foreign keys ok, one e5 vector per chunk, no orphan vectors; every mirror URL returns the catalog size and
  SHA-256 with `access-control-allow-origin: *`; token check control → final: text lost from chunks = exactly the promoted
  headings, nothing gained, in all 78; no section that was visible before (published or control) is hidden now and no new heading
  is hidden (0 of 246). Catalog diff: only the 78 entries (version, sizes, artifacts, documentTable) plus `catalogVersion` and
  `publishedAt`. `bun run typecheck`, `bun run check` (exit 0), `vitest` (494 files, 9 142 tests; the same 5 s timeout of
  `KnowledgeGraph.test.ts` on a busy host, green alone), `pytest tools/ingest`, ruff/pyright, `bun run benchmark:all` within
  tolerance, `bun run --cwd apps/app build`. In a Chromium build (`E2E_PORT=4193`, one worker) the new
  `kr-appendix-heading-modules.spec.ts` installs 655_2, 283_2 and 739_2 from the catalog and opens them: each appendix
  heading is one outline entry and one title, never body text; the KR3 specs (1062_1, 555_3, 960_1, reader structure) and
  `module-pointer.spec.ts` are green with the e2e fixtures reading both local copies.
- **Spot check** of all 246 titles: no dose, ICD code or unit line was promoted; the longest (≤ 291 characters) are the standard
  УДД/УУР evidence-scale appendices («Приложение 2. Шкала оценки уровней достоверности доказательств …», «Приложение А2.3 – Шкала
  оценки уровней убедительности рекомендаций …»); borderline but legitimate titles, kept by the rule.
- **Not verified:** Android/WebView or a phone, slow hardware, an older app against the new data (it reads plain sections), a
  physician review, lexical/semantic search quality on the rebuilt modules (appendix titles now reach FTS through `section_path`;
  no benchmark of the КР modules was re-run).
- Intermediates (`documents-main`, control build, compacted and e5 databases, decoded published copies) were deleted after
  verification; reports, scripts and the id lists are in `data/build/official-clinical-2026-10-08/`.

## КР modules rebuilt with numbered sub-headings — 2026-10-07 (STATE KR3)

Owner OK 2026-10-07: rebuild and republish the clinical-recommendation modules with the numbered
sub-heading rule of [UX11c](#кр-headings-image-zoom-and-selection-ux11c--2026-10-07). Only modules whose
content changed because of the rule were republished; the other 652 keep their catalog entry, version and
URL, so no device re-downloads them.

- **Rebuilt from the raw JSON** (`data/raw/official-clinical-documents/<id>.json`, nothing re-fetched) with
  the committed July plan for the 744 earlier modules and the 2026-10-02 plan for the 30 newer ones
  (`build-documents` → `compact-module-search` → e5 vectors → framed zstd), 774 modules in all. Each was compared
  with the published module (`tools/ingest/scripts/compare_clinical_modules.py`, document / section / chunk
  rows). Separating the rule from older importer drift needed a control build of the 135 candidates with the
  rule switched off: **122 modules changed because of the rule** (841 headings baked in, most in one
  document: 58); 652 are unchanged for the rule. 616 of those still differ from the published bytes by importer
  changes since 2026-07-27 (image label «image.png» → «Иллюстрация», figure/table captions attached to their
  figure; same text, other chunk ids) and 8 by an older structure difference; they were deliberately not
  republished.
- **Extractor: where the rule stays a display-time fact (revision 3).** A first rebuild showed that promoting
  every matching paragraph hides text: the reader drops a section with no text of its own and none below it,
  so a classification list («2.3.1 Краснуха», «2.3.2 Другие» …) or a checklist of numbered lines became
  invisible in the page, the contents and the search index (288 headings in 35 modules), and a promoted
  `3.3.1` at the same level as a stored `h3` «3.3 Иное лечение» left that heading hidden. `clinical_json_import`
  now keeps a matching paragraph a paragraph whenever promoting it would leave it, or a stored heading, hidden
  (`_demote_hidden_promoted_headings`, judged with the reader's own rule, to a fixed point). Of the 1 192
  promotions of the first pass 351 stayed paragraphs; the rule function itself (shared cases file, TS twin)
  is untouched. Those paragraphs are still promoted by the app's display layer, so a current app shows
  them as headings as before, and an older app shows them as plain text exactly as today. Extractor revision
  3 (so `prepare --reuse` re-extracts revision-2 extractions). Tests:
  `test_clinical_json_numbered_headings.py` (+2), `kr-numbered-heading-modules.spec.ts` (3 modules).
- **Published** to the new additive mirror branch `datasets/clinical-json-2026.10.07-197a48d1f268` (122
  `.db.zst`, **139.0 MB** instead of 138.3 MB, 347.6 MB installed instead of 334.7 MB; version
  `0.6.0-json.9db36e75287b.e5`, i.e. the vectors are the same e5 profile, recomputed for the new chunks). Nothing
  existing was touched; no release. `minAppVersion` stays 0.6.46: the data is plain sections, any app reads it.
  Catalog `publishedAt` 2026-10-07T15:40:00Z, `catalogVersion` `kr3-numbered-headings.2026.10.07`; the
  whole КР download is 689.2 MB (was 688.6). Editions sidecar needed no change (998_1 below). Local copy:
  `output/module-zstd-json-2026-10-07/` (the E2 copy `output/module-zstd-e5-2026-10-05/` stays for the 652
  unchanged modules).
- **Identifiers.** Document ids, titles and version labels are identical in all 774 modules. In the 122 modules
  (6 133 sections, 20 922 chunks): 6 123 section ids kept, 841 added, **10 changed** (six modules where a stored
  deeper-level heading, e.g. «3.2.», now sits below a promoted «3.1.» — 1028_1, 1041_1, 391_3, 551_3, 555_3,
  650_2 — so its path-derived id moved), 17 047 chunk ids kept, **3 875 changed** (3 830 new): 1 978 because
  chunks moved under a new sub-section, 2 191 because of the importer drift above (they overlap). That is 4.0 %
  of the 95 827 chunks of the КР modules. Nothing shipped references them: the released core 0.6.47 holds
  its own pointer chunk ids (its KR-derived definition evidence points at «Термины и определения» chunks
  that did not move), mkb/medications/ambulatory/reference packs, the drug-comparison / interaction /
  substance-fallback assets and `clinical-medication-relations` contain none of the changed ids or anchors, and no
  committed test, fixture or benchmark does. Stored on a device: KR highlights (keyed by chunk anchor, quote-checked;
  new today and unreleased), copied section links and a remembered reading position fall back to the document
  top for a moved anchor; bookmarks are per document and survive. No rebuild of the core, the e5 query model or any
  index is needed.
- **998_1** is a changed module whose raw file was re-saved by the registry after the published build (see KR2):
  the rebuild records the current file's checksum (`dfd5f4f7…`), so its source-set digest and document-table
  row differ and the editions sidecar now agrees with the module; its text is as before. The other 11 re-saved
  editions are superseded modules that did not change for the rule and stay as published.
- **Verified:** all 122 `.db.zst` decode with the reference `zstd` CLI to the catalog's decoded checksums, SQLite
  integrity and foreign keys ok, one e5 vector per chunk; every new mirror URL returns the catalog size and
  SHA-256 with `access-control-allow-origin: *`; token check on all 122 modules (text lost from chunks = exactly
  the moved headings, nothing gained); no heading that was visible before is hidden now (0 of 841);
  `bun run typecheck`, `vitest` (469 files, 8 972 tests; one 5 s timeout of `KnowledgeGraph.test.ts` on a busy host,
  green alone), `pytest tools/ingest` , ruff/pyright, `bun run benchmark:all` within tolerance. In a Chromium
  build (`E2E_PORT=4199`, one worker) modules 1062_1, 555_3, 960_1 and 1006_1 installed from the catalog and
  opened: each promoted heading is one outline entry and one title and not repeated as body text.
- **Spot check** (10 documents, all 841 headings screened for doses, ICD codes, units): no dose or code line was
  promoted. Borderline, kept by the rule: descriptive list lines with an enumeration (791_1 «6.1. Интраабдоминальные:
  оментит, …»), the long «7.1. Критерии оценки качества … (коды по МКБ-10: …)» lines of 62_3 and a diagnostic
  criterion «1.1. Подозрение на синдром Линча – …» (396_4); sentence-like items with a trailing full stop
  («1.1. Простой.») are classification entries.
- **Not verified:** Android/WebView or a phone, slow hardware, an older app against the new data (it reads plain
  sections, not run), a physician review, the lexical/semantic search quality on the rebuilt modules (headings now
  also reach FTS through `section_path`; no benchmark was re-run on the 122 modules).
- Tools: `tools/ingest/scripts/compare_clinical_modules.py` (published vs rebuilt), `embed_modules_e5.py --from-dir`
  (rebuilt, compacted databases), `scripts/republish-clinical-modules.ts` (rewrites the listed entries only; new
  version, artifact id, URL, sizes, checksums, digest from the database).

## Module catalog cache — 2026-10-06 (STATE CAT1)

The remote catalog (`catalog.preview.json` on raw.githubusercontent.com) is 7.54 MB, 2.19 MB gzip on
the wire. Its cache used to be one `localStorage` value; the serialized record is about 6.3 MB, over
the quota, so `setItem` threw and the error was swallowed: no validators were ever stored, every
start downloaded the whole catalog, and an offline start used the older bundled catalog.

- **Cache** (`apps/app/src/features/modules/catalog-cache.ts`): IndexedDB database
  `minimed-module-catalog`, store `records`, one record under `preview`. The catalog travels as JSON
  text and is schema-validated by the core on read; a record of the wrong shape or with damaged JSON
  is deleted and reported (`onCacheFailure`), never silently ignored. The old localStorage key
  `minimed.content-module-catalog.preview.v1` is removed on the first refresh, not migrated.
- **Record** (core, `CONTENT_MODULE_CATALOG_CACHE_FORMAT = 2`): format, `appVersion`, `publishedAt`,
  validators, `catalog`. The catalog body is kept only when the remote was strictly newer than the
  bundled one at that time; when the remote merely equals the shipped catalog only the validators and
  `publishedAt` are stored, so the usual state right after a release costs no storage and no parse.
- **Resolution** (`loadContentModuleCatalog`): always the newest of bundled, cached and remote by
  `publishedAt` (ties: bundled, then a freshly fetched remote, then the cache), also on 304 and on
  fetch failure. A record from another app version, or whose body is absent while the bundled
  catalog is older than the remote it describes, loses its validators (a full revalidation); a record
  of another format or one that fails the schema is dropped. Results carry `network`
  (`downloaded`, `not-modified`, `skipped-metered`, `failed`).
- **Transport** (`catalog-fetcher.ts`): raw.githubusercontent does not expose `ETag` to a page and
  its CORS preflight answers 403 to `If-None-Match`, so a page cannot send validators there. Android
  uses the native HTTP client (`CapacitorHttp`: validators sent and read back, 304 passes through);
  the browser uses `fetch` with `cache: 'no-cache'`, so its own HTTP cache revalidates. Not tested on
  a device: the 7.5 MB text response through the Capacitor bridge.
- **Metered connections**: the start-up refresh on a cellular or data-saving connection
  (`coreAutoDownloadAllowed`) contacts the remote only when the cache holds trusted validators (a
  304 costs about 1 KB); without them it uses the local catalogs and does not download. Opening the
  module catalog screen counts as the user asking and may download.
- The start-up refresh no longer ends in `.catch(() => undefined)`: a failure is logged with
  `console.warn` (no clinical text). Offline or HTTP failures stay a `warning` on the result, shown by
  the module catalog screen.

Bytes per start (GitHub, measured with `curl`): before, every start 2 194 392 B on the wire (7 537 011
B decoded, then JSON.parse 15 ms + zod 95 ms on a desktop). After: first start with no record 2.19 MB
once; every later start a 304 of 514 B response headers and no body (cellular: 0 B for the first start).
Size by part: `documentTable` rows 5.85 MB (77.7 %; 1.94 MB gzip) in 795 modules, two ICD reference
modules alone 3.3 MB; `artifacts` 0.48 MB; `tools` previews 0.19 MB; the rest (titles, tags, sizes,
compatibility) about 1 MB. Not changed here: the document table is what lets a pointer open a
document without installing the module, so trimming it is a catalog-format task.

Tests: `packages/core/tests/content-module-catalog-client.test.ts` (newest of three, stale cache on 304 /
failure, other app version / format / schema, metered, cache failures reported),
`apps/app/src/features/modules/catalog-cache.test.ts`, `catalog-fetcher.test.ts`,
`apps/app/e2e/module-catalog-cache.spec.ts` (cached → reload → conditional 304, offline start, newer
bundled catalog after an app update, other app version).

## iOS on iPad mini and iPhone simulators — 2026-10-06 (STATE IOS1)

First time anything ran on iOS. Tested on the **iPad mini (A17 Pro) simulator** (744 × 1133 pt, iOS 26.5)
in Safari and in the Capacitor app, plus the iPhone 17 simulator and Playwright WebKit (iPad mini,
iPhone 15, Slide Over 320 and half-split 570 pt widths). Screens: `output/ios1-screens/` (not
committed; `*-before` / `*-after`, named by device, orientation and screen).

**Works.** The iOS app builds from the committed project (no source changes needed beyond the ones
below), installs and runs: the packaged core opens through the native SQLite plugin («Ядро знаний уже
на месте»), search (20 127 sources, typed through the software keyboard), document reader with the
sticky and hide-on-scroll chrome contract, section/module download and install (4.2 MB drug module
→ drug screen), settings, patient vault (Keychain), camera picker (ECG), share popover, dark mode,
the onboarding tour. In the web view: OPFS incl. sync access handles in a worker, MediaRecorder (webm
and mp4), `navigator.share` with files, backdrop-filter, `@property`, Web Locks, CompressionStream. The
patient diary works in iPad and iPhone Safari (first open, entry with the keyboard, the install card).

**Fixed.**

- *Onboarding blur missing in WebKit.* A radial mask whose first colour stop is negative paints nothing
  in Safari/WKWebView, so the veil (blur and tint) never showed and the greeting sat on the sharp app.
  Stops are clamped (`max(0%, …)`). Headless WebKit paints no backdrop-filter at all: judge blur in the
  simulator, not in Playwright.
- *Portrait tablets.* 744 pt is below the 760 px tablet breakpoint and got the 65ch phone strip with
  83 pt desk gutters. From 600 px the page board is the full width (still one column).
- *Input zoom.* iOS zooms into a focused field under 16 px: on iOS (`@supports (-webkit-touch-callout)`)
  text fields are held at 16 px (`styles/global.css`).
- *Date and time fields* (`date`, `time`, `datetime-local`) stuck out of their card in the patient form
  and the diary and were taller than text fields: `appearance: none` on iOS.
- *Saving files in the app.* `<a download>` of a blob does nothing in the iOS web view (no error). Six
  places (note attachments, transcript, drawing, patient export, user documents, notes backup) now call
  `saveBlobAsFile` (`state/native-share.ts`): the system share sheet on iOS (popover on iPad, «Save to
  Files»), the anchor elsewhere. `navigator.share({files})` works in the web view; verified.
- *Info.plist* had no camera/microphone usage strings: iOS ends the app at the first access.
  `CapApp-SPM/Package.swift` was stale (`@capgo/capacitor-downloader` missing); `cap update ios` fixed it.
- *Launch.* The storyboard was the stock white Capacitor splash and the web view is white until paint,
  so every start flashed white before the cream boot surface. Launch screen: cream + the 190 pt wallet;
  `ios.backgroundColor` in `capacitor.config.ts`.
- *Diary «На экран Домой».* (follow-up in «Patient diary on the iOS home screen», STATE DIARY3.) iPad: the share button is in the top toolbar (iPad detection already
  existed for iPadOS' desktop-class UA). iPhone on Safari 26: «Поделиться» is inside the «⋯» menu.

**Build and run (simulator).** Sanitized environment, no signing identity needed but the app must be
**ad-hoc signed** (`CODE_SIGN_IDENTITY=-`): an unsigned simulator build cannot use the Keychain, and the
patient vault then reports that the key was not saved.

```bash
bun run build:app
# the Android build drops the four large databases; do the same for iOS (core.db stays, ~590 MB):
rsync -a --delete --exclude content/ambulatory.db --exclude content/medications.db \
  --exclude content/mkb.db apps/app/dist/ apps/app/ios/App/App/public/
cd apps/app && bunx cap update ios        # plugins / Package.swift; `bun run cap:sync:ios` also copies dist
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath <scratch>/DerivedData \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build
xcrun simctl install <udid> <scratch>/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch <udid> dev.localmed.search
```

The Safari side serves the build on 127.0.0.1 (`vite preview --outDir … --host 127.0.0.1`) and opens
`xcrun simctl openurl <udid> 'http://127.0.0.1:<port>/#/route'`; `simctl openurl` opens a new tab each
time, and two tabs fight for the one OPFS owner («MiniMed открыт в другой вкладке») — close the old
tab. The iOS-simulator MCP tool can tap, swipe and type (Latin only; Cyrillic text arrives garbled).

**Tests.** `ios-layout.spec.ts` (no sideways scroll at iPad portrait/landscape and iPhone widths, the
portrait page uses the width, the veil mask has no negative stop in WebKit) and an iPad case in
`diary-install.spec.ts`. Opt-in WebKit project: `PLAYWRIGHT_WEBKIT=1 bunx playwright test
--project=webkit-ios` (needs `bunx playwright install webkit`); the specs also run in Chromium. Headless
WebKit cannot navigate offline, so the diary offline spec is skipped there.

**Not verified.** Landscape in real Safari / the app (the simulator cannot be rotated without
accessibility permission for the tool; landscape is checked in Playwright WebKit only — no sideways
scroll, layout as Chromium); iPad Split View / Slide Over in the simulator (widths 320 and 570 checked
in WebKit: the ECG card's «Сфотографировать» button clips at 320); real devices (Keychain with a
real team, camera, microphone permission prompt, haptics, notifications, ProMotion), the Pencil and
touch drawing (Excalidraw), PDF viewer canvas limits on iOS, scroll lock under a sheet, the home-screen
install flow itself (the share sheet cannot be driven), Safari offline after the first visit, PWA
storage eviction (ITP: 7 days without a visit), the real App Store/TestFlight signing. Left as is:
document breadcrumb keeps a stale «Открываем документ» segment after a module install (not iOS
specific), 320 pt Slide Over clipping, `UIRequiredDeviceCapabilities` still lists `armv7`.

## Shared PDF viewer — 2026-10-06 (STATE W3)

Owner decision 2026-10-05: «PDF viewer — just re-use our viewer». The pdf.js reader that lived inline
in `UserDocumentReader` is now one module, `apps/app/src/features/pdf-viewer/` (`PdfViewer`,
`createPdfViewerModel`, `PdfThumbnails`, `PdfFileViewer`), and fills the gaps of W3.

- **Where a PDF is shown, and what is not a PDF here.**
  - «Ваши документы»: `UserDocumentReader` hosts `PdfViewer` (reader chrome, header find, page strip in
    the side panel, menu items «Миниатюры страниц», «Открыть в системе», «Печать»).
  - Note attachments (saved or not yet saved; patient notes, ordinary notes, the timeline): the
    attachment dialog hosts `PdfFileViewer` with its own toolbar (find, page strip, print, open in
    the system). Before, a PDF there fell into «Этот тип файла нельзя показать в заметке».
  - Library card thumbnails (first page, `state/thumbnails.ts`) and OCR ingest still use the same
    `state/pdfjs-document.ts` loader; unchanged.
  - Nothing else shows a PDF file because nothing else ships one: ГРЛС / Allmed / manufacturer
    instruction modules, КР and the forms are text/JSON/schemas (the originals are only recorded as
    `pdfSha256` / `officialSourceUrl` and open as external links); the form preview and print are HTML
    pages (F1/F2); no regulatory scans ship. If a module ever ships an original PDF, or a form offers
    «Сохранить оригинал в Ваши документы», it opens in this viewer (rights decision pending); the
    NEWS1 site viewer is an iframe of its own (request in `STATE.md`).
- **Find.** The units are whole pages of pdf.js text (`pdf-page-text.ts`: item `i` of the text is
  `textDivs[i]` of the layer), searched by the same `findInUnits`/worker as every reader, so a phrase
  matches across lines (the old word units could not). Hits are painted with the CSS Custom Highlight
  API (`::highlight(pdf-find-hit | pdf-find-active)`; a class on the spans where it is missing), next /
  previous bring the match to the middle (`pdf-find-state.ts`, `pdf-find-dom.ts`). Page text is read
  idly 2.5 s after opening (≤ 600 pages) or when find opens; a search waits for it (`busy`). Scanned
  pages without a text layer keep the recognised-word units and the OCR overlay.
- **Page strip, go to page.** Thumbnails (104 px, DPR ≤ 2) live in the reader's side panel — open by
  default in a wide window, a drawer under the header button on a phone; capped at 6 MB with LRU release
  (`pdf-thumbnail-budget.ts`), drawn after pages; in a dialog a rail (a floating strip on a phone). The
  dock above the bottom navigation has previous/next, a page box (type a number, Enter) and zoom.
- **Zoom.** 50–400 % of the column width: buttons, two-finger pinch (anchored at the fingers),
  Ctrl/⌘ + wheel / trackpad pinch, Ctrl/⌘ +/−/0; the % button cycles «По ширине» / «Вся страница»
  (`pdf-zoom.ts`). Pages keep their own aspect ratio from the first read of their size, so positions are
  exact before they are drawn. During a zoom only the CSS scale moves; bitmaps and text layers are
  redrawn 220 ms after it settles.
- **Resume.** Page, offset inside the page and zoom per document (`user:<id>`, `note:<id>`) in
  `localStorage` (`minimed.pdf-position.v1`, newest 150; `pdf-position.ts`). A search hit / explicit page
  wins; a restore keeps its target for 1.5 s while page sizes arrive.
- **Chrome contract** (`docs/NATIVE_STICKY_CHROME.md`): the dock slides out with the bottom navigation
  when the user scrolls down and returns on scroll up; a jump the viewer makes itself (find next, go to
  page, thumbnail, restore) keeps the controls through `state/reader-chrome-hold.ts`.
- **Phone performance design.** One `PdfRenderQueue` (2 concurrent, nearest page to the viewport centre
  first, thumbnails last, off-screen renders cancelled), page bitmaps ≤ 2.5 MP each and ≤ 24 MB in total
  (`pageBudget`), bitmaps swapped in only when complete (no blank flash), pdf.js caches freed by a
  retrying `pdf.cleanup()`, and the text layer built in slices of 8 items after a page has stayed on
  screen 250 ms: pdf.js measures every item with `canvas.measureText`, which made one dense page a
  1.2 s main-thread task.
- **Measured** (`PDF_PERF=1 … pdf-viewer-perf.spec.ts`, production build, headless Chromium, 390 px at
  2.75×, CPU throttled 4×, 150 dense pages / 465 KB; the machine ran at load 12–28 from other agents, so
  absolute times are pessimistic; 4 runs, ranges): open → first page with text layer 0.9–1.2 s;
  finger-speed scroll (140 frames × 30 px) 1.6–1.8 s wall, frame p50 8 ms, p95 34–41 ms, none over
  100 ms, longest task 82–231 ms (before the sliced text layer: 9.3 s, p95 775 ms, 1.2 s tasks); fling
  over all 150 pages: p95 frame 34–42 ms, peak 8 live page canvases = 6.3 MP (was 23 / 18 MP) — two of
  four runs saw a single 1.3 s / 5.6 s stall from other processes; page draw 27–30 ms median;
  jump to page 140 → drawn 0.24–0.29 s (one run 1.7 s); first search 0.38–0.44 s (22 hits), a 5 700-hit
  search 0.44–1.4 s, next match 0.12–0.18 s; two zoom steps → sharp 0.6–1.3 s; thumbnails of all 150
  pages scrolled through: ≤ 25 drawn at once, 1.5 MP. JS heap 54 MB after open → 129 MB after visiting
  every page, searching and scrolling the strip; a heap snapshot shows the PDF part is page text ≈ 1 MB,
  the rest is the app (core buffers 68 MB, catalog JSON 13 MB).
- **Tests.** Unit: `pdf-page-text`, `pdf-position`, `pdf-zoom`, `pdf-render-queue`,
  `pdf-thumbnail-budget`, `pdf-find-state` (26). e2e: `pdf-viewer.spec.ts` (open and lazy pages, text
  selection, find across lines with highlights and wrap-around, go to page, strip on desktop and phone,
  zoom/fit/Ctrl+wheel, CDP two-finger pinch, resume after reload, print path, dock vs reader chrome),
  `pdf-note-attachment.spec.ts`; the reader, native-chrome and user-library specs still pass.
  Screenshots 390/1280 × light/dark in `output/w3-screens/`.
- **Not done / not verified.** Drawing and annotation: the notes drawing editor is a modal Excalidraw
  scene, not an overlay that can sit on a page, so there is no cheap reuse; next step is a per-page ink
  layer (strokes in normalised page coordinates stored per document, eraser, undo-last-stroke — B1).
  Not run: a real phone / Android WebView (touch pinch is CDP-injected), the system print dialog (only
  the hand-off iframe is asserted, headless has no PDF plug-in), OCR-only PDFs end to end (find over
  recognised words + overlay were adapted, no e2e: needs tessdata), PDFs with embedded fonts, rotated
  pages, encrypted files, documents over ~1 000 pages (three observers per page), dark page tint.
  Opening the header menu right after a PDF ingest re-renders it as OCR/text progress events arrive
  (existing behaviour; the specs wait for the banner to go).

## Tools: age scope, «Дети / Взрослые / Все» filter, own questionnaires and calculators — 2026-10-06 (STATE TOOLS1)

- **Age scope in every schema.** `ageScope` (`packages/contracts/src/tool-age-scope.ts`: groups
  `neonates`/`children`/`adults`, optional `minAge`/`maxAge` in completed days/months/years, `basis` = the
  definition wording the declaration rests on) is required in calculator and questionnaire definitions
  and in the catalog entry; it replaced the calculator `audience` enum (the free-text `audience` of a
  questionnaire stays: who fills it in). The schema rejects missing scope and contradictions. All 69
  module tools were audited from their own wording (`content/tool-modules/*.json`, modules rebuilt as
  new versions: core-clinical preview.4, emergency preview.3, gastroenterology preview.4, neonatology
  preview.4, obstetrics-gynecology preview.5, pediatrics preview.3, pediatrics-growth 0.3.1,
  psychology preview.4; catalog digests/sizes updated, old DB files kept for older catalogs). Summary and
  the uncertain tools: `docs/ASSESSMENTS.md`. The built-in unit converter and ECG caliper declare any
  age (the ECG tool's stale «только взрослые» population text was corrected). **Publishing note:** an
  installed pre-0.6.49 tool module has no `ageScope` and fails the new definition parse until it is
  updated to the new versions. TOOLS1b: every module got a new version and file name (the table above),
  all eight artifacts now point at `raw.githubusercontent.com/.../main/apps/app/public/content/modules/`
  (four used the missing `v0.6.33` release assets; the resolver already rewrote them to raw main).
  An installed older version is not read (tools are taken only from the module version the catalog
  lists), so nothing fails to parse; the app installs the new version by itself at start
  (`localPackagedModulesToInstall`, shipped catalog only) and until then the tool shows its
  «Скачать» section state and the list «Есть обновление»
  (`apps/app/e2e/tool-module-update.spec.ts`). An app older than this release still reads the
  catalog from main and cannot parse the new definitions: gate them with `minAppVersion` at the release.
- **Filter and badge.** `features/tools/` (`tool-age-filter.ts`, `ToolAgeFilterBar`, `ToolAgeBadge`):
  the choice is `toolAgeFilter` in app preferences and applies in «Все инструменты» (favourites, tool
  row, groups; collections stay as the doctor made them), the «Калькуляторы»/«Опросники» sections and
  the search catalog, the calculator and test pages and «Мои опросники». «Скрыто по возрасту: N»
  explains short lists; the «create your own» card is never hidden. The patient default is **not**
  implemented: there is no app-wide open patient (the vault is per-tool), so a selected patient outside a tool's
  scope only gets a warning under the patient field in questionnaires (`PatientAgeNotice`).
- **Own questionnaires** (`minimed-questionnaire` v2, v1 still opens): population, sections, per-section
  or total scores, interpretation ranges, plain-Russian issues (`state/user-questionnaire-rules.ts`), pure edit
  operations (`features/assessments/user-questionnaire-edit.ts`), copy/delete/import/export/print.
  `interpretationMode: 'per-scale'` in the engine shows one range per section. Fixed on the way: typing
  lost spaces/focus (saved copy was written back), plural of «Осталось N пунктов», English «incomplete»
  tag, errors with wrong grammatical gender.
- **Own calculators («Мои калькуляторы»)**: file `minimed-calculator` v1 (`.minimed-calculator`), stored in
  `localStorage` `minimed.user-calculators.v1` (not in the user library; unreadable text is kept under
  `….corrupt`), `state/user-calculators.ts`. Numeric inputs (name used in the formula, label, unit,
  limits, integer), a formula typed as text, a result (label, unit, decimals) and result ranges (open-ended
  allowed, compared on the rounded result), population. The formula never reaches `eval`/`new Function`:
  `user-calculator/user-formula.ts` tokenises the text itself (`.`/`,` decimals, `;` between arguments,
  `×÷−`, Cyrillic names, whitelisted functions, ≤ 500 characters, nesting ≤ 30, plain-Russian errors
  with the position) and emits the restricted expression the schema engine already parses;
  `user-calculator-schema.ts` builds a validated `CalculatorSchema` (category `custom`) that is registered
  next to the downloaded ones, so the ordinary form, result panel, print, share, notes and patient
  recording work unchanged. Routes `#/calculators/mine[/new|/<id>/edit]`; editor with input and range
  cards (copy/move/delete), live preview on sample values, range tester, import/export, copy, delete. Side
  effects in generic code: a single numeric result is labelled with the step's own label (older saved
  results still read «Результат»), print puts range messages under «Интерпретация:», a source without
  an address is plain text. `searchCatalog` has the «Создать свой калькулятор» card (`createsNew`, no
  star/collection buttons, never age-filtered).
- Tests: `tool-age-scope.test.ts`, `tool-age-scope-audit.test.ts` (all tools), filter/badge/population/
  patient-age units, questionnaire model/rules/edit units, formula/model/schema/registry/edit units of the
  calculator builder (incl. a scan that no source uses `eval`/`new Function`); e2e `tools-age-filter`,
  `user-questionnaire-builder`, `user-calculators`. Not tested: Android WebView, physical device.

## Patient diary: finding it again, sync, home screen — 2026-10-05 (STATE DIARY2)

Walked the whole flow (doctor issues → patient opens, enters readings, closes the tab, reopens by the
same link / a newer link / another diary / offline / after a browser restart → returns results →
doctor imports, re-imports, imports a newer batch). Bugs found and fixed:

- **Diary lost when no entry was saved.** A link only created the diary in memory; the home-screen
  icon or a bookmark (no link in the address) then showed «пока нет дневников». The diary is now
  stored the moment its link is opened.
- **Older link rolled the header back; a changed plan broke the diary.** `store.load` replaced the
  header with whatever link was opened last. A newer link with a different plan left entries pointing
  at a missing plan item, so the next read failed validation and the diary showed as damaged.
  `diary-merge.ts` merges by `issuedAt` (newer wins, older ignored), keeps plan items that entries
  still use as `ended: true` (not offered again, still readable) and refuses a link whose fields do not
  fit the stored entries. A damaged record keeps its readable entries and the original text is set
  aside under `minimed.diary.salvage.v1.<id>`.
- **No way back from a diary to the list; no landing.** The address kept the first link forever.
  Now: no link → one diary opens at once, several → list with the last used first («Продолжить»);
  «← Мои дневники» is always there; the address is rewritten to a complete link to the open diary.
- **Offline right after the first visit did not work.** The worker cached only `./`; the hashed JS/CSS
  of the first visit were not cached, and cached modules did not match when the host sends
  `Vary: Origin`. The worker now caches the page, its assets (parsed from the HTML and CSS) and the
  manifest on install and matches with `ignoreVary`; `minimed-diary-v3`.
- **Doctor never saw patient corrections.** Import skipped any record whose id was already in the card,
  so an entry the patient edited after the first import stayed wrong. `applyDiaryImport` now replaces
  the card's record and appends «Исправлено пациентом, ранее: …» (applied once; a record in a closed
  visit is reported, not changed). Patient deletions are not propagated (the card is a record).
- **Wrong card.** Results of a diary already imported into / issued from another card are flagged
  before saving and need an explicit tick.
- **Comment and text lines of a diary record were never shown** in the card's «События» list
  (`event.text` was not rendered); it is shown now.
- **Results file.** The patient's «Сохранить файл» was FHIR, which the doctor app cannot read. The
  patient now sends a text file (or copies text) that holds the QR parts; the doctor reads it under
  «Принять данные» → «Пациент прислал файл или текст». The same file restores records on a new phone
  (`RestoreCard`: added to the diary by entry id, never replaces).

Patient UX (`apps/app/src/diary/`): large cards, plain Russian. A «Новая запись» block says how many
entries were made today, a green «Запись сохранена» confirms every save; «Передать врачу» says what
was handed over («Передано врачу (5 окт.): 2 из 3. Не передано — новых: 1»), entries carry «Не
передана врачу» / «Изменена после передачи», and the patient confirms «Врач получил» (showing codes is
not treated as proof). Sending: codes on screen, file (system share sheet where there is one), text.
A link that reopens an existing diary says so («Ваши записи на месте (3 записи)»). Add to home
screen (`InstallCard`): the browser's own prompt (`beforeinstallprompt`, captured at start-up), steps
for iPhone Safari written out, a menu hint for other Android browsers, remembered «Не сейчас» for 7
days, hidden when already installed; a messenger's built-in browser gets a «Откройте дневник в
браузере» warning (its storage is separate and cannot add an icon). Blocked storage (private window)
is explained instead of failing silently. `public/diary/manifest.webmanifest` (scope and start URL
`./`, icons from `../`), Apple meta tags.

Doctor side: the card keeps a list of issued diaries (a patient file `diary-ledger-<patientId>`,
encrypted like other card files, removed with the card): «Ссылка и QR» shows the same link again,
«Обновить» re-issues the same diary id with a new plan/instruction (plan ids are kept; same fields),
«Убрать» forgets it. Import preview counts new / corrected / already present records.

Tests: `diary-sync.test.ts`, `diary-doctor-sync.test.ts` (vitest); e2e `diary-patient`, `diary-install`,
`diary-share`, `diary-doctor` (full doctor ↔ patient round trip, two browser contexts), `diary-screens`
(set `DIARY_SCREENSHOTS=1`; images in `output/diary2-screens/`). The offline test runs only against
the built page (the service worker is off in `vite dev`).

Not verified: real iPhone Safari / Android Chrome (add-to-home-screen behaviour, whether iOS keeps the
`#i=` fragment in the saved URL and gives the icon its own empty storage, `beforeinstallprompt`
timing, the system share sheet, camera scan of the QR codes), Telegram/WhatsApp in-app browsers (only
the user-agent heuristic is tested), GitHub Pages hosting of the scope, a doctor result link that
deep-links into the app (not built: file and pasted text instead).

## Patient diary on the iOS home screen — 2026-10-06 (STATE DIARY3)

Found on the iPad mini simulator (iOS 26.5 Safari, real taps): a diary opened from the doctor's link
and added through «Поделиться» → «Ещё» → «На экран Домой» opened as an **empty «Мои дневники»**. Two
causes: a home-screen web app gets its own storage, and the saved URL was the manifest's `start_url`
(`./`), so the `#i=` invitation was lost and the diary itself did not exist in the icon.

**What iOS 26 Safari honours** (measured with scratch pages on the simulator, dialog name/URL and the
launched icon's `location.href`, `navigator.standalone`, storage counter):

- The manifest is read **once, while the page loads**. A `<link rel=manifest>` swapped to a Blob URL
  after load, or removed after load, changes nothing: the dialog still showed the original manifest's
  name and `start_url`. A manifest known at load always wins over the page address.
- With **no manifest link at load**, the dialog shows the page's current address **including the
  `#i=…` fragment**, the name comes from `apple-mobile-web-app-title`, the icon from
  `apple-touch-icon`; «Open as Web App» is on, and the launched icon is `standalone: true` with that
  exact URL (fragment intact) and empty storage of its own. A Blob manifest as the only manifest was
  ignored (name = page title, icon = letter), so a dynamic manifest is not a usable route on iOS.
- A static manifest can't carry the invitation (it is per patient), so on iOS the page has **no
  manifest at all**. `apps/app/diary/index.html` adds `<link rel=manifest>` from an inline script
  only when the browser is not iOS/iPadOS (same detection as `detectPlatform`, incl. iPadOS' Mac UA).
  Android Chrome and desktop keep the installable manifest (e2e checks both; `sw.js` precaches the
  manifest explicitly, no longer by parsing the HTML). The invitation stays in the fragment, in the
  saved address only; it is never sent to a server and never put in a query string.

**Flows.**

- Add to home screen from a diary: the address is already the full link (`syncAddress`), so the icon
  opens the patient's diary on first launch (notice: «Дневник открыт. Если вы уже делали записи в
  Safari, сюда они не попали…»). Later launches from the icon say nothing about the saved link
  («same»/«older» outcomes are silent when `navigator.standalone`).
- Entries made in Safari before adding: «Передать врачу» → «Сохранить файл» / «Скопировать текстом» in
  Safari, then in the icon «Печать, файлы и копия» → «Восстановить записи». The file/text already
  carries the invitation (`encodeDiaryResultsText` writes `[v, invitation, entries]`), so it restores
  the diary **and** its entries in one step into an empty store or into the diary the icon created from
  its start link (merge by entry id, tests in `diary-sync.test.ts` and `diary-share.spec.ts`).
- Empty «Мои дневники» (icon without a link, or a link that never reached it): card «Вставьте ссылку от
  врача» (`PasteLinkCard`) above «Восстановить записи из файла или текста». `readInvitationText`
  accepts the whole link, a message with the link inside, `#i=…`, `i=…` or the bare code, validates it
  like an opened link and merges with the same rules (newer updates, older ignored, entries kept);
  pasted saved entries (`MMD1.…`) are refused with a pointer to «Восстановить записи». With diaries
  present the same card is a collapsed «Добавить дневник по ссылке врача».
- Copy: iOS steps «Поделиться» (iPad: top toolbar; iPhone: «⋯» then «Поделиться») → «Ещё» → «На экран
  Домой» → «Добавить»; the warning now says what really happens (the icon keeps its storage apart from
  Safari, opens the same diary, entries made in Safari need the file transfer; best order: add before
  the first entry). «телефон» → «устройство» in every patient-facing line.

Tests: `diary-sync.test.ts` (restore into an empty store, merge into the icon's diary, link text
parsing), e2e `diary-install` (iPhone/iPad copy, no manifest on iOS UAs, manifest elsewhere),
`diary-paste` (new, also in `webkit-ios`), `diary-share` (Safari → icon transfer in a second context
with `navigator.standalone`).

Not verified: a real iPhone; iOS versions below 26 (older Safari also takes the manifest at load, so
the behaviour should match, but the share-sheet path differs); Android Chrome install with the
script-inserted manifest (Chrome supports a manifest link added during load, the installability e2e
reads the inserted link but cannot run Chrome's installer).

## Patient diary: a home with three visible actions — 2026-10-06 (STATE DIARY4)

Owner request: it was not always clear how to open, read, fill and send the diary, and the actions were
not visible. The coordinator's phone/iPad screenshots: the page opened with notices and a long
«Добавьте дневник на экран» card, the entry form was long, «Записи» and the list were below it, «Передать
врачу» was at the very bottom, «Печать, файлы и копия» was a collapsed card. Redesigned for an older
patient on a phone (data formats, storage, merge rules, the doctor side: unchanged).

**Structure** (`apps/app/src/diary/`, steps are screens of `DiaryView`, one level deep, the browser's
Back button returns from a step to the home — `history.pushState` with the step in the entry state,
cleaned on reload):

- *Diary home* (`DiaryHome`): title, doctor, «Что просит врач» (the doctor's instruction), then three
  whole-width buttons with an icon, a plain verb and the state in words — **«Записать показания»**
  («Сегодня записей ещё нет» / «Сегодня: 2 записи, последняя в 07:55»), **«Мои записи (N)»**
  («Последняя: вчера в 08:10») and **«Отправить врачу»** («Не отправлено: 3 записи» with a warning
  border / «Всё отправлено 5 окт.» / «Записей пока нет») — and «Ещё: печать, копия, справка». The three
  buttons are on the first 390×844 screen with the title block (e2e checks it, also with the iPhone
  install tip present). Below them: the doctor's plan, the link/update notice (dismissible «Понятно»,
  also dropped once the patient saves), the install tip, the storage note. After a save the green
  «Запись сохранена» card shows the saved entry and when. Wide screens (≥56rem): info and plan on the
  left, actions on the right.
- *Entry* (`DiaryEntryForm`, moved from `features/diary/`): its own page, large labelled fields (label
  20 px bold, input 22 px, unit beside the input, «от 50 до 300» under the label), `inputmode` numeric for
  whole-number fields (pressure, pulse, grams) and decimal otherwise (`diary-validation.ts`
  `inputModeFor`), choices and the doctor's plan as pressed-state buttons instead of dropdowns, counter
  with 56 px buttons, flags as a 56 px row. The time is «Сейчас: 6 октября, 14:32» (read at save time)
  with «Изменить время» opening the date field. «Сохранить» (or «Сохранить изменения») is a sticky bottom
  bar with safe-area padding, so it is on screen however long the form is. Problems are written next to
  the field and summarised above the button («Допустимо от 50 до 300 мм рт. ст. Проверьте, нет ли лишней
  цифры.», «Введите число цифрами, например 120.», ««Нижнее» должно быть меньше, чем «Верхнее»…»); focus
  moves to the first wrong field; `parseDiaryEntry` stays the final authority. Leaving a changed form
  asks «Выйти без сохранения?».
- *Мои записи* (`DiaryRecords`): grouped by day, newest first, «Сегодня» / «Вчера» / weekday + date, today
  highlighted; each record shows time, value, note, «Не отправлена врачу» / «Изменена после отправки»,
  and «Изменить» / «Удалить» buttons (48 px, with the record's time in the accessible name). Deleting asks
  once in place («Удалить эту запись насовсем?»). Editing returns to this list with «Запись изменена».
  A sticky bar keeps «Записать показания» and «Отправить врачу» reachable.
- *Отправить врачу* (`DiarySend`, was `ShareSheet`): three numbered steps. 1 «Что будет отправлено»
  (all records, the period, what the doctor already has and how many are new or changed since, a fold with
  the records, «ваше имя и другие данные не отправляются»), 2 «Выберите, как отправить» — «Показать врачу
  на экране» (QR codes), «Отправить файлом», «Скопировать текстом», each with one line of explanation,
  3 a sticky «Врач получил все записи?» → «Да, врач получил» / «Ещё нет» (showing codes is still not proof;
  nothing is marked until the patient says so). The result is «Готово. Всё отправлено 6 окт.» and the home
  shows it. With no records the step says so and offers «Записать показания».
- *Ещё* (`DiaryMore`): print, FHIR file («для врача в другой программе»), «Восстановить записи из файла
  или текста», the install help (same `InstallCard`, `variant="section"`: always available, no dismissal),
  «Добавить дневник по ссылке врача», «Как пользоваться дневником», «Мои дневники».
- *Мои дневники* (`DiaryList`): one big card per diary — name, doctor, last entry date, where sending
  stands, the same three buttons (each opens that step of that diary), «Удалить дневник» with an in-place
  confirmation; the last used one marked «Продолжить»; empty state keeps «Вставьте ссылку от врача»
  (DIARY3), the install tip and the restore card below. «← Мои дневники» appears on a diary's home only
  when there is more than one diary.
- *Install tip* (`InstallCard`, `variant="tip"`): after the actions, once, «Не сейчас» is remembered for a
  week (DIARY2), the iOS copy is DIARY3's with the file-transfer path renamed («Отправить врачу» →
  «Отправить файлом» / «Скопировать текстом», «Ещё» → «Восстановить записи»).

**Wording.** The patient side now says «отправить / не отправлено» everywhere (was «передать»); the
doctor side is untouched. State logic with no DOM is in `diary-home.ts` (send summary, day labels and
grouping, «сегодня в 07:55», period and what-is-sent sentences) and `diary-validation.ts` (number
messages, keyboard choice); both in `diary-home.test.ts`.

**Accessibility, checked in e2e (`diary-screens.spec.ts`, every screen at 390 and 1024 px, light and dark,
Chromium and WebKit):** every control and checkbox row ≥48 px, page text 17 px (nothing under 15 px),
text contrast ≥4.5:1 (3:1 for large text) computed from the rendered colours, no sideways scroll. The
audit found and fixed two things: the QR carousel's three buttons overflowed a 390 px screen, and the
dark-theme danger button («Да, удалить») had 3.99:1. Screen readers: step titles take focus, action
buttons are named by the verb and described by the state, fields are tied to hints and errors with
`aria-describedby`, errors are `role="alert"`. `prefers-reduced-motion` turns the transitions off.

**Also fixed.** Two links opened in quick succession (hash change while the first was still being decoded)
could leave the earlier one on the screen; the later link now wins and both are stored.

Tests: `diary-patient` (home on the first screen, state in words, the whole open → fill → save → read →
send flow, mistakes explained, leaving a half-filled form, edit and delete in «Мои записи», Back button,
«Ещё», long form with the sticky save, diary cards), `diary-share`, `diary-install`, `diary-paste`,
`diary-doctor` updated to the new flow; `diary-patient` and `diary-screens` now also run in the opt-in
`webkit-ios` project. Screenshots (`DIARY_SCREENSHOTS=1`): `output/diary4-screens/{before,after}/`.

Not verified: a real iPhone or Android phone (touch feel, virtual-keyboard behaviour with the sticky bar,
the numeric keypad on iOS/Android, the system Back gesture), VoiceOver / TalkBack, Telegram/WhatsApp
in-app browsers, the effect on patients themselves (no user test with older people).

## Search header, core status line and source-card download — 2026-10-05 (STATE UX8)

- **Header.** The search top row holds only the history button, the update notice and «?». With the
  notice visible the old row (history, notice, dice, graph, «?») was 392 px wide at 360 px. The
  random record and the relation map are now rows of the «?» menu (`Справка`), under a divider after
  the two help rows: «Случайная запись» (current section; disabled with «Откроется, когда база будет
  готова» until the core is up) and «Карта связей» (hidden for clinical analysis, catalog-only
  views and with experimental modules off, as before). The relation map is still on the knowledge-base
  document library too.
- **Core status line.** Measured in headless Chromium (full 441 MB core, local server): on a first
  run the old «Подготавливаем поиск…» note with a spinner appeared ~1.2 s in and stayed until the user
  pressed «Далее» past the greeting, although nothing ran — the download is held back for the
  onboarding. That state is now `waiting` (`coreWaitingToStart` in `use-app-session.ts`, set only while
  `requestDownload` waits for `releaseCoreStart`): no note on the search page (the field says «Поиск
  откроется после загрузки ядра»; the knowledge-base and document-wait pages still explain it). An
  ordinary open of an installed core takes ~1 s, so the note delay is 400 → 1 200 ms (no flash). The
  spinner is gone: downloading shows the pie with the real share, verifying/installing a full pie
  (no measurable share), opening/waiting/other tab/consent a still clock mark. Slow opens (≥ 10 s)
  still get the longer explanation.
- **Source card.** The «Скачать полный текст · <name> · 1.1 МБ» block below the card header of a
  clinical-recommendation pointer is a compact chip in the header's top-right corner (icon + size;
  «В очереди» / percent / «Повторить» while it works). The accessible name and tooltip keep the full
  sentence with the document title and size; the kind badge on the same line gives it room
  (`--result-group-action-reserve`). The document page's own «Скачать набор» button is unchanged.
- Tests: `search-core-status.test.ts`; `apps/app/e2e/ux8-search-header.spec.ts` (header at 360/390/1280
  px, light and dark, menu rows, first-run status, compact chip); `search.spec.ts` and
  `boot-screen.spec.ts` follow the moved buttons. Before/after screenshots: `output/ux8-screens/`.

## Settings as a list with sub-pages — 2026-10-05 (STATE SET1)

Settings follow the macOS/iOS pattern. `#/settings` is a list of inset groups of large rows (coloured
icon tile, title, status with an indicator dot, chevron); each row opens `#/settings/<id>` with the
existing cards of that area and a `NavBack` arrow (browser and Android back go to the list; the
reference-images page goes back to «Изображения и дополнительно»). From 900 px the list stays on
the left and the open page is on the right (the bare `#/settings` shows «Основные»). A filter field
on the list searches titles, descriptions and card keywords.

| Row (`id`) | Holds | Status (pure function in `settings-status.ts`) |
| --- | --- | --- |
| Основные (`general`) | app update, automatic module updates, onboarding restart, DEV source switch | «Есть обновление» / «Обновляется…» / «Актуальная версия» / «Версия x» |
| Врач и организация (`clinician`) | `ClinicianProfileSettings` | «Не заполнено» / «Заполнено 2 из 5» / «Заполнено» |
| Загрузки и разделы (`downloads`) | sections download, queue, history (`DownloadsPage` is now body-only) | running/queued/needs-attention counts, else «N раздела · 1,2 ГБ» (sections with something installed; sizes from catalog `installedBytes`), «Не скачано» |
| Функции ИИ (`ai`) | search by meaning (e5), speech recognition (ASR), ECG recognition | «Готово 2 из 3» / «Готово» / «Скачивается…» / «Есть обновление» / «Не скачано» |
| Изображения и дополнительно (`images`) | row to «Справочные изображения», packaging images module, «Предварительные материалы» | the reference images' state |
| Внешний вид (`appearance`) | theme note (follows the device), animations, sounds, vibration, separate tabs, floating windows | «Тёмная» / «Светлая» |
| Пациенты и данные (`data`) | patient storage description, where the notes backup lives (link to the notes), no new backup UI | «Пусто» / «Защищено» / «Без шифрования» |

- Statuses are computed from the stores (download queue, e5 cache, ASR selection and cache, ECG
  package, reference-image cache, patient vault, `matchMedia`) in `use-settings-statuses.ts`; the
  list never starts a download, a model or a database. The release catalog (~10 MB) loads when the
  list is shown, to count sections and sizes.
- `#/settings/images/reference` («Справочные изображения») shows the contents from the verified
  manifest («9 084 иллюстрации к 5 932 статьям · 456 МБ»), six example thumbnails and the existing
  download card. Examples: downloaded images are read from the cache only (checksum re-verified,
  `ReferenceImageResolver.cachedSamples`); before the download six original files bundled in
  `public/content/reference-images-preview/` (212 KB, byte-identical to the set, `index.json` with
  article id, source URL and sha256; `bun run content:reference-images:previews`) are shown with a
  note saying so.
- The home update notice opens `#/settings/general` through a one-shot `requestSettingsPage`.
- Not done: no theme choice (the theme follows the device), no new backup/vault UI (it stays in the
  notes section), the old inline «Скачанные материалы» card of the list is gone.
- Tests: `settings-status`, `settings-pages`, `settings-routing`, `reference-image-examples`,
  `native-back` unit tests; `apps/app/e2e/settings-list.spec.ts`; existing specs that touched
  settings now go through the rows (`settings-nav.ts`).

## Android microphone access — 2026-10-05 (STATE MIC1)

- Root cause of "denied although granted" (0.6.50 and earlier): Capacitor's `BridgeWebChromeClient`
  requests `MODIFY_AUDIO_SETTINGS` together with `RECORD_AUDIO` for every WebView audio capture and
  denies the page unless both are granted; the manifest declared only `RECORD_AUDIO`, so
  `getUserMedia` failed with `NotAllowedError` even with the microphone allowed. The manifest now
  declares `MODIFY_AUDIO_SETTINGS` (normal permission, auto-granted) and `check-native-bridge`
  requires it.
- App side: the verdict comes from the failed `getUserMedia` call, never from the Permissions API.
  `features/conversations/microphone-access.ts` compares a refusal with the OS state
  (`LocalMedTranscriber.microphoneStatusAfterRefusal`, since Capacitor's `checkPermissions` reports
  `prompt` for refusals made through the WebView request) and offers «Открыть настройки приложения»
  (`LocalMedTranscriber.openAppSettings`) only when the OS refused for good; a granted OS state
  gets its own wording without the button. Applies to conversation recording, note voice
  recording and the visit recorder.
- Verified on the emulator (API debug build, `org.med.web`): granted -> recorder runs; first
  decline -> "allow in the Android prompt"; second decline (USER_FIXED) -> settings button, which
  opens the app settings. Not verified on a physical phone (HyperOS may add its own audio-record
  gate).

## КР headings, image zoom and selection (UX11c) — 2026-10-07

Owner feedback 2026-10-07, three items. Branch `worktree-agent-a6b8b452dd6b115fe` (not merged).

### КР sub-headings that were plain paragraphs

- **Cause.** The Minzdrav JSON gives only top-level sections (`obj.sections[].title`; the extractor
  already derives their depth from the number), deeper numbered headings («1.2.2.1 Заголовок») sit
  inside the section's HTML as `<p>`. The PDF extraction found headings by font size and missed the
  same ones. Both reach the reader as body paragraphs: no outline entry, no heading style.
- **Measured** (rule below, real data): published КР modules (774 documents, `data/build/official-clinical-documents-merged`):
  1 624 paragraphs start with a multi-level number, **1 184 are headings in 129 documents** (depth 2:
  565, 3: 426, 4: 174, 5: 19; most in one document: 95). Raw JSON editions (1 259): 2 570 candidates,
  **2 004 headings in 250 documents** (headings 56 085 → 58 089). The rest are list items («2.2 ФЛ …;»),
  doses, ICD codes, recommendations, TOC lines.
- **Rule** (`numbered-headings.ts` / `localmed_ingest/numbered_headings.py`, one shared case file
  `numbered-headings.cases.json`, 0 mismatches over the 4 194 real lines): ≥ 2 number components
  (1–2 digits, no leading zero), capital letter next, not ending in `;`/`,`, no dot leaders / page
  number / `____`, no second sentence, no recommendation/instruction phrasing (verbs, infinitive,
  «Для/При …» clauses), ≤ 40 words / 220 characters; question titles of patient sections allowed.
  Depth = number of components.
- **Display layer (works on published modules now).** `visibleReaderSections` (КР source types only)
  runs `promoteNumberedHeadingSections`: the heading paragraph becomes a reader section (outline
  entry, heading element with the sticky-heading stack, find unit, copyable link, section path) and
  the text after it moves in. Stored data and ids are untouched: existing sections keep id/anchor,
  a chunk without a heading is the same object, a chunk cut at a heading gives its id and anchor to
  the first piece that has text; derived ids/anchors are `<chunk id>~<n>` and `<chunk anchor>~h<n>`.
  129 documents / 1 184 sections added over 30 886; no id collisions, text preserved (checked on all
  774 modules). The wording is never changed.
- **Ingest layer (needs a module rebuild).** `clinical_json_import` reads a matching `<p>` as a
  heading block (same text and block id, `promotedFrom: numbered-paragraph`, `promotedHeadings` in the
  extraction report). Section ids are path-derived, so existing sections keep theirs, but chunks that
  move under a new sub-section get new chunk ids — same as any edition rebuild. `ExtractedSource.extractor_revision`
  (2) makes `prepare --reuse` re-extract older clinical-JSON extractions. Rebuild: the KR2 flow
  (`prepare` on the clinical JSON registry without `--reuse`, then build/compact/zstd/publish);
  NOT run or published here (done in KR3, with a further guard for headings the reader would hide). PDF-derived
  modules are not rebuilt: the display layer covers them.
- Tests: `numbered-headings.test.ts`, `numbered-heading-sections.test.ts`, `test_numbered_headings.py`,
  `test_clinical_json_numbered_headings.py`; e2e `kr-reader-structure.spec.ts` (heading + outline).

### Image preview zoom

- Cause: scroll-port zoom scaled from the content's top-left without compensating the scroll,
  the transform model scaled from the centre with an approximate pan, there was no wheel / trackpad
  or double-tap handling, and two lightboxes (user image documents, assessment images) had no zoom.
- `pinch-zoom-math.ts`: one rule — keep the content point under the cursor / pinch centroid / tapped
  point (`placeContentPoint`), clamped pan (content always covers the surface), pinch centroid
  tracking (two-finger pan), double-tap 1× ↔ 2×, wheel factors (mouse notch gentler than trackpad
  pinch, which Chromium reports as Ctrl+wheel). `use-pinch-zoom.ts` applies it in the scrollport
  model (scroll compensation, instant scroll — `html` is `scroll-behavior: smooth`) and in the
  transform model (translate + clamp), adds `wheelZoom` (`ctrl` | `always`), `doubleTapZoom`,
  `dragPan`. Image previews (`MediaViewer` for images, user image lightbox, assessment lightbox)
  use `IMAGE_ZOOM_OPTIONS`; tables keep Ctrl+wheel only so wheel and text selection still work.
  Buttons zoom around the visible centre.
- Library question: PhotoSwipe / similar were not adopted — the viewer needs scroll-port and
  in-place modes, zoom buttons and print inside the app's dialogs; a library would still need that
  glue (~45 kB) for what is ~150 lines of math here, now unit-tested. Inertia was not added.
- Tests: `pinch-zoom-math.test.ts` (22), e2e `image-zoom.spec.ts` (wheel, double click, drag-pan
  clamp, two-finger pinch + double tap via CDP). The scrollport model was checked in a DOM harness
  (wheel, double click, drag, buttons).

### Selection colour and КР highlights

- `::selection` is a green-yellow highlighter from tokens `--selection-background` / `--selection-text`
  in `global.css` (light `#bfd873` + `#292720` 9.5:1; dark `#55661f` + `#f4efd8` 5.5:1); the note
  editor and the PDF text layer use the same tokens.
- Highlights existed only for user documents (`UserDocumentHighlights`); official documents had no
  selection handling, so no popup could appear. `UserDocumentHighlights` now takes the containers it
  works in (`OFFICIAL_DOCUMENT_HIGHLIGHT_CONTAINERS` = a КР text chunk, `id` = chunk anchor), saves a
  selection across chunks as one mark per chunk, checks a stored mark against its quote before
  painting (`verifyQuote`), and `OfficialDocumentReader` mounts it for clinical recommendations.
  Same IndexedDB store, colours and removal-by-tap as user documents. Marks are anchored to the
  rendered chunk (anchor + character offsets + quote); a mark whose text moved (reading rule or a new
  edition) was hidden, not repainted over other words; since 2026-10-13 it is re-anchored by its
  text-quote selector (see «Highlights across editions», R1a). Still only КР among official documents
  (other ones get the dictionary lookup only, see «Reader dictionary on selection»).
- Popup placement (`highlight-popup-placement.ts`): mouse — above the selection as before; touch
  (`pointer: coarse`) — below the selection past the drag handles (the system menu opens above it),
  docked above the bottom navigation when there is no room below.
- Tests: `highlight-popup-placement.test.ts`; e2e `kr-reader-structure.spec.ts` (highlight, cross-chunk
  marks, reload, remove, 390 px touch placement + dock); `user-reader.spec.ts` highlight test still passes.
- **Not verified:** the real Android system selection menu (positions, drag handles, whether the
  WebView's menu ever covers the popup below the selection) — emulated touch only.

Merge follow-up (2026-10-07, coordinator): the promoted headings exposed two older reader faults,
both fixed. (1) `visibleReaderSections` dropped every section without its own text, so chapters
(«1. Краткая информация», «3. Лечение», «7. …») vanished and their subsections nested under the
section before; a text-less section now stays when a deeper section under it has text. (2)
`content-visibility: auto` on nested sections let an off-screen chapter collapse to its 420px
estimate while its subsections kept stale boxes: TOC jumps into it settled on a stale box showing
another chapter, and the outline marked the wrong entry. Sections holding subsections now carry
`.document-overlay-section--container` (rendered as a whole); the scroll spy skips sections the
browser is not rendering; `reader-find-jumps.spec.ts` asserts the landed heading is rendered.

Open: the КР modules are not rebuilt with the ingest-side heading rule (owner decision); the
small-caps section path above each promoted sub-heading is shown as for any section.

## Reader back, positions and layout (UX12) — 2026-10-07

QA pass 2026-10-07 (Playwright, Chromium, 390×844 touch and 1280×800, КР «Острая ишемия конечностей»
`kr.rf.1006_1`), seven items on the official-document reader. Branch `worktree-agent-a2a990fb340f25309`
(not merged, not pushed).

### A–C. Opening, back and positions

- **A. A document opened from a link started at scrollY ≈ 78.** The page (window) scrolls, and the
  host kept the scroll of the document before it; the short loading page of the new document clamped
  it to ~78 px, and nothing reset it (the reader's «scroll to top» branch scrolled
  `.document-overlay-paper`, which does not scroll). `DocumentPageHost.syncFromLocation` now scrolls
  the window to 0 when the route's document changes; the reader's no-anchor branch also resets the
  window.
- **B. Back did not restore the place.** The reading position is the section under the reading line
  (the scroll spy's active section id) plus the pixels past its aligned start
  (`readerOffsetWithin`, `document-reader-scroll.ts`), saved on the history entry
  (`history.state.minimedEntry.position`; `state/history-entries.ts`) — not the raw scroll offset,
  because sections mount lazily and off-screen ones are only estimated (`content-visibility`). The
  reader writes it debounced (500 ms) while the user scrolls, and synchronously before any tap or key
  (capture-phase `click` / `keydown`, `pagehide`, `visibilitychange`, `openDocumentOverlay`), so the
  place at the moment of the tap is what is stored. On back / forward / reload the reader mounts the
  sections up to the anchor and restores with `jumpReaderTo(…, { align: 'start', offset })` (new
  `offset` option), which re-measures until the place stands still; tracking starts only after the
  restore settled or the user took over, so the restore's own scroll events never overwrite the saved
  place. A late write for a document that has been left is dropped (entry id check). Measured on
  КР 1006_1: the section and the offset into it return to ±4 px (raw scrollY may differ by tens of
  pixels, as the sections above the reading line are estimated again until they render).
- **C. The app's own back pushed history** (`navigateDocumentReaderBack` called
  `onNavigate(previous.href)` → `window.location.hash = href`): after open → app back, `history.length`
  grew 5 → 7 → 9 and a system back led to the document just left. Every entry the app visits is now
  stamped in `history.state` with an id and a depth (the number of app entries below it that this page
  load has seen; a push raises `history.length` and arrives unstamped, a traversal lands on a stamped
  entry; an unclassifiable arrival gets depth 0). `navigateDocumentReaderBack` does `history.back()`
  when depth > 0 and only otherwise (deep link, reload of an old entry) replaces the entry with the
  previous document / the trail origin (`replaceLocationHash`, now exported). A crumb tap that leads to
  the same place does the same. The trail follows the address: a system back/forward cuts or extends
  the breadcrumbs (`syncTrail`), so after back the header shows the previous document's crumbs.
- **Found on the way:** `DocumentPageHost` rendered its readers inside
  `<Show when={route()}>{(activeRoute) => { const parsed = activeRoute(); … }}`, a non-keyed callback that
  runs once, so the `keyed` `<Show>`s inside it never re-keyed: **one reader instance served every
  document** (its find, section and scroll state carried over). The keys now follow the route
  (`officialDocumentId()` / `userDocumentId()`); a different document is a new reader.
- Tests: unit `history-entries.test.ts` (stamps, depth through pushes/back steps, late writes,
  flushers), `document-reader-chrome.test.ts` (back = `history.back()` vs replace); e2e
  `reader-back-position.spec.ts` (phone + desktop: search → A → link → B → app back → A → app back →
  search, history length constant, B at scrollY 0, A's place restored, system back after it;
  `page.goBack()`/`goForward()` sequence with crumbs and places; a fresh-load deep link goes to its
  origin by replacing). Before the fix (same flow): B opened at y = 78, A came back at y = 78, history
  length 3 → 4 → 5 → 6.
- **Not verified:** the Android system back (gesture / button) on a device — `nativeBackAction` calls
  `history.back()` on a document route, which is the same history shape as tested; back from a
  document opened inside a Capacitor WebView session that was restored by the OS; the position of
  personal files (`UserDocumentReader`: only the scroll reset and the back behaviour changed; PDF/EPUB
  keep their own resume).

### D. Contents column and the bottom bar

At 761–~1000 px the reader uses the desktop column layout and the floating bottom bar (centred, fixed)
reaches over the contents column (768 px: «Сведения об источнике» ended 17 px below the bar's top).
`--bottom-nav-clearance` (`mobile-shell.css`, 4.75 rem + the bottom safe inset) is now free at the end
of `.document-overlay-outline--open` (`doctor-ux.css`), so the list and the footer scroll clear of it.
`reader-layout-preview.spec.ts` hit-tests the footer and the list end at 768×1024, 800×1000, 844×390,
1024×768 and 1280×800; with the old CSS the 768 case fails (footer bottom 977 > bar top 960).

### E. Image previews

- User image lightbox: the dialog had no definite height, the picture was sized to the window
  (`92dvh`, `92vw`) and centred, so it ran under the title bar and past the bottom edge (1280×800: the
  picture spanned y 67–803 over a body of 88–783; wide pictures were also clipped 32 px at the right).
  The dialog now has a definite height, its body is a size container, and the picture is
  `max-width: 100cqw; max-height: 100cqh` (window-based fallback outside `@supports (width: 1cqw)`).
- The reader's `MediaViewer`: the `<figure>` kept the UA margins (16 px top, 40 px left/right) and the
  caption took room from the picture; margins are 0, the panel's content box is a size container, the
  picture is fitted to it minus a reserved caption row (long captions scroll inside it).
- Reference illustrations (`.document-reference-image`, in `DocumentText` and the pointer page) were
  not openable. They now open in the same zoomable preview (`PreviewableImage` in
  `document-rich-block.tsx`: wheel / double tap / pinch / buttons; no print for them).
- Tests: `reader-layout-preview.spec.ts` — the lightbox and the `MediaViewer` stay inside the title bar
  and the free area at 1280×800, 390×844, 844×390 (tall and wide pictures); a reference illustration
  opens, zooms and closes (the mirror is answered from the local copy of the assets; skipped when
  they are absent).

### F. Term preview card

`ClampedDefinition` (`DocumentText.tsx`): four lines with a fade, «Показать полностью» / «Свернуть»
inside the card (overflow measured with the clamp on); «Открыть» stays in the sticky header at the top
of the card. «Парадоксальная эмболия» (698 characters): card 581 → ~240 px at 390×844.
`reader-layout-preview.spec.ts` checks the height, the four-line clamp, the expand, «Открыть» at the
top after scrolling the expanded card.

### G. First render of a long document

Profile (CDP `Profiler`, 500 µs sampling; КР 1006_1, 86 sections, 390×844): the first long task
(396 ms at 1×) was ~230 ms link matching — `buildDocumentLinkPhrases` + `createDocumentLinkMatcher`
over the ~20 000 catalog entries, **rebuilt for every document opened** because the document's own
family was excluded at build time — plus ~110 ms rendering the first sections. `documentLinkMatcherFor`
builds one matcher per document list (WeakMap on the core's cached listing); the reader's own family is
excluded by `matcher.excluding(…)` (same results as a rebuild, unit-tested). The build is time-sliced
(`prepareDocumentLinkMatcher`, 8 ms slices) and started in idle time 2 s after the search home has the
list (`document-link-prewarm.ts`), so the first document opened finds it ready.

| longest main-thread task while opening | 1× CPU | 4× CPU |
| --- | --- | --- |
| before (matcher rebuilt per document) | 396 ms | 1826 ms |
| after, matcher ready (idle prewarm done, or a second document) | 56–65 ms | 263–280 ms |
| after, opened right after load, before the prewarm finished (built once, synchronously) | 174 ms | 903 ms |

Idle-batch tasks after the first (the remaining sections mounting in batches of 3) are unchanged:
50–70 ms at 1×, 60–160 ms at 4×. Not changed: the section batches themselves, the find index, rich-block
resolution (not measured as a cost). Not verified on a phone.

### Checks

`bun run check`: one error that exists on `main` (`document-reader-chrome.tsx` import order), no new
ones; `bun run typecheck` clean; `bunx vitest run`: 470 files / 8 985 tests pass (one run showed the
timing-only flake `knowledge-graph … keeps every circle one gap clear` under load; it passed on re-run);
`bun run build:app` ok. Playwright (Chromium, `--workers=2`, `E2E_PORT=4198`, local clinical-module
copy): `reader-navigation`, `reader-find-jumps`, `reader-lookups`, `kr-reader-structure`, `image-zoom`,
`reader-loading-layout`, `native-chrome`, `reader-back-position` (5), `reader-layout-preview` (16),
plus `document-core-wait`, `module-pointer`, `notification-open`, `reader-actions`, `user-reader`,
`user-library-reader-fixes`, `ux-feedback`, `ecg-close`, `pdf-viewer`, `search-ui-revision`,
`icd11-module`, `drug-*`, `medication-safety`, `settings-list`, `item-bookmarks`, `search`: all pass
except `search.spec.ts › toggles the document outline on desktop…` (strict-mode violation: the UX11a
«12 / 48» counter pills now also match `/\d+\s*\/\s*\d+/` in `.document-overlay`; not touched by
these changes, its locator needs a more specific selector) and one run of `reader-lookups › search source context…` that timed out under two
workers and passed alone and 3/3 on repeat.

## Reader chrome and navigation (UX11a) — 2026-10-07

Owner feedback on the document reader (official documents and personal Markdown/text files).

- **Name while opening.** A document opens under its own name: the crumb and the pending title come from
  `features/library/document-title-hints.ts` — the document lists and search-result group headings the
  core has already returned (remembered in `WorkerSearchMedicalCore`, by reference), a title the opener
  passes (`openDocumentOverlay(id, anchor, { title })`) or the module-catalog member title. Only a
  document nobody has named yet shows «Открываем документ».
- **Opening is not a history entry.** A module pointer that stands in for its installed document used to
  redirect with a pushed entry, so back landed on the pointer, which redirected forward again.
  `openDocumentOverlay(…, { replace: true })` now takes the pointer's entry (`history.replaceState` plus a
  synthetic `hashchange`, which `replaceState` does not raise); used by the host's pointer redirect and by
  the post-install open. Unit tests: `document-navigation.test.ts`; e2e: `reader-navigation.spec.ts`
  (history length +1, back leaves the reader). The Android system back (`window.history.back()` on a
  document route) is covered by the same history shape; it was not run on a device.
- **One crumb per document.** `state/document-identity.ts` maps a pointer id
  (`core.catalog.pointer.<kind>.<target id>-<16 hex>`, true for all 20 002 bundled pointers) to its
  target; `appendDocumentCrumb` and the header crumbs (`documentTrailBreadcrumbItems`) keep one crumb per
  document identity (pointer, summary, `.full` text and revisions of one work), the latest — the full
  variant — winning. Trails saved by older builds are deduplicated on display.
- **Position counter «12 / 48».** A reflowed document has no pages, so a *page is one entry of the contents
  list* (the sections the outline numbers «01», «02», …): the total is known before the sections render,
  equals the outline's length, and every number is reachable with the outline's own jump. Pure helpers in
  `document-reader-position.ts`; the pill (`ReaderPositionCounter`, tabular-nums) sits at the end of the
  breadcrumb column of the header and in a «Раздел» row at the top of the contents list (phone drawer and
  desktop column). A tap opens a Kobalte popover with a digits-only field and «Перейти» (a number beyond the
  ends goes to the nearest end); a second tap closes it. The jump holds the reader chrome
  (`holdReaderChrome`). Official documents and Markdown/text personal files have it; PDF (own page box),
  EPUB, sheets and medical images do not. The current number follows the scroll spy, so it moves only
  between sections that are mounted; the jump relies on the same `chrome.scrollTo` as the outline, whose
  reach into not-yet-mounted sections is tracked separately (scroll-to-section reliability).
- **«⋯» toggles.** The button sits inside Kobalte's context-menu trigger, so a press is not an outside press
  and the open menu stayed open; the click then dispatched another synthetic `contextmenu`, which only
  moved it. `requestContextMenu` closes the menu when the trigger is `data-expanded` (all «⋯»/discover
  buttons built on `AppContextMenu`).
- **Drawer above the bottom bar.** `.app-shell` is an isolated stacking context at level 0 and the bar
  (z 70) is its sibling, so no z-index inside the reader could lift the drawer above it; the earlier fix
  (3a6c64dc) only slid the bar away. While the drawer is open the shell rises to
  `--z-reader-shell-open` (75: above the bar, below dialogs and toasts), and the `reader-outline-open`
  root class outlives the drawer's slide-out so the bar does not reappear over the closing drawer.
- **Tests:** unit — `document-identity`, `document-trail`, `document-navigation`, `document-title-hints`,
  `document-reader-position`, `app-breadcrumb-items`; e2e — `reader-navigation.spec.ts` (clinical module
  from the local release copy; skips when it is absent).

## Reader find and section jumps (UX11b) — 2026-10-07

Owner feedback on the official-document reader (КР guidelines and the other `OfficialDocumentReader`
documents): find reported more matches than stepping could reach, a far TOC heading needed several
taps, and the find counter shifted the typed text.

- **Nested sections were never rendered.** The reader mounts sections in idle batches and nests them
  through a cached tree whose nodes keep their identity; a node's `children` array is replaced on every
  rebuild but the inner `<For>` read it once. Sections nested under an already-mounted section that
  arrived in a later batch never reached the DOM (63 sections in the model, 17 in the page after
  mounting finished), so find counted text that was not on screen and the TOC listed headings that did
  not exist. The list now reads the tree memo (`OfficialDocumentReader.tsx`, «children» `<For>`).
- **Jumps are one measured, self-correcting scroll.** `features/library/document-reader-scroll.ts`
  (`jumpReaderTo`) replaces the single `scrollIntoView` of TOC taps (`useDocumentReaderChrome.scrollTo`)
  and of find next / previous. Cause of the multi-tap TOC: `.document-overlay-section` carries
  `content-visibility: auto; contain-intrinsic-size: auto 420px` (`styles/user-library.css`), so every
  off-screen section is estimated at 420 px until it renders and the page height changes under a jump
  (and desktop used a smooth animation that chased the moving target). The jump scrolls instantly,
  re-measures every frame, corrects the remainder and ends after the target stood still for 4 frames
  (max 2.5 s); wheel, touch, key and pointer input cancel it. TOC jumps align the heading to its
  `scroll-margin-top` (below the sticky headings); find centres the highlighted word between the chrome
  and the bottom navigation and also reveals it sideways inside a wide table. Both hold the reader
  controls (`holdReaderChrome`) so the find bar stays on screen while stepping on a phone. The scroll
  spy's reading line is never above the sections' scroll margin (`computeReadingLine(rect, minimum)`),
  so the tapped heading is the active one in the outline.
- **Find counts only what the page shows.** `features/library/document-text-search.ts` is the single
  source of a text chunk's searchable text and of `DocumentText`'s highlight offsets; image blocks
  (whose alt text is never displayed) contribute nothing. Table cells and image captions of a chunk now
  carry the host's match class, so the active match in a table is marked (`--current`).
- **Find bar (item 12).** The counter is in the right end of the field (`SearchField` got a `trailing`
  slot) in a slot of fixed width (`.document-find__status`, `5.5em`, `tabular-nums`) so the text does not
  move; while searching the slot shows `components/AsciiSpinner.tsx` (`| / – \`, ~110 ms per frame, timed
  by `motionMs`; an ellipsis when Animations are off or `prefers-reduced-motion`).
- **Tests.** Unit: `document-reader-scroll.test.ts`, `document-text-search.test.ts`, `computeReadingLine`
  minimum in `document-reader-outline.test.ts`. e2e `reader-find-jumps.spec.ts` on «Острая ишемия
  конечностей» (63 sections, tables; needs the local module copy like `reader-loading-layout.spec.ts`):
  stepping through find matches at 390 px (first, last through unmounted sections, 36 consecutive, a
  complete short query) with the active match highlighted and between chrome and bottom navigation;
  highlighted words equal the reported count and the DOM holds every outline section; six far headings
  reached with one tap at 390 and 1280 px and active; counter inside the field at a fixed width, spinner
  cycling and standing still under reduced motion.
- **Not changed / known.** `UserDocumentReader` (personal files) still scrolls find matches with a single
  `scrollIntoView`, and in a quick check a long `.md` file showed no `.document-overlay-match--current`
  after find next (the markdown path appears to draw no `mark` elements), so find there may count
  matches it does not highlight — not investigated, separate task. The initial
  `initialAnchor` scroll of `OfficialDocumentReader` is unchanged. Not verified on phone hardware or
  with slow devices.

## Children's vaccination calendar (VAC2) — 2026-10-07

> Superseded on 2026-10-08 by the UX13 calendar page (see «Owner UI batch» above); the data notes still apply.

Owner request: polish the children's calendar page, make each child a patient record, and print a landscape
«для мамы — личный дневник прививок» sheet shaped like the official chart.

- **Page.** Back and «Печать» share the header row (`Page` `navigation`); the four sections are an even
  two-by-two grid on a phone (`SegmentedControl` got `stretch`); «План ребёнка» rows are compact (date, status,
  dose chips coloured by band, order conditions). Checked at 390 and 1280 px.
- **Child = patient card.** «План ребёнка» starts with «Пациент» (default) / «Только расчёт».
  - Patient: the card field of the calculators (`PatientCaseCombobox`, unlock and «Добавить пациента» inline).
    The plan is computed from the card's birth date and name. «Прикрепить план к карточке» writes a patient
    file `vaccination-plan-<patientId>` into the vault (`vaccination-attachment.ts`: zod-validated on read,
    `{kind, schemaVersion 1, calendarId, editionLine, attachedAt, updatedAt}`); it is protected with the vault,
    removed with the card and carried by the card backup. A stale edition is flagged. A card without a birth
    date gets the typed date written into it when the plan is attached (`setPatientBirthDate`, never
    overwrites a different stored date). No SQLite change, no migration.
  - Only calculate: a birth date (and an optional name for the sheet); nothing is stored.
- **Data (schema v2).** `bun run vaccination:prepare` now also declares, from the reviewed transcription,
  `national.chart.targets` (12 infections in chart order), `item.targets` (chart rows a vaccination covers:
  dtp → коклюш/дифтерия/столбняк …), `item.band` (`all` / `risk` / `catch-up`), `row.ageSpan` (category rows
  16–19: the age from which they apply, open to adulthood) and `item.product` (ИПВ/ОПВ of paragraph 12 of
  Appendix 3, with the risk-group variant). The printed wording is unchanged; the contract checks references.
  The preparer was run against the raw PDFs/OCR of the main checkout (`--dir`).
- **Chart + diary.** `vaccination-chart.ts` builds infections × ages from the data only (columns = age rows:
  24 ч, 3–7 дн., 1…20 мес., 6, 6–7, 14 лет, взрослые; no vaccine named in code). `vaccination-diary.ts` adds
  the child and the planned date of each column; `vaccination-diary-print.ts` renders one A4 landscape page
  (`@page`), green = всем, orange = группы риска, blue = ранее не привитым (with * for risk groups), V/RV
  legend, ИПВ/ОПВ legend, the title and edition cited from the data (приказ 1122н в ред. 677н, приложение № 1),
  the printed date. Printed through the shared `PrintManager`; the preview dialog is generic over the document.
- **Not in the sheet, on purpose.** The order has no columns for 7, 12 and 15–17 years or an АДС-м product
  name; the sheet follows the data (no invented columns or products). The order names no dates: the planned
  dates are calculated from the printed ages (window and ≈ marked), the sheet says so.
- **Tests.** vitest: chart (7), diary model and print (7), child (6), attachment (4), patient-domain
  `setPatientBirthDate` (3), contract (+2), Python (+3). Playwright `vaccination-plan.spec.ts` (3: card
  attach/reload/print one page A4 landscape PDF; calculate-only stores nothing; layout at 390 and 1280) and
  `vaccination-calendar.spec.ts` (updated).
- **Not verified.** A real printer and Android WebView print (the sheet uses 6–7.5 pt text and was checked
  only as Chromium PDF, 1 page, ~10 % spare height); clinical correctness (unchanged, no clinician review);
  the unlock flow on native (Keychain) devices; a diary row for patients who changed edition (only flagged).

Flu colour (owner 2026-10-07): order item 19 names «Дети с 6 месяцев» first and without a
condition, so children's influenza is «всем» (green) from 6 months to 17 years and adults stay
«группы риска». Declared in the data as `bandSpans` on the item (preparer table
`CATEGORY_BAND_SPANS`, contract `NationalItemSchema.bandSpans`); the chart, the diary sheet and the
plan read the band at the age (`itemBandAt`).

## Drug link summary, saved search results, update hint, «Лента» sources — 2026-10-07 (STATE UX10)

Owner screenshots 2026-10-07.

### Drug link card in texts

- A drug name in a text (КР, search context) opens a **short card**: substance (or trade name with
  its substance), the registry's pharmacotherapeutic group (one line; a group that only repeats the
  start of a longer one is dropped), ATC code with the NSI level-4 name, trade names (five, «и ещё
  N»), and — when an instruction module of the substance is installed — one quoted line «Действие:»
  (the instruction's «Фармакодинамика» / «Фармакологические свойства», else «Показания:»; the first
  sentences up to 240 characters, cut at a sentence or word boundary, never paraphrased), then a
  short source line «ЕСКЛП, 28.08.2026 · инструкция». «Открыть» opens the drug card. The previous
  card listed ЕСКЛП codes and a «Открыть фрагмент источника» per dosage form; both are gone.
- Why the codes showed: the link of a not-installed substance points at its core pointer, whose
  lines are «<СМНН code> — form — strength / ТН: …». The card now reads the full ЕСКЛП card behind
  a pointer when its module is installed, else the pointer's «ТН:» lines plus the lazy
  drug-comparison index (`cards`: groups, ATC; `documents`: trade names and the instructions to try)
  and the NSI ATC names — both chunks are shared with their tools and load on the first card only.
- Code: `features/library/medication-link-preview.ts` (pure model + loader, tests),
  `components/DocumentText.tsx` (`MedicationLinkSummaryBody`), CSS `.medication-link-summary*` in
  `styles/doctor-ux.css`. The inline preview card now stands above the search source overlay
  (`--z-inline-preview: 540`); before, in the search context it opened behind the overlay.

### Saved search results

- Every finished search is kept on the device (`state/search-result-cache.ts`, IndexedDB
  `minimed-search-results`, newest 40, evicted through a `savedAt` index; an in-memory layer for the
  session). Key: scope, specialty, filters and the normalised query text.
- Asking a saved query again — typed, submitted, from the history drawer or after the app restarted
  — shows its list at once (no skeleton) with a quiet line «Сохранённые результаты · 12 мин назад ·
  Повторить поиск». A **fresh** copy (same app version and content revision, younger than a day)
  is not searched again; «Повторить поиск» re-runs it and applies the result at once. A **stale**
  copy is still shown at once and the search re-runs behind it with the existing «Есть новые
  результаты» offer (UX9), so the list never changes under the reader's finger.
- The content revision (localStorage `minimed.search.content-revision.v1`) moves on every
  `notifyContentChanged()` (module install/removal, core swap) and on installing/removing the
  semantic model. Clearing the search history clears the saved results too. Query text is stored like
  the history and never logged.
- Tests: unit `search-result-cache.test.ts`, `search-refresh.test.ts` (age wording); e2e
  `search.spec.ts` «a replayed or repeated query shows its saved results at once, and can search
  again» (history replay without re-run or skeleton, «Повторить поиск», survives a reload).

### App update hint

- The «Доступно обновление» pill left the search header. Since 2026-10-19 an available update is
  only the dot on the «Настройки» tab (the hint above it and `state/ignored-app-updates.ts` were
  removed). e2e: `ux8-search-header.spec.ts` (header row has two buttons, the dot shows).

### «Лента»: suggestions first, item pictures, PubMed search (ADR-0024 amended)

Owner request: adding your own feed is too prominent; show what can be added; real articles with
pictures; PubMed search. Code in `apps/app/src/features/news/`, CSS `styles/news.css`.

- **«+» instead of a banner.** The big «Добавить источник» card on the empty view is gone. Adding an
  address of one's own is a small round «+» (`aria-label` «Добавить источник», `data-testid=
  news-add-entry`) in the «Лента» header, beside refresh / PubMed search / «Источники» (all four
  header buttons are now round, 2.5 rem), and a link on «Источники». The add page itself is unchanged
  (its suggestions are now the compact rail).
- **Suggestions are the first view.** `NewsSuggestedFeeds` has two variants: `cards` (empty «Лента»
  or only websites: grouped Россия / Международные, each card = tile + title + language + description
  + topic + «С картинками» + one-tap «Подписаться») and `compact` (a one-row swipeable rail «Ещё
  источники» of the sources not yet subscribed to, under the list and on the add page). No request is
  made to show them: logos are **bundled monogram tiles** (`NewsSourceTile`: coloured tile with a
  1–4 character `mark`, HSL `hue`, topic `glyph` from an allow-list), declared per source in
  `suggested-feeds.json` (`topic`, `visual {mark, hue, glyph}`, `carriesImages`; validated by
  `isSuggestedFeed`; no logo files, no favicons, tested). The «Источники» rows reuse the tile for
  suggested sources. A «Поиск в PubMed» card sits above the suggestions on the empty view.
- **Pictures.** `NewsItem.imageUrl` was already parsed; now also Atom `<link rel="enclosure">`,
  `media:content`/`enclosure` without a declared type (image extension decides), JSON Feed
  `attachments` images (plus the existing `media:thumbnail`, `media:content`, `enclosure`, JSON
  `image`/`banner_image`, first `<img>` of the sanitized text). https only. List row: fixed 4.5 rem
  square thumbnail; article: 16:9 hero box (`aspect-ratio`, lazy, `no-referrer`); both only when the
  source's «Изображения» switch is on. From an article of a source with it off, a one-line button
  turns it on. **Default:** off, except suggested sources whose feeds were measured on 2026-10-07 to
  carry a picture on every item (`carriesImages`: Фармвестник, ДокторПитер, MedPage Today, STAT,
  Medical Xpress), which are subscribed with it on; sources added by address start off.
- **PubMed** (`#/news/pubmed`; `pubmed.ts` pure builders/validators, `pubmed-client.ts` transport +
  rate limit, `NewsPubmedPage.tsx`). User-initiated: a one-line notice «Текст запроса отправляется в
  NCBI (PubMed) — только когда вы нажимаете «Найти»» is shown before the first search; nothing is sent
  until then. `esearch` (no `sort`: `sort=date` is not an E-utilities value and is ignored, the default
  order is newest-added first; measured live) then `esummary`, `tool=minimed`, through `FeedTransport`
  (CapacitorHttp on Android), JSON validated at the boundary, one shared spacer at 400 ms
  (≤ 2.5 requests/s). Results: title, journal · date, first three authors, external link to
  `https://pubmed.ncbi.nlm.nih.gov/<pmid>/` (PubMed refuses framing; no abstract in `esummary`).
  «Подписаться на этот поиск» saves a `kind: 'pubmed'` subscription (`query`, `url` = PubMed web page
  of the search) in the same localStorage list; it refreshes with the other sources, items are dated
  by PubMed entry date, kept 365 days (feeds 30), unread window on first fetch 14 days (feeds 3), and
  counted in the tab badge. Excluded from OPML export. Query text is never logged.
- Tests: unit (`feed-parser` image extraction, `pubmed`, `pubmed-client` incl. spacer, `news-service`
  PubMed + images default, `news-storage` kind/query/badge, `suggested-feeds` data, `opml`, routes);
  e2e `news-feed.spec.ts` (18 cases; «+» entry, tiles without images and no request, images default
  for suggested, thumbnail/hero boxes, compact rail, PubMed search → save → refresh with stubbed
  eutils and spacing, empty/unreachable PubMed).
- Not verified: Android device (`CapacitorHttp` against the real feeds and NCBI, system-browser
  hand-off of the PubMed link), real feeds in the app (parser run against the 14 suggested feeds with
  `bun` on 2026-10-07 only to measure pictures; `who-news-ru` and `nejm-current` failed TLS
  verification from that shell, their pictures were checked with `curl -k`), abstracts/MeSH/NCBI key
  (ADR-0020 items 2–3, still open).

Not verified on a phone: the drug card with installed instruction modules on Android, the saved
results after a WebView kill on Android, the update hint next to the HyperOS gesture bar.

## Search fixes from the QA pass — 2026-10-07 (STATE QA2)

- The source overlay names the kind of document it shows (drug, МКБ card, reference, law,
  recommendation) instead of always «В клинических рекомендациях», and shows catalogue cards in
  reader words (no storage note, identifiers, raw addresses or empty fields).
- Short abbreviations («АГ», «ОКС», «ХСН») match tools only at the start of a word, so scales that
  merely contain the letters no longer lead the list.
- No ghost index numeral under a download chip; «Примеры поиска» at readable contrast; the app links
  (GitHub, APK, version) moved from the history drawer to the «?» help sheet.
- A drug pointer's «Указатель препарата» is cleaned (no storage note) but keeps its place: it carries
  the МНН.

## Reader and library fixes from the QA pass — 2026-10-07 (STATE QA1)

- Reader header: the breadcrumb no longer repeats the H1 title; a long last crumb ends with «…».
  Escape closes the phone outline drawer, and the bottom navigation steps out of its way.
- Library ingest: files are read one at a time (one serial queue; previews too), and a read that
  reports no progress for 60 s (scaled by size, at most 300 s) is abandoned and marked failed with a
  reason and «Повторить» in the card menu, instead of «Читаем файл…» forever (QA saw a hang and a tab
  crash with a 400-page PDF and a 5.5 MB EPUB added together).
- Books are named by their own `dc:title` (and author) once read, unless renamed; the file name stays
  visible. EPUB chapters follow the app theme (dark page and text in the dark theme). Card status wraps
  to two lines on a phone and names the file format.
- EPUB highlight popup (EPUB-POP): the continuous view scrolls the page by itself while it renders
  neighbouring chapters, which used to close or rebuild a just-opened popup (seen on a busy CPU).
  Only a scroll the reader starts (wheel, touch move, scroll keys) closes it now; otherwise it follows
  its text via the CFI range and closes when the text leaves the screen (`epub-popup-anchor.ts`).
  `user-reader.spec.ts` covers both; 12/12 at 6× CPU throttling (the old build failed there).

## Faster lexical search — 2026-10-07 (STATE PERF2)

QA 2026-10-07: some lookups took 7–13 s in the browser build (0.2–0.8 s natively). Cause: packs of
migration 010 index chunks through an external-content view, and reading `chunks_fts.document_id`
/ `chunk_id` made FTS5 materialise the whole source-view row (four joins, chunk text, JSON) for
every match. Filters now reach chunks, versions, documents and sections through the base tables by
rowid (CROSS JOIN keeps FTS as the outer loop), and a document filter of ≤64 documents is narrowed to
its chunk rowid span; older packs keep the direct columns. Same SQL in the Capacitor store.
Browser build, top-10 results identical: ОРВИ 7.1 → 0.5 s, эпилепсия 6.9 → 0.5, инсульт тромболизис
6.6 → 0.4, пневмония у детей 7.0 → 1.2, ангина у ребенка 13.4 → 1.2; `benchmark:all` output identical
apart from timings (suite 24.3 → 20.3 s). Not measured on a phone.

## Smaller APK — 2026-10-07 (STATE SIZE1)

Owner 2026-10-07: «shrink the app; bundle the core or not?». Measured on the 0.6.53 debug APK
(102 MiB): native libs 20.8, tessdata 19.6, JS 18.5, onnxruntime-web wasm 14.35, Excalidraw fonts
12.5, other wasm 3.6, dex 3.6, bundled modules 2.6 MiB.

- Done (≈13 MiB off the APK, dist −26 MiB): Excalidraw's Xiaolai CJK fonts are 312-byte glyph-less
  stubs (`excalidrawCjkFontStubs` in `vite.config.ts`) — CJK falls back to system fonts and nothing
  is fetched from esm.sh; `public/content/modules` keeps only the 11 files the preview catalog names
  (the old core-clinical build used by `tool-module-update.spec.ts` is an e2e fixture); KaTeX ships
  woff2 only (`katexWoff2Only`).
- Core: stays a download after install (76 MB gzip). Bundling it adds 76 MB to every app update
  (the app releases far more often than the core) and keeps a second copy resident; an optional
  «offline» APK beside the normal one is the way to a no-network first run if needed.
- One ONNX Runtime wasm instead of two (≈7 MiB more): the ECG worker imports `onnxruntime-web/webgpu`,
  the entry transformers.js already uses, and still runs on the `wasm` (CPU) backend; the 27 MB
  JSEP build is no longer emitted. Checked with `ecg-success-path.spec.ts` (published model, the app's
  own example photo): local segmentation and editable points as before.
- OCR language pack on demand (≈19.6 MB more): Tesseract eng + rus (tessdata 4.0.0) is no longer
  bundled. «Распознать текст» without it opens a sheet with the size and «Скачать» (nothing is fetched
  before that), progress, «Повторить» on failure, and OCR starts by itself afterwards; Settings →
  Функции ИИ has the card (Скачать / Отменить / Удалить). Files from the pinned naptha/tessdata commit
  806cd9ad (jsDelivr, then raw.githubusercontent), size + SHA-256 checked
  (`features/ocr/ocr-language-pack-catalog.ts`), stored in one IndexedDB transaction in tesseract.js's
  own cache layout (`cacheMethod: 'readOnly'`), offline from then on; a download-queue job (`ocr`).
  E2E `ocr-language-pack.spec.ts`. Not tested on an Android device. Follow-up: a project release
  mirror of the two files as the first source (needs the owner's OK to publish).
- Next, by size: on-demand wasm for ASR/e5, a lite build without the llama stack (≈7 MiB), R8 minify
  (≈2 MiB).

## «В МКБ-11» on ICD-10 cards — 2026-10-07 (STATE ICD11-MAP)

Owner 2026-10-07: specialists should see what changes in ICD-11 for a code they read (Russia still
codes in МКБ-10). WHO's own Russian ICD-11 (MMS 2026-01) is the source; no Russian ministry edition
exists (the 2024 plan was suspended), so nothing is translated by the app.

- Under the title of any card carrying ICD-10 codes (`mkbCode` / `icd10Codes`): a folded row
  «В МКБ-11: 8A6Z · Эпилепсия или эпилептические приступы, неуточнённые» (or «соответствия для N
  кодов МКБ-10» on a recommendation). Opened: per code, the targets of WHO's «одна категория» and
  «несколько категорий» tables (shown separately when they differ), postcoordination parts, the
  ICD-11 chapter, and labels derived from the rows only — одна рубрика / разделено на N рубрик /
  объединено с другими кодами МКБ-10 (reverse rows) / кластер / другая глава / таблицы ВОЗ различаются
  — plus WHO's citation and the practice note (МКБ-10 stays in force). 173 of 8 003 mapped targets
  have no Russian WHO title: the English one is shown, marked «англ., перевода ВОЗ нет».
- With the ICD-11 module installed the codes open its cards; otherwise the panel offers the module
  download (`useModuleInstaller`).
- Asset: `apps/app/src/features/icd11/icd10-icd11-map.json` (1.2 MB raw, lazy chunk), built by
  `bun run content:icd10-icd11-map` from `data/raw/icd11/2026-01` (mapping.zip + Russian tabulation,
  SHA-256 checked); logic and view rules in `icd10-icd11-map.ts`, `icd10-to-icd11-view.ts`,
  `icd10-chapters.ts` (unit tests); e2e `icd10-to-icd11.spec.ts`.
- Licence: WHO CC BY-ND 3.0 IGO for the classification; the mapping tables are shown unchanged under
  the owner's personal-use publication decision of 2026-10-06 (as the ICD-11 module).
- A dedicated МКБ-11 search section and ICD-11 code lookup: done 2026-10-15 (ICD11-SEC).

## Search and reader polish — 2026-10-07 (STATE UX9)

Owner screenshots 2026-10-06 (search «Эпилепсия», the result list, a disease card's page).
Presentation only: ranking, the core and every benchmark set are unchanged.

- **One definition preview.** Dictionary entries of one name (two term lists, a Wiktionary gloss and
  an archived name without a definition) fold into one card «**Эпилепсия** — …» above the results:
  the best-covered entry first, read from the installed dictionary (`definition-preview.ts`,
  `core.reference` status → blocks → text); without it, the definition section of a found document of
  the same name is quoted with «из «…»». «Подробнее» opens the entry, «ещё N источника/значения» the
  others, «Также в словаре» other names. Source text only, nothing reworded.
- **Nothing blocks.** A re-run of the query on screen (after an install, a core swap, a history
  replay) keeps the results usable — no dimming, no `pointer-events: none`; an identical outcome is
  applied silently, a different one waits behind a sticky «Есть новые результаты · Обновить»
  (`search-refresh.ts`). While the core opens the field takes a query (it runs once the core is
  ready), the send button is a disabled spinner, and the status is one small line at the bottom of the
  search block instead of a separate card. Readiness is `data-search-ready` on the field.
- **Plain result cards.** No second icon under the title or before the fragment, no «Карточка
  источника / Полный текст / Краткий обзор» line, no repeated section line; one section label per
  fragment. A catalogue card's technical fragments («Сведения о документе», «Сведения МКБ-10»,
  «Классификационный контекст», «Ограничение покрытия») come after its own text and read in plain
  words: «Другие названия:», no title/identifier/empty fields/storage note/copied-from address
  (`search-result-presentation.ts`, highlight ranges remapped).
- **Reader.** The same technical sections go last in small print (`isAdministrativeSection`), so a
  disease card opens on «Краткое описание». The download block is one row: «Полная версия — в наборе
  «…»» (up to two lines on a phone) and a button with the size that fills with the download's
  progress. Inline links start at their icon (a `<button>` centred wrapped text), long addresses wrap,
  and their colour is an app token (`--inline-link`, `global.css`) — the dark override used to lose to the
  lazily loaded light rule in the production bundle. The header's «Меню действий» is «⋯».
- «Сравнение препаратов» is the fourth «Полезные функции» card (with «Взаимодействие»).
- Motion tokens `--motion-*` (iOS curves, 120–260 ms, `global.css`: the theme files feed the native token generator) and the AGENTS.md «Motion» rule (owner).
- E2E: `core-identities` (one preview, «ещё 1 …»), `boot-screen`, `startup-shell`, `search`, and the
  readiness checks of 13 specs moved from «field enabled» to `data-search-ready`.

## Stable library cards — 2026-10-06 (STATE LIB-KEY)

- «Ваши документы» keeps one DOM node per card while its document is read, previewed or patched:
  documents and folders live in a Solid store reconciled by `id`, entries keep their identity
  (`features/library/user-library-entries.ts`), and `LayoutVirtualizedGrid` reuses unchanged row
  arrays (`chunkLayoutRows(…, previous)`) because virtua keys rows by reference. Keyboard focus on
  «⋯» and an open card menu survive ingest; before, every refresh rebuilt all cards (found in the
  0.6.52 release run).
- Processing state (inspection, page counts, OCR progress, processing failures) is written with
  `patchUserLibraryDocumentProcessing`, which keeps `updatedAt`: «изменён» and the time order no
  longer move a file while it is read. User edits (rename, colour, move, OCR request) still touch it.
- Inserts and new orders keep cards too (LIB-KEY2): the page uses `LayoutVirtualizedGrid
  preserveItemNodes` — fixed row slots by position, each item rendered once into a
  `display: contents` holder kept by a reference-counted `RetainedNodeCache`, a row's cell only
  hosting it — so a card pushed into the next row is moved, not rebuilt; focus that the move drops to
  the page is given back to the same element. Other grids keep the old mode (their children use the
  render index). E2E: `user-library-doc-menu.spec.ts` holds the PDF reader during ingest, and pushes
  a focused card into the next row with a new file; both check the same node stays focused.

## Discoverable item menu — 2026-10-05

- Document and folder cards in «Мои файлы» (the only list items that carry the right-click /
  long-press menu; the knowledge-base lists have none) now show a «⋯» button («Действия с документом»
  / «Действия с папкой») at the card's top-right corner (`-0.25rem`), via `AppContextMenu`
  `discoverLabel` (`.app-context-menu__discover`). It opens the same menu, anchored under the button.
  With a mouse it fades and scales in on hover of the stable card or keyboard focus (hidden, it is
  `pointer-events: none`, so it cannot feed hover flicker); on touch it is always visible but quiet
  (opacity 0.7, 1.5 rem with a larger tap area) next to the unchanged long-press. Cards themselves
  are not tab stops; the button is. E2E: `user-library-doc-menu.spec.ts`.

## Official forms — 070/у — 2026-10-05 (STATE F1)

- «Формы» (notes → forms, «Мои файлы» → «Формы», patient card → «Заполнить форму»): the first form is
  070/у «Справка для получения путёвки на санаторно-курортное лечение» of Минздрав order № 274н of
  13.05.2025 (Минюст 82433, in force 01.09.2025–01.09.2031). Plan, done list, next steps and open
  questions: [FORMS_PLAN.md](FORMS_PLAN.md).
- Source: `publication.pravo.gov.ru` eoNumber `0001202505300033`, SHA-256 `e385d12a…58a5dd3c`; the PDF is a
  scan, so the text is OCR (macOS Vision) with logged, reviewed corrections. The schema JSON
  (`apps/app/src/features/forms/schemas/ru-minzdrav-274n-070u.json`: 52 fields, 16 cited paragraphs, 89
  region codes, print layout) is generated by `tools/ingest` `localmed_ingest.medical_forms` and parsed
  by `FormSchemaSchema` (`packages/contracts`) at load; prefill bindings are declared in it.
- Trust boundaries: patient full name, address, СНИЛС, ОМС policy, workplace and the episode diagnosis
  live only in the patient vault snapshot (ADR 0015/0016); «Врач и организация» is device-local
  (`localStorage` `minimed.clinician-profile.v1`, no patient data); typed form values are in memory
  only and dropped when the vault locks; nothing is logged or sent. The print is a paper sheet for
  signature and stamp — no electronic document is issued.
- Not verified: print on a physical printer and in the Android shell (`printHtmlInNativeShell` is the
  existing path); ICD-10 codes are format-checked, not looked up in the МКБ module; the OCR-derived
  code lists were compared with the scan by eye only.

## Official forms — layout-fidelity check and thirteen forms — 2026-10-05/06 (STATE F3)

- **«Формы» now lists thirteen forms** (order of the list: the most used first): 070/у, 057/у «Направление для
  оказания медицинской помощи» (519н, from the general rule 27.10.2025), 088/у «Направление на
  медико-социальную экспертизу» (joint 488н/551н, 13 sheets, 216 fields), 107-1/у, 148-1/у-88, 148-1/у-04(л)
  (рецептурные бланки, 1094н), 003-В/у (1092н) and 071/у (395н) — **drafts**, the organisation prints its own
  (protected) stock —, 072/у, 076/у, 079/у, 025-1/у (274н) and 058/у (740н) which is **in force only from
  01.03.2027** and is shown as «Вступает в силу с 01.03.2027» (`validityLine`, from `source.effectiveFrom`).
  Orders, eoNumbers, in-force dates and field statistics: [FORMS_PLAN.md](FORMS_PLAN.md) «Done — F3». All
  sit in the registry `tools/ingest/medical-form-sources.json`, so `bun run forms:check-updates` watches
  them (seven source orders, run clean on 2026-10-05); the regional-order noise of its «possible
  replacement» search was removed (only the federal Минздрав counts).
- **Layout fidelity is measured**, `bun run forms:overlay`: the empty print of each form (Chromium PDF of
  the print HTML, at the declared paper size) is aligned with the official scan page (words by OCR boxes,
  ruled strokes by raster, sheets, paper size, whether Chromium shrank the page), images in
  `output/f3-screens/<form>/`; `bun run forms:calibrate` fits margins, font, line height and the space
  above each row from the scan into `tools/ingest/medical-form-calibration/*.json`, merged by the preparer.
  Figures of the last run are committed (`tools/ingest/medical-form-overlay-results.json`, tested): nine of
  thirteen forms are inside every tolerance (median vertical offset 0.1–0.5 mm, p90 ≤ 1.4 mm); 088/у
  (p90 4.1 mm), 025-1/у (rule recall 0.71), 071/у and 003-В/у (scan layout) carry written reasons —
  details and the before/after table in FORMS_PLAN.md. A form's print is now one layout row per printed
  line; text-only rows flow like paragraphs; blanks keep their length and share the rest of a line.
- Code: contract additions (optional; `rule`, whole-year date part, option `separators`/`range`/`joined`,
  `stretch` rows, `spaceBeforeMm`/`minHeightMm`, page `lineHeight`, `insetMm`, running-text table cells,
  `charCells`, …), prefill `format: initials`, a checkbox ticked by a mapped value, the order/validity line
  (`form-source-line.ts`), blueprints discovered by file name, registry-driven `forms:prepare`, rules from
  several appendices of one order, joint orders (issuer), a form whose order has no filling rules.
- Tests: python 1 210 (overlay metrics, calibration, per-form schema/rebuild, registry, results), vitest
  forms/contracts, Playwright `official-forms.spec.ts` (070/у, the F2 four, 057/у with prefill and
  underlined answers, the seven new forms prefilled with the printed sheet count of the official blank).
- Not verified: print on a physical printer and the Android shell; Latin/Cyrillic letters inside the scans;
  the stitched measurement of 003-В/у (an agent's scratch script, not in the repository); the filled
  print of a very long entry (it flows to another sheet).

## Official forms — the rest of order 274н, update check — 2026-10-05 (STATE F2)

- «Формы» now lists five forms of Минздрав order № 274н of 13.05.2025: 070/у, 072/у «Санаторно-курортная
  карта», 076/у «…для детей», 079/у «Медицинская справка о состоянии здоровья ребенка, направляемого в
  организацию отдыха детей и их оздоровления» and 025-1/у «Талон пациента, получающего медицинскую помощь
  в амбулаторных условиях» (landscape, both sides, with the prescription and visit-date tables). Same
  official file (eoNumber `0001202505300033`), same preparer and review method; schemas
  `apps/app/src/features/forms/schemas/ru-minzdrav-274n-{070u,072u,076u,079u,025-1u}.json`
  (`bun run forms:prepare` builds all). 025/у (the full outpatient card) is not built, on purpose; reasons
  in [FORMS_PLAN.md](FORMS_PLAN.md).
- Prefill: the existing patient, ОМС, address, diagnosis and clinician bindings, `patient.workplace` where
  a printed line needs it (025-1/у line 14), a new `patient.citizenship` (patient vault profile + editor)
  and a `words` binding that takes surname, name and patronymic of the talon from the full name.
  Schema contract extensions are generic (page break, framed block, ruled lines, table, underline
  marks); the UI still knows no form number. Two-sided blanks print the reverse side on a new sheet.
- Every cited page was reviewed against the scan (four independent reviewers plus a zoomed pass over the
  rotated talon); corrections are logged in each schema. Not verified: hyphen vs en dash in running
  text, print on a physical printer, the Android shell.
- `bun run forms:check-updates` (local; `--rebuild`, `--metadata-only`): compares the registry
  `tools/ingest/medical-form-sources.json` with publication.pravo.gov.ru (file SHA-256, size, pages;
  amending/repealing orders; possible replacement sets), writes `data/build/forms-update-check.json`,
  reports network failures, and on `--rebuild` re-runs OCR and the blueprints and asks for a human review
  when anything no longer matches. A step before releases (docs/RELEASES.md). A shortlist of other common
  forms with their verified orders («Candidates for the owner») is in FORMS_PLAN.md; none is built.

## Vaccination calendar of order 1122н — 2026-10-05 (STATE VAX1)

Owner request: «For 1122н — add a whole grid, printable.» The summary card of 1122н in the regulatory
pack stays a pointer; the calendars themselves are now a tool, **«Календарь прививок»**
(`#/notes/vaccination`, `apps/app/src/features/vaccination/`, CSS `styles/vaccination.css`).

- **Source and edition.** Order № 1122н of 06.12.2021 in the edition of № 677н of 12.12.2023 (in force from
  01.09.2024, valid until 01.09.2030): official scans from publication.pravo.gov.ru (eoNumbers
  `0001202112200070`, 15 pages, and `0001202401300021`, 2 pages), edition line «по приказу № 1122н в ред.
  приказа № 677н». The portal was asked on 2026-10-05 for amending orders; 677н is the only one found.
  Full record (hashes, method, rows to check): [research/vax1-transcription-2026-10-05.md](research/vax1-transcription-2026-10-05.md).
- **Data.** `apps/app/src/features/vaccination/data/ru-minzdrav-1122n.json`, generated by
  `bun run vaccination:prepare` (`tools/ingest/src/localmed_ingest/vaccination_calendar.py`, reviewed
  transcription `vaccination_calendar_1122n.py`; contract `packages/contracts/src/vaccination-calendar.ts`).
  Appendix 1: 19 rows (15 by age, 29 vaccinations; 4 by category), Appendix 2: 24 rows, Appendix 3: 15
  paragraphs with 3 footnotes. The scans have no text layer and tables do not survive OCR as cells, so the
  cells were read from the scan and every word is checked against the OCR of the cited pages (100 % but two
  words, both read from the scan). Each row cites its PDF page; the screen link «Проверить по источнику»
  opens the official PDF at that page. Row 24 of Appendix 2 is the 677н text, the original is kept as the
  previous edition. Raw PDFs and OCR stay in git-ignored `data/raw/vaccination-calendar/`.
  `bun run vaccination:check-updates` asks the portal for new orders.
- **Screen.** Sections «Национальный», «План ребёнка», «Эпидемические показания», «Порядок». Wide screens:
  real tables with sticky headers (the three printed columns plus a source column); phones: one card per
  row with the vaccinations in an expandable body, «Развернуть все строки». Filters: «Все / Дети /
  Взрослые» (declared per row), an age (keeps its row and every category row), a search over Appendix 2,
  reset. «Сводка по возрасту» regroups the 29 vaccinations by infection (V1, RV1 …; marked as compiled,
  not the text of the order). The screen says that a clinician has not checked the transcription.
- **Print.** «Печать» opens a preview and prints the whole document on A4 landscape through the shared
  `PrintManager`: the three appendices as in the order (columns, footnotes, PDF page per row), the compiled
  summary, the edition line repeated in every table head, the source links and the «not checked by a
  clinician» line. Checked with Chromium's PDF output (`emulateMedia('print')`).
- **Plan from a birth date** (small slice): dates for the age rows computed from the printed ages, with the
  conventions stated on screen (day of life 1 = day of birth, 4,5 months = 4 months and 15 days, window
  6–7 лет), the related paragraphs of Appendix 3 beside each vaccination; no stored birth date, none in the
  address, no knowledge of vaccinations already given.
- **Reachable from** «Все инструменты» (Справочное) and the search catalog (listed with the calculators,
  population children and adults), and by the route above. Hooks in other agents' files: one entry each in
  `SearchHome.tsx` and `searchCatalog.ts` reading `vaccination/vaccination-tool.ts`.
- **Tests.** Python 16 (`test_vaccination_calendar.py`), contracts 5, app 32 plus the route test, Playwright
  `apps/app/e2e/vaccination-calendar.spec.ts` (6: desktop table with sticky header, filters, grid, epidemic
  table; phone cards; plan; print preview and PDF pagination; «Все инструменты»; search). The tools-list
  test `experimental-reference.spec.ts` now expects «Справочное» to stay with the calendar when
  experimental modules are off (not re-run to the end here: it waits for the real core).
  Screenshots (390, 1280, print pages) in `output/vax1-screens/`.
- **Not verified.** Clinical correctness (no clinician has checked the transcription); amending orders that
  the portal title search cannot find; print on a physical printer and in the Android shell; the PDF page
  anchor (`#page=N`) in every browser or PDF viewer.

## Search loading skeleton — 2026-10-05 (STATE UX6)

- The skeleton (`SearchResultsSkeleton.tsx`, `search-results-skeleton.css`) is drawn with the real result
  group's own classes (`result-group`, header, tags row, excerpt card) and the result grid's column rule,
  so a placeholder card has the card's border, header and spacing; bars replace text, a soft highlight
  sweeps over each card (transform only, off under `prefers-reduced-motion`).
- It lives in the results slot (`.search-results-slot`), one grid cell shared with the results, and is
  shown from the first keystroke of a query (through the 500 ms debounce too) or the submit: it fades out
  in place (`createLingeringFlag`, `motionMs(180)`) while the results fade in; opacity only.
- It does not move: the home intro folds away as a fading overlay (`.search-heading--hidden` is out of
  flow, so the slot is already at its final top), and in «Клинический разбор» a placeholder analysis row
  holds the real row's place. A catalog block above the slot (tools matching the query) is real content and
  can still push it. Checked by `apps/app/e2e/search-skeleton.spec.ts` (skeleton top vs results top within
  2 px, lookup and clinical, 390/1280 px, typing and Enter).

## Download by sections — 2026-10-05 (STATE SEC1)

- «Скачать по специальности»: the tour (new step 4 of 10) and Settings → Загрузки show one shared list
  (`apps/app/src/features/sections/SectionDownloads.tsx`). A section is a clinical collection of the
  catalog (20 sections, 774 single-КР modules; titles from `catalog.categories`, a small glyph table
  for the icons). Each row reads «35 клинических рекомендаций · препараты: 3 группы · 210 МБ» (Russian
  plural forms), expands to the recommendations, the drug groups with the number of substances the
  recommendations name, and a «Формы — скоро» line without a count (forms are task F1). Several sections
  can be ticked; a drug group can be switched off per section; the total counts a shared drug group
  once and an installed package never (partial sections read «ещё N МБ», finished ones «скачано»).
- **Drug groups are derived, not listed.** `bun run content:sections:manifest`
  (`scripts/build-section-manifest.ts`, pure part in `section-manifest-source.ts`) reads the 753
  `data/build/clinical-medication-relations/<КР id>.json` files and the catalog: each recommendation's
  ЕСКЛП МНН ids are looked up in the `documentTable` rows of the ЕСКЛП modules (an ATC level-1 group
  each), and the group's ГРЛС instruction module is the one of the same group. The result is
  `section-manifest.json` (21 kB, provenance: catalog version + SHA-256, relations count + digest;
  `--check` verifies it). Every МНН named in the relations matched a ЕСКЛП module. Allmed
  (`minimed.medications.ru`) is not part of any section: it has no per-drug membership in the catalog;
  «Скачать препараты целиком» still covers it.
- Downloads go through `useModuleInstaller` (shared with `useDrugDownload`, which now sits on top of
  it): the module runtime, so tasks appear in the shared queue; the full-set drug button is unchanged.
- Sizes of the sections today: 85 МБ (офтальмология) … 350 МБ (гематология и онкология), mostly ГРЛС
  instructions; all drug packages together are ~350 МБ. Not measured on a phone; the real download could not be
  completed in the dev browser (the dev server's release proxy answered 502), so the queue path was
  checked up to the retrying task. Unit tests: `features/sections/*.test.ts`; e2e:
  `section-downloads.spec.ts` and the updated `onboarding.spec.ts` (10 steps).

## Semantic search over clinical recommendations — 2026-10-05 (STATE E2)

- Optional on-device e5-small (`Xenova/multilingual-e5-small` q8, 129 MB, pinned revision and
  SHA-256 per file) from Settings → «Поиск по смыслу»; queries are embedded in a worker from
  IndexedDB only. Without it every search is lexical, as before.
- The 774 single-КР modules carry e5 passage vectors (profile `localmed.e5-small.384.int8.v1`)
  instead of the feature-hash scaffold: mirror tag `clinical-e5-2026.10.05`, 688 MB in total
  (+31 MB). Installed modules show as updates (version suffix `.e5`).
- «Клинический разбор» and «Рекомендации» search in `auto` mode (hybrid when the model and e5
  packs are present); drugs, law, conditions and «Все» stay lexical.
- Q1 held-out test, КР only: R@5 0.123 → 0.497, R@1 0.067 → 0.294
  ([SEMANTIC_RETRIEVAL.md](SEMANTIC_RETRIEVAL.md)). Two-phase vector scan: 150–250 ms for all 774
  packs on the host. Not yet measured on a phone; ESKLP, МКБ and core packs have no e5 vectors.
- Code map of the whole search path: [SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md).

## Search: name variants and МКБ → КР bridge — 2026-10-06 (STATE S3)

Roadmap items 3 and 4 ([SEARCH_ROADMAP.md](SEARCH_ROADMAP.md), code map in
[SEARCH_ARCHITECTURE.md](SEARCH_ARCHITECTURE.md)); both on by default in `createMedicalCore`
(`nameVariants`, `icdBridge`), measured off/on with `S3_OFF=1`.

- **Names on the wrong layout or in Latin letters.** «vtnajhvby», «ьуеащкьшт», «nurofen», «Nurofen»
  find the drug; a lookup whose first groups name nothing typed is retried (layout swap, Latin →
  Russian reading, drug `nameLat`) and the page says «Показаны результаты по: «метформин»»
  (`queryRewrite`). `tools/benchmarks/name-variant-queries.json` (720 generated variants of real
  МНН, Allmed trade names, disease and КР titles + 166 controls): hit@1 0.063 → 0.947, hit@5 0.094 →
  0.956; controls: 3 of 166 rewritten («vitamin D», «Parkinson», «APGAR» — none had a title match as
  typed), the rest identical. Cost: only on a weak lookup with a plausible rewrite, +50 ms p50 / ~1 s
  p95 over the 720 cases (nearly all of which are such misses). Not covered: the clinical analysis.
- **МКБ → КР bridge.** Cards and disease articles carry `icd10Codes`; recommendation pointers list
  theirs. Q1 test (lexical, `run-icd-bridge.ts`): КР R@5 0.264 → 0.325 with core only (RuCCoD 0.417
  → 0.536), 0.190 → 0.282 with core + mkb.db (0.298 → 0.476), 0.190 → 0.294 with 723 КР modules
  (0.274 → 0.476); e5 hybrid 0.423 → 0.423; complaints unchanged. Latency unchanged (p50 311 → 309 ms).
- **Gates, off → on:** `benchmark:real:release` lookup R@1 0.803 / R@5 0.934, demo 0.526 / 0.632
  — identical; `benchmark:all` identical; `benchmark:doctor-lookup` R@5 0.9 → 1.0; owner queries
  hit@1 0.167 → 0.278, hit@5 0.444 → 0.574; 100 Allmed trade names top-1 100/100 both; `reverse-term`
  hit@5 23/35 both. Not measured (packs not on disk): the ГРЛС name and indication sets of E3,
  e5 on «Болезни», phone latency, the «Рекомендации» scope with e5 and 723 modules.
- Storage: `listSearchDocuments`/`listNavigationDocuments` (SQLite and Capacitor) now project
  `icd10Codes`, `mkbCode`, `nameLat`. Tests: `name-variants.test.ts`, `icd-bridge.test.ts`,
  `packages/core/tests/name-variants-and-icd-bridge.test.ts`, `apps/app/e2e/search-name-variants.spec.ts`.
  The e2e skeleton spec `search-skeleton.spec.ts` (lookup, 390px) was flaky while other work was in
  the tree; it does not involve a rewrite.

## Discovery core 0.6.47 — 2026-10-02 (STATE CORE2)

Published as `core-0.6.47` (prerelease; `core-0.6.45` stays published for rollback). Rebuilt with
`CORE_BUILD_VERSION=0.6.47 CORE_BUILT_AT=2026-10-02T00:00:00Z bun run content:core:build -- --stage=finalize`.

- **Pilot gone from the build.** The stages `public-pilot-build`, `public-pilot-clean-build`,
  `finalize-clean`, `pilot-removal-diff` and the retargeting report are removed; `finalize` composes
  reference + clinical + medication pointers and two alias-only inputs. The 15 pilot documents
  (`kr.rf.*.{uti,…}`, `drug.rf.*`) and their 8 `medication_profiles` are not in the core. The 45
  colloquial aliases moved to `content/colloquial-aliases.yaml` (`alias.pilot.*` → `alias.colloquial.*`;
  `build_alias_pack.py`, the renamed vocabulary builder). `content/pilot-rf` is now only the fixture of the
  historical registry migrations 007/008/012 (`tools/ingest/tests/fixtures/pilot-rf`); the
  `content:lint:pilot`/`content:build:pilot` scripts are gone. The medication alias projection is empty
  (the 1 643 source names are already in the pinned pointers, byte-identical to `medication-source-aliases.db`
  of 0.6.45), so that pack is built with `--allow-empty`.
- **Clinical track = every current edition + the replaced ones.** `medbase-clinical-catalog build
  --previous-source` takes the 2026-10-02 catalog (763 current) and keeps the 11 editions that left it
  (115_2, 25_2, 507_3, 535_2, 758_1, 759_1, 760_1, 761_1, 762_1, 771_1, 937_1) as pointers with
  `status: superseded` and `supersededByDocumentId` (the registry gives no link; the successor is the highest
  current edition of the same code, and a replaced edition without one fails the build). The successor
  lists `supersedesDocumentIds`; both bodies and aliases carry the other edition's code, so a search for
  «507_3» finds both cards. Pointer ids are unchanged for the 744 earlier records (their keywords, aliases,
  definitions, ICD, modules and medication links are identical to 0.6.45); 30 pointers are new
  (`kr.rf.1062_1`…`1080_1`, `311_2`, and the 11 new editions). The databases of the 30 editions are decoded
  from their published zstd modules (decoded checksums verified) because enrichment reads them; they come
  from the current importer, so most have no «Ключевые слова» list (keywords 0 for 27 of 30).
- **Result** (against 0.6.45): 20 002 documents (19 987 − 15 + 30), 57 264 sections, 57 276 chunks, 62 960 aliases
  (62 615 − 45 + 45 + 345); SQLite 441 597 952 B (+0.65 MB, +0.15 %), `core.db.gz` 76 268 794 B (+56 KB, +0.07 %),
  16 KiB pages, integrity ok, no FK violations, identity index unchanged (31 599 names / 31 508 targets). Diff
  against 0.6.45: exactly the 15 pilot ids removed, 30 added, the 11 replaced pointers changed, nothing else.
- **Benchmarks** (candidate = released bytes; baseline file re-measured and committed separately): CI
  `benchmark:all` (core only) lookup R@1 0.131 → 0.180, R@5 0.246 → 0.279, MRR 0.175 → 0.214, demo unchanged;
  release `benchmark:real:release` (all packs + 7 modules) lookup R@1 0.705 → 0.803, R@5 0.918 → 0.934, MRR
  0.788 → 0.855, Top-1 rate 0 → 1 (the ceftriaxone/amoxicillin/paracetamol/oseltamivir lookups no longer rank
  the pilot card above the ЕСКЛП/Allmed record); demo R@1 0.526 unchanged, R@5 **0.684 → 0.632** (one query of 19,
  `demo.30` «учащенное мочеиспускание боль в пояснице», expected `kr.rf.281_3`: it was answered by the pilot's
  retelling text, which the title-only pointer cannot replace) — more than the 0.02 tolerance, accepted as
  the cost of retiring the pilot and recorded in the new baseline; cases unchanged. No colloquial alias was
  added to win it back: that needs a clinician-reviewed symptom → disease mapping.
- **Published:** GitHub release `core-0.6.47` with `core.db.gz` (browser bundle and Android download),
  `MiniMed-0.6.47-core.db` (raw, for older builds), `core-report.json` (`distributions.android` with the gzip
  checksums) and `core.manifest.json`; `content/bundled/core.db.gz`, `apps/app/public/content/core-report.json`
  and `ANDROID_CORE_DOWNLOAD` point at it. `scripts/write-core-report.mjs` writes the report (self-tested: it
  reproduces the 0.6.45 report byte for byte apart from the dropped migration-012 checksum). The catalog's core
  entry (`minimed.core.ru` 1.0.0-preview.8) is independent of the build version and unchanged.
- **Verified:** `bun run test:unit` (312 files, 7 355 tests), `pytest tools/ingest` (895), `python:check`,
  `typecheck`, `benchmark:all`, `benchmark:real:release`; in a Chromium build (headless, fresh profile) the
  new core installs from `/content/core.db` and its checksum passes, a search for «Панариций у детей»
  returns the new pointer first, its page offers «Скачать набор» (139 КБ), the real mirror download installs
  and opens the full text; «507_3» returns the 507_4 pointer (528 КБ module) above the 507_3 one (453 КБ,
  still installable), and their pointer pages show «Редакция заменена: актуальная редакция 507_4» /
  «Заменяет редакции: 507_3».
- **Not verified:** the Android download of the new gzip on a device/emulator (the installer is unchanged; the
  URL and checksums are the published ones), the iOS/native Kotlin port (its `RELEASE_CORE` constant still names
  0.6.45; the port is frozen), a physician review of any text. UI follow-up: the pointer page does not yet read
  `supersededByDocumentId`/`supersedesDocumentIds` or the `superseded` status. Done since: a result list keeps
  one edition of a КР — when a newer edition of the same chain is among the results, the older pointer is left
  out (`withoutOlderEditions`, edition list loaded lazily after the search page); `build-core-slice.ts`
  regenerates again (modules from `data/build/release-clinical`, the retired pilot summary carried over from
  the committed slice under its original core.db checksum).

## Retrieval benchmark from external datasets — 2026-10-02 (STATE Q1)

Research note: [research/query-datasets-2026-10.md](research/query-datasets-2026-10.md). The owner has no
query log, so benchmark queries come from open Russian datasets (nothing machine-translated):
RuMedPrimeData complaints (CC BY 3.0) and RuCCoD diagnosis phrases (CC BY 4.0) with ICD-10 codes, plus
forum questions that name one medication (licence unknown: kept under `data/build/`, never committed).
Relevance is derived over the full databases (753 КР modules with registry ICD codes, 9 549 МКБ cards,
ЕСКЛП МНН/Allmed documents): grade 3 = same/ancestor/descendant code (or the named МНН), grade 1 = same
3-character block.

- `tools/benchmarks/retrieval-icd-queries.json` (400 rows, dev/test 200/200, attribution and checksums inside),
  `retrieval-benchmark.ts` (loader, ICD matching, R@k/MRR/nDCG, vitest), `build-retrieval-benchmark.ts`
  (`--fetch` downloads ≈25 MB into `data/raw/query-datasets`), `run-retrieval-benchmark.ts`
  (`--path=app|core --split=dev|test|all`; the test split is for reporting, not tuning).
- Lexical baseline over core + all packs + 753 КР modules (app path): R@5 0.282 overall (dev 0.272, test
  0.292); complaints 0.05, diagnosis phrases 0.22, drug names 0.87. Not gated: a run takes ≈1 h (≈6 s per
  query with 753 modules mounted). Use it for E1 (embeddings) instead of the synthetic pediatric set.

## Pilot corpus retired — 2026-10-02

Owner decision: the 15-card «pilot» corpus gives way to the full databases
([research/pilot-corpus-retired-2026-10-02.md](research/pilot-corpus-retired-2026-10-02.md)).

- The lookup query sets were renamed (`clinical-guideline-queries.json`,
  `medication-lookup-queries.json`, `doctor-workflow-queries.json`) and re-targeted at full-corpus ids
  (`kr.rf.<id>`, `esklp.mnn.*`, `drug.allmed.*`); no expectation names a pilot card. `run-real-corpus.ts`
  reports `lookup.*` instead of `pilot.*` (section recall is gone) and, for the release run, mounts the
  released module of each targeted recommendation. The baseline was re-measured in its own commit
  (app path, all packs: lookup R@1 0.705, R@5 0.918; CI `core.db`-only R@5 0.246, low by construction
  because pointers carry titles only); tolerance 0.02 is unchanged.
- A pilot-free core candidate (`core.0.7.0-test7.no-pilot.db`) passes the retargeted lookup gate
  (R@5 0.918, Top-1 rate 1): the earlier «no-pilot rebuild failed the clinical gate» came from
  fixtures that expected pilot ids. The pilot left the core build with core 0.6.47 (see above); the 45
  `alias.pilot.*` rows became `alias.colloquial.*`.
- Removed: `benchmark:pilot`/`run-pilot.ts`, the pilot sync/auto-rebuild workflow and scripts, the
  drug-pilot and knowledge-pilot workflows, the pilot docs, the corrupt hard-1500 fixture and its
  loader. Renamed: `Public Russian pilot Android release` → `Android release` (versioned APK asset
  `MiniMed-<v>-android-debug.apk`; `android-latest/MiniMed-android.apk`, Pages and tags unchanged),
  `Validate Russian regulatory pilot` → `…regulatory pack`.
- Still named «pilot» on purpose: the fixture copy of `content/pilot-rf` for the historical migrations, the shipped regulatory/reference/definition pack identifiers and the local
  `private-pilot`/`medications-pilot` data paths (renaming breaks installed modules or running
  pipelines); full list in the research note.

## App fixes after the КР refresh — 2026-10-02 (STATE FIX1)

- **Long titles install.** The download queue rejected any title over 180 characters, so 8 recommendations (759_1,
  759_2, 129_3, 766_1, 817_1, 888_1, 32_2, 795_1) could not be installed. The title is a display label only: it is
  now clipped to 180 characters with «…» (`downloadDisplayTitle`), while id, kind, resume and empty/control-character
  titles are validated exactly as before. Tested with the real titles from `catalog.preview.json`.
- **«DB has been closed» right after an install.** Installing a module builds a new core and closes the old one, but
  the state (`ready`) still pointed at the old core until its close had finished, and readers keep the core they were
  given. The session now wraps every core in `RetirableMedicalCore`: the old core forwards new calls to its successor,
  closes only after its running calls have settled (20 s cap, logged) and `ready`/`searchCore` are switched before the
  close starts (`swapMedicalCore` → `onSwapped(next)`). OPFS pools keep their single worker owner. The end-to-end run
  installs 129_3 (303-character title) and opens it the moment it is installed: no error; the open itself waits ~10 s
  for the new core (not a failure; a faster reconnect is a separate improvement). Done since (claude-ui, PERF1):
  «Скачать набор» → open text measured 5.9 s → 0.9 s on the КР 1006_1 pointer (built app, desktop Chromium, two runs).
  The time went to (a) a quadratic catalog lookup — every pointer of the 20 000-document home catalog scanned whole
  module document lists (`moduleContainsTarget`; 600–790 ms per home recompute, three recomputes per install), now a
  per-module index; (b) the rebuilt core re-reading whole-pack listings of the unchanged core pack (identities and
  aliases for validation, the navigation list: ~2.1 s of worker time with the opened document queued behind them),
  now read once per OPFS pool owner, which the rebuilt core leases (`WorkerOpfsMedicalStore.listing`; a seeded
  initialize drops them); (c) the pointer page waiting for the new core's full document list before reading the
  target — reading the target with text is the proof now, the list loads afterwards; (d) `core-report.json` fetched
  again on every reconnect, now once per page. The first document opened after start-up also waits less (2.1 →
  1.2 s): the home catalog no longer blocks the main thread. Small modules are still re-read from IndexedDB on every
  reconnect (linear in installed modules; not measured with many КР installed).
- **Replaced КР editions.** `catalog.clinical-editions.json` is the source (`features/modules/clinical-editions.ts`).
  Lists, category counters, search and «Скачать раздел» hide a replaced edition unless it is installed (the catalog
  still contains it); an installed one carries the badge «прежняя редакция» and a link «Текущая редакция от …».
- **Edition notice in the reader.** One line under the title: «Это новая редакция от {дата}. Открыть старую
  редакцию от {дата}» / «Это старая редакция от {дата}. Открыть новую редакцию от {дата}». Date = registry
  publication date (`publishedAt`), written as «14 августа 2026». A current edition links to the immediately previous
  one, a replaced one to the newest current one; if the other edition's module is not installed the same tap
  downloads it through the queue (progress inline) and opens it. Only 11 codes have two shipped editions; for the
  rest the notice is not shown at all (owner decision 2026-10-02: no modules for the 485 old editions for now; STATE
  UX3), so «Предыдущая редакция … не поставляется» is gone.
- **«Препараты» without a medication package (UX3).** Since core 0.6.47 the core holds only pointers, so the catalog
  (`#/modules/documents/medications`) is empty until a package is installed. Once it has finished loading with zero
  products the page shows an explanation, the whole download size (sum of the released medication packages,
  `formatModuleBytes`) and a primary «Скачать препараты» that queues them through the same logic as the tour step
  (`useDrugDownload` in `features/medications/use-drug-download.ts`, shared with the onboarding action), plus a quiet
  link «Выбрать группы в базе знаний». Progress shows in the button; the list fills when packages connect.
- **Landing counts** come from the catalog manifest at build time (`apps/landing/src/data/catalog-facts.ts`): current
  recommendation modules (replaced editions excluded, 763) and sections (21), with correct Russian plural forms.

## Clinical recommendations refresh — 2026-10-02 (STATE KR2)

Registry snapshot 2026-10-02 (`apicr.minzdrav.gov.ru`, 1 855 records: 763 current, 496 replaced, 596 archived
or cancelled, 56 of those rows without id or title). Against the 744 modules of `clinical-json-2026.07.27-13991c1feee5` it adds **30 current editions:
19 recommendations that are new to the app (18 new codes 1062–1080 and 311_2, whose only earlier edition is archived)
and 11 new editions of recommendations the app already had**; those 11 earlier editions are now replaced.

- **Raw data kept** (`data/raw/official-clinical-documents/<id>.json`, byte-exact `GetClinrec2`, 1.41 GB, checksums in
  `data/raw/official-clinical-registry/2026-10-02/raw-json-checksums.json`): all 763 current and all 496 replaced
  editions, plus the registry pages (`api-pages*.json`, `catalog*.json`). Every fetch was sequential. 732 of the 744
  earlier modules still match the source checksum of the published pack byte for byte; the 11 replaced editions changed
  bytes when the registry replaced them; 998_1 was re-saved by the registry (publication time) but its text is equal to the
  published pack up to image labels and table captions (the same differences appear for unchanged sources, they come from
  importer changes since 2026-07-27), so its module is unchanged.
- **Built the same way** as the published 744 (`delta` → ledger → source plan → `medbase sync` → `build-documents` →
  `package-snapshot` → `compact-module-search` → framed zstd with decoded checksums): snapshot
  `clinical-json-2026.10.02-7b17a45f02ff`, 30 modules, 85.7 MB SQLite → **33.3 MB** download (2.6×; modules need app
  ≥ 0.6.46). Only the 30 new editions were built; installed modules and their checksums are untouched.
- **Editions.** A new edition is a new module id (`minimed.clinical.recommendation.<CodeVersion>`). The 11 replaced
  editions stay in the catalog, downloadable and installed copies stay valid, with their document marked `superseded`
  (the schema's own status; the app already labels it «предыдущая редакция»). The catalog schema cannot link two modules,
  so the old ↔ new link, dates, registry ids, which edition is a module and the raw checksum are in the sidecar
  `apps/app/src/features/modules/catalog.clinical-editions.json` (358 codes, 797 editions, tested against the catalog).
  Replaced editions that were never modules (485) have raw JSON only; adding them as modules is the same pipeline, but
  they would double the titles in every category list until the UI hides or badges `superseded` editions.
- **Catalog.** 812 modules (+30); `publishedAt` moved to 2026-10-02 because a remote catalog replaces the bundled one only
  when it is newer; category counters recount current editions.
- **Discovery core:** the 30 new editions have pointers and the 11 replaced ones point to their successors since
  core 0.6.47 (see «Discovery core 0.6.47»). Installed modules and their checksums are untouched.
- **Published** to the new mirror branch `datasets/clinical-json-2026.10.02-7b17a45f02ff` (30 `.db.zst`, 33.3 MB, additive:
  a new branch, nothing existing touched; no GitHub release). All 30 mirror URLs return the published bytes (size and SHA-256
  equal the catalog) with `access-control-allow-origin: *`. Local copy: `data/build/official-clinical-2026-10-02/zst/`.
- **Verified:** `bun run typecheck`, `vitest` (310 files, 7 331 tests), `pytest tools/ingest/tests`, `bun run benchmark:all`
  (within tolerance of the core); all 30 files decode with the reference `zstd` CLI to the catalog's decoded checksums; in a
  Chromium build 29 of the 30 modules installed from the catalog UI and opened as full text (3 of them through the real mirror
  with real CORS). Not verified: Android/WebView, slow hardware, a physician review of any text. The 30 new modules come from the current importer, the 744
  earlier ones from an earlier revision (same text, slightly different image labels and table-caption chunking).
- **Known app issues found on the way** (not caused by this data): the download queue rejects titles over 180 characters, so 8
  catalog modules (759_1, 759_2, 32_2, 129_3, 766_1, 795_1, 817_1, 888_1) fail with «Invalid download descriptor» (including the
  new 759_2; fix flagged); opening a document within ~1.5 s after an install can show «DB has been closed» while the app reconnects.

## Drug document screen — 2026-10-01

A trade name or an ЕСКЛП substance card now opens with a drug header instead of the plain title row
(`features/medications/DrugScreen*.tsx`, model in `drug-screen.ts`, ATC logic in `atc-code.ts`, both
pure and tested):

- Header: sentence-case name (ЕСКЛП capitals are only recased when the whole name is capitals),
  Latin name when an Allmed supplement has one, form/strength and manufacturer, bookmark and share. A
  packaging photo (installed packaging-images set only) is a dimmed backdrop under a paper veil
  (`object-fit: cover`, never stretched); without one the header is a plain paper panel.
- Quick links, each row only when the data has it: other trade names of the same substance («Аналоги»,
  opened in place with the closest form/strength, «ещё N» after 6), the substance (switches to the
  substance card with all trade names), the pharmacological group (opens the medication catalog with
  its search filled; groups are matched by catalog text search, not by an exact membership list), ATC
  code chips.
- ATC sheet: the code level by level. Levels 1-4 take their Russian names from the Minzdrava NSI
  dictionary «АТХ» (OID 1.2.643.5.1.13.13.99.2.473, v3.8 of 2025-07-15, 6 897 rows built from WHOCC
  data; 14/93/271/937 names for levels 1-4): `features/medications/atc-names.json` (109 kB, 16.8 kB
  gzip) is a lazy chunk loaded by `atc-names.ts` when a sheet first opens, outside the start-up
  preload list. Where the dictionary lacks a code, the older sources apply (MiniMed's 14 headings,
  ЕСКЛП group text); level 5 is the node's substance name. The footer cites the dictionary, version,
  date and the WHO Collaborating Centre. Cyrillic look-alike letters are mapped to Latin. The chunk is
  precached by the service worker with the rest of the build (see «Web offline shell»). The dictionary is fetched by
  `scripts/fetch-nsi-dictionary.sh` in a disposable container that trusts the Russian national root CA
  (fingerprint-checked) and receives only `NSI_USER_TOKEN`; raw data stays in `data/raw/nsi/` (ignored),
  see `docs/NSI_FETCH.md`. The passport carries no licence text; a public release still needs a WHOCC
  request. Verified in headless Chromium (420 px, light and dark) on the albendazole and
  levothyroxine ЕСКЛП cards.
- Section index (jump chips) above the unchanged instruction/registry text; the «Кратко / Инструкция»
  switch stays below the quick links.
- Not covered: GRLS-only registrations get no analogues/ATC (the data is not in the document);
  the group link is a text search; the bookmark of a trade name still saves the substance document id.
- Verified in headless Chromium at 390 and 1280 px, light and dark, on the ЕСКЛП nervous-system
  module; the packaging photo was a synthetic stand-in (the real images module is not installed
  locally).

### Country of manufacture next to trade names — 2026-10-04 (STATE MFG1)

- `scripts/build-mfg-countries.ts` reads `data/raw/official-grls-registry/catalog-02.10.2026.json`
  and writes `features/medications/mfg-countries.json` (registration number → country index, grouped
  by `basis`; 888 kB, 126 kB gzip) — a lazy chunk loaded by `mfg-countries.ts` /
  `use-mfg-countries.ts` only once a drug screen or the «Препараты» list is open; `dist/index.html`
  and the start-up graph do not reference it. Registration numbers are matched by
  `normalizeRegistrationKey` (case, spaces, dashes, Latin look-alikes, `N` = `№`); when the registry
  lists `ЛП-N (…)` (changed) and `ЛП-№(…)` (in force) the record in force wins.
- Country = where the product is made, from «Сведения о стадиях производства»: stage making the
  finished form («Все стадии», «готовой ЛФ») → `finished-form`; else release quality control →
  `release-qc`; else primary packaging → `primary-packaging`; else the holder's country → `holder`
  (secondary packers, solvent and substance makers do not make the product). The export holds one
  stage line per registration, so there is no multi-site data today (the parser and asset support
  it). Countries are normalised to short Russian names («Республика Беларусь» → «Беларусь»).
- Coverage 2026-10-02: 99.96 % of registrations in force (29 389 of 29 400) and 29 297 of the 29 300
  registrations the ЕСКЛП modules show; basis shares over all 39 415 numbers: finished form 80.3 %,
  release control 8.7 %, primary packaging 2.4 %, holder 8.4 %. Packer-only and release-control-only
  records can differ from the true maker; a tooltip on the country says which basis it rests on.
- UI: trade name in the drug header gets «(Россия)» after it (muted, read as «Страна производства»);
  the analogue row lists one chip per trade name × country («Альбендацид (Беларусь)», «Альбендацид
  (Россия)»), each opening its closest registration; «Препараты» list titles carry the country; the
  share text includes it. No country on the МНН (substance) card header. The МНН card's trade-name
  list is an accordion: 2 entries visible, «Показать ещё N названий» (Russian plural) opens the rest
  with the app's disclosure motion (0fr → 1fr track). No «оригинальный препарат» mark.
- Rebuild after a registry refresh: `bun scripts/build-mfg-countries.ts`. Not tested: the ибупрофен
  pointer in the musculoskeletal module did not open its card in headless install (module install
  stayed at 100 %); verification used the antiparasitic module (албендазол) at 360 px, light and dark.

## Storage and transfer compression — 2026-10-01 (STATE C1, K2 P0)

Implements the P0 items of [kb-audit-storage-2026-10](research/kb-audit-storage-2026-10.md) (levels a and b).
Candidate artifacts are built and verified locally; **nothing is published and the catalog still points
at the uncompressed assets** (see «Publishing» below).

- **Android core as gzip.** The native installer inflates the downloaded transfer while it streams
  into the verified-install transaction (`VerifiedPackFiles.openTransfer`); the decoded checksum is
  what is verified, a truncated archive never replaces the installed core. `ANDROID_CORE_DOWNLOAD`
  now points at the published `core-0.6.45/core.db.gz` (76.2 MB, the browser bundle's archive of the
  same 16 KiB-page file; `core-report.json` records `transferSha256`/`transferSizeBytes` next to the
  decoded `checksum`). Download 440.9 → 76.2 MB (−365 MB). JVM tests pass; not run on a device.
- **One store per large module index.** Indexes above the 32 MiB WASM limit used to sit in
  IndexedDB (Blob) *and* OPFS, and OPFS pools survived remove/rollback. Now the OPFS pool is the only
  copy; the row keeps `indexStorage: 'opfs'`, `indexSizeBytes`, `indexSha256`. A zstd index made of
  independent ≤64 MiB frames is decoded frame by frame inside the OPFS worker straight into its pool
  with an incremental SHA-256, and the pool associates the file only after size and checksum match
  (`stageEncodedIndex`; no decoded copy in memory, none in IndexedDB). fzstd's streaming API was
  measured and rejected: it moves its whole window per block (10 s vs 1.2 s for 340 MB). Other
  artifacts keep the generic decode and still end up OPFS-only. Pool files are found under the
  unsuffixed name blob imports always used (an e2e run caught the size-suffixed variant).
- **Migration of existing installs, no re-download.** Mounting a legacy row opens its OPFS copy (or
  imports it once from the Blob) and then drops the duplicate bytes; inactive versions migrate in
  the background; pools no row refers to (removed modules, failed installs, copies orphaned by older
  versions) are swept under Web Locks, an install in progress holds a shared staging lock, and a pool
  a live worker still holds waits for a later sweep. Rollback keeps both versions (the registry history
  needs them); registry history is still unbounded, so a version bump of a large module keeps the old
  copy on the device (next task: prune history).
- **Search-compacted module builds.** `medbase compact-module-search` (migration 013) and
  `medbase build --compact-search-text`: external-content FTS (the pack's own tokenizer/prefix kept)
  plus empty `chunks.normalized_text` after the rank-1 integrity check; accepted only when a
  token-instance fingerprint of the index, bm25 top-50 of a deterministic query set and a hash of all
  other chunk columns equal the input's. The Krasota/MKB/packaging module scripts use it; a compacted
  pack records `search_text_state` and refuses any later index rebuild or composition.

| Measured | before | after |
|---|---:|---:|
| ЕСКЛП ×15, download | 1 992.6 MB (`none`) | 94.5 MB zstd of the published bytes (21.1×) · **68.7 MB** zstd of the compacted build (29.0×) |
| ЕСКЛП ×15, on device | 3 985 MB (IndexedDB + OPFS copies, by code) | 1 992.6 MB (single store) · **1 429.4 MB** (compacted, −28.3% of the SQLite) |
| Клинреки ×744, download | 2 072.5 MB (`none`) | 677.0 MB (3.06×) · **652.6 MB** compacted (3.18×) |
| Клинреки ×744, on device | 2 072.5 MB | **1 560.9 MB** compacted (−24.7%) |
| Android core, download | 440.9 MB | 76.2 MB |
| kras / MKB / packaging SQLite (local packs, already external FTS) | 629.8 / 294.8 / 221.1 MB | 461.9 / 257.6 / 177.1 MB (normalized_text only) |

zstd parameters: `-19 --long=26`, frames of ≤64 MiB made from files (so each declares its size; the
128 MiB-window decoding bug of fzstd is avoided by construction). `-22 --ultra` gains 4.8% for 10× time.
Search checks: all 15 + 744 compactions passed the built-in fingerprint/bm25/text-hash proof. Through the
whole `MedicalCore.search` pipeline over the released core plus the modules mounted as the app mounts
them (`tools/benchmarks/src/compare-module-search.ts`, lexical, every `query` of the committed benchmark
fixtures plus document titles): 229 queries over three compacted ЕСКЛП modules and 260 queries over 49
sampled compacted clinical modules, 0 differences in both (reports in `output/module-zstd-2026-10-01/`;
the full 15-module run did not finish on the loaded host). The same 40 store-level queries on one module
in Chromium over sqlite-wasm/OPFS (plain vs compacted install): identical ids, ranks and order.
`bun run benchmark:all` (core only, unchanged) stays within tolerance. All 1 518 `.db.zst` files were
decoded again with the reference `zstd` CLI and match their catalog checksums.

**Publishing (pending the owner's decision).** Candidates are in `output/module-zstd-2026-10-01/`
(`esklp`, `esklp-compacted`, `clinical`, `clinical-compacted`, each with `repack-report.json`; the two
`catalog.candidate.*.json` are the full catalog with those entries swapped; recorded in the data
ledger). Upload plan and mirror paths are in the reports; `scripts/publish-module-zstd-mirror.sh`
adds the files to the `datasets/<tag>` branches additively. The clinical release already has 746 of
the 1 000 allowed assets, so the 744 clinical `.db.zst` go to the branch only. The same module
version is kept: the logical source set is unchanged, installed copies stay valid, nothing re-downloads.
`minAppVersion` of repacked modules becomes 0.6.45 (the first release with the zstd installer; the
three already published zstd modules still say 0.6.44 and should be corrected with the next catalog change).
Regenerate `catalog.shell.json` (`scripts/build-module-catalog-shell.ts`) after swapping the catalog.

Not verified: any Android device or WebView (Java unit tests and Chromium only), slower hardware (install
of a 93 MB module took 1.4 s to import + ≈8 s validation on this loaded laptop), all 744 compacted
clinical modules through the app (49 sampled through the benchmark pipeline, none in a browser), the four already published
zstd modules (single frame: they still decode in memory) and the `module-pointer` e2e case
«no download action when experiments are disabled» (times out waiting for the core on this loaded host;
it does not touch module storage).

## ГРЛС instruction collection (G1) — 2026-10-02

Owner decision: ГРЛС grants no database access; for this personal single-user build the public
instruction PDFs are still collected, politely (`tools/ingest/.../grls_collect.py`, command
`medbase-regulated-catalog grls-collect`): truthful `User-Agent`, ≤2 requests in flight, randomized
delays, backoff on 429/503, no CAPTCHA handling, resumable state ledger, never overwrites a raw file.

- Owner decision: collect over time (no RLS purchase). The runs stopped at an image CAPTCHA twice (30 PDFs, then 14);
  a detached daily-batch loop (`grls-collect-daily`: probe with one registration, batch ≤50 until the first CAPTCHA,
  wait 24 h; never bypassed) waits for its first attempt 2026-10-03 05:45 UTC. Queue order: ЖНВЛП, then INNs with the
  most registrations. Watch `data/build/grls-collect/progress.json`; stop with a `STOP` file. 6 300+ transient
  failures and 675 new registrations remain; the ledger now keeps `idReg`/`routingGuid`/exact PDF URLs
  (`grls-instruction-url-ledger.jsonl`). Pace is unknown until the first windows finish.
- Real-difference queue (owner, 2026-10-04): one text per «INN + dosage-form class» group, not per registration —
  4 383 groups, 2 954 covered (67 %), ЖНВЛП groups 958/1 138 (84 %); queue 1 041 groups (177 ЖНВЛП first) plus an
  ОХЛП second pass for 854 leaflet-only groups. Each card visit keeps all current-edition documents with their kind
  (ohlp/leaflet/national-instruction); only 5 ОХЛП held so far. ~14 registrations per daily window: ЖНВЛП groups
  ~2 weeks, first pass ~2.5 months (honest range 40–100 days). `progress.json` reports groups/ЖНВЛП/ОХЛП coverage.
- New registry export 02.10.2026 (39 481 records, +666) is stored next to the old one
  (`data/raw/official-grls-registry/catalog-02.10.2026.json`); plan `grls-instructions-active-plan-02.10.2026.json`.
- OCR flag kept: `ExtractionDiagnostics`/`metadata.extraction` now carry `textExtractionMode`,
  `ocrEngine`, `ocrPages`, `ocrMeanConfidence` (Vision, character-weighted) and
  `ocrLowConfidenceRatio` for PDFs; `data/build/grls-instruction-text-manifest.jsonl` joins every PDF
  (checksum, URL, fetch date, OCR flag, `unknownWordRatio`, `textSha256`) and
  `grls-instruction-text-coverage.json` holds before/after coverage. Released packs and the catalog
  are untouched; the confidence is recorded only for PDFs extracted since this change (older OCR
  documents have the flag and the unknown-word proxy only).

## ГРЛС loop restart and sister-register pilot — 2026-10-13 (STATE G2)

Owner 2026-10-13: «resurrect the collector, or search for a drugs db once again». Full numbers and the source table:
[research/drug-sources-2026-10-13.md](research/drug-sources-2026-10-13.md).

- **Loop restarted** at its existing polite rate (probe with one registration, ≤50 per window, 10–20 s between requests,
  24 h wait, stop at the first CAPTCHA, one instance). It had died with the host reboot of 2026-10-05 10:16 (no
  `LOOP stopped`, no `STOP`), not with a site block. First window after the restart: 1 + 14 registrations (7 stored,
  7 «search-miss», CAPTCHA); groups 2 973/4 383, ЖНВЛП groups 977/1 138. `scripts/grls-collect-daily.sh start|status|stop`
  restarts it after a reboot (reads the previous `nextAttemptAt`; no LaunchAgent), command in
  `GRLS_INGESTION_HANDOFF.md`. Group representatives now prefer EAEU numbers (31/31 found since 10-04 against 3/16 for
  older national numbers), effective at the next `stop`/`start` on updated code.
- **Sources re-checked:** the Union register OData (`opendata.eaeunion.org/odata`, 55 563 records) holds no document texts
  (`drugDocumentsDetails` is null in all 1 563 sampled records) but maps each dossier to its member states;
  `lk.regmed.ru` ОХЛП/ЛВ downloads stay behind an image CAPTCHA (not touched); mirrors, archives, aggregators: nothing
  new. **New and usable: the registers of Belarus (rceth.by) and Kazakhstan (register.ndda.kz)** publish the dossier's
  leaflet and ОХЛП as plain files without a CAPTCHA.
- **Collector `medbase-eaeu-sister-registers`** (`eaeu_sister_registers.py`, 16 tests on fixtures): listings → candidates
  by shared dossier number → polite resumable download → manifest per (registration, document) with source class
  `eaeu-sister-register`, country, URL, sha256, fetch time, `Last-Modified`, text check. Missing registrations matched:
  **377 (4.6 %), ЖНВЛП 190 (6.2 %); 1 018 documents listed, 950 downloaded (565 BY, 385 KZ, 711 MB; ~65 Kazakh ids answer
  HTTP 500)**, so 370 registrations (ЖНВЛП 186) hold a leaflet and, for 369, an ОХЛП (ГРЛС gave 5 ОХЛП so far); +66
  «INN + form» groups (+20 ЖНВЛП). Raw files in `data/raw/eaeu-sister-registers/` (private, ignored; ledger entry added).
  `manifest` ran on the 30-file pilot (32 rows, 0 mismatches); on the full set it needs Vision OCR for the scans (≈15 %).
- **Not done / owner decisions:** no module builder for this source class, no pack, catalog or release change; showing a
  Belarus/Kazakhstan-stamped text for a Russian registration needs an owner decision; the three further manufacturer
  adapters (ns03.ru, dalkhimpharm.ru, avexima.ru) and an official НЦЭСМП request remain open.

## Official ГРЛС instructions and Allmed as downloadable modules — 2026-10-05 (STATE GI1)

> Republished 2026-10-14 with cleaned OCR text, content kinds and quality grades: see «OCR quality of the ГРЛС instruction
> modules» below (versions `grls-2026.10.14.kd1`, the numbers in this section are those of 2026-10-05).

The ~8 950 collected ГРЛС instructions were in no module; now they ship, one module per ЕСКЛП group, and the
Allmed reference (until now only the local dev companion `public/content/medications.db`, catalog entry without
artifact) is a downloadable module too. Both need app **0.6.48** (`minAppVersion`); the catalog entries are
`releaseState: preview`, i.e. like the ЕСКЛП groups they appear with «Экспериментальные модули».

- **Builder** (`tools/ingest/src/localmed_ingest/grls_instruction_modules.py`, CLI
  `tools/ingest/scripts/build_grls_instruction_modules.py plan|build`, tests `tests/test_grls_instruction_modules.py`;
  it replaces the Sep-28 `build_grls_atc_modules.py` partition, whose `data/build/grls-instructions-atc-*.db` are now
  obsolete). Input = every row of `grls-instruction-text-manifest.jsonl` with `extraction == prepared` (8 947 distinct
  document ids; a PDF fetched under two registration numbers is one document that serves both). Group = the ЕСКЛП
  module that lists one of the document's registration numbers (`data/build/release-esklp`; primary registration
  first, otherwise the most common group, ties alphabetical and flagged `atcGroupBasis`); no ЕСКЛП registration or no ATC
  → `unclassified` («без АТХ»). Only the front matter of the prepared Markdown changes; the body, `localmed:source` spans,
  ids, section and chunk anchors stay byte-identical (checked against the Sep-28 build: 690/690 chunks equal). Added
  metadata, all taken from the manifest: `documentKind` (`leaflet` / `national-instruction` / `ohlp` / `unknown`),
  `fetchedAt`, `ocr`, `textExtractionMode`, `ocrEngine`, `ocrMeanConfidence`, `ocrLowConfidenceRatio`,
  `unknownWordRatio`, `qualityScore`, `textSha256`, `pdfPageCount`, `registrationNumbers` (every number the PDF serves),
  `atcGroup`, `atcGroupBasis`; `officialSourceUrl`, `instructionLabel` («Изм. № …») and `pdfSha256` were already there.
  A leaflet/ОХЛП title names its kind («РАМИПРИЛ: листок-вкладыш»). Cards (`official_registry_summary`) are not shipped
  (ЕСКЛП holds the registry data). Lexical only (no hash embeddings), then `medbase compact-module-search` (all 15
  passed the fingerprint/bm25/text-hash proof), framed zstd (`scripts/package-instruction-modules.ts`, shared archive
  code in `scripts/lib/zstd-module-archive.ts`, also used by `repack-module-indexes-zstd.ts`; decoded again with the app's
  reader and with the reference `zstd` CLI, all 16 match the catalog checksums).
- **Left out:** 3 of 8 947 fail the builder's own guards and are listed in the reports (two OCR headings with control
  characters/backslashes, one English-dominant text); 6 PDFs are `not-prepared` (no text).
- **Published** additively to new branches `datasets/grls-instructions-2026.10.05-056961ab2b54` (15 files) and
  `datasets/allmed-2026.10.05-2d39a7fc2b43` (1 file) with `publish-module-zstd-mirror.sh --family esklp --create`;
  `artifact-url.ts` maps those tags to `raw.githubusercontent.com/…/datasets/<tag>/modules/<file>.db.zst`. All 16 URLs
  return the catalog's bytes (size and SHA-256) with CORS. Catalog `release-0.6.48-grls.2026.10.05` (827 modules, +15,
  Allmed completed with its artifact, same version and `sourceSetDigest` so a locally mounted companion stays valid);
  `catalog:shell` regenerated.

| Module (`minimed.medications.instructions.<group>.ru`) | documents | registrations served | download MB | installed MB |
|---|---:|---:|---:|---:|
| alimentary-metabolism | 1 217 | 1 761 | 26.5 | 159.8 |
| antiinfectives | 1 245 | 1 760 | 40.9 | 236.0 |
| antineoplastic-immunomodulating | 688 | 913 | 25.9 | 141.9 |
| antiparasitic | 30 | 49 | 0.5 | 3.3 |
| blood | 516 | 734 | 15.8 | 96.2 |
| cardiovascular | 949 | 1 361 | 28.2 | 167.6 |
| dermatological | 502 | 754 | 7.3 | 47.7 |
| genitourinary-hormones | 262 | 366 | 7.1 | 41.4 |
| musculoskeletal | 616 | 880 | 16.3 | 97.7 |
| nervous-system | 1 086 | 1 547 | 30.1 | 174.5 |
| respiratory | 680 | 965 | 13.1 | 84.2 |
| sensory-organs | 203 | 272 | 4.9 | 29.4 |
| systemic-hormones | 87 | 126 | 2.8 | 15.5 |
| unclassified («без АТХ») | 705 | 1 040 | 7.2 | 49.9 |
| various | 158 | 221 | 3.9 | 22.8 |
| **15 modules** | **8 944** | **12 749** | **230.6** | **1 367.8** |
| `minimed.medications.ru` (Allmed, 4 708 entries) | 4 708 | — | 48.7 | 276.5 (was 514.3) |

  Uncompacted the instruction packs were 1 883 MB (−27 %). The whole «Препараты» set (ЕСКЛП 68.7 MB + instructions 230.6 +
  Allmed 48.7) is **348 MB download, 3 074 MB installed** (the empty-catalog / onboarding «Скачать препараты» button reads
  332 МБ in MiB), installed as the app does from the mirror in a clean browser profile in 15 minutes on this loaded
  laptop. Kinds in the modules: 4 671 instructions, 3 811 leaflets, 5 ОХЛП, 457 unclassified (scans); 2 296 OCR texts.
- **Coverage** (`tools/ingest/scripts/measure_grls_instruction_coverage.py`, `data/build/grls-instruction-modules/coverage.json`):
  12 740 of 27 049 active non-substance ГРЛС registrations (47.1 %) and 12 666 of 29 300 ЕСКЛП registrations (43.2 %) have an
  official text; 2 353 of 3 324 ЕСКЛП МНН cards (70.8 %), 5 075 of 7 672 СМНН nodes (66.2 %), 2 811 of 4 055 МНН × form-class
  groups (69.3 %); in the collector's «INN + dosage-form class» groups 2 971 of 4 383 (67.8 %), ЖНВЛП groups 961 of 1 138
  (84.4 %). It grows with the daily collector window (about 14 registrations a day); a later delta is a new module version
  or additional modules by the same pipeline.
- **App.** `instruction-source.ts`: kind label («Листок-вкладыш (для пациента)», «Инструкция по медицинскому применению»,
  «ОХЛП (…)»), edition, ГРЛС link (https only), fetch date and an OCR/low-quality note, shown above any
  `official_drug_instruction` text; `instructionIndexFromSummaries` indexes a PDF under every registration it serves and
  prefers ОХЛП > instruction > leaflet when one registration has several documents. `allmed-matching.ts`: an Allmed entry
  is attached to a product only for the same ЕСКЛП substance, the same trade name and a compatible dosage form (a form only
  rules an entry out when both sides name forms with nothing in common; no match across substances or by similarity) — used
  for the merged «Кратко (Allmed)» text and the Allmed panel. The Allmed panel shows its own notice («не официальная
  инструкция ГРЛС»), and for a drug without an installed official text the plaque «Полная официальная инструкция пока
  недоступна — показана краткая справка Allmed» plus, when the group's instruction module is in the catalog and not
  installed, «Скачать инструкции группы «…» · 495 КБ» (downloads through the module runtime, reconnects the core and opens
  «Инструкция»). Without Allmed only the official text is shown (the «Кратко» side is the ЕСКЛП card). The «Скачать
  препараты» flow already selects every `kind: medication` module, so it now includes the instruction modules and Allmed;
  its explanation text names them.
- **Verified in a browser** (390 px, light/dark, headless Chromium, clean profile, packages from the mirror): the whole
  «Скачать препараты» set installs (16 976 documents, 2 931 МБ); Мефлохин (OCR instruction): switch «Кратко (Allmed) /
  Инструкция», source block with edition «Изм. № 1, ЛП-004502, 2022», link, date and OCR note; Вермокс (leaflet): label
  «Листок-вкладыш (для пациента)»; with the antiparasitic instruction module removed the plaque and the offer appear,
  the offer downloads 0.5 MB and opens the text (`apps/app/e2e/grls-instruction-modules.spec.ts`, opt-in with
  `GI1_MIRROR_E2E=1`, passes against a 0.6.48 build). Unit tests: `instruction-source`, `allmed-matching`,
  `instruction-offer`, `artifact-url`, `catalog.preview` (15 instruction modules + Allmed in the drug set),
  Python `test_grls_instruction_modules`.
- **Not verified:** Android/WebView and slow devices; search quality over the mounted instruction modules (they join the
  lexical search as `official_drug_instruction`, which the scoped search already treats as medication); registrations
  with several documents of different kinds (none exist yet: the collector now keeps all of a card's current documents);
  the 3 left-out documents are not repaired.

## OCR quality of the ГРЛС instruction modules — 2026-10-14 (STATE OCR1)

Owner 2026-10-13 («Data with quality problems — fix it»). The 15 ГРЛС instruction modules held 2 302 OCR texts
(19 740 pages, every one flagged «OCR» in the app) and 457 unclassified scans; 16 manufacturer-site texts were OCR
too. Measurements, defects, the engine comparison and what was rejected:
[research/ocr-quality-2026-10-14.md](research/ocr-quality-2026-10-14.md). The released texts were macOS Vision output
(the confidence was recorded for 29 of them); Tesseract is not installed on the build machine.

- **Engines compared** (20 documents with a native-text edition of the same product as a yardstick): Vision at 1 800,
  2 480 and 3 300 px, with and without language correction, and Tesseract.js `rus`+`eng` all land within 0.03 of each
  other (word-trigram agreement with the native edition 0.746–0.757, released text 0.776), they agree on 95.5 % of the
  words. A different setting or a full second engine pass does not pay (Tesseract 5–10 s per page for 0.2 % of the
  words). **Marker (Surya) was compared afterwards** (section «Marker evaluation» below).
- **What was wrong** (measured on the released text, `scripts/grls_ocr_report.py`): 7 507 scan-stamp lines in the body
  («СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ», «СОГЛАСОВАНО», «ЛП - 005351-021219»; 281 documents with the expert-report stamp
  as a *heading*), one paragraph per OCR line (median 38 characters, 74.6 % without closing punctuation), **730 of the
  2 302 OCR documents are sheets of amendments** («Изменение № N», «Старая / Новая редакция»; 668 of them labelled
  «Инструкция по медицинскому применению»), 451 OCR texts and 8 text layers had no recognised kind, systematic
  misreads («Стах» for Cmax ×2 224, «иньекций», «коньюнктивит», «вышуска», «вкладьи», the dropped «У» of «Условия»),
  two-column amendment tables read line by line across the columns, three text layers with a broken font encoding
  (one cut every word into pieces: «Ли ст ок-вкладыш – ин формаци я д ля пац и ент а»; two decoded to Latin look-alike
  noise).
- **Pipeline** (`tools/ingest`, all deterministic, every change recorded; none touches a number or a unit):
  `grls_ocr_vision_cache.py` re-runs the same Vision engine once over the 2 296 OCR PDFs + 10 text layers a lexicon check
  rejected (19 894 pages, 0 failures, ≈ 1.7 h) and keeps the raw payload with the per-line confidence;
  `ocr_requality.py` assembles lines (observations on one baseline, stamps on a title baseline apart, amendment
  tables column by column), turns stamps into `page_mark` blocks (kept as `<!-- localmed:page-mark … -->` comments in
  the prepared Markdown, outside the body; 0 false positives on 6 655 native documents), recognises the standard
  headings, reflows lines into paragraphs from geometry and punctuation (line-break hyphens joined only when the joined
  word is a lexicon word), applies `ocr_text_cleanup.py` word rules (an unknown word with exactly one lexicon spelling
  one *measured* confusion away — `ь`↔`ъ`, `н`↔`п`, `ш`↔`п`, a dropped letter, never in the last two characters,
  names skipped: 388 correct and 2 wrong in 56 693 correct-but-unknown tokens on 241 OCR/native pairs; the
  pharmacokinetic symbols, «ATX», the leaflet title word), and replaces a text layer that reads as noise by the
  recognised page. The raw lines stay in the extraction JSON (`ocrRaw`, `lines`), the source marker lists every
  line block of a paragraph and its confidence. `grls_ocr_second_opinion.py` + `scripts/ocr-tesseract-worker.mjs` read
  6 561 pages again with Tesseract.js (the pages of low-graded documents and every page with a low-confidence line of
  two or more unknown words; 82 min, 0 failures): for each Vision line the lexicon picks the reading with fewer unknown
  words and less junk (no word given up, at least one known word to stand on, lines a box spans joined), the other
  reading is kept as `ocrAlternatives`: 5 306 lines compared, **4 282 replaced** (e.g. a dose line read as
  «мли по 10 г, 20 1,23 банковало ной …» became «По 5 г в пенале … или по 10 г, 20 г, 25 г в банке …»), and 1 082 lines
  where the engines disagree about a standalone number (not a unit or a code) mark the paragraph
  `<!-- localmed:review ocr-uncertain-number -->`. Uncertain numbers are only marked: a digit run with a look-alike
  letter («1О», «5l0») or a unit that is none («500 мr»): 254 tokens.
- **Classification** (`grls_document_kind.py`, by content: ОХЛП / leaflet / instruction for use / **amendment sheet** /
  other): the 451 unclassified OCR texts are 383 instructions, 62 amendment sheets and 6 leaflets, the 8 unclassified
  text layers are classified by the module builder the same way; every OCR text now has a kind: 1 364 instructions,
  211 leaflets, 1 ОХЛП, **730 amendment sheets** (351 of one page); 8 947 documents in all: 4 394 instructions, 3 818
  leaflets, 5 ОХЛП, 730 amendment sheets. An amendment sheet is labelled («Лист изменений к инструкции», title
  «…: лист изменений к инструкции»), ranks below every real instruction of a registration (even a holder-site one),
  is never a same-substance donor, and registrations it serves alone are counted apart: **736 registrations have only
  a sheet of amendments**, so the registrations with a real instruction text are 12 015 of 27 049 active (44.4 %, was
  reported as 47.1 % with the sheets), ЕСКЛП МНН cards 2 225 of 3 324. A journal article collected from a holder site is
  not an instruction (`other`) and was dropped from the manufacturer module.
- **Measured, 2 306 re-prepared documents, before → after:** unknown words against the native-text lexicon 3.27 % →
  2.42 % overall (median per document 3.65 % → 2.67 %; native text 0.9 %); stamp lines in the body 7 507 → 2; paragraphs
  816 142 → 324 156, median length 38 → 65 characters, paragraphs without closing punctuation 74.6 % → 44.6 %; recognition
  confidence recorded for 29 → 2 303 documents; instruction-section coverage (the builder's own segmentation, ≥ 3 pages)
  95.1 / 96.8 / 96.3 % → 95.2 / 96.9 / 96.5 % for dosage / indications / contraindications — the builder already
  recovered the standard headings, so nothing is claimed there. 6 107 word edits, 8 925 page marks. Spot checks against the
  page images (ten pages of good, fair and low documents): every dose and number read exactly except one unit
  («5 м.» for «5 мл», in a document graded low); the two lines a scan had lost (a pack-size line with its doses, an indication
  line) were recovered by the second engine. Sibling text layers: 50 of 1 448 OCR instructions have a native-text
  document of the same product (trade name, INN, holder, dosage form), none is demonstrably the same text with the same
  doses, so none replaced an OCR text (`grls_ocr_siblings.py`, tested).
- **Quality grade and the app note.** Every OCR document carries `ocr`, `ocrTool`, `ocrMeanConfidence`,
  `ocrLowConfidenceRatio`, `ocrQuality` (`good` / `fair` / `low`) with `ocrQualityReasons`, the counters and
  `textSha256`, next to the raw `pdfSha256` and the pages (`ocrPages`). The grade combines mean confidence (< 0.80
  low, < 0.90 fair), the low-confidence share, the unknown-word ratio (relaxed for amendment sheets, which are names and
  addresses) and uncertain numbers per 1 000 words. Result: **1 108 good, 1 044 fair, 151 low** (122 of the low are amendment
  sheets). `instruction-source.ts` shows its OCR note only for `low` (and keeps «сверен со страницами» for the reviewed
  oseltamivir text); modules without the grade keep the old behaviour. Was: all 2 303 flagged.
- **Modules republished.** The 15 ГРЛС instruction modules (8 946 documents; the document with an OCR-noise heading that
  fails the builder's JSON guard is still left out; indication vectors re-embedded, 9 446 chunks, KD1 profile) →
  `datasets/grls-instructions-2026.10.14-15ce0cf79f45-kd1`, 224.9 MB download / 1 328.7 MB installed (was 230.6 / 1 367.8),
  largest blob 39.3 MB, version `grls-2026.10.14.kd1`; the manufacturer-site module (271 documents, 240 registrations)
  → `datasets/manufacturer-instructions-2026.10.14-769c87d55bcc`, 7.2 MB / 45.8 MB, `manufacturer-2026.10.14`. Nothing
  published earlier was touched or overwritten; all 16 URLs return the catalog's bytes with CORS; the catalog is
  `publishedAt` 2026-10-14T12:00Z. The `-kd1` source tag is the only branch of the new release (the lexical stage was
  packaged for its catalog entries only). Rebuilt on the new modules: interaction, safety and comparison indexes, dose-rule
  index, same-substance fallback (registrations with text 12 897 → 12 185, change sheets are no donors). Local
  copies and builds: `data/build/grls-instruction-modules-ocr1`, `output/module-zstd-grls-ocr1-kd1-2026-10-14`.
  `scripts/lib/module-pack-identity.ts` copies the pack identity out of Bun's SQLite rows: with Bun 1.2.3 strings read there
  changed after later databases were opened (duplicate catalog ids, only in the slow real run), which would have mislabelled
  catalog entries.
- **Tests.** `tools/ingest/tests/test_ocr_text_cleanup.py` (rule fixtures: stamps, headings, hyphenation, look-alikes,
  edits, numbers never edited), `test_ocr_requality.py` (line assembly, tables, reflow, page marks, grading, native-layer
  checks, end to end), `test_ocr_second_opinion.py`, `test_grls_document_kind.py` (classification), `test_grls_ocr_requality.py`
  (manifest/overlay integrity: provenance, digests, selection), `test_grls_ocr_siblings.py`, `test_grls_ocr_sibling_stage.py`,
  `test_grls_instruction_modules.py` (overlay join), TS `instruction-source.test.ts` (grade, labels, ranking),
  `catalog.preview.test.ts`.
- **Not done / not tested:** truncated word endings («терапи») are not repaired (several lexicon
  completions exist); tables stay text rows (`a | b`, flagged `table-candidate`); only ten pages were compared with the page
  image by eye — there is no page-level ground truth for the other 19 700; the OCR note of already installed modules
  changes only after the module update; Android/WebView and the on-device display of the new labels were not run; the
  hand-reviewed oseltamivir text (`content/grls-reviewed-ocr/`) is carried unchanged by the builder (its checksum matches).

## Manufacturer-site instructions (M1) — 2026-10-02

Research and pilot (`docs/research/manufacturer-instructions-2026-10.md`): official instruction texts for
registrations the ГРЛС collector has not delivered, taken from the holders' own sites. Separate source class
`manufacturer-site` under `data/raw/manufacturer-instructions/` (ledger entry in `docs/data-ledger.json`); ГРЛС raw files and
the G1 loop are not touched. Collector `tools/ingest/.../manufacturer_instructions.py`
(`medbase-manufacturer-instructions missing-report | crawl | rebuild-manifest`): robots (RFC 9309), one request at a time
per host, TLS verified, truthful `User-Agent`, stops a host on 403/429/CAPTCHA, resumable ledger, manifest with URL, fetch
date, sha256, version/date as printed, OCR flag and match evidence.

- 8 325 missing registrations (3 102 ЖНВЛП, 77 % EAEU numbers) over 1 323 holders: 78 holders cover 50 %, 301 cover 80 %.
- Pilot on 7 holder sites: 245 of 681 missing registrations found (36 %; 94 ЖНВЛП), 61 with the registration number
  printed in the document or on its page, 179 `label-unique` (name + form + holder, no number printed: EAEU листки omit it),
  5 ambiguous. Not yet used by any pack or the app; whether to accept `label-unique` is an owner decision.
- Generic web search for 20 missing ЖНВЛП: 0 verified official documents (reference books and aggregators only).

## Manufacturer-site instruction module (M1 shipped, MED3) — 2026-10-05

Owner decision D2 (2026-10-05): the collected M1 documents ship as ONE separately labelled module,
`minimed.medications.instructions.manufacturer-site.ru` («Инструкции с сайтов производителей»), version
`manufacturer-2026.10.05`, catalog entry `kind: medication`, `releaseState: preview`, collection
`manufacturer-instructions` (not `grls-instructions`: the sections feature reads that collection as the per-ATC groups),
tags `manufacturer-site`, `official-instruction`, `instructions`, `minAppVersion` 0.6.48, lexical only, search-compacted.

- **Builder** `tools/ingest/src/localmed_ingest/manufacturer_instruction_modules.py`, CLI
  `tools/ingest/scripts/build_manufacturer_instruction_module.py plan|registry|build`, tests
  `tests/test_manufacturer_instruction_modules.py`. Flow: `registry` → `medbase prepare` (PDF: normal preparer with the macOS
  Vision OCR fallback, so the body keeps `localmed:source` spans; DOCX: the collector's cached text written as a `format: text`
  source) → `build` (stages only the front matter, GI1 guards, `build_content_pack` without embeddings) →
  `medbase compact-module-search` → `scripts/package-instruction-modules.ts --family manufacturer` (disjoint from `--family grls`) →
  `publish-module-zstd-mirror.sh --family esklp --create`. Text is never summarised or repaired. The 21 DOCX texts have
  single-newline paragraphs, so the text preparer finds only 1–2 headings in each (the body is chunked by size); the PDFs keep
  their headings.
- **Acceptance.** Only `text-number` (number printed in the document), `page-number` (printed on the holder's product page) and
  `label-unique` (name + form + holder, no number printed) count; `label-ambiguous` never attaches a document to a registration.
  A file serves every accepted registration of every manifest row that names its sha256 (373 rows = 277 files). Of the 245
  registrations the pilot found, **240 are accepted: 45 `text-number`, 16 `page-number`, 179 `label-unique`** (strongest level per
  registration; as registration × document pairs 47 / 16 / 213). 5 registrations match only ambiguously and are left out
  (`ЛП-№(004982)`, `(005347)`, `(005543)`, `(005822)`, `(015391)`), with the 5 files that carry only such matches (4 Микроген, 1 Усолье).
  A document that also has accepted matches keeps only those registrations.
- **272 documents** (`drug.rf.m1.<20 hex of the file sha256>.instruction`; 251 PDF + 21 DOCX; 16 OCR; none excluded by the guards),
  5 916 sections, 7 310 chunks. Kinds (read from the text): 153 national instruction, 92 leaflet, 22 ОХЛП, 5 unclassified
  (scans without a title). Documents / registrations by site: Микроген 103 / 103, КРКА 35 / 16, Вертекс 25 / 21, Акрихин 31 / 27,
  Промомед 31 / 26, Реневал 27 / 26, Усолье-Сибирский 20 / 21. Documents by their weakest level: 213 `label-unique`, 15 `page-number`,
  44 `text-number`.
- **Provenance written to every document's metadata** (all from the manifest): `sourceClass` (`manufacturer-site`), `publisher`,
  `site`, `tradeName`, `registrationNumber` (primary = strongest, then lowest number), `registrationNumbers`, `registrationMatches`
  (`registrationNumber`, `tradeName`, `matchLevel`, `evidence`), `matchLevel` (the weakest accepted level of the document) and
  `matchMethod` (`number-in-text` / `number-on-page` / `name-form-holder`), `officialSourceUrl` (the document URL, https only),
  `pageUrl`, `fetchedAt`, `httpLastModified`, `documentRevision` (as the collector derived it, file-name dates included),
  `instructionLabel` (only when a revision/date was printed in the text: 3 documents), `pdfSha256` (the file's sha256, also for DOCX),
  `fileFormat`, `rawPath`, `documentKind`, `ocr`, `textExtractionMode`, `ocrEngine`/`ocrMeanConfidence` when present,
  `qualityScore`, `ocrLowConfidenceRatio`, `pdfPageCount`, and `sourceUrls`/`pageUrls` when one file was reached by several links.
  `sourceType` stays `official_drug_instruction`, so the registration index and the drug screen pick the documents up; the title names a
  leaflet/ОХЛП like the GRLS ones. Rights of the holders' texts are not assessed (owner decision: shipping approved for this source).
- **Size:** 7.34 MB download (7 340 963 B, framed zstd), 46.4 MB installed (46 444 544 B; 64.6 MB before compaction). Tag
  `manufacturer-instructions-2026.10.05-7a74c67f575d` (12 hex of the `sourceSetDigest`), branch
  `datasets/manufacturer-instructions-2026.10.05-7a74c67f575d` (`modules/<file>.db.zst`, created additively), SHA-256
  `f8c4ab3c…bb420c`; the raw.githubusercontent.com URL returns the catalog's size and SHA-256 with CORS. Catalog
  `release-0.6.48-m1.2026.10.05` (828 modules, +1); `artifact-url.ts` maps the `manufacturer-instructions-` tags; locale key
  `collection_manufacturer-instructions` (ru/en).
- **Verified:** python:check (1 077 tests), pack integrity and foreign keys, compaction proof, framed zstd decoded with the app's reader
  (packaging script) and with the reference `zstd` CLI, SQLite query of the built module (272 documents, 240 distinct registration
  numbers, `sourceClass`/`matchLevel`/`matchMethod` in every document, kinds), vitest (`catalog.preview`, `artifact-url`, shell,
  sections, onboarding). **Not verified:** installing the module in a browser/Android profile, the drug-screen wording for this source
  class (MED3 UI), search ranking over the mounted module, text overlap with the ГРЛС version of the same drug.

## Drug comparison: tool, index and search card — 2026-10-06 (STATE CMP1)

Owner request 2026-10-06: «Compare drugs by parameters» (release 0.6.52). Details, numbers and the hand check:
[`research/drug-comparison-2026-10-06.md`](research/drug-comparison-2026-10-06.md); roadmap item 16 of
[`SEARCH_ROADMAP.md`](SEARCH_ROADMAP.md).

- **Tool «Сравнение препаратов»** (`#/notes/drug-comparison?c=<slug|slug|Trade name>&d=<typed name>`, 2–4 drugs, substance or
  product chosen with the app's own drug search, `apps/app/src/features/drug-comparison/`). Columns per drug, rows per
  parameter, the first column pinned on a wide screen, every row stacked with the drug's name on a phone. Rows: МНН, ATC code
  and НСИ group names, registry pharmacotherapeutic group, forms and strengths (ЕСКЛП), conditions of dispensing (ГРЛС
  register), ЖНВЛП per form, counts of registrations / trade names / manufacturers / holders; the instruction's own
  pharmacotherapeutic-group and dispensing lines quoted; age and weight, pregnancy, breastfeeding from the SAFE1 extraction
  run on the open instruction; six quoted sections (Показания, Противопоказания, Способ применения и дозы, Побочное
  действие, Особые указания и «С осторожностью», Передозировка) declared in `SECTION_ROWS`; the INT1 sentences and INT2
  DDInter label for the pairs (the same panel as the interaction tool, `InteractionPairs.tsx`).
- **Deterministic marks, no generated text.** Sections are split into sentences and list items (plain substrings of the
  instruction), normalised (case, punctuation, light stems, numbers kept, the drug's own names ignored) and matched across
  the drugs: «у обоих» / «у всех» (identical), «формулировки различаются» (Jaccard ≥ 0.6, or ≥ 85 % of a ≥ 4-word statement
  inside a longer unit; differing words and numbers marked), «только у X». «Показать только различия», «Показать полностью»,
  «Открыть в инструкции» per statement. The notice «Сравнение текстов инструкций, а не клиническая рекомендация» is on the
  screen, the print and the share text; no summary, no «лучше / хуже».
- **Which instruction is read.** The index lists every instruction with the sections it has: the most sections, ГРЛС before a
  holder's site, professional before leaflet; a product asked for keeps its own instruction; otherwise one dosage-form class
  is read for every drug where each has one. Another instruction of the substance is one `<select>` in the column head; the
  ADR-0023 wording and the leaflet note are shown; missing modules are offered once.
- **Index** `apps/app/src/features/drug-comparison/data/comparison-index.json` (2.5 MB, 541 kB gzip, lazy chunk; registry facts
  per card and a section map per instruction, **no text**), built by `bun run content:drug-comparison`
  (`scripts/build-drug-comparison.ts`: instruction modules checked against the catalog SHA-256 like INT1 / SAFE1, ЕСКЛП
  cards, ГРЛС register `data/raw/official-grls-registry/catalog-02.10.2026.json` for the conditions of dispensing; report
  `data/build/drug-comparison/report.json`). Rebuild it with every instruction-module or register refresh.
- **Search entry.** «X или Y», «X vs Y», «сравнить X и Y», «чем отличается X от Y», «разница между X и Y» (`parseComparisonQuery`)
  → a card «Сравнить: X, Y» above the results of «Все источники» and «Препараты», only when every part names a drug in the
  ordinary drug search (S3 layout / transliteration included, genitive names re-looked-up as their stem). Diseases and
  symptoms get no card. No search code, ranking or alias changed.
- **Entry points.** The search card; «Сравнить с…» in the quick links of a substance card and of a trade-name screen
  (`links.compare` in `drug-screen.ts`); «Сравнить эти препараты» in the interaction tool; «Все инструменты» and the tool search
  (`DRUG_COMPARISON_TOOL`, `ageScope` «any»); print and share like the interaction tool.
- **Refactor.** The pairs block of the interaction tool (quotes, severity labels, offers, summary) moved from
  `DrugInteractionWorkspace.tsx` to `InteractionPairs.tsx` (`InteractionPairsPanel`) so both tools show the same text; classes
  and test ids unchanged. `QuoteBlock` of `SafetyBlocks.tsx` is exported; `endsSentenceAt` / `isUpperStart` of
  `interaction-text.ts` are exported.
- **Measured** (research note): 198 of the 200 most common substances (99 %) have all six quoted sections in the instruction read
  first; marks hand-checked on 62 statements 95.2 % and on 63 after the containment rule 100 % (sample in
  `research/data/cmp1-precision-sample.json`; two known error classes left); 4-drug comparison computes in 66–86 ms (desktop,
  bun + SQLite); `bun run benchmark:cmp1` 35/35; exact-lookup gates unchanged.
- **Not verified:** Android / WebView, devices, emulators; print on paper; recall of shared statements; statements on one topic in
  different words are not matched (a «только у X» can be shown for a topic the other drug also covers).
- Tests: unit (`comparison-*.test.ts`, 50 cases: units, normalisation and matching, view and instruction choice, registry rows,
  build, query parsing, routing) and e2e `apps/app/e2e/drug-comparison.spec.ts` (instruction module from local bytes; screenshots
  `output/cmp1-screens/`).

## Pregnancy, lactation and child-age questions in search — 2026-10-06 (STATE SAFE1)

Owner request 2026-10-06: «X разрешён ли во время ГВ», «X при беременности», «X можно кормящей», «X ребёнку до Y лет / ребёнку 3 лет /
с какого возраста X». Design, rules, measurements and what is not done:
[research/medication-safety-2026-10-06.md](research/medication-safety-2026-10-06.md); roadmap item 15 in
[SEARCH_ROADMAP.md](SEARCH_ROADMAP.md).

- **Index** (`scripts/build-medication-safety.ts`, `bun run content:medication-safety`, rebuild after every instruction-module refresh):
  same inputs and SHA-256 checks as the INT1 build; writes `apps/app/src/features/medication-safety/data/safety-index.json` (1.8 MB,
  592 kB gzip, lazy chunk) and `data/build/medication-safety/report.json`. It holds offsets into the canonical text of each section plus a
  4-hex checksum — no instruction text. Per МНН card the best instruction of each of up to five dosage forms (3 201 of 9 186 instructions).
  Per sentence: topic (pregnancy / lactation), origin section, dosage forms named; per age limit: operator, bounds (days / tenths of kg),
  the words it was read from.
- **Query parsing** (`safety-query.ts`, syntactic): intents lactation / pregnancy (trimester) / age (typed age or «до N лет»); the
  rest, minus frame words, is the name; looked up with the app's own medication search (S3 layout / transliteration fallback included).
  A name that no result group carries (a symptom, a disease) shows no card.
- **Card** (`MedicationSafetyCard`, above the results of «Все источники» and «Препараты», not shown for the interaction query): quotes of the
  installed instruction without change, grouped (the pregnancy section; «Противопоказания» and «С осторожностью»; other sections folded),
  each with its section, the source line (kind, edition, ГРЛС / holder's site, fetch date, form), dosage forms named in the sentence and
  «Открыть в инструкции». Age: limits by section, weight limits apart, and for a typed age «Рассчитано: 3 года — меньше верхней границы
  12 лет» lines (labelled as the app's arithmetic). Never «можно / разрешён / безопасно» in the app's own words. States: not installed
  (download offer through the module runtime), no instruction in the sources, «В инструкции об этом не сказано» (the instruction read is
  named, with a link to open it), changed section (reported). The instruction read is «одна из инструкций по этому веществу» (ADR-0023
  wording) unless the doctor typed the product; the other dosage forms of the substance are a switch.
- **On the open instruction**: «Беременность, ГВ, дети» folded block in `OfficialDocumentReader` (`DrugSafetyBlock`), the same extraction run
  on the open text (so every registration has it, not only the instructions the index keeps).
- **Measured**: coverage (2 398 МНН cards have an instruction; 74.6 % a pregnancy section, 93.0 % / 90.6 % ≥ 1 pregnancy / lactation
  sentence anywhere, 88.1 % a numeric age limit); hand-checked precision 98.3 % (age), 100 % (weight), 94 % (age group without a number),
  98.3 % (section sentences), 94.5 % (mentions outside the section) on 50–60 sentences each; recall ≈ 99 % of the number + unit +
  child-word sentences. Separate set `tools/benchmarks/safe1-queries.json` (44 questions): 44/44 with and without the module installed;
  `benchmark:real:release`, `benchmark:doctor-lookup`, `benchmark:owner-queries` unchanged (no search code changed).
- **Not done / not verified**: comparing the substance's other manufacturers' instructions; trade names inside quoted text; print / share of
  the card; Android / WebView / devices (desktop Chromium only); limits worded without a number or in sections the section splitter typed
  wrongly.

## Drug interactions: tool, index and search entry — 2026-10-06 (STATE INT1)

Owner request 2026-10-06: a drug-interaction «calculator» (UI idea from vidal.ru; Vidal's data is proprietary and is
not used — only a «Проверить на vidal.ru» link-out that sends nothing). Research, measurements and the severity-source
recommendation: [research/drug-interactions-2026-10-06.md](research/drug-interactions-2026-10-06.md).

- **Index** (`scripts/build-drug-interactions.ts`, rebuild after every instruction-module refresh): reads the 16 published
  instruction modules (SHA-256 checked against the catalog), the ЕСКЛП cards and the НСИ «АТХ» names; writes
  `apps/app/src/features/drug-interactions/data/interaction-index.json` (2.0 MB, 672 kB gzip, lazy chunk, no instruction
  text: sentence offsets into each section plus a 4-hex checksum) and `data/build/drug-interactions/report.json`.
  Sections: interactions, special instructions, contraindications, caution (flagged by section); a leaflet without a typed
  interaction section is read only for sentences about taking drugs together. Substances by МНН (whole word, inflection-aware,
  own substance excluded), classes by the official ATC group names (derived; 35 documented aliases, each pointing at НСИ codes).
- **Tool** «Взаимодействие препаратов» (`#/notes/drug-interactions?d=<name>&c=<card>`, listed in «Все инструменты» and the
  search catalog, ageScope any, Print / Поделиться): 2–10 drugs from the ordinary drug search (+ «Алкоголь»), per pair the quoted
  sentences of each drug's instruction with the matched words marked, the section, the source (kind, edition, ГРЛС/holder site)
  and «Открыть в инструкции» (reader at the chunk). States: «упоминание найдено», «в инструкциях упоминаний не найдено»
  (never «безопасно»; the notice says so), «инструкция не установлена — скачать» (one offer per missing module), no instruction
  in the sources. The instruction read is one of the substance's instructions and is labelled so (ADR-0023). A changed section
  text is reported, not guessed.
- **Search entry**: «X взаимодействие с Y, Z», «совместимость X и Y», «X и алкоголь» (`parseInteractionQuery`, syntactic, cue
  word + separators) add a card «Проверить взаимодействие: …» above the results of «Все источники» and «Препараты»; the
  ordinary search and ranking are untouched (benchmarks before/after in the research note).
- **Measured**: 12.2 % of the 19 900 pairs among the 200 most common substances have ≥ 1 sentence in either instruction; 1 484 of
  3 324 МНН have an indexed interaction section (2 398 have any instruction). Hand-checked precision (50 sentences): all
  targets right 96 %, relevant to a pair 86 % (interaction section 27/27, «Особые указания» 6/12).
- **Not done / not verified**: trade names in instruction text; Android/WebView; products as items (a drug is picked as a
  substance); `benchmark:*` unchanged by design (no core change). The severity layer is INT2 below.

### INT2: optional DDInter severity labels and the fold — 2026-10-06 (STATE INT2)

Owner decisions of 2026-10-06 (recorded in `docs/research/drug-interactions-2026-10-06.md` §5): a severity layer is wanted as an
optional, separately downloadable module from DDInter 2.0 (CC BY-NC-SA 4.0, personal non-commercial app), **labels only**
(no English text, no machine translation); a label only on a pair that already has an instruction sentence, naming the source;
sentences outside the interaction section folded; INT1's best-instruction-per-substance rule kept.

- **Source and licence checked** (`docs/research/drug-interactions-2026-10-06.md` §6.1): terms page states CC BY-NC-SA 4.0; the bulk
  download has no login or CAPTCHA; its CSV files hold only `DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level` (no ATC codes, no text);
  14 files, six of them (C, G, J, M, N, S) not linked from the download page but served from the same path. Raw files and
  `MANIFEST.json` (SHA-256 per file) in `data/raw/ddinter/` (33 MB, local, git-ignored).
- **Join** (`tools/ingest/src/localmed_ingest/ddinter_severity.py`, CLI `tools/ingest/scripts/build_ddinter_severity_module.py
  manifest|report|build`, 13 pytest cases): DDInter English name → НСИ «АТХ» level-5 English name (exact, salt-stripped, 21 listed USAN → INN
  spellings, each checked against НСИ) → ЕСКЛП single-substance card (НСИ Russian name equals МНН, or the card's own code with the same first
  word). 815 of 1 971 DDInter drugs and 811 of 2 020 single-substance cards joined; **79 884 labelled card pairs**, of which **19 213** also
  have an instruction sentence (the only ones the tool shows); 1 071 of the 2 430 pairs with a sentence among the 200 most common substances.
- **Module** `minimed.reference.ddinter-severity.ru` (`kind: reference`, collection `ddinter-severity`, preview, `minAppVersion` 0.6.52,
  `capabilities.search: false`): 799 documents (one per card that is the smaller slug of a labelled pair: `<partner slug> TAB <level code>`;
  a manifest document with source, licence, date), documents flagged `definitionReference` so they stay out of the search index, 6.5 MB
  installed, 243 KB download, reproducible build. Packaged with `bun scripts/package-instruction-modules.ts --family ddinter` (tag
  `ddinter-severity-2026.10.06-51ff325a7659`, mirrored through the `datasets/<tag>/modules/` branch like the other medication modules;
  `artifact-url.ts` maps the tag). The installer accepts an empty search index only for a module that declares no search
  (`module-search-index.ts`).
- **Tool**: `interaction-severity.ts` (levels, rules, labels «Серьёзное / Умеренное / Слабое / Степень не определена по DDInter»),
  `interaction-severity-load.ts` (reads the manifest and one document per pair through `core.getDocument`), a badge with the note «Оценка из
  международной базы DDInter … а не из инструкции» under the pair status, a source block (source, licence link, retrieval date, count),
  `SeverityDownloadOffer` («Скачать метки степени риска (DDInter), 243 КБ», shown only when a quotable sentence exists and the module is not
  installed), the label and attribution in print and share text. **A label needs a level for the pair and at least one sentence quotable now**
  (instruction installed): alcohol and pairs without sentences get none. No module: nothing changes.
- **Fold**: per side, interaction-section sentences (and a leaflet's general-text sentences, which have no typed interaction section) stay visible;
  «Особые указания», «Противопоказания», «С осторожностью» sit behind the shared `Disclosure` «ещё из других разделов (N)», closed by default; a
  side with only folded sentences says so. Print and share keep every sentence with its section name.
- **Tests**: `test_ddinter_severity.py` (name matching, aliases refused when not НСИ names, card codes, most-severe rule, pack content, raw checksum
  manifest), `interaction-severity.test.ts`, `interaction-view.test.ts` (label rules, print, `splitQuotes`), `module-search-index.test.ts`,
  `catalog.preview.test.ts`, `artifact-url.test.ts`; e2e `drug-interactions-severity.spec.ts` (module installed from its local bytes with the
  catalog chunk's minimum version lowered, `severity-module-fixture.ts`; fold; no label without a sentence; no leak into search).
- **Not verified**: Android/WebView, a phone, the module card in the knowledge-base catalog UI (not looked at under load), the app on the real catalog URL (the mirror branch and the pre-release are published; the catalog entry reaches `main` with the app code),
  the module on old apps (they hide it by `minAppVersion`), clinical accuracy of DDInter levels (shown as the source's label, never as advice).

## Same-substance instruction fallback (MED3) — 2026-10-05

Owner decision D1 (2026-10-05, delegated and decided; details in [ADR-0023](adr/0023-same-substance-instruction-fallback.md) and
`docs/research/medication-instructions-2026-10-05.md` «Decisions»): a product with no instruction of its own shows, labelled, the
instruction of ANOTHER registration of the same МНН. Never presented as the product's own text, never merged, exact provenance kept,
no fallback across МНН or form classes. D2 (the M1 holder-site module) is the section above; D3–D5 (official requests, BY/KZ
registers, machine translation) stay not done.

- **Matching is build-time data.** `tools/ingest/src/localmed_ingest/substance_fallback.py` (pure; 43 pytest cases in
  `tests/test_substance_fallback.py`) + `tools/ingest/scripts/build_substance_fallback.py` read the released ЕСКЛП cards, the
  documents the released instruction modules hold (GRLS module reports + the instruction manifest, and the M1 module report) and the
  ГРЛС registry export (holder country and date, ranking only), and write the generated asset
  `apps/app/src/features/medications/substance-fallback.json` (schema 1: ranked donor lists shared between registrations, 669 kB,
  14 180 registrations, 3 358 groups, lazy chunk) plus `data/build/substance-fallback/report.json` (coverage). Rebuild it with
  `bun run content:substance-fallback` after every instruction-module refresh or collector window; nobody edits it by hand.
  Level 1 = the same СМНН node or an identical form string with an identical canonical strength (`0,5 г` = `500 мг`, combinations keep
  their order; an unstated strength, «НЕ УКАЗАНО», is never «the same»). Level 2 only when level 1 has no donor: same form class
  (the collector's `dosage_form_class`) with a different strength (flag 1), unstated strength (2) or another wording of the form (4).
  A donor always belongs to the product's own ЕСКЛП МНН card. Ranking: fewest differences, ГРЛС before holder-site, ОХЛП >
  instruction > leaflet, foreign holder (originator proxy), earliest registration, number; four donors per registration.
- **Drug screen** (`instruction-fallback.ts`, `substance-fallback.ts`, `use-substance-fallback.ts`; `DocumentPageHost`,
  `OfficialDocumentReader`): the asset is validated at the boundary (schema, flags/level consistency); a donor applies only if it is
  in the product's own card and its document is installed (the existing registration index), so nothing shows until the group's
  instruction module is installed (the existing download offer stays). The «Инструкция» tab then opens the donor document; above the
  donor's own source block a fallback block shows the label «Инструкция другого производителя: то же вещество, форма и
  дозировка», the warnings (level 2: «Дозировка отличается: проверьте дозы по своему препарату»; unstated strength: «Дозировка в
  реестре не указана: …»; other form wording: «Лекарственная форма отличается: …»), the donor product (trade name, registration,
  holder, form and strength) and «Это не инструкция выбранного препарата…». The product card's source line no longer claims ГРЛС for a
  fallback; a hint under the «Кратко | Инструкция» switch names it. A restored history entry is re-resolved against what is
  installed. A product with an own text never gets a fallback; a ГРЛС file outranks a holder-site document of the same registration.
- **Holder-site documents in the screen:** the source block names the holder («Сайт производителя: АО «ВЕРТЕКС»»), links the
  document, and states the match method per registration (number in the text, number on the product page, or «по названию, форме и
  держателю: номер регистрации в документе не напечатан»); `instructionSourceClass` keeps the product's source line honest.
- **Coverage** (604 213 ЕСКЛП product positions = packs, deduplicated by КЛП code; own = the registration has a document in a released
  module, now including the 231 M1 registrations that are in ЕСКЛП):

  | | own text | + level 1 (same form and stated strength) | + level 2 (same form class) | none |
  |---|---:|---:|---:|---:|
  | all positions | 267 374 = **44.3 %** | 88.9 % | **97.4 %** | 15 752 (2.6 %) |
  | ЖНВЛП positions (345 837) | 42.2 % | 94.3 % | 99.0 % | 3 519 |
  | trade name × МНН units (12 038) | 55.8 % | 83.0 % | 89.2 % | 1 296 |
  | registrations (29 300) | 12 897 = 44.0 % | + 10 869 | + 3 311 | 2 223 |

  Versus MED2's estimate (43.7 % → 94.3 % same СМНН node / 97.3 % same form class): without M1 the same method gives 43.7 % own, 95.1 %
  node-equivalent and 97.3 % form-class-equivalent (the 0.8-point gap to 94.3 % is unreconciled: positions listed under several
  registrations), so the estimate holds. The shipped level 1 is stricter than «same node»: 6 points of positions sit in groups whose
  strength the registry does not state (14 % of trade entries) and are level 2 with a warning, which is why level 1 alone is 88.9 %.
  Level 2 first donors: unstated strength 2 173 registrations, different strength 456, other form wording 322, wording and strength
  231, wording and unstated strength 129. МНН cards: 2 395 of 3 324 have a text somewhere; the other 929 have no registration with a
  text, so nothing can be shown for them (nothing crosses an МНН).
- **Verified:** pytest (matching), vitest (`instruction-fallback`, `instruction-source`, `medication-record`), e2e
  `apps/app/e2e/medication-instruction-fallback.spec.ts` on a real build with the real antiparasitic ЕСКЛП module and GRLS instruction module
  (level 1 Албендазол-Эдвансд, level 2 Гельминтокс with its warning, own text Вермокс without a block; screenshots in
  `output/med3-screens/`, light and dark, 390 px). The real M1 module was read with the app's own functions (272 documents, 240
  registrations indexed, 213 / 47 / 16 registration-document pairs by match level).
- **Not verified:** Android/WebView and slow devices; the M1 module installed in a browser profile (its drug-screen wording was checked
  on the real module's metadata only); clinical suitability of any donor text (that is the label's job, not a check); search ranking
  with the M1 module mounted; the fallback asset's refresh after the next collector window (manual rebuild step).

## Exact lookup (S2) — 2026-10-05

- Lexical lookup no longer matches a short query word inside a longer one («боли» → `Болиголов`), drops
  groups that share only form/audience/meta words with the query, prefers documents with every subject
  word, and finds «Вирусные менингиты у детей» for «менингит у ребёнка» (rules in `docs/SEARCH.md`).
  Measured: `benchmark:doctor-lookup` R@5 0.7 → 0.9, MRR 0.65 → 0.85; `benchmark:real:release` lookup
  R@1 0.803, R@5 0.934, MRR 0.855 → 0.852 (unchanged within tolerance, no re-baseline).
- Left: the release set is mostly narrative clinical phrasing (clinical path); its misses come from
  the intent branch («лечить», «терапия») matching ICD Z-codes when the subject is lost to a negation
  span, and need the clinical parser. Indication queries («от давления») need the semantic path (E3).

## Release 0.6.47 — 2026-10-02

- Ships core 0.6.47 (no pilot; 30 new КР editions, replaced editions point to successors), the
  КР refresh to the 2026-10-02 rubricator, the reader edition notice, НСИ ATC names and the FIX1
  fixes. Release ratchet passes on the full databases (lookup R@1 0.803, R@5 0.934).
- Verified: `bun run verify`, 27 targeted browser E2E tests, emulator clean install with the new
  core (metered-network consent → gzip download → ready).
- Known: the «Препараты» catalog is empty until a medication module is installed (pilot drug
  cards left the core).

## Release 0.6.46 — 2026-10-02

- Ships the smooth start-up, guided onboarding, drug screen, motion settings and the compressed
  module distribution (ЕСКЛП ×15 and КР ×744 as framed zstd from the dataset mirror branches,
  `minAppVersion` 0.6.46; kras/МКБ/РЛС-упаковки zstd gated to 0.6.45; Android core as gzip).
- Verified: `bun run verify`, 23 targeted browser E2E tests, emulator clean install (core gzip
  download → search; КР and ЕСКЛП zstd modules installed from the real mirror and opened).
- Known limitation at release time (resolved 2026-10-02, see «Pilot corpus retired»):
  `benchmark:real:release` reported `pilot.sectionRecall` 0.836 against 0.869; v0.6.45 measured the
  same, so the drop predated this release.
- Not in this release (owner decisions pending): ГРЛС access (its robots.txt forbids crawlers),
  Allmed redistribution, refreshing КР (+30 editions since 2026-07-27); embeddings paused.

## Smooth start-up — 2026-10-01

- Android splash shows the whole launcher wallet (`res/drawable/splash_icon.xml`) and stays until
  the page calls `window.MiniMedBoot.ready()` (a JavaScript interface from
  `LocalMedSystemUiPlugin`, because plugin calls queue behind the database plugin) or 4 s pass,
  then fades onto `#boot-surface` in `index.html`: the same image at the same screen position
  (`MiniMedBoot.iconShiftY()` corrects for the system bars). `src/app/boot-surface.ts` removes it
  with one fade once the first view's code and fonts are in and two frames have painted. The
  former «Запускаем MiniMed…» card and the reveal veil are gone.
- `FirstRunSetup` (now the lazy onboarding, see below) is lazy; its package list loaded the full module catalog after the reveal, so the
  9.6 MB catalog chunk is no longer in every launch's start-up graph (12.2 → 2.5 MB; emulator
  DOMContentLoaded 5.9 → 1.8 s). The session's catalog load also waits for the reveal.
- `capacitor.config.ts` sets `loggingBehavior: 'none'`: prereleases are debug builds, where
  Capacitor echoed every bridge result (SQL rows, query text) to logcat.
- Open: on the loaded emulator the native core open still takes ~25 s before search is ready.

## Motion settings — 2026-10-01

- Settings → «Анимации» (Выключены / Быстрые / Обычные / Медленные), stored as
  `motionSpeed` in app preferences. `src/state/motion.ts` retimes every CSS transition, keyframe
  animation and `Element.animate` call through `playbackRate`; «off» collapses durations in CSS so
  end states and `transitionend`/`animationend` still happen. JS-timed code uses `motionMs()`.
- `OverlayDialog` keeps a closing dialog mounted until its exit plays: on phones the sheet slides
  down from where it was released (pull-to-close continues instead of snapping back), the backdrop
  fades; wide-screen dialogs fade and settle. Verified in headless Chromium (close ≈ 290 ms).

## Guided onboarding — 2026-10-01

- `apps/app/src/features/onboarding/` replaces the first-run modal (`FirstRunSetup`, its package
  list and the carousel on that screen are gone). The real search page renders under a full-screen
  blur; after the splash leaves: «Привет», «Добро пожаловать в MiniMed», then the core download on
  a thin line along the bottom edge (`CoreProgressLine`: percent and smoothed speed from
  `coreProgress.loaded` samples, own texts for verifying/installing, «Скачать» on a metered
  connection, «Повторить» on error). An installed core is reported as «уже на месте».
- «Далее» begins the tour (steps 2–9 of 9, data in `onboarding-steps.ts`, state machine in
  `onboarding-controller.ts`): the blur recedes to a light band at the screen edges (registered
  `@property --onboarding-clear`; the band is the «tutorial mode» indicator, there is no edge glow
  or particle layer), the intro's «Далее» flies into the hint card with the View Transitions API
  (cross-fade without it), and hand-drawn arrows are drawn with `stroke-dashoffset` from the card
  to the control found by `[data-tour="…"]` (rAF-batched tracking; carousel slides out of sight are
  scrolled into view). Arrows are plain SVG: a few tangent-continuous cubic Béziers with one small
  loop and a two-stroke curved head turned to the shaft's last direction, viewBox in CSS pixels, no
  filter or noise. Step 2 spotlights the bottom navigation (`data-tour="nav"`): a pulsing ring whose
  shadow dims the rest of the screen a little (static with animations off or reduced motion). The
  welcome scene shows the real `boot-icon.png`; both «Пропустить» buttons are bordered 44 px pills.
  The tour switches between search and «Мои файлы» and returns to search at the end.
- Start-up hand-off: when the onboarding will show, `App.tsx` calls
  `revealFromBootSurface({ handOff })` and the splash does not reveal search. The onboarding is
  already mounted under the surface (blur at full strength, the wallet icon as the intro's anchor);
  after the native splash has faded, `document.startViewTransition` removes the surface and starts
  the greeting in one frame while the splash icon (`minimed-boot-icon`) flies onto the intro icon
  (520 ms, `::view-transition-group` in `onboarding.css`) and the ground cross-fades into the blurred
  app. Without the API or with animations off the surface fades over the intro. A finished
  onboarding keeps the plain fade into search. Checked by 25 fps video frame strips at 390 px (light,
  dark) and an rAF probe: no frame shows bare search. `afterBootReveal()` still resolves after it.
- Optional downloads inside the tour go through the real feature code: «Скачать препараты» queues
  the released `medication` modules through the module runtime (the 10 MB catalog loads only at
  that step, after the intro; size from the catalog), «Скачать модель (в фоне)» activates the first
  runtime-ready Whisper model through `asr-models`. The «Мои файлы» step and the tour's imaging
  slide cycle six sagittal head-MRI frames captured from MiniMed's own viewer on the downloadable
  MRI example (`public/onboarding/mri-viewer`, provenance in its SOURCES.md; 2026-10-05, replacing
  the drawn demo and the OpenNeuro axial slices). The tour dialog «Что умеет MiniMed» had lost its
  stylesheet with the old first-run modal (0.6.46) and has it again.
- Dismissal is unchanged: `dismissSetup()` runs only when the core is installed (at the end of the
  tour or when it arrives later); otherwise the tour hides for the session and returns next launch.
  `restartOnboarding()` (`onboarding-state.ts`) runs it again; Settings needs a button for it.
- Verified in headless Chromium at 390 and 1280 px (light, dark, reduced motion, animations off,
  core ready / downloading / failing; dark theme re-checked step by step) and by `e2e/onboarding.spec.ts`; not verified on a physical
  Android device or WebView build (View Transitions there).

### Onboarding polish (UX5) — 2026-10-05

- The intro no longer advances by timer: «Привет» (logo) → «Далее» → short text about the app →
  «Далее» → core screen → «Далее» → tour (`IntroPhase`: `wait | hello | welcome | core`). The core
  download starts only on that second «Далее» (`holdCoreStart()` in `setup-state.ts`, set in
  `App.tsx` when the onboarding will open, released by the onboarding on `core`/tour/done/unmount;
  `use-app-session` awaits `whenCoreStartReleased()` before asking for consent). The progress line is
  hidden until then. The core screen plays the icon: vector documents (`OnboardingDocuments`) leave
  the wallet, it fades, three sheets drift, the middle one higher (transform/opacity only; reduced
  motion = static triplet).
- The «notification over the button» was the wide metered-connection caption of the progress line
  («Мобильная сеть: загрузка ядра около …» + «Скачать», centred above the navigation, z-index above the
  tour): while the onboarding is open it is a compact pill in the bottom corner (`compact`), the tour
  card keeps a 44 px strip clear of it, the intro footer sits above it. Toasts slip under the tour
  (`:root[data-onboarding]`); the speech-model failure shows inside the card.
- Tour card respects the safe area (`safe-insets.ts`), falls back to a tighter arrow gap and scrolls the
  page (`scrollDeltaToFit`) when neither side has room; the arrow ends `ARROW_OUTSET` from the control,
  clear of the ring; `data-tour` slides are re-revealed (900 ms) after the carousel restores itself.
  Tour body padding stops the buttons' shadows being cut square. «Мои файлы»: the list is a collapsed
  accordion (`bulletsSummary`), the MRI source is behind a «?» (`MriSliceViewer variant="badge"`).
- Home «Полезные функции» (`components/Carousel`): 12 px gap, scroll-driven scale/opacity on slides
  (`animation-timeline: view(inline)`, snaps without support), arrows moved under the slides beside the
  dots (no longer clipped), autoplay paused while the onboarding is on screen.
- Not verified on the Android emulator, a physical phone or HyperOS WebView.

### Home polish 2 (UX7) — 2026-10-05

- **Carousel scroll**: the track no longer reads layout per scroll event (stride cached on width change,
  passive listener + one rAF, signal only when the slide changes), the resize observer reacts to width
  only, `will-change` is set on the slide frames only while the track moves. On native Android the
  scroll-driven scale/fade is off (`carousel__frame--plain`). Desktop headless, 4x CPU, 6 touch swipes:
  scroll-event dispatch 604 ms to 227-316 ms, FunctionCall 1264 to ~800 ms, one 259 ms long task to none;
  desktop was already 120 fps, so the Android-WebView gain is not measured (the shared emulator was
  taken by other agents).
- **First-tap stall (root cause of «hard re-render» on opening a section)**: the first UI sound built
  the `AudioContext` (~205 ms) inside the tap. `uiSounds.warmUp()` now preloads the common cues in idle
  time 1.5 s after start (`installUiFeedback`). Opening a section: longest task 428 ms to 85 ms.
- **Open section = page**: `#/search/section/<id>` (entry pushed with `history.state.searchSection`,
  replaced on section switch). Back arrow, system/Android back and `Escape` return to the list, which
  stays mounted and gets its scroll back (`restoreScroll` retries while the page is laid out);
  the section starts at the top with a 220 ms slide/fade (transform + opacity, `backwards` fill).
  `SearchWorkspace` leaves list/section scroll to `SearchHome`. A group of «Все источники» has no address.
- **«Примеры поиска» arrows**: centred on the chips row (`--example-pad-*` variables), row clips sideways
  only so chip and arrow shadows are not cut; e2e checks centre within 2 px and corner hit-tests.
- **«ЭКГ по фото»**: the tool route has no description page any more; the editor is the route.
  Closing it (`leaveTool`) replaces the route's history entry with the recorded origin (search page for a
  deep link), re-entering reopens it, closing «Готовые измерения» returns to the editor (a button on step 1
  opens them). Inline use keeps the small launcher. The home «?» opens the editor's first step.
- **Context menu**: an item with no actions has a disabled trigger (no menu on long press or right click,
  the event reaches the page menu) and no «⋯» button.
- **«Клинический разбор»**: a note above the results (`ClinicalAnalysisNote`) and an explanatory
  placeholder. **«Скрыть»** on «Полезные функции» stores `usefulFeaturesHidden` in app-preferences; a quiet
  «Показать полезные функции» link at the end of the home restores it (Settings toggle left to SET1).
- Tests: `ux7-home`, `ecg-close`, `empty-context-menu` e2e, `search-section-route`, `ui-sounds`,
  `app-preferences` units. Not tested: Android WebView frame rate, physical device.

### Tools, tour, recording activity and button depth (UX6) — 2026-10-05

- **«Все инструменты»** lists only real app features (`APP_TOOL_IDS`, `quick-tools.ts`): «Запись беседы»,
  «ЭКГ по фото» (id `ecg-photo-caliper`), «Формы» (`#/notes/forms`), «Заметки», «Просмотр снимков»,
  «Калькуляторы» (+ the experimental dictionary). Calculators and questionnaires are starred from
  their own pages (star on every calculator and questionnaire card, same `item-collections`
  favourites as before, shown in the quick row). Patients/questionnaires entries are no longer
  listed but still resolve for stars from older versions. `QuickTool.dropFiles` makes a tool row a drop
  target (data, not an id check).
- **«Просмотр снимков»**: an empty state (`ImagingViewerEntry`) with «Открыть из моих файлов» (DICOM and
  NIfTI already in the library), «Открыть новый файл» (`userLibraryFileAccept()`, imports into
  «Исследования») and a drop target; a file dropped on the tool row imports and opens directly.
- **Home «Полезные функции»** no longer repeats header actions (graph card removed; ECG, imaging,
  recording stay). The imaging card and the tour's imaging slide offer «Открыть пример МРТ» when the
  example is already in the library, otherwise a link to «Исследования»; nothing downloads from them.
- **«Что умеет MiniMed»**: every slide has a navigation action (search, patients, record, notes,
  research folder / MRI example, calculators + questionnaires); navigating closes the dialog; the dialog
  clips (`overflow-x: clip`, `contain: inline-size`) instead of letting the track widen it.
- **Search page**: «Все инструменты» is a primary button (icon takes the label colour), pinned tools are
  raised secondary buttons, «?» is a `ui-button`; while a section is open with an empty field the history
  button becomes a «Назад к разделам» arrow (Escape and Android back do the same via `[data-search-back]`).
  Scroll rows (quick access, examples, carousel) carry padding with a compensating negative margin so
  hover shadows are not clipped.
- **Recording activity**: the bar «Идёт запись беседы» (time, level meter) opens a window built on the
  `.floating-window` frame with a full-screen toggle, live text, a note when no speech model is loaded, and
  «Стоп»; it lives in `ConversationRecorderHost`, so it survives tab switches. Live text
  (`live-transcription.ts`) recognises the newest 6–28 s of the in-memory recording with the loaded browser
  Whisper model every 7 s, skips silence, stays in memory, is cleared on stop and never logged. Not saved
  into the patient record (only the audio is). No model: timer and meter only.
- **Button depth** (`--theme-primary-*` tokens in `theme.css`/`theme-dark.css`, `Button.css`,
  `primary-depth.css`): hover = lighter face, bright top edge, larger shadow; press = inset shadow and the
  label sinks. **No control transforms on hover or press** (a moving box slides from under the pointer at its
  edge, ends the hover and loops, replaying the hover sound): the global `button:hover` lift, card lifts and tilt
  were replaced by shadow-only states; `UiSoundController.hover` also ignores a re-entry of the same control within
  400 ms. Reduced motion: no transitions, states still visible.
- Viewer keyboard hints are keycaps outside the icon (`data-shortcut`, hidden on touch).
- Range sliders share one style (`RangeSlider`, separate commit) and the search loading skeleton matches the result
  groups (separate commit).
- Not verified: live text with a real Russian speech model on a device; Android hardware back for the section
  arrow; physical touch devices; Firefox/Safari.

## Release 0.6.45 — 2026-09-30

- **Published application and corpus.** The signed Android APK, core `13f238f…`, and RLS MKB
  2026.9.30 are published. GitHub CI and Android release checks pass; APK certificate and SHA-256
  match the declared prerelease identity. The published Pages app downloads its actual core and
  returns four source groups for the public pneumonia lookup. On Xiaomi 14, Android rejected
  `adb install --user 0 -r` with `INSTALL_FAILED_USER_RESTRICTED`; no physical runtime pass is
  claimed and existing user data was not cleared. The native product port continues; its current
  lookup spike is not a complete replacement for the WebView application.

- **Core rebuild qualification.** Audited medication aliases, exact definition/document identities,
  RLS packaging links and light/dark contrast fixes are implemented. The no-pilot rebuild failed
  the existing clinical regression gate, so the 15 pilot documents remain until source replacements
  qualify. Phrase indexing and classification-alias attribution are corrected; numbered migration
  012 restores eight issued paragraph identifiers. The final `13f238f…` core passes the unchanged
  clinical thresholds and exact source audit. Nine stale expected section labels now describe the
  existing registration schema; targets, anchors and thresholds are unchanged. Native lookup agrees
  on the released core's golden queries. Age-qualified lookup preserves doctor-lookup R@5/MRR@5
  0.70/0.60 by keeping explicitly opposite source populations behind matching or general sources;
  clinical ranking is unchanged. The paired application release is published. See the continuation record below.
- **Continued Claude's UI/data queue.** S2 paper sheets are retained; cancelled drags spring
  back, reopening clears drag state, and only the topmost dialog handles Escape/Tab. S3 result
  cards show one compact excerpt and disclose the others with the shared `Disclosure` animation;
  source-kind badges are readable in ordinary flow. Details and the remaining release blockers:
  [state/claude-continuation-2026-09-30.md](state/claude-continuation-2026-09-30.md).
- **Lookup patient qualifiers.** In ordinary age/sex-qualified lookup, a literal subject match
  precedes a match limited to «ребёнок», «взрослый» or sex. Explicit failed-treatment and clinical
  finding ranking keep their existing rules. Candidate test7 doctor-lookup reaches R@5/MRR@5
  0.70/0.60 (was 0.70/0.533), with zero forbidden hits; the released core stays 0.70/0.60.
  This is a ten-case regression gate, not clinical qualification or a published core rebuild.
- **Medication card after a reload.** Opening a product from «Препараты» saves it with the
  document's history entry, so a reload or back/forward keeps the trade name, presentation and the
  short/instruction switch. The saved product is validated before use; a queued catalog handoff
  still forces a fresh load, a restored one does not. `e2e/medication-reload.spec.ts` fails
  without the fix.
- **EPUB chapter jumps.** In continuous mode `display()` resolves before epub.js finishes
  rendering neighbouring chapters, so the chapter visibly passed through several positions
  (≈4284 → 6521 → 4389 px). The reader now hides the text while the target's position is still
  moving, aligns once it has been still for six frames (at most 1.5 s), then fades in. Wheel or
  touch — also inside the chapter iframes — hands control back to the reader immediately.
- **Compact catalog membership.** `catalog.preview.json` shrank from 12.6 to 5.8 MB and
  `catalog.terminology.json` from 5.5 to 2.1 MB: both are minified and store membership as a
  compact `documentTable` that the schema expands into the same `documents` (the parsed catalogs
  are deep-equal to the previous ones). All catalog writers use `serializeContentModuleCatalog`.
  Installed 0.6.44 and older read a refreshed remote catalog without membership until updated.
- **RLS packaging module listed.** `minimed.rls.packaging.ru` 2026.9.28 (preview, optional; 7 181
  brand documents, 29.2 MB gzip) is in `catalog.preview.json` (now 7.4 MB) with the release asset
  `reference-rls-mkb-2026.9.28/minimed.reference.rls-packaging.2026.9.28.db.gz`, whose size and
  SHA-256 match the published GitHub asset; the Pages mirror list includes it.
- **zstd module indexes.** The installer decodes zstd indexes in a Web Worker with `fzstd` 0.1.1
  (24 KB, reviewed: no network, no eval). fzstd silently corrupts a 128 MiB window
  (`--long=27`) and decodes 64 MiB exactly, so indexes are packed with `zstd -19 --long=26` and
  windows above 64 MiB are refused; the decoded SHA-256 is verified as before.
  `scripts/repack-module-index-zstd.ts` re-encodes a published gzip index, verifies it with the
  app's decoder and updates the catalog. Four modules moved (267.6 → 167.3 MB): definition
  reference 42.2 → 18.8, krasotaimedicina 142.7 → 100.6, MKB 53.5 → 30.4, RLS packaging
  29.2 → 17.5 MB; the `.db.zst` assets sit next to the `.db.gz` in the same releases and their
  GitHub digests match. `e2e/module-pointer.spec.ts` installs the MKB zstd file through a core
  pointer (1.7 min, local-only fixture). Terminology packs stay gzip.
- **Per-document lexical window.** Lexical search ranks a 4× wider bm25 window and keeps at most
  three chunks per document before cutting to the limit, so long books no longer crowd other
  documents out of the window. Released core: doctor-lookup, lookup-quality, runtime and
  real-corpus unchanged, p50 latency 161 → 140 ms. Candidate core: doctor-lookup R@5 0.60 → 0.70
  ([research](research/search-kr-pointers-vs-mkb-2026-09.md)).

## Native application port — 2026-09-30

- The first product slice owns actual private content storage, consent/download/verification,
  lookup, the 782-module inventory, exact module membership and original-document reading.
  Android and Desktop use the same UI-independent core and bundled SQLite adapter; iOS has a
  real Foundation/CoreCrypto/zlib adapter and Swift host. No WebView or hosted backend is involved.
- Desktop qualification passes 60 tests, including unchanged 151-query lookup and 206 SQL-branch
  parity. Actual published core download matches `13f238f…`; the immutable 401,408-byte regulatory
  module matches `61b82c9…`. Installation, visible offline failure/retry, original reading,
  historical status, down/up reader chrome and exact reading/search positions across offline
  process restart were exercised. The Android 36 emulator downloaded the same core and performed
  real native lookup. A physical device pass is still pending.
- Device/simulator iOS Kotlin and simulator test sources compile; the device framework and actual
  Swift host link. Full Xcode application packaging and runtime tests remain blocked by the absent
  iOS simulator runtime. No simulator or physical iOS runtime pass is claimed.
- Exact source identities and current-edition definition cards/readers now pass 80 Desktop tests,
  including 259 exact-name cases and complete hashes for 22 cards/73 blocks/88 text pages. The
  previous 151 lookup queries and 206 SQL branches remain unchanged. An actual Android APK
  upgrade preserves its schema-1 installed registry, query, catalog filter and exact reader position
  in schema 2. Source-local review and missing-definition status stay explicit.
- The searchable 782-module inventory preserves filters and positions through Back and offline
  restart; the Android emulator exercises actual keyboard input, the immutable regulatory install,
  original reading and down/up chrome with application-only network denial.
- Installed-reference search resolves an exact catalog edition, installs through the existing
  verified owner and preserves its query/results position. All 23 production reference searches
  match complete ordered cards, including limits and bounded description/negation behavior.
  The combined Desktop suite passes 86 tests without skips; Android lint and Android/Desktop/Wasm
  builds pass. Actual Desktop reading reaches all 17 blocks and seven Unicode pages, restores
  page seven offline and returns to the same reference query. Android verifies visible original
  text hashes, all three ambiguous senses, missing-definition status and a second block page.
  Fixed grey-background action contrast, clipped long-name actions, final-card navigation and
  reader focus loss while switching blocks/pages. Android also exercises real Russian keyboard
  input and all seven pages of the same 26,155-codepoint block, preserving page seven offline.
  Updated iOS sources and Swift host compile/link; the runtime limitation above remains.
- Explicit native clinical mode now matches all 85 production lexical cases: 152 facts,
  356 branches and 2,863 complete ordered source passages, including scores, highlights and anchors.
  The 151 lookup queries and 206 SQL branches remain unchanged. Clinical mode uses the current core
  only; it does not imply mounted-module or hybrid retrieval. SQL timing now measures SQL stages.
  The combined Desktop suite passes 108 tests without skips; Android lint and Android/Desktop/Wasm
  builds pass. Current iOS Kotlin/test sources, device framework and Swift host compile/link.
- Native theme/text-size settings and a bounded completed-search history persist atomically and
  remain independent of medical content. History distinguishes lookup and clinical modes, replays
  through the real core and deduplicates successful searches. Failed writes retain pending changes;
  malformed private state is preserved and reported. Actual Desktop and Android emulator checks
  cover settings/restart, replay, deletion, confirmed/cancelled clearing, clinical source opening and
  offline restoration. Production personal-data migration and physical-device qualification remain
  separate gates.
- Native mounted retrieval now preserves 94 actual scoped requests over verified module editions,
  including source identities and complete ordered passages. Six document scopes are exposed in the
  UI; query/mode/scope/filter guards and scoped history prevent stale results or replay changes.
  Initial search warmup admits the installed composition once; completion signals no longer retain
  an obsolete full index. Single-document identities avoid allocating ambiguous-name sets.
- The native catalog opens all 69 schema-defined calculators/assessments. Its engines match 3,014
  production cases with explicitly bounded numerical interoperability checks, and catalog discovery
  matches 407 actual ordered queries. Inputs, stages, answers and results persist atomically in a
  separate validated private file. Tool Back restores its actual search/catalog/collection entry.
  Android emulator checks exercise real keyboard input, calculation, assessment, upgrade/restart and
  package-only offline restart. Patient-result saving remains hidden until the vault is implemented.
- Native readers now have a compact primary Back row and a source menu retaining full title,
  edition, provenance, saving and retry actions. Reader controls hide down and return up together
  with bottom navigation. Shared chrome currently uses the coordinator's opaque strip/fade (`22ac0aa0`);
  this chat's earlier transparent blur/grain request awaits reconciliation in `STATE.md`. Android file
  reading now has current phone light/dark and dark tablet checks; PDF chrome remains separate.
- `bun run native:visual:dev` serves actual shared Compose screens at `127.0.0.1:4174` with continuous
  compilation and browser reload. Its labelled preview uses one public, checksum-linked reader
  fixture and disposable in-memory user state; it does not expose SQLite or claim native FTS.
  Six same-page resized light/dark comparisons against actual WebView found missing home sections,
  query typography and layout differences. The frozen WebView and generated design-system
  components are the reference; screen migration is the immediate next task.
- Native home/search now consumes the shared generated query sheet/footer, equal-height feature
  carousel, section list, bubble navigation and source/identity result cards. The query remains
  editable before core readiness; explicit submission shows «Ищем…» and runs after readiness.
  Source and clinical sections retain independent queries, filters, completed results and viewport
  in the current session; only the active validated search snapshot is durable. Public Wasm checks
  cover queue/edit/clear/readiness, carousel controls and Settings swipe. Selected tests and
  Desktop/Wasm/Android/iOS source compilation pass; these checks do not qualify current Android
  visual parity. Wasm serif rendering, responsive geometry and admitted-source counters still
  require the coordinator's component/core contracts. Feature-card engines remain unavailable.
- Official-source text now maps to shared reader blocks without changing its stored chunk or anchor.
  A frozen oracle from the actual Web functions passes 115 cases: 75 released public chunks and
  40 explicitly labelled test boundaries, including list continuation, source spans, Unicode spaces,
  extra table cells and validated image/table metadata. Reproduce with
  `bun scripts/nativePrepareSourceText.ts` after placing the checksum-verified regulatory module at
  `playwright/native-verified-regulatory.db`, then run `NativeSourceTextGoldenTest` on Desktop.
  This qualifies parser data and block mapping. The coordinator connected the adapter to the shared
  official-source reader and checked it on Android; neighbouring captions, media decoding and inline
  navigation still need their own checks.
- The main native app now exposes «Открыть файл» beside search and in collections, including before
  the medical core is ready. The system picker opens the shared Markdown/HTML/text/PDF reader in
  a transient, in-memory layer; Back preserves the underlying screen and search draft, and cancellation
  preserves the current file. Android's main activity accepts local `content:`/`file:` VIEW intents.
  This is a file-reading entry, not a durable personal library or encrypted patient vault.
  Desktop flows check cancelled/failed picks, failed navigation saves and return without a core;
  22 selected search/tool/navigation tests pass. Android emulator checks cover the actual system
  picker, visible original text/list/table and native Back restoring the same query. The release
  merged manifest includes the local VIEW filters; current physical devices remain unqualified.
  Actual Wasm import checks pass Markdown/HTML/TXT in search and startup, phone/tablet, light/dark;
  Back loses accessibility nodes with `Node 16 not found`, and ordinary search edits similarly fail
  with `Node 39 not found`. The matching upstream fix is in Compose 1.11.1; the current 1.9.3 Android
  SDK ceiling prevents an unchecked version bump. PDF chrome and browser Back parity remain open.
- Personal Markdown/HTML/text reading now assembles the shared document-reader parts inside
  `NativeChromeScaffold`: controls take the status inset once, Back uses the shared primary glyph,
  and the bottom navigation follows scroll direction. The scaffold's current opaque/fade treatment
  is recorded above; the earlier matrix APK still demonstrates the preceding grain treatment.
  Find, outline, text size, embedded images and explicit external-link handling remain shared reader
  behavior. Choosing Search, Settings or Collections closes the transient file only after a successful
  navigation flush; failure retains the file and draft. Another file gets its own list and chrome
  state; its controls and navigation padding do not change the covered source reader's state.
  Desktop checks pass 45 file/navigation/tools/user-state/search-mode/collections/clinical/component tests; Desktop,
  Android, Wasm and iOS source compilation and generated source/token checks pass. Actual Android
  picker/down/up/Back checks preserve the covered source viewport and hidden controls; gestures on
  unsupported-file notices also retain exact underlying text/bounds. PDF and notices retain safe
  viewport padding until their shared reader branches expose the same chrome/inset contract.
- Startup/progress and search retry/error copy now use generated design-system parts. Settings render
  the Web sheets, choices and range control for the two real persisted native preferences (theme and
  text scale). Files render shared search, breadcrumbs, folder grid/list, saved references, empty state
  and collection dialogs. Clinical query analysis now uses the same DS paper, disclosure and choice
  chips, preserving the original deterministic facts, polarities, warnings and calculation copy.
  Picking a local file remains transient; durable files, other Web settings and
  the encrypted patient vault are not implemented. File-folder navigation survives other destinations;
  reselecting Files clears the filter and returns to root only after successful navigation flush.
  Android checks cover both phone themes, actual 140% text, settled 820×1180 tablet settings, collection
  create/rename/delete, picker cancellation and file Back. Current artifacts live in ignored
  `playwright/native-pages-qa/` and `playwright/native-files-navigation-qa/` (APK932972c0: grid/list,
  folder/filter retention, reselect to root and breadcrumbs). APKc1d730ab clinical checks prove two
  visible age/temperature facts, disclosure/reset on query change, source opening and Back in both
  phone themes (`playwright/native-clinical-ui-qa/`). Those cases do not exercise warnings, suggestions
  or calculations; UIAutomator does not expose the disclosure's spoken stateDescription. The current
  component box-parity suite passes too. Final APK0e654729 checks also prove that selecting Files
  from its reader preserves exact origin folder/filter bounds, while reselecting Files returns to root
  (`playwright/native-final-file-return-qa/`). No physical-device or iOS runtime qualification is claimed.
- Next: finish design-system screen parity, then personal files/patient-vault parity, the two separate
  unit-conversion/photo-ECG tools, rich
  original rendering, and remaining application features. The personal library and patient vault
  remain subsequent work. Production Android identity and existing personal data must be preserved
  by a qualified migration before replacing the released app.
- Qualification and concrete limits: [state/native-first-slice-2026-09-30.md](state/native-first-slice-2026-09-30.md).
- Exact identity/migration qualification: [state/native-identities-2026-09-30.md](state/native-identities-2026-09-30.md).
- Clinical/user-state qualification: [state/native-clinical-user-2026-09-30.md](state/native-clinical-user-2026-09-30.md).
- Mounted/tools/chrome continuation: [state/native-tools-chrome-2026-09-30.md](state/native-tools-chrome-2026-09-30.md).
- Mounted/scoped retrieval has a production-generated 94-case oracle over the exact immutable
  regulatory pack and current core; 50 calculators and 19 assessments have 3,014 real-engine cases.
  Mounted retrieval and tool engines pass the qualified native gates above; full feature parity
  remains open.
  Production calculator traces now trim fractional mantissa zeros only: scientific exponents and
  rounded integer zeros preserve their value. The expression/all-schema checks pass 1,399 tests.

## Definition reference data — edition 2026.9.30 (published 2026-09-28)

- Fixed the ~596-record `Список сокращений` mislabeling bug (`scripts/extract_prepared_definitions.py`)
  and a trailing-punctuation over-splitting bug in the KR glossary/abbreviation dedup key; catalog
  description now reports real per-type counts instead of one lumped figure. Abbreviation-list parsing
  is shared with `clinical_aliases.py` (core search aliases unchanged). The specialized-source verbatim
  quote budget (`clinic_definition_completions.py`) is 1024 words for msdmanuals.com (was 25, still 25
  for consumer sites); a measured rebuild with 3 real MSD quotes added ~4.1 KB installed / ~2.7 KB gzip
  per entry, comfortably inside the accepted growth range even at full high+medium priority volume — see
  `research/definition-quote-budget-2026-09-27.md`. Local edition `2026.9.30` has 31 488 entries (8 585
  clinical definitions, 8 369 abbreviation expansions, 6 939 Wiktionary glosses); verified, all 23 279
  source name surfaces found. 7 141 names still need an external source, priority-scored in
  `research/definition-gap-priority-2026-09-27.json`; a 454-pair same-title review queue has no
  auto-merge. Separately, `catalog_module_builder._map_reference_aliases` no longer collapses a
  polysemous MKB-code alias (e.g. ОНМК, ХСН) to one arbitrary document — 9 218 of 12 432 raw
  diagnosis-category aliases were affected; fixed and tested before the qualified 0.6.45 rebuild (see
  `research/diagnosis-alias-ambiguity-2026-09-27.md` for scope and the missing-merge-step blocker).
  Details: [research/definition-reference-2026-09-29.md](research/definition-reference-2026-09-29.md).
  The missing-merge-step blocker is now resolved and scripted (`bun run content:core:build`,
  `scripts/build-core.mjs`): three independent pointer tracks (reference/clinical/medication)
  reproduced the earlier core.db's exact document counts (15,904/744; medication's ledger had
  grown past its 3,324). The qualified rebuild is now published as core-0.6.45 above; see
  `research/core-build-reconstruction-2026-09-27.md` (pipeline, profiling, gated pilot removal).

## Krasota i Meditsina disease module — built and published 2026.9.28

- User decision (2026-09-28, see `REFERENCE_SOURCE_POLICY.md`): the krasotaimedicina.ru snapshot
  is distributed as an experimental module despite unresolved source rights; documents keep
  `rightsStatus: unresolved`, `crawlPublicationState: blocked`, source URL, `fetchedAt`, raw
  checksum and `requiresReview: true`. Not clinically reviewed.
- `bun run content:module:krasotaimedicina` prepares the unchanged 2026-09-04 crawl (20 926 records,
  crawl finished; 6 068 articles), builds a lexical pack and packages it
  (`medbase package-krasotaimedicina`): 6 068 documents, 58 056 sections, 73 148 chunks,
  629 829 632 bytes installed, 142 650 749-byte gzip, text only. Module id
  `minimed.reference.krasotaimedicina.ru` 2026.9.28, `releaseState: preview`, `minAppVersion` 0.6.44.
  The released core's pointers still name the unpublished `minimed.mkb.ru` (kept for the RLS MKB
  pack); from 0.6.44 `selectModuleForPointer` falls back to any released module whose verified index
  lists the exact target. The packager checks every krasotaimedicina pointer against the module's
  membership: 6 068/6 068 targets present with identical document version ids and definition
  anchors. The 9 836 RLS MKB pointers are covered by the separate `minimed.mkb.ru` module below.
- Distribution: data prerelease `reference-krasotaimedicina-2026.9.28`, mirrored to Pages by the
  existing `MIRRORED_DATA_RELEASE_TAG` list (about 820 MB of the 1 GB Pages site). The generated
  catalog entry adds 3.1 MB to `catalog.preview.json`.
- Open risks: the one index is 143 MB gzip / 630 MB SQLite (the contract allows one index per
  module, so no split); installation holds both in memory before the OPFS copy, which is
  unqualified on Android. Article images still point to the source site.

## RLS MKB-10 modules — initial published edition 2026.9.28

- User decision (2026-09-28, see `REFERENCE_SOURCE_POLICY.md`): the 2026-08-14 RLS MKB snapshot is
  distributed as two experimental modules; documents keep `rightsStatus: unknown`, their `rights`
  block, source URLs and response checksums. Not clinically reviewed.
- `bun run content:module:rls-mkb` splits the existing scrape workspace without refetching
  (`medbase split-rls-mkb`), builds both packs and packages them (`medbase package-rls-mkb`).
  - `minimed.mkb.ru` 2026.9.28: 9 835 code pages plus the classification index (9 836 documents,
    49 183 sections, 51 335 chunks), a classification path (category → block → chapter) derived
    from that index, 18 929 aliases, 19 121 knowledge entities, 51 206 `listed-on-rls-mkb-page` and
    6 986 `active-ingredient-of` relations with exact evidence, 9 286 medication profiles (forms and
    strengths, no packaging rows). The medicine section lists names/INN/RLS links only.
    294 768 640 bytes installed, 53 529 648-byte gzip (the local-dev `mkb.db` was 1 501 626 368).
    Document versions, the code/synonym/limitation sections and every chunk outside the medicine
    section keep their ids and anchors; all 9 836 core pointers and their 17 013 cited
  classification anchors resolve.
  - `minimed.rls.packaging.ru` 2026.9.28 (optional): 7 181 brand documents with 7 185 source tables
    (260 022 rows, unchanged), linked by `medicationEntityId` ↔ profile `packagingDocumentId`;
    221 089 792 bytes installed, 29 206 386-byte gzip.
  - Lexical search over the code pack finds `J18.9`, `J189`, `J18 9`, Cyrillic look-alikes such as
    `Е11`/`К29.7`/`А00.0`, synonyms (`ЦВБ`, `внебольничная пневмония`) and titles at rank 1.
- Distribution: one data prerelease `reference-rls-mkb-2026.9.28` with both assets; the Pages
  mirror needs that tag prefix and grows to about 900 MB of 1 GB. Both catalog entries together
  add about 8.6 MB of membership to `catalog.preview.json`. Since 2026-09-29 both are published as
  zstd (30.4 + 17.5 MB). Edition 2026.9.30 of the MKB module is published with 50 137 exact
  source-listed packaging links (306 647 040 bytes installed, 30 738 701-byte zstd). The app opens
  their verified packaging target and preserves its source anchor across installation and reload.
  Packaging edition 2026.9.28 is reused unchanged; the MKB source text and identities are unchanged.

## Core coverage audit — 2026-09-28 (measurement only)

- `benchmark:core-coverage` (`tools/benchmarks/src/run-core-coverage.ts`, seed 20260928, 3,850
  queries) searches `core.db` alone through the app's lookup path. KR titles and INN reach 100%
  correct@5. ICD codes reach only 46% because the released pointers do not index sub-codes and the
  legacy fallback assumes chapter I; the candidate rebuild reaches 97.5–99.5%. All 15,904 MKB and
  krasotaimedicina pointers were dead ends at measurement time; the 6,068 krasotaimedicina ones
  resolve from 0.6.44 (module c6b63b6b, membership fallback 044ef7a7). The MKB module and its
  qualified 2026.9.30 packaging links are now published above. The original audit found terms at 16%,
  normative acts 0% (90% with the bundled `regulatory.db`), and tools 100% through the client-side
  catalog. Findings and the size/risk proposal:
  [research/core-coverage-2026-09-28.md](research/core-coverage-2026-09-28.md).
- ICD fallback fix (2026-09-28): the legacy ICD query keeps the typed chapter letter (Cyrillic
  look-alikes mapped) and adds the three-character parent token instead of assuming chapter I. On
  the released core alone, correct@5 for «J18.9»-style codes rose from 46.0% to 96.5% and for
  «J189» from 46.0% to 99.0%; benchmark:all within tolerance, doctor-lookup 0.70/0.60 unchanged,
  lookup-quality Top-1 1.0. Downloadable (actionable) ICD results stay 7–15% until an MKB module
  ships.

## Knowledge graph («Карта связей») — 2026-09-27

- Experimental module (follows the experimental setting like «Словарь»). Opens on at most 300
  documents (query results plus shared areas, or an area-balanced sample) with «Показано N из M»;
  «Показать все» draws the whole scope. Layout runs in a Web Worker (Barnes–Hut, grid collisions,
  cluster separation; static grid above 500 nodes); the main thread only draws cached paths.
  Headed 165 Hz measurement: pan/zoom frame p95 <= 3.6 ms in every scenario (20 040 documents
  included), 0% node overlap after convergence. 14 missing area labels were added. Details:
  [research/knowledge-graph-performance-2026-09.md](research/knowledge-graph-performance-2026-09.md).

## Search while the core is not ready — 2026-09-28

- Only the shell load and a missing core waiting for download consent (metered network) keep a
  separate screen; first-run setup is unchanged. Opening, verifying, another tab holding the
  database, open errors and later core downloads keep the search page mounted (not remounted when
  the core arrives): the field is disabled with the status as placeholder and a compact line shows
  progress or the error with «Повторить»; tools that need no core work at once, «Словарь» waits
  (`search-core-status.ts`, `SearchCoreStatusNote`). E2E boot-screen, core-reload, startup-shell and
  unified-downloads pass (the last two had failed since 0.6.40).

## Start-up and patients polish — 2026-09-28

- Start-up keeps one ground from the Android splash to the first view: the post-splash window and
  the WebView use `splashBackground` (light `#F3ECD9`, night `#2D2721`), the page before render and
  the boot screen use the same surface, and the first view fades in once (0.2 s, none with reduced
  motion). A quick core open shows only the field placeholder; the note under it appears after
  400 ms. The native part needs verification on a physical device.
- Patients: device-key and existing vaults open without a dialog (ADR-0016 unchanged); the dialog
  appears only when the user must act (browser warning, «Открыть» for a plaintext vault, Keystore
  error). The blurred sticky-header layer now paints behind every header control, and route desks
  hold one viewport of folder tint instead of stretching with the content height.
- Home: no greeting. The search field leads the page; the tool row and «Полезные функции» follow
  it on a quieter surface and fold away once a search starts. The carousel (`components/Carousel`)
  has equal-height cards, arrows on the card edges, position dots («Функция 2 из 4»), and autoplay
  that pauses on hover or focus, stops once the user swipes, presses an arrow or a dot, and is off
  with reduced motion; it opens on today's capability. Capability cards carry a second action as a
  second button and «Как это работает» as a round «?» (`HelpIconLink`). The field holds only the
  input, source picker, «Клинический разбор» and a round send button; clearing is a × inside the
  field, and «Карта связей» sits in the top row beside «Случайная запись». All home blocks share
  one spacing step (`--home-gap`, 1 rem / 1.25 rem).
- Dialogs are paper sheets (`OverlayDialog`, `presentation="sheet"` by default): from the bottom
  edge on phones with a grip, pulled down to close (`sheet-drag.ts`), a centred paper sheet on wide
  screens; the scrim, Escape, the focus trap and safe-area insets are shared. Viewers and editors
  (relation map, image lightboxes, print, drawing, ECG editor, first-run setup) keep
  `presentation="screen"`. Confirmations use the same sheet as an `alertdialog`. Panels that open
  from a button — search sections, collections, the home «?» — are popovers on wide screens and the
  same sheet on phones (`SheetPopover`).
- While the core opens, its status shows once: the note under the field (with progress) or, for
  the first 400 ms of a quick open, the field placeholder. «Мои файлы» lists «База знаний» as a
  root folder when the navigation has no tab for it (separate tabs off, or the core not ready);
  folders that cannot be deleted carry a pin.
- Notices about something the user now has (a downloaded example, an added file, a created PDF,
  a recording attached to a patient) carry a link-styled «Открыть» that opens exactly that item
  (`components/notify.ts`); the CT example no longer jumps to «Заметки» on its own.
- Downloads the user starts by hand end with the same notice: a calculator or its section, a
  questionnaire or its section, a document set or a whole catalog section, and ECG recognition
  from Settings; «Открыть» leads to what was installed (`catalogGroupHash`, `moduleCatalogHash`).
  Background updates and restored downloads stay silent.
- Readers (official document, medication card, file from «Мои файлы») share one header
  «Меню действий» (`ReaderActionsMenu`: «Печать», the reader's own actions, «Сохранить в
  коллекцию») and one bookmark in front of the title (`ReaderTitleRow`); both open the same
  collections panel. Saved personal files reopen in the personal reader.

## Release 0.6.44 — 2026-09-29

- **Reference modules become reachable.** `minimed.reference.krasotaimedicina.ru` and
  `minimed.mkb.ru` (RLS MKB-10) are listed as preview modules (minAppVersion 0.6.44); pointers
  resolve through exact membership (`selectModuleForPointer` fallback). The RLS packaging module is
  released as an asset but not yet listed (no UI link; catalog membership needs a compact format —
  the catalog is 12.6 MB with these two).
- **Search:** ICD chapter-letter fix (core alone: dotted codes 46% → 96.5% correct@5). Fixed the
  ASR download (transformers 4 `main` probe) and the Android WebView OOM on broad queries (paged
  navigation catalog).
- **UI:** collections and bookmarks, reader actions menu, calm start-up, patient vault without a
  flashing dialog, home carousel and spacing, «База знаний» entry and folder pins, «Открыть» in toasts.
- Corpus unchanged. Signed with the persistent prerelease key.

## Release 0.6.43 — 2026-09-28

- **Persistent APK signing.** Up to 0.6.42 every release was signed with an ephemeral CI debug key, so
  no release could be installed over another. From 0.6.43 the release workflow signs with one PKCS12
  key from repository secrets and fails on any other certificate; see `RELEASES.md` «Android
  signing». Users of 0.6.42 or older reinstall once.
- **«Разделы» on the empty home** (`SearchSectionsOverview`, `sections-overview.ts`): six sections
  with one/few/many worded counts declared in `SEARCH_SECTIONS`.
- Corpus and packs unchanged; `verify` passes; section-related e2e 59 passed / 1 skipped (serial).
  The `tool-hydration` and `search-section-downloads` failures noted under 0.6.42 were stale specs,
  fixed after this release.
- **Speech model download (fixed after 0.6.43).** Since df6448a3 (transformers.js 4.2) the Whisper
  download failed with «Unsupported speech asset URL»: transformers 4 probes `config.json`,
  `tokenizer_config.json` and `preprocessor_config.json` at `resolve/main/` before honouring the
  pinned `revision`, and the worker's host/revision guard rejected them. The worker now maps that
  probe onto the pinned revision; the guard is unchanged.

## Release 0.6.42 — 2026-09-28

- **App-only release over the 0.6.41 corpus.** `core.db` and the companion packs are unchanged; the
  rebuilt candidate core (`bun run content:core:build`) is not shipped because doctor-lookup on it is
  0.60/0.45 (recall@5/MRR@5) against 0.70/0.60 on the released core. A wider per-branch window and a
  targeted identity backfill were measured and rejected
  ([research/search-kr-pointers-vs-mkb-2026-09.md](research/search-kr-pointers-vs-mkb-2026-09.md)).
- **Definition reference `2026.9.30`** is published as the `definition-reference-2026.9.30` data
  prerelease (42 173 697-byte gzip, 192 323 584 bytes installed, 31 488 entries) and replaces
  `2026.9.27` in `catalog.preview.json`; `minAppVersion` stays 0.6.41.
- **Home, startup, search ranking, medication card, «Словарь» and graph** changes are listed in
  `CHANGELOG.md` [0.6.42].
- **Verification.** `bun run verify` and `benchmark:real:release` pass. Full serial Web E2E: 105
  passed, 8 failed, 6 skipped of 119. The section-menu specs were stale after the new home and pass
  once updated; `module-pointer` passes when rerun alone. `tool-hydration` (both variants) and
  `search-section-downloads` (375/1280) failed the same way on a v0.6.41 build; both specs were stale
  and were fixed after 0.6.43. `tool-hydration` still expected a fresh profile to auto-install tool
  packages, which e72af7f8 deliberately stopped (optional packs install only on «Скачать»).
  `search-section-downloads` lost its menu when `hover()` scrolled the page at 375 px, and its
  25-second assertion raced the 423 MB core open that package status waits for.
- **Native spike.** `native/` holds a Kotlin Multiplatform + Compose Multiplatform search page over
  the same `core.db` (ADR-0021) for a device speed comparison with this release's WebView; it is not
  built by CI or shipped.

## Release 0.6.41 — 2026-09-27

- **Experimental definition reference and data-release mirror.** Everything that previously worked
  only in DEV now follows the experimental-modules setting (default on). The draft dictionary
  edition `2026.9.27` (16 069 entries, 27 003 687-byte gzip, 127 369 216 bytes installed; verified
  by `scripts/verify-definition-reference.ts`: all 12 644 source names found) is built with
  `prepare-definition-reference.py --publication-state experimental-preview --artifact-url …` and
  advertised from the `definition-reference-2026.9.27` data prerelease. Release hosts send no CORS
  headers and the old resolver rewrote such URLs to a nonexistent raw-`main` path (terminology
  downloads returned 404 since 0.6.39), so `terminology-*` and `definition-reference-*` assets are
  now read from the Pages mirror (`content/releases/<tag>/<file>`, absolute on native builds) via
  the shared `releaseAssetMirrorUrl`; `landing-pages.yml` mirrors exactly the assets the catalogs
  advertise (`scripts/list-mirrored-release-assets.ts`), verifying size and SHA-256 (~64 MB; the
  Pages site stays ≈677 MB of 1 GB). Definition drafts remain DEV-only.
- **Search home widget, favourites and tool collections.** The welcome block (greeting, key tools
  and the ECG photo entry, previously a separate card) collapses once typing starts; a compact
  «Мои инструменты» row stays above the field with favourite chips and a menu: favourites first,
  then user collections drawn as the same folders as «Мои файлы» (shared `FolderFigure`), then
  built-in tools (conversation recording, term dictionary, ECG). Any catalog calculator or
  questionnaire can be starred or added to several collections from its card; collections can be
  created, renamed and deleted. Data lives only on the device (`state/tool-collections.ts`, stable
  tool ids); ids missing from the catalog stay listed as «Недоступен». Full personal-notes backups
  carry favourites and collections as an optional v1 field; card handover backups do not.
- **Section menu stability.** Opening the menu focused it without `preventScroll`, so the smooth
  page scroll immediately triggered the release's close-on-scroll and detached its rows. It now
  focuses without scrolling and closes on scroll only once its trigger leaves the viewport.
  E2E (`--workers=1`): search-dropdown 2/2, tool-collections 2/2, search-ui-revision 4/4 (the
  long scenario now dismisses the modal patient-vault dialog with Escape, as a user would).
- **Search latency.** Clinical analysis no longer re-prepares 44k aliases per query; medication
  aliases are normalized once; Levenshtein runs in a band. `bun run benchmark:search-latency`
  (132 queries, full core, native SQLite): Bun p50 657 → 208 ms. Ranking benchmarks unchanged.
- **Diaries v2 (schema-driven).** Fields (number, choice, multi, flag, count, text, plan) plus the
  doctor's plan. Templates: blood pressure, medication (prescribed list, taken/missed), child
  (feeding plan, amount, weight in g → body mass in kg, sleep, stool flag/count, complaints),
  illness course (temperature, symptoms, medicine), glucose; doctors can build custom diaries.
  Entries default to now and stay editable; landscape A4 print for doctor and patient. v1 links,
  stored diaries and QR codes convert on read. FHIR export codes LOINC vitals/MedicationStatement.
- **Conversation recording.** «Записать беседу» on the home screen records immediately; each
  one-second slice is committed to IndexedDB, so a crash keeps the recorded part (reported as
  interrupted). After stopping, audio is added to a patient/visit or kept in «Записи бесед».
  Stored unencrypted for now.
- **Patient vault in the browser.** Unlock/creation in a compact dialog; no automatic lock or
  privacy curtain any more (user decision). Passkey protection (WebAuthn PRF) was moved to the
  unmerged `feature/patient-vault-passkey` branch and is not part of this line.
- **UX.** Settings grouped with a shared `FeatureCard`; animated `Disclosure`; `SelectField`,
  `FileDropZone`; search welcome with shortcuts; questionnaire import dialog; notes open straight
  into the full-screen editor with title, tags, pictures and reminder; plain-language copy;
  virtualized grids pass a row-size hint (no first-frame jump); smoother nav bubble overscroll.
- **Known open items.** Content pointer text still exposes internal ids/English categories (needs a
  generator change, a core rebuild and a new dataset); UI strings are not yet on Lingui; patient
  storage is not yet migrated to HL7 FHIR resources; e2e «creates a protected patient profile»
  needs the anthropometry pack (download area owned by another agent).

- **Search recovery and startup (merged from `feature/ux-ecg-pass`).** Free search keeps a
  medication whose title stem is typed; source-pointer results offer the exact containing module
  (verified index membership) as an in-result download; a completed search with no document groups
  shows an explicit empty state with scope downloads; ambiguous phrases list candidate documents
  as `ChoiceChip` buttons. Startup parses bundled catalogs as raw JSON text and reads tools and the
  core descriptor from a generated `catalog.shell.json` (`bun run catalog:shell`, drift-checked by
  a test). UI font sizes below 11px use `--type-micro`. Section-menu, result-chip and bottom-nav
  download states separate “queued” from “transferring” (`DownloadProgressMark`); long section
  names scroll only for the selected/hovered/focused row (`MarqueeText`).
- **Core opening.** The OPFS open timeout counts only while this worker owns the pool lock and is
  not waiting for the user's download consent; the boot screen explains when another tab holds the
  local database. Calculators and assessments open before the medical core is ready.
- **ECG photo editor.** Guided five-step flow with per-step guides, camera capture, auto-markup
  summary, explicit paper speed, a home-screen entry card, stale-model detection with in-place
  update, and the 30 numeric-model features drafted from confirmed editor points. Details and
  checks: [state/ecg-research-log.md](state/ecg-research-log.md). The dev/preview Vite server
  serves `/content/releases/<tag>/<file>` from the gitignored `.cache/releases/` cache.
- **ECG perspective.** Automatic sheet corners with manual handles and «Выпрямить по углам»; calibration runs on the rectified image, the original is kept ([details](state/ecg-research-log.md)).
- **ECG ST.** Per-lead ST at the J point and adult Fourth UDMI/ESC 2023 review findings from a declared schema, checked against PTB-XL+ ([details](state/ecg-research-log.md)).
- **ECG children.** Under 18 the editor and numeric panel compare confirmed values with Rijnbeek 2001 age/sex limits declared in a schema; no paediatric model by user decision ([details](state/ecg-research-log.md)).
- **Query-parser POC (tools only).** Local LLM/GLiNER parsers compared with the deterministic
  parser on 40 realistic narratives; no model or runtime was added to the app. See
  [research/query-parser-llm-ner-poc-2026-09.md](research/query-parser-llm-ner-poc-2026-09.md).
- **Verification (0.6.41).** `bun run verify` passes (Biome, strict TypeScript, Vitest, build,
  Python, native source checks, benchmarks, secret scan); `benchmark:pilot` Recall@1 0.951,
  Recall@5 0.984, MRR@5 0.967. Targeted Playwright (`--workers=1`) over boot, startup, core reload,
  downloads, modules, terminology, calculators, assessments, navigation, search, experimental
  reference and patient vault: 16 failures that equally fail on 0.6.40 (stale selectors and
  pre-core flows; 18 tests that failed on 0.6.40 now pass); the one new regression (inline
  preview under the bottom navigation) was fixed. Not tested: physical Android devices, MIUI, iOS.
- **Integration note.** Part of this work was developed on a base older than 0.6.40 and merged on
  2026-09-26; the merge combined the consent-gated core download with the other-tab lock wait and
  the FeatureCard ECG settings with the model-update state.

## Release 0.6.40 — 2026-09-26

One consolidated branch (`release/0.6.40`) merges every open line of work into `main`:
`feature/browser-integration` (diary, canvas links, browser ASR, reading scale, notes backup),
PR #180/#174 (search quality, definition reference, index compaction — see the section below, now
released), the native Android transcriber, and the Android high-refresh display mode.

- **Visit dictaphone (Android).** A visit in the patient card can record a consented conversation.
  sherpa-onnx 1.13.8 (JitPack AAR) runs pyannote segmentation + CAM++ speaker clustering and GigaAM v3
  CTC recognition fully on the device after a one-time verified model download. The doctor renames
  speakers, edits the text and saves: the audio is stored as a patient-vault blob and the transcript as
  a `note` event labelled «Автоматическая расшифровка аудиозаписи; проверьте перед использованием».
  Recording files are deleted from app storage after a successful save. Only arm64 native libraries
  are packaged (APK ≈ 102 MB). Not qualified on physical devices; iOS (libopus) is not implemented.
- **Display refresh.** Android requests the highest refresh mode for the current resolution
  (`preferredDisplayModeId`, plus `setFrameRate` on Android 15+). MIUI behaviour on real hardware is
  unverified.
- **First run.** The core download now starts automatically, except when the connection reports
  `cellular` or `saveData` (then the user decides). The screen cannot be dismissed while the core
  downloads; it shows a feature tour with live demos of real screens (search, patient chart, dictaphone,
  canvas, questionnaire). Onboarding is remembered as completed only once the core is installed.
- **Shared UI.** New `Disclosure` (animated accordion, card/inline variants, reduced-motion aware)
  replaces native `<details>` in setup, settings, calculator sources, reader source details, Allmed
  supplements and the definition-reference panel. New `SelectField` replaces raw selects in the patient
  workspace. `OverlayDialog` accepts `dismissible={false}`.
- **Ranking fix found by the release gate.** Body weight («вес 20 кг», label «Масса») was treated as
  a positive clinical finding, so any document mentioning body mass got full finding coverage and
  outranked a named medicine (`drug.ceftriaxone.pediatric-pneumonia-workflow` fell to rank 5).
  Weight facts are now excluded from ranking findings. Pilot, lookup (Top-1 100%) and clinical
  (Top-1 81.8%, NDCG@5 0.913) benchmarks pass. Note: `benchmark:all` does not run `benchmark:pilot`;
  run it locally before a release.
- **Verification.** Local only (Actions minutes are reserved for the release build): Biome, strict
  TypeScript, Vitest, Vite build, Python checks, native source checks and benchmarks — see the release
  commit. The release APK is built by the release workflow. Not tested: physical Android devices, MIUI,
  iOS, and the boot-screen Playwright spec on a real build.

## Browser integration workspace — 2026-09-25

- Integration branch: `feature/browser-integration`. It combines the browser transcription branch
  with the patient self-monitoring diary and canvas/app-link work while deliberately making no new
  Android or iOS qualification claim.
- Shared browser form controls (`TextField`, `TextArea`, `ChoiceGroup`, `Checkbox`,
  `FileButton`) are reused by the diary/transcript surfaces. Hidden labels are self-contained and
  do not depend on the main app's global visually-hidden utility.
- The patient card can issue a blood-pressure, glucose or medication diary. The lightweight
  `app/diary/` entry stores patient-entered readings locally, exchanges invitation/result payloads
  through QR codes and can export an HL7 FHIR R4 bundle. Doctor-side import remains idempotent by
  diary/entry id and can attach imported events to an open visit. The QR transport caps both encoded
  input and decompressed JSON (1 MiB), rejects oversized individual QR chunks, limits photo import
  batches/files, and releases camera/ImageBitmap resources on every exit path. The local diary index
  is reconstructed from source records after corrupt/stale/quota-failed index writes, and patients
  can explicitly remove a stored diary. Its scoped service worker caches static assets only.
- Note drawings support links to MiniMed documents, calculators, assessments and notes through the
  shared note-link target index. Drawing attachments render an actual Excalidraw preview in note
  timelines instead of a generic file icon.
- Text and Markdown readers now expose a persistent reading scale in the existing document menu:
  90/100/110/125/140%. Plain text, Markdown body text, headings, tables, code and captions scale as
  layout typography rather than a visual transform, preserving selection and scroll geometry. The
  preference is local/session-safe when storage is unavailable and remains independent of PDF
  pinch/zoom and two-page mode.
- Voice notes use the browser MediaRecorder + optional local Whisper path documented below. Persisted
  audio opens the editable transcript panel; a transcript can be copied or inserted at the current
  note caret, including a timestamped form.
- `NoteMarkdownEditor` and `notes-polish.css` were resolved manually rather than choosing one
  feature branch wholesale: canvas link-target behavior and structured browser-ASR behavior are both
  present in the integration tree.
- Draft PR #185 (`feature/browser-integration` → `main`) is the consolidated review surface.
  GitHub Actions are intentionally not used because the repository Actions quota is exhausted.
  Dependency-free source validation passes **57/57** top-level invariants on
  `56fe5dfabe1c17419ffc3e74c0202a43714a556b` across diary, canvas, MediaRecorder, structured ASR,
  persistent Whisper lifecycle, transcript retention, portable personal-notes backup, diarization
  admission and integration wiring. The source gate's three over-escaped word-boundary regexes were
  corrected before that run. A full browser `tsc/vitest/vite build` is still a pre-merge gate when
  a checkout/build environment is available.

## Portable personal-notes backup — 2026-09-26

- Personal notes now have their own plaintext JSON backup domain, deliberately separate from the
  encrypted/optional-plaintext patient-vault backup. Schema v1 includes stable card/note ids,
  arbitrary note files, note images and transcript records including edited speaker labels.
- Binary note files retain their exact ids and carry declared size plus SHA-256. Import decodes and
  verifies all binaries and every cross-store link (card→note, file/image→note,
  transcript→source-audio) before changing durable state. Duplicate ids, note hierarchy cycles,
  missing parents and transcript/audio mismatches are rejected.
- Import is a full replacement of the personal-notes domain. It snapshots the current durable state
  first and attempts rollback if a later store replacement fails. Active transcription jobs are
  quiesced before transcript-store replacement. Restored queued/running transcript records become
  explicit retryable failures instead of pretending an inference job survived the backup.
- Backup v1 intentionally excludes ephemeral editor drafts and the single previous-revision recovery
  slot. A successful import clears those stale local recovery records so an imported note cannot
  reopen with text from the previous device state; rejected imports leave them untouched.
- Notes UI validates/parses the selected JSON before showing the destructive confirmation and displays
  its card/note/file/image/transcript counts. Export/import actions live in a separate data menu rather
  than the create-note menu. Raw backup files above 512 MiB are rejected before parsing. Export also
  estimates the final base64-expanded JSON before reading attachment blobs and refuses a result above
  512 MiB, avoiding a late browser-memory spike after hundreds of megabytes have already been copied.
- Backup v1 also supports `scope: card` for handover. Each ordinary note card has an explicit export
  action that serializes only that card and its files/images/transcripts. Importing a card backup
  replaces or adds only that card; all unrelated cards remain unchanged, and note/file/image/transcript
  ID collisions with another card are rejected before mutation. Legacy v1 backups without a scope are
  read as full backups for compatibility with earlier branch exports.
- Card wipe remains a separate destructive action and explicitly states that the card, nested notes,
  files, images and transcripts are removed. The existing retention journal makes that cascade
  retryable across browser restarts.
- Unit coverage includes exact-ID full round trip with audio bytes, image and edited speaker name,
  same-size binary corruption rejected by SHA-256, missing transcript source-audio rejection, scoped
  card round trip preserving unrelated data and working drafts, plus cross-card ID-conflict rejection.
  Patient-vault data is never read or replaced by this format.

## Browser voice transcription — 2026-09-25

- Browser voice notes use MediaRecorder with a 64 kbit/s target, one-second chunks and a 10-minute
  ceiling. Unsupported recorder startup, runtime recorder errors and empty captures release the
  microphone and surface an error instead of saving a broken attachment.
- Quantized Whisper Base/Small remains optional and local after its existing first model download.
  The worker requests word timestamps and returns millisecond transcript segments. Browser
  transcription rejects recordings over 10 minutes before the expensive decode when metadata is
  available. One worker owns one pipeline: switching Base↔Small unloads the previous runtime first,
  so readiness cannot point at a model the worker no longer holds and the two pipelines do not
  overlap in memory. Unchecking a model now truly deactivates the worker while keeping its admitted
  cache; Settings can separately delete one cached model plus its resumable partials without touching
  already-saved transcripts.
- Persisted audio attachments now retain their NoteFile in the viewer, fixing the previous path where
  a saved recording could not actually start transcription. The viewer exposes queue/running/failure/
  unsupported states, retry, editable text, copy/insert actions, timestamped segments and plain-text
  export. Real diarized speakers can be quickly relabelled as «Врач»/«Пациент». Finished transcripts
  remain separate local personal data in IndexedDB.
- Background OCR preemption re-queues speech work without marking it as a failed ASR job. Genuine ASR
  failures persist as failed with their error so retry is explicit.
- Transcript retention follows its audio attachment: replacing/deleting an attachment removes the
  separate transcript record **before** mutating the file store, so a secondary file-store failure
  cannot leave hidden derived text behind. Explicit transcript deletion keeps the source audio.
  Active transcription jobs are cancelled and tombstoned before deletion; guarded IndexedDB writes
  prevent a stale completion or concurrent manual save from recreating deleted transcript data.
  Deleting a note/card first journals every doomed note id in localStorage and then runs idempotent
  file/image cleanup; an interrupted cleanup is retried after the next browser start, closing the
  previous fire-and-forget orphan-data gap.
- Speaker-aware storage/alignment is implemented: an optional BrowserDiarizationEngine can supply
  source time regions, Whisper words are assigned by temporal overlap and adjacent words are merged
  into turns. Null/empty region sets are tested and never set `diarized=true`. The pyannote
  segmentation and CAMPPlus embedding files are pinned by immutable source revision, exact size and
  SHA-256; admitted blobs persist in a versioned IndexedDB cache for offline reuse, while cache
  failures do not block the current verified session. No diarizer runtime is enabled by default yet;
  without one the UI says «без разделения спикеров» and labels timestamps neutrally as «Речь».
- Upstream sherpa-onnx v1.13.8 has a first-party browser/WASM diarization target. MiniMed deliberately
  does not load a floating HF Space or the Node-specific npm WASM build. Runtime handoff and remaining
  artifact-pinning requirements are recorded in
  `research/browser-speaker-diarization-2026-09-25.md`.
- This branch is browser-only work; no Android qualification or APK claim is made here.

- MiniMed `0.6.39` ships optional Russian Wiktionary/Kaikki lexical downloads: seven gzip packages
  (index with source definitions plus six owner sections). Local selection: 6,939 senses, 6,940
  Russian glosses; no MeSH equivalence or clinical approval is inferred. Current-core + Russian-index
  reconstruction completed locally with 26,926 documents and 75,299 chunks, valid SQLite/FKs and
  unchanged source hashes. Published data remains `terminology-ru-2026.9.16`. See
  `RUSSIAN_TERMINOLOGY.md` for source rights, sizes and measurements. The discovery core is unchanged.

## Production versus DEV boundaries

- **Definition reference (thesaurus) ships as an experimental module.** The reader accepts
  `publicationState` `local-dev` (a developer's own build, DEV-only `catalog.definition-reference.local.json`,
  which replaces the published entry with the same id) or `experimental-preview` (the edition
  advertised in `catalog.preview.json` as a `preview` module, installable only while experimental
  modules are enabled; `minAppVersion` 0.6.41). The «Словарь» entry points and the onboarding row
  follow the same setting reactively. All content stays `requires-review` and the UI says «Черновая
  редакция, не проверено». The app dispatcher still rejects the `fragments-v1` metadata layout.
- Definition drafts (`content/definition-drafts`, ~39 MB of JSON) still load only under
  `import.meta.env.DEV`; shipping them needs a separate downloadable artifact, not bundle chunks.
- DEV-only infrastructure (not features): local module artifacts (`artifact-url.ts`), local
  reference-image assets, DEV download settings and the DEV update checker.
- Ordinary lookup is deterministic: lexical FTS5, aliases, exact-identity retention, bounded
  medication spelling alternatives. No model participates in ordinary search. Laya multilingual and
  a Russian cross-encoder were measured and not adopted (they lowered Top-1 on the frozen
  candidate set); see `research/laya-source-smoke-results-2026-09-23.md` and the cross-encoder
  PoC in `research/system-one-search-benchmark-2026-09.md`.
- Personal notes and the patient vault are separate local trust layers, never official sources.

## Search quality from PR #180 (released in 0.6.40)

- **Search quality gates.** A corpus-derived lookup benchmark (titles, navigation aliases, declared
  aliases) and a diagnosis-free, leakage-checked clinical challenge set with graded multi-document
  relevance. See `research/system-one-search-benchmark-2026-09.md`.
- **Exact identity.** Exact title, short title and editorial navigation aliases are hard ordering
  keys, and identities lost by candidate cut-offs are restored. They are restored with one filtered
  FTS query and fall back to reading the first readable section.
- **Medication spelling.** Bounded OSA candidates from the alias vocabulary, including omitted
  one-letter source suffixes (Канефрон Н). Since 2026-09-24, alternatives are used only when no
  retrieved source passage literally contains the typed word: "дизурия" no longer ranks
  "ДЕЗОГЕСТРЕЛ" first. RapidFuzz stays experiment-only (see the branch log).
- **Clinical ranking.** Fractional coverage keys are compared in tiers (none / under half / at
  least half / all) before the relevance score. The 33-case challenge set is unchanged by this
  (Top-1 81.8%, NDCG@5 0.909 on the committed public-pilot fixture).
- **Definition reference.** Source-local definition cards with exact provenance, a bounded reverse
  (description → term) search and source-span annotations (migrations 006–009). Counts and
  evidence are in the branch log. Reviewed links now stay visible. Only `rejected` links are hidden.
- **Search index size (migration 010).** Ordinary `chunks_fts` reads its content from `chunks`
  through the `chunks_fts_source` view, with `prefix = '2 3'`. The composer writes 16 KiB pages. On
  the bundled core this is 403.2 → 342.0 MiB with an identical token stream and identical
  lookup-quality metrics. Readers are unchanged, so old packs keep working. See
  `research/core-db-size-2026-09-24.md`.

## МКБ-11 (ВОЗ) as an optional separate module — 2026-10-06 (ICD11)

Owner decision 2026-10-05: МКБ-11 may be a separate pack, Russia uses МКБ-10. Source and licence
findings, the Russian status and what the public files lack are in
`docs/research/icd11-2026-10-05.md`. Summary: WHO publishes the MMS **Russian** linearization
(release 2026-01) and the ICD-10↔ICD-11 mapping tables as public downloads (no account); licence
CC BY-ND 3.0 IGO; the public file has titles, hierarchy and coding notes but **no definitions,
inclusions, exclusions or index terms** (ICD-API only; added in 2026.10.6, see below); Russian has no
official status (Минздрав suspended the transition 2024-02).

- **Numbers** (2026.10.6): 37 052 documents (28 chapters, 1 360 blocks, 35 664 categories), 1 494 titles without a
  Russian translation in WHO's file (English kept, marked), 633 coding notes (+246 residual rows with the API's note);
  55 078 sections, 56 720 chunks; **47.7 MB download, 261.7 MB installed** (2026.10.5: 76.3 / 479 MB);
  release asset `reference-icd11-2026.10.6` (pre-release), catalog preview entry updated (no per-document table:
  no core pointer targets it).
- **Module** `minimed.reference.icd11.ru`, collection `icd11`, title «МКБ-11 (ВОЗ), справочно; в РФ
  действует МКБ-10», `preview`, `minAppVersion` 0.6.51. Never replaces or mixes with МКБ-10 (own id,
  collection, document prefix `who.icd11.mms.`, source type `who_icd11_reference`, none of
  `mkbCode`/`icd10Codes`/`entityType`; the packager refuses a document with one).
- **Pipeline** (`bun run content:fetch:icd11`, `bun run content:module:icd11`):
  `medbase fetch-icd11` (SHA-256 manifest in `data/raw/icd11/<release>/MANIFEST.json`) →
  `prepare-icd11` (one Markdown document per WHO row; every paragraph carries a `localmed:source`
  marker with the entity's browser URL and the raw file line / mapping rows) → `build` →
  `package-icd11` → `scripts/upsert-catalog-module.ts`. Ids are WHO linearization ids (residual rows
  `…/other`, `…/unspecified` keep their own). A title WHO has not translated stays WHO's English
  title and the card says so; nothing is translated or generated.
- **Mapping tables** (WHO's own, unchanged): ICD-11 → closest ICD-10, ICD-10 → ICD-11 (one and several
  categories), cluster targets such as `A00.0 → 1A00&XN8P1` shown as text with the extension titles
  (the only postcoordination data in the public files). ICD-10 links open the МКБ-10 card only when
  that exact card exists in the МКБ-10 module (`rls.mkb.node.<code>`), otherwise the code is plain
  text. WHO's redistribution terms for the mapping tables are not explicit (the licence puts
  crosswalks outside the classification licence): recorded as an owner publication decision.
- **App**: `apps/app/src/features/icd11/` (`icd11-document.ts`, `Icd11CardPanel`); ICD-11 documents are
  searched only in «Все источники» (`documentMatchesSearchScope`), dropped from the whole-core
  «Клинический разбор» scope, absent from the МКБ/состояния section, the condition catalog and the
  inline term links, ordered last in the home catalog and counted outside the «Ядро» card;
  result cards carry the label «МКБ-11 (ВОЗ), справочно», the card title ends «МКБ-11 (ВОЗ)», and the
  reader shows the practice note («В Российской Федерации действует МКБ-10…»), WHO hierarchy as
  links, children and the crosswalk; the modules page lists it in its own «МКБ-11 (ВОЗ), справочно»
  card, not under «Нормы и расчёты» or «Заболевания и состояния», so no section download queues it.
- **ICD-API text (owner decisions 2026-10-06, `docs/research/icd11-2026-10-05.md`)**: WHO's local container
  `whoicd/icd-api` (`acceptLicense=true`, `include=2026-01_ru`, loopback only, analytics off) is run once by
  `bun run content:fetch:icd11-api` (`medbase fetch-icd11-api`; refuses a non-loopback URL); the 37 052 raw answers are
  cached unchanged in `data/raw/icd11/2026-01/api/mms-ru.zip` with a SHA-256 manifest (image digest, data release,
  per-entity checksums). `prepare-icd11` merges them: definitions (7 990 cards), long definitions (665), fully specified
  names (89), inclusions (1 515 cards), exclusions (2 535), index terms (14 419) and «children elsewhere» (1 669).
  The container tags English fallback as `"@language":"ru"` with `[No translation available]` (or unmarked English):
  such text is **omitted** and counted (76 definitions, 6 252 index terms, 23 exclusions, …), WHO's
  `[possible translation]` strings are kept with a visible note; nothing is translated or substituted. The ICD-10 ↔ ICD-11
  crosswalk tables stay (owner publication decision).
- **Size reduction**: one «Рубрика МКБ-11» section per card (+ the crosswalk), hierarchy/children kept as metadata links only,
  crosswalk text without English ICD-10 titles (kept in metadata), compact source spans and per-document metadata
  (`rawSources` checksums in the release report). Remaining lever, not done: ancestor/child titles by id in the panel.
- **Not done**: exclusion/inclusion link targets and postcoordination axes (in the raw cache, not carried), a zstd-framed re-pack (gzip transport only); the dedicated ICD-11 search section and the ICD-10 → ICD-11 links on МКБ-10 cards were done later (ICD11-MAP, ICD11-SEC).
- Tests: `tools/ingest/tests/test_icd11_prepare.py`, unit (`icd11-document`, `ScopedMedicalCore`,
  `homeDocumentOrder`, `overview-document-counts`), `apps/app/e2e/icd11-module.spec.ts` (installs the
  module from the local release bytes, skipped when they are absent).

## Regulatory acts released — 2026-10-13 (REG1)

Owner request: «Legal acts are just copies of documents — let's release them.» They are source-linked
paraphrase cards (not copies of the act text); all were checked against publication.pravo.gov.ru and
released as `minimed.regulatory.pediatrics.ru` 2026.10.13 (31 documents: 30 acts and the study-list
crosswalk; `minAppVersion` 0.6.59; gzip 261 218 bytes; catalog `publishedAt` 2026-10-13T21:00Z; same
content as the bundled `regulatory.db`). Details, fixes and the dropped acts (455, 154, 5, the forms
crosswalk): [REGULATORY_PACK.md](REGULATORY_PACK.md) «Verification of 2026-10-13». New: `medbase
package-regulatory` (refuses incomplete acts), `bun run regulatory:verify`
(`content/regulatory-rf-verification.json`), number-lookup benchmark queries, `test_regulatory_pack.py`.
Every card ends with a plain-text «Источник и редакция» section; no new app code (the reader shows it as
ordinary text, not yet as a small footer). Not done: full act texts and tables (scans without a text
layer), consolidated editions of the federal laws, a clinician review of the paraphrases.

## Compact document opening — 2026-10-14 (DOC-UI1)

Owner: «Keep all UI compact. You open a doc — you see some info about the topic as well as the text; you
shouldn't scroll much to see actual info.» Measured at 375×812 with Playwright (`getBoundingClientRect` of
the first rendered line of the document's own text, CSS px; the bottom navigation starts at 752):

| Document | Before | After |
| --- | --- | --- |
| КР, installed (1006_1) | 255 | 241 (+ meta line) |
| КР, short card with its download offer | 461 | 362 (380 before DL1's flat offer row) |
| МКБ-10 card with its download offer (C74) | 440 | 353 (371 before the flat offer row) |
| Legal act (1122н, 374н): summary card + offer row of the full-text module (REG2) / full text when installed | 255 | 272–288 with the offer row (241 for the full text) |
| Term / definition card (terminology fixture) | 329 | 315 |
| Reference article with picture (hero) | 497 | 414 |
| User document (Markdown) | 271 | 258 |
| Calculator, first input (unit conversion / Бишоп) | 162 / 235 | unchanged (already on the first screen) |
| ГРЛС instruction text in the drug reader | 1173 | 493 (DRUG-UI1, DRUG-UI2) |

What changed (reader = `OfficialDocumentReader`, shared by КР, acts, МКБ, references, terms):

- **Meta line** (`reader-meta-line.ts`): one line under the title — kind (the search card's label), edition,
  audience — replaces the uppercase source label. Verification, source links and catalogue fields stay in
  «Сведения о документе» / the source section at the bottom.
- **Title block** shorter: paper top padding 1 rem, header rule 0.5 rem below the title; the reference hero
  picture is 36 vw tall (was 56 vw); a user document's idle header (only «Редактировать») is an icon button row.
- **Stacked rows folded**: the ICD-11 mapping and the sick-leave periods use `Disclosure variant="inline"`
  with the new `singleLine` option — flat 44 px rows with a hairline, no card, no wrapped title. The download
  offer row (`DocumentModulePointer`) belongs to DL1 (request in STATE.md).
- **«N / total» pager** no longer floats over the text: it is a chip at the right end of the sticky section-path
  line (`ReaderSectionPath`, an opaque bar of the chrome). It appears once the reader has scrolled
  (page 1 at the top is not shown), taps into the same in-place jump field, and the dock at the bottom-left is
  the fallback only for readers without a path line (PDF has its own page box). The shell registers a
  `ReaderPageHost` on its root (`reader-page-host.ts`); the line claims it from its DOM position. Also fixed:
  `--document-heading-top` was measured only on resize/mutation, so after the chrome slid back the line stayed
  under it — it is re-measured when the slide ends.
- **Raw ids out of the UI**: `documentVersionLabel()` turns the version label «359_3» into «ред. 3» and drops
  `site-<hash>` and other internal ids (result-card qualifier, «Редакция» row, print header, source label of a
  medication link). A long external address in text shows its site name (`externalUrlLabel`: «publication.pravo.gov.ru»),
  the full address stays in the link and its title.
- **1122н**: the «open the current table of the annex» card text was the paraphrase release; since the full texts
  (regulatory 2026.10.14) the act shows its annexes and tables, and the source section ends with a link named
  by its site instead of the raw URL.
- **Unreadable document links**: `#/modules/documents/d/%%%` (and any document address that does not parse)
  shows «Документ не найден» with back and «Искать в базе» (`DocumentNotFound`); an address no source knows shows
  «Документ не найден.» in the reader instead of the installation hint.

Tests: unit (`document-version-label`, `reader-meta-line`, `external-url-label`); e2e `first-screen.spec.ts`
(КР, act, ICD card, calculator, user document: first text line above the nav and under the limit, meta line,
pager in the bar and not floating, damaged and unknown links), `reader-navigation.spec.ts` updated for the
pager's new place; the clinical fixture reads the release copies from the main checkout. Not covered: a physical
device; the instruction text's first-screen assertion lives with the drug screen (DRUG-UI1).

## Tool screens polish — 2026-10-14 (STATE VIS2, QA pass «qa-haiku-2026-10-14»)

Calculators, assessments, comparison, interactions, «Назначение», ATC tree, converter, forms
(`docs/research/qa-haiku-2026-10-14.md`, items tagged VIS2/RX):

- **No pipeline notes.** An assessment result shows an evaluation only when the tool schema declared one
  (`evaluationNotice`, `assessments/assessment-evaluation-notice.ts`): a verdict, a context the reader can
  still supply, or a declared «not applicable» reason. An `unavailable` evaluation says nothing (18 shipped
  assessments, e.g. PUCAI, Silverman, GCS) — the score and its declared interpretation stand alone; the manual
  result no longer carries «Оценка недоступна». The disclaimer sits behind the header «?».
  Tools without `interpretations` (65 calculators, 5 assessments) and with `evaluation: unavailable` (55
  calculators, 18 assessments) are listed by `bun scripts/audit-tool-interpretations.ts` (reads
  `content/tool-modules/*.json`). Fixing them is a content task (new module versions), not UI
  (five modules done by TOOLS-A, 2026-10-15: see «Result interpretations, part A»).
- **Result actions** of calculators and assessments are icon buttons with names («Распечатать», «Поделиться»,
  «Записать»); «Удалить» is a quiet, danger-tinted icon apart from the others. The calculator header has a «?»
  («Информация»: summary, population, limits, sources) instead of a one-item action menu.
- **Questionnaire options** are one row each: the label left, the points a small right-aligned tag (no 44 px
  ghost numeral behind the label); the disclaimer left the submit panel (it is in «Информация»).
- **Score scales:** an ordinal-class scale (`layout: equal`: NYHA, PSI) writes the class name as its result
  instead of «3 класс» beside «Класс III»; cut-points are written once — in the legend, or on the track only
  when no legend is drawn (`scoreScaleClassName`, `scoreScaleTicksVisible`). Input echo is label/value chips
  (`calculatorInputFacts`; numbers with a decimal comma, dates dd.mm.yyyy); many outputs are one line each.
  Quantities: `calculator-quantity.ts` writes 39,98 мес as «3 года 4 мес» (from 24 months), a z-score without
  the unit «SD», «BMI» as «ИМТ». The «Авто по возрасту» option and «Fenton» are module content (not changed here).
- **Unit converter** (bundled schema): both values are result lines («Исходное значение 2,5 кг» / «Результат
  2 500 г»), the input echo is skipped for non-clinical tools, summary and BIPM source in Russian, «?» help.
- **Pre-download calculator page** has the standard header row (back arrow, title, section) with the download
  offer below; no text back button.
- **Comparison picker** no longer overflows the viewport (grid column `minmax(0, 1fr)`, names wrap at «+»);
  «Это инструкция одного из препаратов…» is said once in the «?» (comparison, interactions and their print),
  not per drug; ATC tree explainer is behind the header «?».
- **Interaction checker:** one drug name (`drug-label.ts`: product equal to substance is written once); the pair
  line reads «В инструкциях N предложений об этом сочетании» and, while the instructions are not installed, adds
  «— они появятся после скачивания инструкций»; names are never declined («— упоминание: «Симвастатин»»).
- **«Назначение»:** placeholders are muted hints («лет, мес», «кг», a card value with «из карточки пациента»),
  no example values; «Ребёнок / Взрослый» is one segmented control, pregnancy/feeding an even two-column row.
  With computed doses off, quoted dose sentences are ordered by how surely the patient fits them (the band of the
  patient's weight/age before the adult band), and a sentence the patient surely fits is marked «Подходит
  пациенту по массе/возрасту» (`quotedMarks`, `PopulationMatch.matched`); nothing is computed. The «Рецепт» sheet
  keeps copy/share/print in view (dimmed) and says what is missing (`recipe-missing.ts`: drug, form, strength,
  instruction).
- **Patient card** shows the age beside the birth date (`patientRowSummary`); form fields show plain labels
  (`form-field-labels.ts`: «ФИО пациента», «Полис ОМС», «Код МКБ»…) while the official wording stays the tooltip
  and the printed form is unchanged; the vaccination grid shows edge fades with an arrow when it continues
  sideways.

Not done / left: `DrugRecipeButton` (drug screen) still words its empty recipe sheet in the old way (DRUG-UI1's
file); the `CHA2DS2-VASc` «Ничего не найдено» before its module is downloaded is the search card's offer (DL1/SRCH1).

## Known limits


- Clinical starter documents are concise source-linked cards; the separately installable snapshot
  contains the official structured recommendation text, headings, tables, and embedded figures.
- The selected oseltamivir instruction (ЛП-№(002417)-(РГ-RU), ООО «Атолл») is a 29-page scan with no text-layer
  copy anywhere; its OCR text was re-read against the scan on 2026-10-13 (`content/grls-reviewed-ocr/`, DQ1) but
  only by an agent — remaining doubts are in its front matter — and the published module still carries the old OCR
  until the next module rebuild. The clinical recommendation snapshot no longer depends on PDF OCR.
- Text-layer drug PDFs can still lose visually distinct subheadings that use the same font size as
  body text. Preserved layout metadata prevents list continuations from absorbing adjacent text, but
  complex layouts still require reviewed structure extraction before publication.
- The PDF reader is the shared viewer (see «Shared PDF viewer»): page rasterization is bounded
  (2.5 MP per page, 24 MB in total), off-screen renders are cancelled and inactive canvases released;
  a 160-page Android stress scroll completed without a WebView crash earlier, the new queue/budget
  and sliced text layer were measured only in headless Chromium — a physical-phone qualification is
  still open.
- Scroll-driven app-chrome hiding is scoped to generic document readers; CT/MRI and ordinary
  application pages keep their normal navigation chrome.
- Medication registry cards establish identity, form, strength, and registration status; they do not
  establish a verified regimen.
- The GRLS `data/build/medications.db` pipeline proof is still one-drug; it is not the local Allmed
  catalog. Allmed cards are reference snapshots, not verified dosing. Similar products, normalized
  dosing facts, ATC classification, and additional dosage forms remain absent from the official
  instruction pack.
- The verified ESKLP archive is available through fifteen preview identity modules and the bundled
  core's lightweight pointers. It remains metadata-only (`trustedDoseData: false`): neither the
  preview modules nor the core establish a verified dose or indication corpus.
- The MKB companion is a local-dev reference pack: the full-detail crawl is network-heavy and must be
  explicitly requested, while its code-to-medicine relations remain proposed/reference-only rather
  than treatment guidance. The public AJAX endpoint is used for forms and manufacturers; raw HTML is
  not bundled.
- The local RLS MKB companion is a classification/reference index with sparse downloaded detail
  content and medicine mentions, not a complete drug-instruction or dosing corpus. The local GRLS
  instruction pilot builds are samples; since 0.6.48 the collected official instructions ship as 15 group modules
  (43 % of ЕСКЛП registrations, see «Official ГРЛС instructions … (GI1)»). There is no released
  deterministic linker yet from exact terms inside instructions (for example, `синдром Жильбера`) to
  stable local condition cards, and ambiguous abbreviations are not context-disambiguated.
- The published corpus has official ГРЛС instruction texts for 43 % of ЕСКЛП registrations (a part of them OCR, flagged), but
  still lacks complete verified drug instructions, legal/normative material,
  vaccination calendars, nutrition, growth, development, and calculation-rule sources. The complete
  clinical-recommendation snapshot is not yet a complete physician knowledge base.
- The Allmed packaging-image pack (4,214 photos, 279 MB, 16 ZIP shards) is published as an opt-in
  module (Settings → Изображения) on `datasets/allmed-images-2026.10.13-c8e85a688094` and listed in the
  catalog (needs app 0.6.60); each photo shows a «?» with its source (see
  [DRUG_KNOWLEDGE_PIPELINE.md](DRUG_KNOWLEDGE_PIPELINE.md)). The Allmed terms still require written
  permission for redistribution; the owner accepted that on 2026-10-13. Photos are not in the
  production core and the pack is not part of the «Скачать препараты» bundle. Not measured on a
  phone: install memory (all 17 artifacts are staged in memory before activation). Dose/indication coverage and clinical-grade
  diagnostic/dose validation are also not complete. The larger generated clinician-query benchmark
  for Recall@5, MRR@5, and section recall remains pending.
- The full GRLS export has no confirmed ATC field; the codes come from ЕСКЛП (83 % of its МНН cards carry one, 59 % a
  substance-level code before ATC2, see «ATC completion» below). The 668 homeopathic and herbal nodes have no WHO code
  at all and stay «без АТХ».
- The installed corpus must abstain from dose output when no supplied source contains the exact regimen.
- Small local models can satisfy a JSON shape while citing semantically irrelevant exact text; the
  20-case tester-box result is a screening benchmark, not clinical qualification.
- Browser inference is CPU/WASM; model download size and latency remain substantial.
- The ECG photo tool extracts waveforms only for the fixed 3x4+1R layout and falls back to manual
  calipers when its quality gate fails. Findings come from confirmed manual measurements and
  deterministic adult rules. The optional numeric model is a probabilistic hypothesis, not a
  diagnosis. No diagnostic CNN is shipped. Every measured and rejected candidate is in
  [state/ecg-research-log.md](state/ecg-research-log.md).
- The patient vault is browser-tested at the domain/contract level, but native Keychain/Keystore
  failure, memory pressure, and recovery after background suspension still require physical Android
  and iOS device qualification. It intentionally has no cloud sync or server-side backup; portable
  backups are plaintext and require the user's own secure handling.
- Physical Android interruption, memory-pressure, and local-model inference qualification remain release
  follow-up checks even when the debug APK and browser automation are green.
- Personal notes use unencrypted device-local browser storage and are a notebook rather than an
  electronic medical record. Browser-local Russian transcription is implemented with optional
  Whisper Base/Small, editable stored transcripts and word timestamps. Full-backup export/import,
  single-card handover and a rollback-safe whole-notebook wipe are implemented. Verified
  multi-speaker diarization still waits for a fully pinned browser WASM runtime.

## Marker evaluation — 2026-10-14 (STATE MARKER1)

Full report: `docs/research/marker-eval-2026-10-14.md`. Marker 2.0.0 (Surya-2 in llama.cpp/Metal, local, no keys) on 23 scanned ГРЛС
documents (106 pages, the worst-graded by OCR1), 5 scanned legal acts (127 pages) and two pages of the Капитан textbook scan.

- **Measured:** 22.9 s/page (17 on documents of ≥ 3 pages; 24 s on the legal acts; 67 s per two-page textbook spread), peak 14 GiB
  resident for the whole process tree, never below 13.7 GiB free. Against the page images: OCR1 ≈ 64 wrong numbers in 10 documents (exponent
  signs and superscripts, isotope mass numbers, dilution lines), Marker ≈ 50 in 5 documents plus one page with ≈ 3 000 invented numbers; word
  errors 1.6 % vs 0.3 %. Marker keeps tables and Kazakh letters; it fails **silently** (a generation loop, a lost table, dropped lines, a cut
  paragraph, handwritten «н» read as «4» in 4 of 4 act numbers).
- **Decision:** adopted as an optional local build tool, not as the default OCR. Uses: (a) second reading of the 140 `low` ГРЛС scans (≈ 2 h), only
  where a per-page cross-check against the Vision text passes; (b) full texts of the 30 legal acts (≈ 2 000 pages ≈ 13 h) with the header taken from
  the portal API; (c) the Капитан feeding chapter (≈ 20 spreads ≈ 25 min; 0 wrong numbers in ≈ 60 table values). Command:
  `data/build/marker-eval/venv/bin/python -I scripts/marker_convert.py <out> <pdf>[:<0-based pages>] …` (main checkout, private data stays there).
- **Kept on disk:** `data/build/marker-eval/venv` (1.1 GiB) and `cache/` weights (1.8 GiB), recorded in `docs/data-ledger.json`; outputs, the sample PDFs
  and the uv cache are deleted. **Not built yet:** the Marker-vs-Vision reconciliation step and the API-header step. Full sets were not run.

## Ordered next work toward 1.0

User decision, 2026-09-29/30: after publishing the last WebView release, finish the native
application port first. The qualified first slice and its next dependencies are recorded above;
the content and 1.0 qualification queue below remains open. Completed identity-index/core and
RLS packaging-link work is recorded in release 0.6.45 rather than kept as a future task.

The private, resumable `krasotaimedicina.ru` discovery crawl uses Crawlee Python with a persistent
request queue, robots enforcement, bounded same-host paths, raw HTML/image checksums, and per-page
manifests. The crawl finished on 2026-09-06 (20 926 pages, 6 failed requests). Raw and built output
remains ignored private data with `rightsStatus: unresolved`; since the 2026-09-28 user decision the
disease articles are packaged as the experimental `minimed.reference.krasotaimedicina.ru` module
described above.

1. Grow the content bank before further retrieval/model work — see [CONTENT_DATA_PLAN.md](CONTENT_DATA_PLAN.md)
   for the full cross-category priority list (regulatory acts, pediatric norms/calculators, assessments,
   diets, nutrition/feeding norms). A personal textbook library under `Med/` is an acceptable cited source
   per book/edition/page ([LITERATURE_BANK.md](LITERATURE_BANK.md)) — MiniMed itself is never the cited
   source — but redistribution review still applies before any extracted table or excerpt publishes.
   Anything uncertain found while extracting goes to [LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md)
   for review rather than being silently trusted. In the same content phase, expand official GRLS
   instruction coverage and extend the current recommendation terminology layer: classification
   IDs/hierarchy, synonyms, eponyms, abbreviations, sourced concept explanations, and exact
   source-mention links from instructions to local concept cards. Do not create a second glossary
   database or treat an RLS MKB medicine mention as dosing/treatment authority.
2. Verify the published 0.6.45 prerelease and native replacement on a physical Android device, including system-bar insets, native Back,
   locally scheduled
   notifications, note-image persistence, and the published Pages `/app/`.
3. Build and qualify the missing dose/indication corpus from source-backed rules, including
   clarification/abstention behavior. (The Allmed packaging-image pack is published, outside the core
   database; the rights question was decided by the owner on 2026-10-13.)
4. Rebuild the antiinfectives instruction module so the reviewed oseltamivir text replaces the OCR text (DQ1);
   other OCR instructions stay flagged.
5. Expand real Russian clinician-query, unsupported-answer, and source-scope benchmark coverage.
   The 70-query medication regression after pack installation is fixed. Use `benchmark:runtime` to investigate
   symptom/phrase misses, and missing published document membership before claiming retrieval quality.
6. Qualify the existing browser Whisper path on real Russian consultations and enable multi-speaker
   diarization only after the full WASM runtime is immutable/pinned. The two speaker models already
   pass exact size+SHA admission and verified IndexedDB reuse; the executable JS/WASM runtime remains
   the missing supply-chain/runtime gate.
7. Qualify bundled local models on citation fidelity, abstention, latency, storage, and memory before
   presenting diagnostic assistance as a 1.0 capability. For ECG, qualify the digitizer and
   deterministic measurement/rule pipeline on licensed phone-photo fixtures, compare the integrated
   numeric pack with independent Minnesota/AHA/MEANS-derived rule specifications, and test manual
   measurements on an external adult population. Diagnostic CNNs remain research-only. LearnECG
   remains an external manual smoke-test source until redistribution permission is explicit.
8. Keep GigaEmbeddings benchmark-only until a physician-authored real-corpus benchmark shows a gain
   over the current hybrid and the locally verified Q8_0 conversion has an immutable hosted artifact
   plus Android parity, latency, memory, storage, battery, and thermal qualification. The public pilot
   currently shows one Recall@5 regression when Giga is added with the existing fusion weights. Keep
   the deterministic/hash hybrid and lexical fallback.
9. Local device sync (ADR-0019, proposed): Settings → «Синхронизация» with paired phone/tablet/desktop
   devices, Bluetooth LE pairing and signalling, WebRTC bulk transfer, background sync and dated
   conflict blocks. First slice: one-way copy to a new device; needs a Capacitor plugin (BLE, Wi-Fi NSD; not the frozen native port) and a
   physical device.
10. Medical news and research feed: user subscriptions to RSS/Atom/JSON Feed and websites shipped as
    the «Лента» tab (ADR-0024, NEWS1, section below). The research-API layer (PubMed, Europe PMC,
    OpenAlex, ClinicalTrials.gov; ADR-0020) is still plan only.

A portable Rust `MedicalCore` and stable JSON CLI are recorded as a `1.1` idea, not a 1.0 release gate.
No cross-language runtime migration should start before shared golden fixtures demonstrate parity.

No database update can safely add dose guidance until a supplied source actually contains the regimen.
Redistribution review remains a production gate; prototype manifests preserve current rights status
without treating unknown rights as approval.

Branch-specific next steps (PR #180):

1. Run the full CI (Biome, Ruff, pytest, benchmarks) on the branch and rebuild the core with
   migration 010 through the composer. Publish both distributions with their own checksums.
2. Collect a held-out Russian clinician query set (200–300 queries, multi-relevance) before any
   reranker or decision-model work. Candidate public sources are listed in the PR discussion.
3. Consider an OSA fallback for medication names only when the bounded matcher returns nothing,
   behind the corpus-evidence gate. Test negative controls at corpus scale (thousands of correctly
   spelled words), not ten.
4. Further size work: catalog-pointer `classificationPath` (9.3 MiB) as parent pointers, and a
   decision on `normalized_text` (16.9 MiB) versus a custom tokenizer.
5. (Done 2026-10-02) the corrupt `hard-medical-queries-1500` fixture was removed, not regenerated; see
   `tools/benchmarks/HARD_BENCHMARK.md`.

### Drug chips, fold button and the ATC group tree — 2026-10-04 (STATE UX4)

- Drug screen: the fold button of trade-name/analogue/group lists is `.drug-links__toggle`, a tinted
  borderless pill with an `AppGlyph` `caret-down` that turns 180° on open (`aria-expanded`,
  `aria-controls`, Russian plural labels unchanged). Chips are one type step smaller (0.875rem),
  tighter (0.625rem side padding, 0.375rem gaps, 40 px minimum height) and the country «(Россия)» is
  muted, 0.8em and never splits from its brackets; two chips usually fit a row at 360–390 px.
- «Препараты» has a view switch «Список | По группам АТХ» (`SegmentedControl`, state in the hash):
  `#/modules/documents/medications/atc` (14 groups) and `…/atc/<code>` for levels 1–4 (`N`, `N06`,
  `N06B`, `N06BX`) or `none` (substances without an ATC code). The registration-number legacy route
  no longer swallows `atc`; browser back climbs the tree, the header back button goes one level up
  (`knowledgeDocumentBackHash`).
- `atc-tree.ts` (pure, tested) places the installed ЕСКЛП МНН documents under the levels of their
  normalised ATC codes (`drugAtcCodes`, Cyrillic look-alikes fixed), counts distinct substances per
  node («12 веществ», «3 подгруппы») and names levels 1–4 from the NSI dictionary
  (`atc-names.json`, lazy; taxonomy headings as fallback for level 1). Levels the dictionary does
  not name show «Группа <код>». `MedicationAtcTree.tsx` + `medication-atc-tree.css` are a lazy chunk
  of `MedicationCatalogView`; substance lists use `LayoutVirtualizedGrid`; each level fades in.
- Level-1 groups without substances show the package size and «Скачать · 9,3 МБ» for their ЕСКЛП module
  (`atc-group-package.ts` over `useDrugDownload`, now exposing `installedIds`/`tasks` and
  `start(modules?)`; the same queue and progress mark as the catalog button); the subtree appears
  once the module is installed and the catalog reloads. «Скачать все группы» queues the rest.
  Group → module map is `atcLevelOneGroups` (checked against the release catalog in a test).
- Not covered: the unclassified and Allmed packages have no group of their own (only the synthetic
  `none` group when installed substances lack a code); no search inside the tree. E2E:
  `apps/app/e2e/medication-atc-tree.spec.ts` (antiparasitic module, needs the local zstd copy).

### ЕСКЛП dosages without the «1.0» placeholder, readable drug snippets — 2026-10-15 (STATE DOSE1, QA 0.6.60 items 4 and 12)

QA found «1,0325 мг+10 мг+20 мг» on the card ПАРАЦЕТАМОЛ+ФЕНИЛЭФРИН+ФЕНИРАМИН while the product list said 325 мг (also
«1,0650 мг», «1,0250 мг+65 мг+250 мг» Цитрамон, «1,01,42 мг+18,26 мг+20 мг/мл» Корвалол, «1,025 мг+1 мг+0,4 мг/мл»), the
literal «НЕ УКАЗАНО», search snippets that were pipeline lines, one drug listed twice and a card titled «Theraflu».

- **Cause.** The workbook prints a dosage in two cells, «Кол-во» and «Единица измерения дозировки». For a combination drug
  the registry writes the placeholder «1.0» into the first and the whole dosage into the second («1.0» + «325 мг+10
  мг+20 мг»); an unstated dosage is «1.0» + «~» or «НЕ УКАЗАНО». The builders glued the cells: node rows without a
  space (`1.0325 мг+…`, `1.01.42 мг+…`, `1.0~`), trade-name rows with one (`1.0 325 мг+…`, `1.0 ~`).
- **Builder.** `localmed_ingest/esklp_strength.py` is the one rule (`registry_strength`: a unit cell that is itself an
  expression wins over the placeholder, an unstated unit leaves nothing; `repair_strength`/`has_glued_placeholder` read an
  already glued string, glued ones only with evidence). `esklp_rows.parse_trade_rows` and `esklp_catalog._strength` call it
  and a card's `strengths` no longer lists an unstated value. Tests (`test_esklp_strength.py`) run the raw cells of the
  five QA cards through `parse_trade_rows`, `parse_smnn_rows` and the catalog.
- **Scan, all 3 324 ЕСКЛП cards (15 modules).** Before: 1 765 cards carried a glued dosage in a node or trade-name string
  (1 018 of them a composite dosage like the QA ones, 747 the «1.0~» placeholder), 1 564 showed it in their `strengths`
  list, 1 372 listed «НЕ УКАЗАНО» there; 5 523 card-text chunks showed a glued dosage and 18 989 the literal «НЕ УКАЗАНО».
  After: **0 / 0 / 0 / 0 / 0** (`repair_esklp_strengths.py scan`; a line the 3 200-character chunk limit cut in the middle of
  «(НЕ УКАЗАНО)» is repaired as far as the chunk shows it). 1 839 cards were repaired (2 815 node and 9 938 trade-name
  dosages), 20 602 chunks changed text.
- **Modules.** The registry archive is not on this machine, so the 15 published modules are repaired by the same rule with
  evidence (a glued node dosage `1.0<rest>` only when a trade name of the node holds `1.0 <rest>`; all 1 788 glued node
  dosages had it): `tools/ingest/scripts/repair_esklp_strengths.py apply` rebuilds each module from the non-compacted
  original, carries the published metadata over (the ATC2/ATC3 fill stays), repairs `documents.metadata_json` and the card
  text, rebuilds the search text of the changed chunks the way the modules were indexed (`index_text`; the run refuses
  unless it reproduces all 134 630 stored `normalized_text` values), and runs the same search compaction. It then compares
  the result with the published module: only the metadata of repaired cards and the text of the touched chunks differ;
  chunk ids, section ids, anchors, order and spans are the published ones. The registry's own klp rows
  (`klpPositions[].strength`, «НЕ УКАЗАНО») and `normalizedFormsStrengths` are kept as provenance; a card's text writes an
  unstated dosage like any other empty field («не указано в каталоге») and names a dosage once.
- **Republished.** All 15 ЕСКЛП group modules as tag/branch `esklp-2026-08-28-str1` (`datasets/esklp-2026-08-28-str1`, 68.7 MB,
  module version `2026-08-28.str1`), every artifact verified from the raw mirror (`verify-module-artifact.ts --url`);
  `catalog.preview.json` (15 entries, `publishedAt` moved forward) and `catalog.shell.json` point at it. Local release
  copy `output/module-zstd-esklp-str1-2026-10-15`; the `atc2`/`atc3`/original copies stay as the previous release. No GitHub
  release was created. `reframe-modules.ts` now also replaces a `strN` marker.
- **Indexes.** The drug-comparison index was rebuilt from the repaired modules (`CMP1_ESKLP_DIR`): only the `f` strengths of
  1 765 cards changed, 1 619 glued dosages → 0 (the 10 «1,0…» left are real: «1,05 мг», «1,03 мг/г», document ids). The
  interaction, safety and substance-fallback indexes read no dosages and are unchanged; the dose-rules index (`r`/`ps` rows)
  keeps the registry literal «НЕ УКАЗАНО» as the key of a row (the prescription model selects by it), so the prescription
  screen no longer offers it as a chip and the Rp line leaves it out.
- **Core pointers.** The core's medication pointers (pinned to the released core) carry the same defects in section titles
  and «форма/дозировка» lines. `pin_medication_pointers.py` repairs them on its copy (`esklp_strength_repair.repair_pointer_pack`,
  per-card changes from `tools/ingest/scripts/esklp-strength-repairs-2026-08-28.json`): on the released core 2 815 section
  titles are retitled (2 437 glued → 0, 1 025 «1.0~» → 0) and 2 961 chunks change («(НЕ УКАЗАНО)» 1 872 → 0). **No core was built or
  released here**; the next `content:core:build` carries it. The released core is read correctly by the app until then.
  `packages/test-fixtures/src/generated/core-slice.json` (a slice of the released core) still holds the old titles.
- **App.** `features/search/registry-values.ts` reads a dosage the old modules still have: the placeholder quantity and the
  registry's «не указано» are not part of it (drug screen `displayStrength`, reader section titles and registry lines, the
  comparison index builder, prescription chips and Rp line). Search snippets of a drug pointer read «Аспинат — Таблетки,
  500 мг · Аспирин — …» and «Действующее вещество: розувастатин.» (`presentResultSnippet`; names keep their highlights; the
  source overlay keeps the catalogue wording). **One result per substance:** an Allmed monograph that carries the substance's
  own name is collapsed into the registry card of that substance (`АМОКСИЦИЛЛИН` / `Амоксициллин`; a trade-name monograph
  such as «Терафлю» stays; `collapseGroupsByTargetDocument`). **Russian title:** a monograph opens under its Russian trade
  name, not the Latin short title (`displayDocumentTitle`: «Терафлю», «Колдакт Флю Плюс»).
- **Checked.** vitest 18 011 passed (one test of the old duplicate behaviour rewritten), pytest `tools/ingest/tests` green,
  `benchmark:all` within tolerance. The probe of the real corpus (core + ЕСКЛП/Allmed/instruction modules) shows one
  «амоксициллин» result; the 15 modules open through the app's own parsers with clean dosages. **Not tested:** the browser UI
  (snippets, chips), the e2e specs (`reader-lookups` now waits for «Действующее вещество»; `module-install-timing` and the
  catalog test name the `-str1` copy), an install of the `-str1` modules from the mirror in a clean profile, a device.

### ATC completion for the ЕСКЛП cards — 2026-10-13 (STATE ATC2)

Owner 2026-10-13: «ATC codes could be taken from generics or from other sources». The premise needed a
measurement first: ЕСКЛП already gives every СМНН node an `atcCode`, but `~` for 899 of 7 672 nodes (homeopathic, herbal,
biologic) and only a group stub (`L03AX`, `N06BX`: five characters, no substance) for another 1 404. The drug screen, the
«По группам АТХ» tree and the interaction/comparison indexes read that field of the МНН card
(`drugAtcCodes`, `atcSubstanceFromDocument`); instruction documents and Allmed entries have no code of their own
(Allmed: none in the text; ГРЛС instructions: printed in 3 640 of 8 947 texts, not stored in the module).

Coverage, share of records with a code of any level / a group code (level 4-5) / a substance code (level 5):

| Record type | n | before | after |
|---|---:|---|---|
| ЕСКЛП СМНН nodes | 7 672 | 88.3 / 85.3 / 70.0 % | 89.8 / 87.2 / 73.1 % |
| ЕСКЛП МНН cards | 3 324 | 82.9 / 78.6 / 59.2 % | 83.8 / 79.8 / 61.0 % |
| ЕСКЛП registrations (trade names and КЛП positions) | 29 300 | 89.4 / 87.3 / 73.7 % | 93.0 / 91.2 / 78.5 % |
| ГРЛС instruction documents, through the ЕСКЛП card of their registrations | 8 947 | 90.0 / 88.1 / 75.7 % | 93.0 / 91.5 / 79.9 % |
| Allmed entries (3 538 of 4 708 linked to an МНН card) | 4 708 | 73.6 / 72.7 / 65.2 % | 73.8 / 73.1 / 66.4 % |

The code a ГРЛС instruction prints itself covers 40.7 % of the 8 947 texts (33.9 % a substance code); 78 documents have no
ЕСКЛП card at all (22 print a code). The remaining gap is mostly not fillable: of the 770 nodes no source can code, 668
are homeopathic or herbal (WHO assigns no code), the others are biologics, vaccines, probiotics and solvents.

Rules (`tools/ingest/src/localmed_ingest/atc_fill.py`, `tools/ingest/scripts/build_atc_fill.py derive|apply`, 29 pytest
cases; details and provenance fields in DRUG_KNOWLEDGE_PIPELINE.md «ATC code completion»): a code is applied only when
every source agrees (a longer code that starts with the registry's group stub agrees); sources are `instruction-text`
(«Код АТХ: …» parsed from the 8 947 prepared instructions; `-ocr` needs a second source), `same-inn` (same normalised
МНН and dosage-form class, a full ЕСКЛП code elsewhere), `same-inn-other-form` (only for an МНН with one code everywhere),
`same-inn-instruction`, and `registry-nsi` (the НСИ «АТХ» level-5 name equals the МНН; a name with several route-dependent
codes only supports a code another source chose). Applied to 269 nodes: 115 filled from `~`, 154 group stubs refined to a
substance code; first source 130 instruction text, 45 same МНН, 43 НСИ, 41 same МНН other form, 10 same-МНН
instruction. Agreement of each source with the codes ЕСКЛП already has (the measured precision): instruction text
95.6 %, OCR text 94.3 %, НСИ 95.8 %, same МНН and form 98.1 %, instruction of the same МНН 96.0 %.

Conflicts are kept, not resolved: **676 nodes** where sources disagree (491 against a full ЕСКЛП code, 176 against a group
stub, 9 against `~`) keep the registry value and carry `atcFlag: conflict` plus `atcCandidates` (every code with its
sources), 7 nodes whose only support is an OCR text are flagged `unconfirmed`. 26 of the stub conflicts have two or more
independent sources agreeing on one substance code (umifenovir `J05AX13` against the registry's `L03AX`); the owner
decided on 2026-10-14 to show both (ATC3, below): the registry code stays the official value and the agreed code is
shown beside it as the primary one. Examples of genuine disagreements: methyldopa
(`C02AB01` registry, `C02AB02` instruction), ribavirin (`J05AB04` against the current WHO `J05AP01`), diclofenac skin forms.

Shipped: the 14 ЕСКЛП group modules with a changed code (antiparasitic has only a flag and is unchanged) as `.db.zst`
under the new mirror tag `esklp-2026-08-28-atc2` (branch `datasets/esklp-2026-08-28-atc2`, module version
`2026-08-28.atc2`, `scripts/reframe-modules.ts --family esklp`); only `documents.metadata_json` of 399 cards changed
(chunks, sections, vectors, FTS byte-identical, checked table by table), and catalog `publishedAt` moved forward. Node
fields added: `atcCode` (completed), `atcOriginal` (what ЕСКЛП published), `atcSource`/`atcSources`, `atcFlag`,
`atcCandidates`; card field `atcFill`. The code sheet of the drug screen says «Код дополнен: …» with the registry value
and «Источники расходятся: …» with the other codes (`AtcCodeSheet`, `drugAtcCodes`); it needs the next app release,
older apps ignore the new fields.

Not done / known:
- The interaction (INT1), medication-safety (SAFE1) and drug-comparison (CMP1) indexes were **not** rebuilt with ATC2: their ATC
  prefixes drive class-level interaction rules, so the new codes were reviewed first (done in ATC4, below; CMP1 in ATC3). Core pointers and the module partition stay as published (a card whose code
  was filled keeps its module, e.g. a former «без АТХ» card is not moved to its anatomical group; the tree lists
  installed cards only).
- Instruction documents without an ЕСКЛП card (78) and the 1 170 Allmed entries without an МНН link get no code: the app
  shows ATC only from the МНН card. Their text codes are in the ledger (`data/build/atc-fill/out/ledger.jsonl`, rebuilt by `derive`).
- `registry-nsi` rests on НСИ «АТХ» (WHOCC data; copying for commercial purposes is not allowed, request pending, see
  NSI_FETCH.md): the source is recorded per code so those codes can be stripped if the answer is no.
- Vidal and the other local-only sources were not used. The ЕАЭС register (no offline dump, the portal is not scraped here)
  and combination names in НСИ («цефтазидим и ингибитор бета-лактамаз») are not matched.
- Not tested: the app release that shows the new sheet text in a browser (unit tests only), installation of the
  `atc2` modules from the mirror in a clean profile, a physical device.

### ATC consensus against a registry stub — 2026-10-14 (STATE ATC3, owner «show both»)

Owner 2026-10-14 on the 26 stub conflicts: **keep the registry code as the official value, show the consensus code
beside it as the primary one; search and class comparison use both.**

- Ingest (`atc_fill.stub_consensus`, `derive`/`apply` report `consensus`): for a conflict whose registry value is a
  level-4 group stub, one full code outside the stub proposed by sources of **two independent kinds** is recorded as the
  node field `atcConsensus: {code, sources}`. Kinds: *registry* (`same-inn`, `same-inn-other-form`: the same МНН
  elsewhere in ЕСКЛП) and *instruction* (`instruction-text`, `same-inn-instruction`, and the OCR text `instruction-text-ocr`);
  two instructions are one kind, an OCR text alone is never a consensus (it needs the registry kind, as it needs a second
  source to apply a code). A source that repeats the stub or stops at the full code's group does not veto; a second full
  code or another group does. The НСИ dictionary does not vote (a name with several codes is an option set; its silence
  about a form is not a contradiction), which is also why the count is 26 and not 52. `atcCode`, `atcOriginal`, the
  conflict flag and the candidate list are untouched; the card gets `atcConsensusCodes` and `atcFill.consensusNodes`.
  `apply` refuses to write a malformed consensus (`consensus_problems`: 7-character level-5 code, stub outside it, ≥ 2
  rules of ≥ 2 kinds). 37 pytest cases in `test_atc_fill.py` (8 new) (agreeing, one source, one kind, OCR alone, OCR with the
  registry kind, disagreement, repeated stub, full registry code, `~`), a data test over the patched databases.
- Result: **26 nodes in 13 cards** (the count the owner was given), 13 substances in nine ЕСКЛП group modules: aminophenylbutyric acid 5,
  thioctic acid 6, ascorbic acid 2, umifenovir 2, larotrectinib 2, terazosin 2, retinol, sildenafil, zoledronic acid,
  iodine + potassium iodide + glycerol, silver protein, neomycin + nystatin + polymyxin B, diphenhydramine + naphazoline
  (one node each). The other two umifenovir nodes agree only with the НСИ dictionary and stay flagged conflicts.
  Caveat: a registry stub can be indication- or route-specific (sildenafil `C02KX` is the pulmonary hypertension code,
  the agreed `G04BE03` the erectile one; retinol ointment `D11AH` against the systemic `A11CA01`), which is why the stub stays
  visible and official.
- Modules: only `documents.metadata_json` of 13 cards changed, in the nine groups alimentary-metabolism, antiinfectives,
  antineoplastic-immunomodulating, cardiovascular, dermatological, genitourinary-hormones, musculoskeletal,
  nervous-system and sensory-organs (every table of the databases compared with the `atc2` modules, identical except
  that column; 15 databases pass `PRAGMA integrity_check`). Published as `.db.zst` under the mirror tag
  `esklp-2026-08-28-atc3` (branch `datasets/esklp-2026-08-28-atc3`, module version `2026-08-28.atc3`, 53.8 MB;
  `scripts/reframe-modules.ts --marker atc3 --family esklp --module-id …`, which now replaces an `atcN` marker like an
  embedding one); the other five completed groups stay on `-atc2` and antiparasitic on the original tag. The catalog
  `publishedAt` moved forward. Local release copy: `output/module-zstd-esklp-atc3-2026-10-14` (the `atc2` copy stays as the
  rollback one, 65 MB; `data/build/atc-fill/` decodes and patched databases were deleted after the checks).
- App: the drug-screen ATC chip reads «J05AX13 · в реестре: L03AX» (`drugAtcCodeLabel`), the code sheet leads with
  the agreed code, names its levels from `atc-names.json` and says which sources agree and what the registry holds
  (`AtcCodeSheet`, `DrugAtcCode.consensusSources`); the link preview of a drug card leads with the consensus code. The
  «По группам АТХ» tree (`drugAtcSearchCodes`) lists the substance under the registry stub's group and under the full
  code's group; the medication list search accepts an ATC code or its prefix (`J05AX13`, `J05`, Cyrillic look-alikes) and
  matches the registry and the consensus code (`MedicationProduct.atcCodes`); the comparison index
  (`build-drug-comparison.ts`, `CMP1_ESKLP_DIR`, `MINIMED_DATA_ROOT`) carries both codes of a card in its `a` list and
  was rebuilt from the patched set, so it also carries the ATC2 completed codes (155 cards changed, `a` only). Older
  apps ignore `atcConsensus`; the field needs app ≥ the release that contains this change to show.
- Not done / known: the interaction (INT1) and medication-safety (SAFE1) indexes were still built from the original
  ЕСКЛП release when this shipped; ATC4 below reviewed and rebuilt them; the global
  full-text search runs over the card text («АТХ: …» of the registry), which the metadata-only rebuild does not touch (the
  main search finds drugs by every code through the drug directory since ATC5, below).
  Checked in a browser only as the chip and the code sheet in a throwaway Vite page (chip text, NSI level names of the
  consensus code, the sources and registry lines); not tested: the full app with the `atc3` modules installed from the
  mirror in a clean profile, the e2e specs (they need the local core and the network), a physical device.

### ATC codes in the interaction and safety indexes — 2026-10-14 (STATE ATC4)

Review: [research/atc-index-review-2026-10-14.md](research/atc-index-review-2026-10-14.md) (+ `.json`, selection audit `.json`).

- **What uses ATC.** The interaction index (INT1) in two places: class membership at query time (`drugTargetSet`: a drug is hit by the class
  target `c:<code>` when a card code starts with it, so a sentence naming «противовирусные препараты» is shown for every member) and own-class
  suppression at build time (`keepMention`: in warnings a class mention is dropped when the document's own card is in the class). The
  medication-safety index (SAFE1) uses **no** ATC (substance names and registration numbers only): rebuilt from the published modules it is
  byte-identical, so nothing changes and a data test keeps it ATC-free. Substance rules (`s:`) never use ATC.
- **Code selection** (`features/drug-interactions/atc-codes.ts`, `selectAtcCodes`, 14 unit tests): the node's completed `atcCode`; a node flagged
  `conflict`/`unconfirmed` gives only the registry value, never a candidate; a stub conflict with `atcConsensus` gives **both** the registry stub and
  the consensus code (class membership and own-class suppression alike: the stub stays official, the substance code is the specific one);
  minus the exceptions in `features/drug-interactions/data/atc-code-exceptions.json` (card, code, reason, review; validated by
  `parseAtcCodeExceptions`, applied at build time, so the index never holds an excepted code and no UI code branches on a drug id). Cards are
  chosen from the nodes, not from the card's `atcCodes` total; the old index is reproduced exactly this way from the original release (the
  «~» placeholder that old cards carried is gone).
- **Builders** (`scripts/build-drug-interactions.ts`, `build-medication-safety.ts`): the ЕСКЛП cards now come from the **published** group modules
  found among the local release copies by the catalog SHA-256 (`scripts/lib/published-esklp.ts`), no hand-kept `data/build/release-esklp`; options
  `--out`, `--report`, `--esklp-dir` (decoded databases, for comparing with an earlier release), `MINIMED_DATA_ROOT` (the main checkout from a
  worktree). `scripts/diff-interaction-atc.ts` produces the review input (changed class memberships with the code's node and sources, the class
  rule and its basis, readers and quotes, own-class suppressions) and `--audit-out` the selection audit.
- **Diff and verdicts.** Old index (original release) against the new one (atc2/atc3 codes), same instruction modules: 120 cards with another code
  set, but a refined stub keeps its classes, so **20 class memberships gained on 15 cards, 0 lost, 5 own-class suppressions** (C09D removed from
  sentences of the three sacubitril/valsartan instructions); the 13 ATC3 consensus codes were already on their cards (no change). Review: memberships
  **12 plausible, 6 unsure, 2 wrong**; suppressions 5 plausible. Wrong: the intranasal interferon + loratadine ointment in the systemic
  interferon classes `L03AB`/`L03` (its instruction: plasma level below the detection limit) → exception. Unsure: R05 ×2 (the НСИ class word
  «противокашлевые» covers all of R05), N02B xenon–oxygen, J05AB remdesivir, R02AA eucalyptus tincture — shipped because the product's own
  instruction prints the class; flax seed `A06AC05` (code from the НСИ dictionary only) → exception, for the owner. **Index shipped: 17 memberships
  on 13 cards**; `interaction-index.json` 2 102 425 → 2 100 458 bytes (app asset: it is committed and ships with the next app release, not a
  module, so there is no mirror tag, catalog entry or ledger line; the local-data ledger lists only ≥ 50 MiB artifacts).
- **Tests.** `atc-codes.test.ts` (selection, flags, consensus, exceptions, file validation), `atc-index.data.test.ts` (class codes valid in the
  НСИ dictionary, every judged membership shipped or excluded as the review says and each exclusion declared, suppressed sentences no longer name
  the class, none of the 215 ignored conflict/unconfirmed candidate codes in the index, the 13 consensus codes present, SAFE1 without ATC).
- **Owner decisions 2026-10-14 (STATE ATC4b)**, recorded in the review note and `ownerDecisions` of its JSON; index rebuilt (2 100 458 → 2 101 607 bytes; the build before the change
  reproduced the committed file byte for byte). (1) The class word «противокашлевые» is an alias in `class-phrases.ts` for `R05D` + `R05F` (R05F combinations contain a suppressant by
  definition) instead of the derived whole of R05: **78 cards (expectorants, mucolytics, `R05X` cold remedies) lose it** (7 111 card-document / 7 699 card-sentence pairs), **15 suppressant
  cards keep it and gain** 244 / 304 pairs (suppressant warnings from expectorant instructions were dropped as «own class» before); the two R05 memberships of the first review are
  withdrawn. Residual: 3 dextromethorphan cold remedies coded `R05X` lose the antitussive sentences (no per-card extra-code mechanism exists). (2) The two older topical interferon cards stay in
  `L03AB`: Генферон (benzocaine, vaginal/rectal suppositories) states no absorption and indicates acute bronchitis, cystitis, endometritis with systemic interferon reactions; Генферон лайт has
  no instruction in the product. (3) Flax seed `A06AC05` admitted (exception removed): +97 documents / +133 sentences on that card. Shipped memberships 17 → 16. Other class words as broad
  as R05 (`J01F` macrolide/lincosamide, alias «цитостатики» → all `L01`, `A07`, `N06B`, `R01A`/`S01G`, `B05`, `N02`, `N05C`) were listed in the review and decided the same day (ATC4c, next bullet).
  Tests: `atc-index.data.test.ts` (R05 mapping covers `R05D`/`R05F`, not `R05C`; interferon exceptions; flax in `A06AC`), `class-phrases.test.ts` (alias narrows a derived word).
- **Owner decisions 2026-10-14, second part (STATE ATC4c)**, in the review note («second part») and its JSON (`ownerDecisions` OD4/OD5, `userPerspective`); index rebuilt (2 101 607 → 2 127 209 bytes; the
  build before the change reproduced the committed file byte for byte). (A) Eleven class words resolve to the part of the group they name, as aliases in `class-phrases.ts` (each with its basis; the build
  refuses a code that is not in the НСИ dictionary): «макролиды» → `J01FA`, «линкозамиды» → `J01FF`, «стрептограмины» → `J01FG` (not all `J01F`); «цитостатики» → `L01A`/`B`/`C`/`D`, `L01XA`, `L01XB`, `L01XX`
  (not kinase inhibitors `L01E`, antibodies `L01F`; «противоопухолевые» keeps `L01`); «психостимуляторы» → `N06BA`, `N06BC`, `N06CB` (not nootropics `N06BX`); «снотворные» → `N05CA`–`N05CF`, `N05CH`, `N05CJ`,
  `N05CX` (not herbal sedatives `N05CM`; «седативные» stays on `N05C`); «противодиарейные» → `A07B`, `A07D`, `A07X` (not probiotics, anti-infectives, rehydration); «анальгетики» → `A03EA`, `N02A`, `N02B`,
  `S02DA` (not migraine `N02C`); «деконгестанты» → `R01AA`, `R01AB`, `R01BA`, `S01GA`; «кровезаменители» → `B05A`; «гипотензивные» and «антигипертензивные» **widened** to `C02`, `C03A`–`C03E`, `C07`, `C08`,
  `C09`. Cards losing a word, in the order above: 2 / 7 / 9 / 109 / 28 / 30 / 27 / 13 / 23 / 44; 97 cards gain «гипотензивные» (**+25 208 document pairs**: the NSAID, metformin and additive-hypotension
  sentences of ~380 instructions now reach amlodipine, lisinopril, bisoprolol …). All words together: 13 984 document pairs lost, 26 130 gained (the gains are the widening and own-class suppression working per code).
  (B) `addClasses` in `atc-code-exceptions.json`: a card is added to a class with the instruction document, section and a **verbatim quote** as evidence; `selectAtcCodes(…, additions)` applies it at build
  time and `build-drug-interactions.ts` refuses a quote that is not in the instruction (`additionEvidenceHolds`). Applied to Каффетин® Колд (dextromethorphan, `R05X` → `R05D`, +98 document pairs) and, as a repair
  of the «деконгестанты» narrowing, to Полидекса с фенилэфрином (`R01AA`); the other three dextromethorphan cold remedies have no instruction in the product and stay out. (C) User-perspective assessment: 40
  scenarios through `checkPair`, the installed instruction texts and the run-time highlight: 20 better, 20 neutral (controls that must not change), 0 worse, so every narrowing is applied. The prescription tool
  shares the pair component and changes the same way; the instruction reader does not show interaction sentences; the drug comparison tool and the ATC tree do not read class words; **main search does not use the
  alias table** (class words return instructions that mention them, not class members; proposed for ATC5's search by ATC code, not done). Limits: own-class suppression works per code, so self-description sentences
  reach sibling subgroups of a multi-code word; «антибиотики из группы макролидов» still reaches every antibiotic. Tests: `class-words.data.test.ts` (42 data tests: alias codes and reach, absent broad targets, cards
  of the index, the review record against the index, class additions), `atc-codes.test.ts` (additions), `class-phrases.test.ts` (split and widened aliases).
- **Secondary classes (STATE CLS1, owner 2026-10-14: «Корвалол is about treating the heart, so the hypnotic class is secondary; one drug can have many classes»)**, in the review note («third part») and its
  JSON (`ownerDecisions` OD6); index rebuilt (2 127 209 → 2 127 753 bytes; the build before the change reproduced the committed file byte for byte). A drug has a **primary class** (its ATC codes) and
  may have **secondary classes**: `addClasses` entries get `role` (`primary`: replaces a wrong code and joins the card's codes; `secondary`: an additional class one component brings, kept apart from the codes, with `via` = the
  component and `label` = the class in the view). Several entries per card are allowed; each keeps its reason and a verbatim quote of the product's own instruction (the build still refuses a missing quote and a
  secondary class the card's own codes already cover). In the index a card is `[slug, codes, substances, [[class, component, label], …]]` (4th element only where present); secondary classes match class sentences
  like codes (`drugTargets` splits primary and secondary targets; `drugTargetSet` is their union) and (until CLS2) counted as the card's own class for own-class suppression (0 documents changed). **Applied: phenobarbital,
  `N05CB`** (the registry's own class for Валокордин) on five cards whose instruction calls the phenobarbital sedative or hypnotic or names a barbiturate: Корвалол family (`N05CM`, +287 document / +478 sentence
  pairs), Корвалол-Экстра (`C01EX`, +453 / +702), Тетралганол family (`N02BB72`, +366 / +650), Андипал (`N02BB52`, +400 / +660), Седал-М family (`N02BB72`, +351 / +649); the hypnotic and barbiturate
  sentences of other instructions now reach them (Корвалол + зопиклон 4 → 7, + амитриптилин 0 → 3, + морфин 2 → 4, + лизиноприл 0 → 1). The two ATC4c entries (Каффетин Колд `R05D`, Полидекса с фенилэфрином `R01AA`) became
  secondary by the same rule (a wrong code is primary, a component's effect is secondary): their pairs are unchanged. **UI:** a quote reached only through a secondary class shows a small italic
  «через фенобарбитал (барбитурат, снотворное)» beside the section label in the interaction checker, the prescription tool and the comparison (shared `InteractionPairs`), and in print/share text; no raw codes.
  The «также: …» line of the drug screen was done in CLS2 (below). Not applied, for the owner: phenobarbital cards without an
  instruction (Пентабуфен, Пенталгин Плюс, Тетралгин Н, Корвалол плюс Форте), with an instruction that does not call it sedative or hypnotic (Паглюверин, Теофедрин-Н, Пенталгин-Н/Пиралгин amendment only,
  single-substance Фенобарбитал); other component classes (codeine → opioid 4 of 11 cards with an instruction, caffeine → psychostimulant 19 of 33, phenylephrine/pseudoephedrine → decongestant 15 of 23, paracetamol →
  analgesic 14 of 15, chlorphenamine → antihistamine 6 of 13). Tests: `interaction-secondary.test.ts` (asset shape, split targets, marked sentences, view/print words), `atc-codes.test.ts` (roles, `via`/`label`,
  redundancy), `class-words.data.test.ts` («CLS1»: quotes and roles of the entries, Корвалол among the hypnotic recipients, the per-card counts of the record).
- **Component classes as secondary classes, and the «также: …» line (STATE CLS2, answers the CLS1 and VIS2 requests to DRUG-UI1)**, in the review note («fourth part») and its JSON (`ownerDecisions` OD7).
  The classes CLS1 listed and left open are declared as secondary classes where the card's own instruction names the class (the same quote rule, checked by the build): codeine → opioid `N02A` (2 cards), caffeine →
  psychostimulant `N06BC` (9), phenylephrine and pseudoephedrine → decongestant `R01BA` (12 + 1), paracetamol → analgesic `N02BE` (9, the cold remedies coded `R05X` and Теофедрин-Н), chlorphenamine → antihistamine
  `R06AB` (4); **pheniramine** → `R06AB` too (8; same subgroup and the same cold-remedy products, not on CLS1's list). 45 entries on 28 cards, 7 + 45 = 52 `addClasses`; each entry has its reason and a quote.
  Left out with the reason on record (`notApplied`): the Цитрамон family (its instruction says caffeine in that dose practically does not stimulate), caffeine called only an analgesic adjuvant (РАНКОФ family),
  eye drops with phenylephrine (mydriatic), amendment or OCR sheets, cards without text about the component, and cards the word «анальгетики» already covers through `N02A`. **Own-class suppression no longer
  counts secondary classes:** the first build lost 10 sentence pairs that are real warnings («избегать совместного применения с другими лекарственными препаратами … содержащими парацетамол или антигистаминные
  средства» for loratadine, cetirizine, promethazine; the paracetamol and NSAID contraindication list for paracetamol and aspirin), the scenario check found it; the seven CLS1 cards and their documents are
  unchanged by the fix (0 documents differ). Index 2 127 806 → 2 130 548 bytes (the build before the change reproduced the committed file byte for byte); the top-200 pair coverage is unchanged (2 578 of 19 900).
  **User-perspective check (ATC4c method, 15 changed cold-remedy and analgesic cards × 46 partner drugs = 690 pairs):** 103 pairs change, 131 sentence pairs gained, 0 lost; 73 pairs better (duplicate-antihistamine,
  opioid + benzodiazepine / hypnotic, CNS-depression, sympathomimetic with antihypertensives / digoxin / levodopa, xanthine with theophylline), 30 neutral (true of the class but about another member, or a long
  contraindication list), 0 worse, 587 unchanged; search and the comparison are not affected (class words feed the interaction and prescription tools only).
  **Drug screen:** a small plain line «также: психостимулятор (через кофеин); деконгестант (через фенилэфрин)» (also «барбитурат, снотворное (через фенобарбитал)» for Корвалол) under the code, and on the screen of a
  drug whose module is not installed. The build writes `data/secondary-classes.json` (6.9 kB, 32 cards) beside the index, a lazy chunk of its own (`secondary-classes.ts`, `secondary-classes-load.ts`,
  `DrugSecondaryClasses.tsx`), so the 2.1 MB interaction index is not loaded for one line; the ATC sheet is unchanged (a secondary class is not the card's code). `DrugRecipeButton` words its empty recipe sheet through
  `recipeMissingText(controller.analyses())` (VIS2 request). Tests: `class-words.data.test.ts` («CLS2»: record against declarations and index, classes named by words, per-entry document and sentence counts,
  candidates left out, scenario rows against `checkPair`), `secondary-classes.test.ts` (asset, line, the committed file equals the index), `interaction-secondary.test.ts` (own-class suppression). Not tested: a physical
  device, the dark theme of the new line, the Python suite; no clinician has signed the classes.
- **Not done / not tested.** No clinician has signed the review (AI reviewer, product instruction texts as evidence); hits that did not change were
  not re-audited; the ATC4/ATC4b assets were tested by unit and data tests only (ATC4c ran four pairs in Chromium against the built app with the real instruction modules, before and after: counts match the code
  path; not on a physical device, not in the dark theme, the Python suite not run); no release was made.

### Drugs by ATC code in every drug search — 2026-10-14 (STATE ATC5)

Owner 2026-10-14: ATC search must work in the main search and in the other drug searches (the comparison tool and the
rest), along with the name. Design and numbers: `docs/SEARCH_ARCHITECTURE.md` «Drugs by ATC code», `docs/SEARCH_ROADMAP.md`
item 21.

- **Reading rule** (`packages/search-lexical/src/atc-query.ts`, 40 unit cases): a query is an ATC code only when the whole
  text, spaces ignored, has the code shape — `J05`, `J05A`, `J05AX`, `J05AX1` (typed up to the last digit), `J05AX13`,
  upper or lower case. Cyrillic look-alikes (А В С Е Н К М О Р Т Х У) and the keys of the Russian layout are read («о05» is
  `J05`, «о05фч13» is `J05AX13`, a mix works); a text with two readings gives both and the first one that names a drug wins.
  Not codes: a lone letter, a letter with one digit («С3», «B1»), words («ВИЧ»), a code plus words («J05 ацикловир», which
  stays a name query), anything longer than seven characters. «В12» has the shape; no ATC group `B12` exists, so it lists no
  drug.
- **Main search**: the core takes a drug directory (`createMedicalCore({drugCodes})`, `DrugCodeDirectory`; the app passes the
  comparison index through `comparison-atc-directory.ts`) and puts the drugs carrying the typed code in front of the text hits,
  exact level first, then by name; each group has `atcMatch` and the result card shows the code that matched (`AtcMatchBadge`:
  «J05AX13 · в реестре: L03AX» for the 13 ATC3 cards, the code alone otherwise). It works offline and without the module: a
  drug whose group module is not installed is listed by its catalogue pointer with the download chip, as under a name search.
  An МКБ-10 card with the same letters and digits (`M05`) stays first. A code typed on the Russian layout says «Показаны
  результаты по: «J05»». Lookup mode only, and not with a specialty, audience or section filter.
- **Other places** (all go through the same answer): the medication list search (`medication-catalog-search.ts`: partial
  last digit, spaces, layout), the drug comparison picker and the comparison card's names, the interaction checker picker,
  the prescription drug picker and the search dose card, the safety card. Suggestions show the code beside the name. One-drug
  resolvers (comparison names, interaction names, dose and safety questions) take a full code, or a prefix only when it holds
  exactly one drug.
- **Codes in text are links** (owner addition 2026-10-14; `atc-text-links.ts`, 9 cases): `DocumentText` renders an ATC code
  in any document text as an inline link (`LinkedPlainText`, segment kind `atc`, button `document-inline-atc-link`). Rules: a
  full seven-character code (`J05AX13`) is a link anywhere (no ICD-10 code has that shape); a shorter code (`J05`, `J05AX`)
  has the shape of an ICD-10 category, so it is a link only right after «АТХ»/«ATC» (with «код», a colon or a dash) or in the
  list that continues such a code; a code followed by `.digit` or `-` (`J05.1`, `J05-J06`) never is; look-alike Cyrillic
  letters are read as Latin ones, the Russian-layout reading is for typed queries only. Words, numbers, «ВИЧ», «С3», «В12»
  stay plain text. Tapping opens the code sheet (`AtcCodeSheet`, lazy chunk `AtcTextCodeSheet`, rises from below):
  one row per level with its code and the Russian name (levels 1–4 from the НСИ dictionary, level 5 from the substances that
  carry the full code in the comparison index; a level without a name shows just the code). The drug screen's ATC chip uses
  the same sheet; an agreed code gets a second ladder «В реестре: L03AX» (`atc-sheet-model.ts`, 7 cases). Each level row
  is a button: levels 1–4 open the «По группам АТХ» tree at that node (subgroups, substances, group package download), a full
  code opens the medication list filtered by it (`atcGroupTarget`, `openAtcGroup`; the list takes the query even when its view
  is already mounted). E2E (`atc-links.spec.ts`, real built app with the antiparasitic module): chip → sheet (5 levels) → level
  2 → tree at `P02`; chip → full code → list with the search filled; inline code in the card text → sheet → level 1 → tree.
- **Data**: the comparison index carries the agreed pairs (`q`: `[agreed code, registry stub]`, 13 cards) beside the codes in
  `a`; `scripts/build-drug-comparison.ts` writes them. Rebuilt on 2026-10-14 from the published `atc3`/`atc2` modules
  (decoded in a scratch directory, deleted after): the new asset is identical to the committed one except for the 13 `q` fields.
  No module, pointer or core was rebuilt.
- **Measured**: `bun run benchmark:atc` over the real core (2 787 cards with codes): 2 192 full codes → 2 192 found (top-5
  2 093, the rest share a code with other cards), 13/13 agreed pairs show both codes under either, 142 prefix queries return
  only drugs under the prefix, 220/220 typing variants (lower case, spaces, look-alikes, Russian layout) give the same drugs, 0/8
  word negatives; `benchmark:all` (core), `run-name-variants.ts`, `benchmark:cmp1` (35/35) and `benchmark:source-names`
  identical with the directory on and off (`ATC5_OFF=1`). Built app, real core, Chromium (`apps/app/e2e/atc-search.spec.ts`,
  2 cases): `J05AX13` shows «Умифеновир · J05AX13 · в реестре: L03AX», `j05ab` lists drugs under `J05AB`, `о05ах13` reads as
  `J05AX13`, «ВИЧ» has no code badge, and the comparison picker suggests the drug with the code.
- Not done / known: drugs are found as substance cards, not as the products (trade names) under them; a lone letter never
  names an anatomical group; the first call of a code query loads the 2.5 MB comparison chunk (not measured on a phone); not tested: a physical device,
  the native (Capacitor) core with the directory, the `atc3` modules installed from the mirror.

### Search fixes from the QA pass — 2026-10-14 (STATE SRCH1)

The Haiku QA pass of 2026-10-14 (`docs/research/qa-haiku-2026-10-14.md`, «Search quality») and the owner's class-word decision of the
same day. Design: `docs/SEARCH_ARCHITECTURE.md` «Brand names, class words, homeopathy and nonsense (SRCH1)»; roadmap item 22. Measured
below (the core alone, `MINIMED_CONTENT_DIR` = the main checkout's `apps/app/public/content`, a baseline worktree at `04dab36a` for «before»).

- **Trade names** (item 1): «Аспирин», «Нурофен», «Амоксиклав», «Но-шпа», «Кардиомагнил»… were in the core (the pointer of the substance lists every
  trade name) but «Все» dropped the pointer because its title does not carry the brand; now a pointer whose found fragment matched a
  typed word as itself stays, its title is `Бренд · ВЕЩЕСТВО` (not another product line of the expanded query), and a product typed
  whole leads. Benchmark: 315 trade names from the shipped drug index.
- **Drug before tools** (item 2): an INN query already put its card first in the core (150/150); the calculators that mention it were laid
  out above it by the app (`toolsFollowResults`). When the first result is a drug card, tools follow it unless the query asks for a tool.
- **Homeopathic mixtures** (item 3): behind the ordinary cards that name the query («фосфор», «ртуть», «сера», «кальций»); the registry
  group «гомеопатическое средство» (344 cards) is the class; nothing is hidden (`createMedicalCore({drugCodes}).homeopathicIds`).
- **Drug pickers** (item 4): one rule (`features/drug-picker/drug-name-match.ts`) for the interaction, comparison, prescription / dose
  and safety pickers: any typed word begins any word of the МНН or of a trade name of the card, any order, «/», «+», «,», «-», spaces.
  «сакубитрил», «сакубитрил/валсартан», «рил валсартан» find `валсартан+сакубитрил` even without the core.
- **Nonsense** (item 5): `<script>alert(1)</script>`, `<img …>`, keyboard smashes and symbol-only text find nothing («Ничего не
  найдено», also no tool cards: `fuzzyQueryScore` of a query without a word is 0); a spelling correction never turns a Latin word of up to
  six letters into a rare Latin name («alert» → «Apert»). Typo correction of names is untouched.
- **Marks** (item 6): only the typed words, whole (`search-highlight.ts`); `J05` marks nothing but the typed characters of a code.
- **Label = target** (item 7): `searchResultDocumentKind` calls a document a calculator only when it names one (`interactiveCalculatorId`);
  the four reference documents flagged `calculationRequired` (WHO BMI table, eGFR, child growth) are reference documents. Data follow-up
  (SRCH2 linked two of them, see «Class word inside a query, calculator links»): `interactiveCalculatorId` + `interactiveRoute` in
  `content/reference-rf-pilot/*.md`, then rebuild `reference.db`.
- **«Обновить»** (item 8): only after installed content changed and only if the first 12 documents or their order differ; every other
  re-run of the query on screen replaces the list at once.
- **Query in the address** (item 9): `#/search?q=…` / `#/search/section/<id>?q=…`; reload and shared links restore the field and the search;
  the entry is the one navigation made (replace only; NAV1 owns push), see the request in STATE.md.
- **Dictionary** (item 10): a selection without a dictionary entry lists only documents whose title carries the selected word.
- **ATC data** (item 11): the card «Вейника наземного трава + щучки дернистой трава» carries `J05` because ЕСКЛП gives it that level-2 code
  («противовирусное средство растительного происхождения»); no source can code it further and 16 more herbal / biological cards have
  only a level-2 code. The registry value stays (ATC2 rule: published codes are changed only by agreement of sources); the search no
  longer ranks such a card as "the exact level" of its group, so `J05` lists the classified antivirals first. No module or core was rebuilt.
- **Class words** (owner decision 2026-10-14): a query that names a drug class as a whole returns the class card (name, its ATC groups
  with НСИ names and drug counts, each group a link to the ATC tree), then up to 12 drugs of the class (single substances before
  combinations, commoner first, each with the ATC code that matched), then the documents. One vocabulary: the НСИ group names of
  `class-phrases.ts` read in every inflection, its declared aliases (owner decisions ATC4/4b/4c: «макролиды» = `J01FA`, «цитостатики» =
  `L01A–D, L01XA, L01XB, L01XX`…) and the search-only synonyms `CLASS_QUERY_ALIASES` (бета-блокаторы, мочегонные, сартаны, ИПП,
  цефалоспорины, бронходилататоры, муколитики, антиаритмики, сахароснижающие…, not added to `CLASS_ALIASES` because the interaction index
  was built with that table). `bun run benchmark:class`.
- **Measured** (before → after; `bun run benchmark:srch1`, `benchmark:class`, the unchanged gates):

  | Set | Before | After |
  |---|---|---|
  | 315 trade names, «Все»: card first / in the first three | 0.911 / 0.943 | 0.978 / 1.000 |
  | 315 trade names, «Препараты»: first / first three | 0.959 / 1.000 | 0.978 / 1.000 |
  | 150 INN names, own card first (both scopes) | 1.000 | 1.000 |
  | 15 words that homeopathic mixtures also contain, no mixture in front of an ordinary card | 13/15 | 15/15 |
  | 16 nonsense strings find nothing («Все» / «Препараты») | 14/16 / 16/16 | 16/16 / 16/16 |
  | 19 controls (names, codes, Latin terms, misspellings) still find something | 19/19 | 19/19 |
  | 52 class words × 2 scopes: class card / right ATC groups / drugs lead | 0 / 0 / 0 of 104 | 104 / 104 / 104 |
  | expected drugs among the listed ones; 22 negatives (disease, drug, code, brand) carry no class | – ; 22/22 | 232/232 ; 22/22 |
  | `benchmark:all` (core): lookup R@1 / R@5 / MRR, demo R@1 / R@5 | 0.180 / 0.279 / 0.214, 0.053 / 0.158 | identical |
  | `benchmark:all` demo MRR (19 queries) | 0.105 | 0.096 (one query, «аугментин пневмония»: the Амоксиклав card is no longer dropped in «Все», the КР moves from second to third; hit@5 unchanged, tolerance 0.02) |
  | `benchmark:all` latency p50 / p95, both checkouts run at the same time under load 45 | 1 102 / 2 914 ms | 1 071 / 2 949 ms |
  | `benchmark:cmp1` (35 cases), `benchmark:atc` (2 192 codes, 220 variants, 142 prefixes, 8 negatives) | 35/35, all pass | identical |
  | typo set (698 first-letter slips, 231 late slips, 220 controls), `run-typo-queries.ts --no-companions`: hit@1 / hit@5 of the first-letter slips with correction on | 0.831 / 0.832 | 0.831 / 0.832 (every row and every control identical) |
  | name variants (720 layout / Latin spellings, 166 controls), `run-name-variants.ts --no-companions`: hit@1 / hit@5 on | 0.804 / 0.818 | 0.804 / 0.818 (identical rows, controls identical) |

  The first two baseline runs of the typo set (21:50 and 23:13, with other agents loading the machine) came out broken (correction «on» 0.000 for diseases and
  guidelines, every control «changed»); the third solo run is the one above. Unit: 600 files / 17 652 tests pass. E2E in Chromium on the built app
  with the real core (`apps/app/e2e/search-srch1.spec.ts`, 6 cases): «Аспирин» leads with its card, «макролиды» shows the class card above the drugs
  (group link opens `#/modules/documents/medications/atc/J01FA`), disease / drug / code carry no class card, the query is in the address and survives a reload,
  markup shows «Ничего не найдено», marks are whole typed words.
- Not done / known: the class card on the native (Capacitor) core was not run; the class list is 12 drugs (the card says how many more and
  links to the groups); the first class-shaped query loads the 110 kB НСИ dictionary chunk and derives the phrases (59 ms on a laptop);
  a class word inside a longer query is handled by SRCH2 (below); not measured on a phone; the reference documents of
  item 7: two of the four are linked by SRCH2 (below).

### Class word inside a query, calculator links, version qualifier — 2026-10-15 (STATE SRCH2)

Roadmap: the class row and item 22 (`docs/SEARCH_ROADMAP.md`); design `docs/SEARCH_ARCHITECTURE.md` «Class word inside a longer query».

- **Class word inside a longer query.** «макролиды детям», «статины при беременности», «ингибиторы АПФ кашель» show the class card and the
  three commonest drugs of the class (12 for a bare class word), then the documents ranked by the whole query (unchanged order: checked per
  query against the same core with the class lead off). `classOf` (`medications/drug-class-lookup.ts`, `classInQuery`) takes the first class
  phrase of the query (longest run at that word) if a plural word or a capital abbreviation is in it, and at most three other words remain;
  it returns them as `DrugClassMatch.rest`; the core (`drug-class-search.ts`, `restNamesDrug`) drops the class when they name a substance
  (whole МНН names of the directory, never one word of a long registry name). Not triggered: «инсулин при беременности», «витамин D дефицит»,
  «антибиотик ребёнку», «статин-индуцированная миопатия», «азитромицин макролиды», sentences with more than three other words, queries with a
  digit or a filter. Left: a trade name typed with the class word («аспирин и статины») still shows the class; two classes in one query take
  the first; a singular class word («антибиотик при ангине») stays a text query.
- **Measured** (real core + companions, `ScopedMedicalCore`, before → after): `benchmark:class` 52 classes unchanged (104/104 on card, groups, lead,
  232/232 drugs, 22/22 negatives) plus the new `phrases` set: 46 queries × 2 scopes → card 92/92, groups 92/92, leading drugs in the class 92/92,
  documents in the plain order 92/92, 12 negatives × 2 scopes clean 24/24 (before: 0/92 cards). `benchmark:all` (lookup R@1 0.180 / R@5 0.279 /
  MRR 0.214, demo R@1 0.053 / R@5 0.158), `benchmark:real:release` (lookup R@1 0.246 / R@5 0.328 / MRR 0.284, demo 0.105), `benchmark:srch1`
  (315 brands 308/315 first, 150 INN 150/150, 16 nonsense, 19 controls) and `benchmark:doctor-lookup` (R@5 0.929, MRR 0.804): identical.
  Owner queries (54, «Все»): hit@5 0.556 → 0.574 (rush 0.742 → 0.774), hit@1 0.259 unchanged; the one changed query is «фп антикоагулянты»
  (miss → rank 3). A scan of the 3 200 queries of all benchmark query sets finds 3 that read a class inside them (the owner's
  «фп антикоагулянты» and two parser fixtures «Антибиотики не принимал…»); without the ≤ 3 other words rule the clinical-guideline sentences
  («…нужны ли антибактериальные препараты при ротавирусном гастроэнтерите») would have been 4 more. Unit: 625 files / 17 845 tests; e2e `search-srch1.spec.ts` (3 class cases, Chromium, built app) pass. Not run: a physical device, the native core.
- **Calculator links.** The CKD-EPI 2021 adult eGFR document and the WHO child-growth document now carry `interactiveCalculatorId` and
  `interactiveRoute` (`content/reference-rf-pilot/*.md`), so their result cards are «Калькулятор» and open the reference with the «Рассчитать»
  button. The WHO BMI table (adult + child) and CKiD U25 are **not** linked: the app has no adult BMI calculator, and its only CKiD tool is the
  older bedside-2009 equation (a different formula than the document teaches). `data-assets.data.test.ts` pins the links and the two exceptions.
  **Rebuilt 2026-10-15:** `apps/app/public/content/reference.db` (`medbase build --input content/reference-rf-pilot`; first rebuild since
  0.6.33, now the current pack schema: external-content FTS, definition-reference tables; same 18 document ids, 1.02 → 0.97 MB) and
  `reference-report.json` (sha256 5b3e1a0e…; 6 warnings: the diet tables have no chunk source spans, as before).
- **Version qualifier.** `resultQualifier` reads `documentVersionLabel()`: a recommendation's «459_2» shows as «ред. 2», `site-…` ids and hashes
  show nothing (`isMachineVersionLabel` is gone).
- **МКБ-11 section** (request ICD11, 2026-10-06): assessed as not small; done on the owner's decision of 2026-10-15
  (ICD11-SEC, «МКБ-11 search section» above).

### «Лента»: opt-in news feed and site viewer — 2026-10-05 (STATE NEWS1, ADR-0024)

Owner decision: a fourth bottom tab «Лента» (Поиск · Файлы · Лента · Настройки; in the six-section
layout it sits before «Настройки») with the unread count on the tab icon (`app-nav-badge--news`,
read from localStorage only). Everything is in `apps/app/src/features/news/`, CSS `styles/news.css`
(lazy with the tab) and `styles/news-badge.css` (start-up).

- **Network is opt-in.** No request is made until a source is added; suggested sources are offered
  (`suggested-feeds.json`, data not code), never auto-subscribed. Refresh on opening the tab (only
  feeds older than 15 min) and on the refresh button; no background polling. Offline the tab shows
  the cache with the last fetch time; a failing source keeps its items and shows its own error.
- **Transport port** (`news-transport.ts`): Android uses `CapacitorHttp` (core, no plugin, no config
  change; no CORS; base64 body decoded with the declared charset; redirects followed by the app;
  ETag/Last-Modified sent); the web build uses `fetch` and reports a CORS refusal honestly («Этот
  источник не разрешает чтение из браузера — откройте в приложении для Android или как сайт») with an
  «Добавить как сайт» fallback. No CORS proxy. Limits: 15 s, 6 MB, 100 items per fetch.
- **Parsing** (`markup.ts`, `feed-parser.ts`): RSS 2.0, RSS 1.0/RDF (NEJM, Lancet, Nature), Atom,
  JSON Feed; a small tolerant tokenizer instead of `DOMParser` (no DOM in the unit runner, malformed
  feeds, no entity expansion — reasons in ADR-0024). Page feed discovery reads
  `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">` only; no path guessing.
- **Sanitization** (`feed-content.ts`, `NewsRichText.tsx`): item HTML becomes a tree of allow-listed
  elements rendered by element creation (no `innerHTML`); remote images only when «Изображения» is on
  for that source; links `target=_blank rel="noopener noreferrer"`, no referrer.
- **Storage** (`news-storage.ts`): subscriptions in localStorage (`minimed.news.subscriptions.v1`),
  items in IndexedDB `minimed-news` (≤ 200 per feed, ≤ 30 days; memory fallback). First fetch marks
  only the last 3 days unread. OPML 2.0 export (system share/download) and import in «Источники».
- **UI**: list grouped by day (Сегодня/Вчера/date) with source, time, title, snippet and unread dot,
  filter chips per source with counts, «Отметить всё прочитанным», sites strip, empty state with the
  suggested sources, add page (paste address: feed → preview and «Подписаться»; page → declared feeds
  or «Добавить как сайт»), sources page (rename, images on/off, remove with confirmation, OPML).
  Routes: `#/news`, `/add`, `/sources`, `/item/<id>`, `/site/<id>`; `newsParentHash` makes Android
  Back close the viewer, then the sub-pages, then return to search (`native-back.test.ts`).
- **Viewer** (`NewsViewer.tsx`, `framing-policy.ts`): «Из ленты» (offline text) / «Страница»
  (`<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox">`, no
  `allow-same-origin`, `referrerpolicy=no-referrer`), address line, «Открыть в браузере». Framing
  refusal is read from `X-Frame-Options`/CSP `frame-ancestors` where headers are readable (Android,
  CORS-open hosts) and otherwise caught by a 12 s load timeout plus a standing hint.

Suggested sources, verified by fetching and parsing with the app's own parser on 2026-10-05
(`webReadable` = host sent `Access-Control-Allow-Origin` for `https://t-damer.github.io`; Android
reads all of them):

| Source | Format | Items | Browser build |
| --- | --- | --- | --- |
| Росздравнадзор — новости | RSS 2.0 (every item twice; deduplicated) | 10 | blocked (CORS) |
| ВОЗ — новости (на русском) | RSS 2.0 | 25 | readable |
| Фармвестник — новости | RSS 2.0 | 30 | blocked |
| Медицинская газета | RSS 2.0 | 10 | blocked |
| MedPortal — новости медицины | RSS 2.0 | 100 | readable |
| ДокторПитер | RSS 2.0 | 100 | readable |
| NEJM — свежий выпуск | RSS 1.0 (RDF) | 52 | blocked |
| The Lancet — новые статьи | RSS 1.0 (RDF) | 55 | blocked |
| Nature Medicine | RSS 1.0 (RDF) | 8 | blocked |
| PLOS Medicine | Atom | 30 | blocked |
| FDA MedWatch | RSS 2.0 | 20 | blocked |
| MedPage Today | RSS 2.0 | 20 | readable |
| STAT | RSS 2.0 | 20 | blocked |
| Medical Xpress | RSS 2.0 | 30 | blocked |

Left out on purpose: Минздрав (no feed; the site is not reachable without the Russian root CA),
Медвестник (no feed), Лечащий врач (feed without items), WHO English (newest item from February),
BMJ (redirects to http-only `feeds.bmj.com`: mixed content in the browser, cleartext on Android),
JAMA (bot challenge for non-browser clients), RIA/TASS (general news, not medical), Medscape (the
public feed found is the nurses' one).

Framing of article pages (HEAD with a browser User-Agent, 2026-10-05): refused by Росздравнадзор,
Медицинская газета, ДокторПитер, WHO, NEJM, The Lancet, Nature, PLOS, FDA, STAT, Medical Xpress,
PubMed, Vidal, КР Минздрава, BMJ and JAMA (`X-Frame-Options: SAMEORIGIN`/`DENY`, WHO and STAT also
`frame-ancestors`); allowed by Фармвестник, MedPortal, Медвестник, RLS and Wikipedia; unknown
(HEAD refused or bot-blocked) for MedPage Today, CyberLeninka and Cochrane Library. Most medical
publishers therefore need «Открыть в браузере» or the feed's own text.

Not verified: a physical device or the Android emulator (shared, not touched): `CapacitorHttp`
against the real feeds, system-browser hand-off from the viewer, and whether Android lets an external
`<iframe src>` load inside the frame (see ADR-0024). The Vite dev/preview servers are cross-origin
isolated, so real sites cannot be framed there; the e2e fixtures send the opt-in headers.
Tests: unit (`features/news/*.test.ts`: parsing of every format, malformed and oversized input,
sanitizer attacks, merge/retention/unread, URL detection, transport, framing policy, OPML, routes,
service) and `apps/app/e2e/news-feed.spec.ts` (empty tab makes no request, add by address, offline
cache, unread badge, viewer sandbox, framing-refused and never-loading fallbacks, CORS message,
images switch, suggested source, rename/remove).
