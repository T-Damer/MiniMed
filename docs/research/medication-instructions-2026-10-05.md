# Russian drug instructions: coverage, further sources, foreign sources with translation (MED2, 2026-10-05)

Owner request (2026-10-05): «We need medications data, search for it more, maybe foreign sources with translations — we need
Russian instructions on drugs in the app.» Research and plan only: no pack, catalog or app code was changed, no PDF or archive
was downloaded, no CAPTCHA was touched. Builds on [grls-mirrors-2026-10.md](grls-mirrors-2026-10.md),
[instruction-sources-2-2026-10.md](instruction-sources-2-2026-10.md), [instruction-mirrors-3-2026-10.md](instruction-mirrors-3-2026-10.md),
[manufacturer-instructions-2026-10.md](manufacturer-instructions-2026-10.md), [grls-reuse-rights-2026.md](grls-reuse-rights-2026.md),
[../GRLS_INGESTION_HANDOFF.md](../GRLS_INGESTION_HANDOFF.md) and the GI1/G1/M1 sections of [../CURRENT_STATE.md](../CURRENT_STATE.md);
what those documents already established is not repeated except where a number is needed.

Legend: ✔ measured or requested in this session; ◐ taken from an earlier repo document (not re-checked today); ○ my estimate or
general knowledge, not verified.

## 0. Summary

1. **The gap is mostly per product, not per substance.** 70.8 % of ЕСКЛП МНН cards already have an official ГРЛС text and 87.2 % of the
   ЖНВЛП ones, but only 43.7 % of ЕСКЛП product positions (packs) and 54.2 % of trade names have *their own* text. 39.3 % of trade
   names (МНН × trade name) have neither their own official text nor a name-matched Allmed entry.
2. **The cheapest large gain needs no new source:** for 94.3 % of positions (ЖНВЛП 96.3 %) *another registration of the same МНН,
   dosage form and strength* already has an official Russian text in the shipped modules. Showing it, clearly labelled as another
   preparation's instruction, lifts "has an official Russian text to read" from 43.7 % to 94.3 % of positions. It needs an owner decision and a
   small ADR, not data collection.
3. **No other open source of official Russian text exists at scale** (re-confirmed: the EAEU registry is still down, `lk.regmed.ru`
   is behind a CAPTCHA, no mirrors). Realistic extra free paths add about 600–750 registrations (≈ 5 % of what is missing). The only
   path that scales is an official request or a paid contract (ЕАЭС ОХЛП/ЛВ list: 6 306 uncovered EAEU registrations).
4. **Foreign sources with translation are a niche, not the main fix:** Russian-language labels do not exist in EMA/FDA/MHRA. For the 703 МНН cards
   with no Russian text at all, an English label exists for roughly 56–80 of them (8–11 %), almost all innovative oncology, rare-disease and
   biologic products; the other ~620 are Russian-specific combinations, herbal, homeopathic, vaccines and sera. That is under 1 % of
   product positions. It can be done consistently with AGENTS.md only as a separately labelled machine-translation artifact next to the
   original, and it needs an ADR plus an owner decision.

## 1. Current coverage (measured 2026-10-05 from repo data)

### 1.1 What exists

| Item | Value | Source |
|---|---|---|
| ГРЛС registry export 02.10.2026, active non-substance registrations | 27 049 | `data/raw/official-grls-registry/catalog-02.10.2026.json` ✔ |
| Of them with an official text in the 15 released instruction modules | **12 740 (47.1 %)** | `data/build/grls-instruction-modules/coverage.json`, re-derived ✔ |
| ЕСКЛП registrations (29 300) with an official text | 12 666 (43.2 %) | coverage.json ✔ |
| Released documents | 8 944 (15 modules, 230.6 MB download / 1 368 MB installed) | GI1 ✔ |
| Kinds | 4 671 national instructions, 3 811 patient leaflets, **5 ОХЛП**, 457 unclassified scans | coverage.json ✔ |
| Registrations served by a leaflet only (no professional text) | 5 134 of 12 749 (40 %); ОХЛП serves 8 registrations | re-derived ✔ |
| OCR documents | 2 296 (25.7 %); 114 of them have an unknown-word ratio above 0.2 (17 above 0.3) | manifest ✔ |
| Allmed reference (not official, rights unresolved) | 4 708 entries; 3 538 linked to a МНН (1 563 distinct МНН), 1 129 unmatched, 41 ambiguous | `apps/app/public/content/medications.db` ✔ |
| ЕСКЛП product cards | 3 324 МНН cards, 7 672 СМНН nodes (МНН × form × strength), 604 213 КЛП positions (packs), no instruction text of its own | `data/build/release-esklp` ✔ |

### 1.2 By level

"Own official" = the product's own registration number is served by a released ГРЛС document. "+ Allmed" adds an Allmed entry linked to
the same МНН with the same trade name (the form check of `allmed-matching.ts` is not applied, so this is an upper bound).

| Level | Total | Own official | + Allmed | Lacks both |
|---|---:|---:|---:|---:|
| **МНН card** | 3 324 | 2 353 (70.8 %) | 2 621 (78.8 %) | **703 (21.2 %)** |
| МНН card with a ЖНВЛП node | 905 | 789 (87.2 %) | 837 (92.5 %) | 68 (7.5 %) |
| **Trade name × МНН** | 12 038 | 6 529 (54.2 %) | 7 311 (60.7 %) | **4 727 (39.3 %)** |
| **КЛП position (pack)** | 604 213 | 264 178 (43.7 %) | 416 672 (69.0 %) | **187 541 (31.0 %)** |
| КЛП position, ЖНВЛП flag | 347 051 | 144 205 (41.6 %) | 238 729 (68.8 %) | 108 322 (31.2 %) |
| Distinct trade-name strings, ЕСКЛП (any registration with text) | 11 888 | 6 489 (54.6 %) | n/a | n/a |
| Distinct trade-name strings, ГРЛС | 10 749 | 6 261 (58.2 %) | n/a | n/a |
| ГРЛС registrations flagged `essentialDrug = Да` | 11 377 | 5 869 (51.6 %) | n/a | 5 508 |
| ГРЛС INN strings, ЖНВЛП | 924 | 795 (86.0 %) | n/a | 129 |
| «INN + form class» groups (collector), all / ЖНВЛП | 4 383 / 1 138 | 2 971 (67.8 %) / 961 (84.4 %) | n/a | 1 412 / 177 |

Answer to "what share of products shown in the app lacks any instruction": by trade name **39.3 %** (45.8 % lack their own official text;
Allmed is a short non-official reference), by pack position **31.0 %** (positions weigh widely packaged products more). ЖНВЛП behaves like
the whole: 31.2 % of ЖНВЛП positions. The registry side: 14 309 of 27 049 active registrations (52.9 %) have no text. The collector's plan listed
8 325 of them as targets on 2026-10-02 (6 415 EAEU-format `ЛП-№(…)-(РГ-RU)`); today 6 306 EAEU-format registrations are uncovered, 2 896 of them flagged ЖНВЛП. The rest
are numbers the plan defers (legacy or ambiguous, 2 420 in G1); the two denominators were not reconciled exactly.

By registration format the uncovered 14 309 are: EAEU 6 306, `ЛП-` (national, old) 3 254, `ЛС-` 2 406, `Р` 1 080, `П` 903, other ≈ 360 ✔. By holder country
(uncovered): Russia 10 845, India 708, Germany 413, China 240, France 169, Switzerland 168 ✔.

### 1.3 Who is left without any text

The 703 МНН cards with neither an official text nor an Allmed link hold only 7 989 of 604 213 positions (1.3 %) and 1 276 registrations ✔. They are:
403 combinations (many herbal and homeopathic mixtures), 204 with no ATC code (`~`), the rest single substances. By ATC letter: A 79, J 66, L 58, D 50,
V 48, N 41, R 40, G 33, C 28, B 26, M 18, S 11, H 1. Only 68 are ЖНВЛП (vaccines, sera, immunoglobulins, a few new oncology and contrast agents).
Sample: new oncology antibodies (avelumab, panitumumab, teclistamab, glofitamab), new small molecules (vonoprazan, darolutamide, selpercatinib),
Russian-only substances (riamilovir, arglabin, omberacetam), insulins (4 human insulin cards), phage and allergen products, radiopharmaceuticals.

### 1.4 If a same-substance text were shown (not implemented; no fallback exists in the app today)

The app attaches a document by registration number only (`instruction-source.ts`, `drug-screen.ts`); a product whose registration has no
document gets the Allmed plaque or nothing. Measured effect of a *labelled* fallback to another registration's text:

| Fallback key | Positions with some official text | ЖНВЛП positions |
|---|---:|---:|
| Own registration only (today) | 43.7 % | 41.6 % |
| + same МНН × form × strength (СМНН node) | **94.3 %** (own 264 178 + node 305 551; none 34 484) | **96.3 %** (none 12 794) |
| + same МНН × dosage-form class (as the collector's groups) | 97.3 % (98.0 % with Allmed; none 12 251) | 98.9 % (99.2 % with Allmed) |

By trade name × form class (13 070 units): own 53.5 %, same-substance-and-form-class text 34.3 %, Allmed only 2.6 %, none 9.5 %. The
strength-matched node key is the safer one: different strengths often differ in dosing text. This is the same logic the G1 collector already
relies on («one text per INN + form class group»), so the collector's queue and this fallback complement each other.

### 1.5 Collector state and pace (G1, `data/build/grls-collect/progress.json`)

Windows so far: probes 1/1/0 successes, batches 12 of 13, 14 of 14, 11 of 14 processed before the CAPTCHA (3 CAPTCHAs, 39 successes in 3 days, **≈ 13 registrations
per day**). Groups covered 2 965 of 4 383 by `progress.json` (2 971 by the module measurement; the 6-group difference was not reconciled);
queue: 1 030 first-pass groups (166 ЖНВЛП), 854 ОХЛП second-pass groups, 388 unreachable. At 13 per day the ЖНВЛП groups finish in ≈ 2 weeks, the first pass
around 2026-12-23, the ОХЛП pass around 2027-02-27. A refresh of the instruction modules is needed to ship any of it.

## 2. Russian sources beyond ГРЛС and Allmed

Requests made today (all ✔, sequential, truthful `User-Agent: MiniMed-research/1.0 …`, no logins, no CAPTCHA, no downloads): HEAD on six
registry addresses, one config JSON and the web-app bundle of `pharma.eaeunion.org`, `rceth.by/Refbank` (page), three web searches. No Russian
root certificate was installed or used; no ЕСКЛП/НСИ host was contacted.

| # | Source | Official approved text? | Rights / terms | Access | Re-check 2026-10-05 | Gain (registrations) | Effort |
|---|---|---|---|---|---|---|---|
| 1 | **ГРЛС** `.aspx` + `/InstrImg/` (running collector G1) | Yes, the registered instruction | no licence; `robots.txt` disallows `/` and `/instrimg/`; owner decision 2026-10-02 to collect slowly ◐ | search → card → Ajax → static PDF; CAPTCHA after ≈ 14 registrations | 3 CAPTCHAs in 3 days ✔ | ≈ 13 per day (group queue) | running |
| 2 | **Official request** to НЦЭСМП (ОХЛП and ЛВ of EAEU registrations) or to Минздрав for ГРЛС data | Yes | official channel; reply and licence unknown | letter / 8-ФЗ request ◐ | not tried | up to 6 306 uncovered EAEU registrations, all 1 412 uncovered groups if ГРЛС agrees | S (write the letter); delivery uncertain |
| 3 | **ЕАЭС union register** `portal.eaeunion.org/…/PMM01/TableView.aspx` | ОХЛП/ЛВ in theory | open-data reuse allowed for the OData/open data (◐) | web registry | **404 again** (as 10-01, 10-02) ✔ | 0 today | none until it returns |
| 4 | EAEU OData `pharma.eaeunion.org` and `opendata.eaeunion.org` | Documents not exposed: `drugDocumentsDetails` = null in every checked record (◐); useful only as a dossier-number key between countries | «available for reuse with minimal restrictions» (◐) | SPA 200 ✔; daily archive `OP26_1.0.0_full.zip` 49.6 MB not downloaded | pages 200 ✔; `config.json` points to `/spd2` API and `/platformsvc` file storage (not probed further) | 0 direct; a key for #5 | S (needs your OK to fetch 50 MB) |
| 5 | **Belarus `rceth.by`** and **Kazakhstan `register.ndda.kz`** (shared EAEU dossiers: same registration number, ОХЛП/ЛВ in Russian) | Yes, the common dossier text with a national stamp (Jaccard 0.56–0.99 against our PDFs ◐) | no terms found on either site (`rceth.by` footer shows only «© 1998-2026» ✔); `robots.txt` has no rules (◐ earlier reports; today only HEAD 200 text/html ✔); not a clearance | rceth: form + `NDfiles/pdfeaec/<№>/LV.pdf`/`OHLP.pdf`; ndda: JSON API of the web UI; no CAPTCHA seen ◐ | `robots.txt` 200 ✔; `rceth.by` page says all content is Russian, no login or CAPTCHA ✔ | ≈ 361 gap registrations (ЖНВЛП ≈ 184) ◐ | M (adapter + matching) |
| 6 | **Holders' own sites** (M1 pilot of 7 sites; plus `ns03.ru`, `dalkhimpharm.ru`, `avexima.ru`) | Yes (holder-published), edition may differ from ГРЛС | robots permit; no licence | static HTML + PDF | pilot data on disk: **245 registrations, none yet in any module** ✔; 240 pass the strict/unique levels, they close **47 of 1 412 uncovered groups (17 of 177 ЖНВЛП)** ✔ | +240 now; ≈ +100–150 with three more sites ◐ | S to ship the pilot; M per further site |
| 7 | `lk.regmed.ru/Register/EAEU_SmPC` (НЦЭСМП, 13 859 records) | Yes | official | page 200 ✔; downloads behind a CAPTCHA | not touched | would cover most of #2 | not possible (CAPTCHA) |
| 8 | **medi.ru** | verbatim ГРЛС text, but samples are 2011–2017 editions ◐ | terms grant nothing for reuse ◐; the site says it publishes «official instructions … verified by НЦЭСМП» and reformats ГРЛС ✔ | HTML, `robots` open | not re-sampled | ≈ 16 k pages, mostly stale | not recommended (stale doses look current) |
| 9 | Pharmacies, marketplaces | rewritten or stale; some terms forbid copying | forbidden or unclear | HTML; many blocked | not touched | n/a | do not use |
| 10 | Wayback / Common Crawl / GitHub / HF / Zenodo / Kaggle / Telegram | no complete mirror; 0.06 % of known URLs, 0 CC pages | — | — | not repeated | ≈ 0.3 %, old editions | do not use |
| 11 | **Paid**: ЛС ГЭОТАР API (claims daily sync from ГРЛС, «originals» in paid tiers), РЛС Aurora (18 249 instructions, API/offline copy), Видаль database | ЛС ГЭОТАР/РЛС: text from ГРЛС (RLS and Видаль rework it); Видаль not verbatim | contract; ЛС ГЭОТАР terms limit use to «personal non-commercial» ◐ | API, MS Access dump | prices unpublished | all missing registrations in principle | S to ask, then a contract |
| 12 | ЕСКЛП / ФРЛП fields | none: no instruction link or text in the ЕСКЛП Excel export 2.0.4 (◐); I found no register called «ФРЛП» with texts in public sources ✔ (web search returned only ЕСКЛП, ГРЛС, РЛС pages) | — | — | — | 0 | — |
| 13 | Минздрав open data (ГРЛС CSV 2017, standards), Росздравнадзор letters | not texts; stale | — | — | — | 0 | — |
| 14 | Other EAEU registers (Armenia, Kyrgyzstan), Ukraine, Uzbekistan | likely instructions in Russian, Ukrainian or local language; other country's approved text | unknown | not examined | — | unknown | do not start before #2–#6 |
| 15 | Federal formulary (Федеральное руководство по использованию ЛС) and WHO publications with official Russian versions | not instructions (formulary monographs) | authors' copyright / WHO terms ○ | not located online in this session | — | n/a | out of scope for "instruction text" |

Conclusions for this section:

- **Official Russian text cannot be obtained at scale without either #2 or #11.** #3 would also do it if the portal came back; it is a weekly check (30 s) worth keeping.
- #5 and #6 are legitimate free additions (≈ 600 registrations) but they close few *groups* (47 of 1 412 for #6), so for the ЖНВЛП and group-level goal the
  fallback of §1.4 is worth far more than any of them.
- Show the provenance class everywhere: ГРЛС document, other-country EAEU register, holder site. A document found by name only (`label-unique`) is not a
  registration-number match; M1's owner decision on `label-unique` is still open.

## 3. Foreign sources with translation

### 3.1 Why foreign sources cannot be "Russian instructions"

- EMA product information exists in all official EU languages plus Icelandic and Norwegian; **Russian is not included** ✔ (Keytruda EPAR page).
  FDA/DailyMed, MHRA, Health Canada (English/French) and TGA are English. A Russian text would always be a translation made by us.
- A foreign label describes a foreign registration (indications, doses, strengths, excipients, contraindications differ from the Russian registration).
  It can inform a doctor about a substance but is not the approved instruction for any Russian product.
- Everything below therefore targets only the **703 МНН cards without any Russian text**, not the product-level gap (which is better served by §1.4 and §2).

### 3.2 Candidates

| Source | Content | Licence / terms (what was checked) | Access | Size / count | Language |
|---|---|---|---|---|---|
| **openFDA drug label** | JSON of FDA SPL labels split into sections (`indications_and_usage`, `dosage_and_administration`, …) | «public domain … Creative Commons CC0 1.0» for openFDA data; «Some data … may not be public domain, such as copies of copyrightable works made available to the FDA by private entities» ✔ (`open.fda.gov/terms`) | `api.fda.gov` (no key needed for light use), 14 download partitions | 262 888 label records, 1 773 MB zipped, exported 2026-10-02 ✔ | English |
| **DailyMed** (NLM) | official SPL XML/PDF of current labels, daily/weekly/monthly updates | NLM: US government works are not copyrighted, but «you may encounter … content … protected by U.S. and international copyright laws … your responsibility to determine» ✔; no explicit licence for the label text itself | bulk ZIPs: human Rx ≈ 54 932 files (5 × 3.00 GB + 1.72 GB), OTC 83 322 files ✔ | ≈ 17 GB for Rx | English |
| **EMA EPAR / SmPC / PIL** | product information for centrally authorised products | EMA legal notice: reproduction allowed commercially and non-commercially if EMA is acknowledged in each copy; third-party content excluded; translations and adaptations not addressed ✔ | per-product pages (PDF), open data JSON of the medicine list ○ | ≈ 1 400 active products ○ | 24 EU languages + IS/NO, no Russian ✔ |
| **MHRA** (`products.mhra.gov.uk`) | SmPC, PIL, PAR | no licence or copyright text on the page I read ✔ (so unknown; UK Open Government Licence is usual for gov content ○) | search UI, no bulk/API seen ✔ | tens of thousands ○ | English |
| Health Canada DPD / product monographs, TGA PI | monographs, PI/CMI | not checked | — | — | EN/FR, EN |
| EAEU registers of Belarus/Kazakhstan | already Russian (see §2 #5) | see §2 | — | — | Russian |

Preferred: openFDA (explicit CC0 statement for its data, section-level JSON, 1.8 GB total, can be queried per substance) with DailyMed as the source of the
original SPL document for provenance; EMA for products absent in the US (attribution required in every copy). The third-party-copyright caveat means
the registry-of-origin text still belongs to the manufacturer; for a personal single-user app this matches the project's existing risk posture, but it is a
rights decision for the owner, not a clearance (same wording as for Krasota i Meditsina / RLS in `REFERENCE_SOURCE_POLICY.md`).

### 3.3 Match rate to Russian МНН (measured against openFDA)

Method ✔: ЕСКЛП МНН cards → ATC level-5 code → English substance name from the НСИ ATC dictionary v3.8 (`data/raw/nsi/atc/v3.8`, `ATC_NAME_ENG`) →
one openFDA query on `openfda.generic_name` / `substance_name` (127 queries, 1 s apart, 0 errors).

- Mechanism: 1 350 of 3 324 МНН cards (40.6 %) are single-component with a level-5 ATC code and an English name, so the join is automatic for them. Combinations
  (403 of the 703 gap cards), cards without ATC, vaccines, sera and herbal/homeopathic cards need manual matching or have no foreign counterpart.
- Gap cards: of 703 МНН without any Russian text, **127** are in the automatic class; strict name matching found an openFDA label for **56 (44 %)**, of them 14 of 42 ЖНВЛП.
  Hits: asfotase alfa, velmanase alfa, vonoprazan, sapropterin, telotristat, tenofovir alafenamide, maraviroc, pretomanid, telavancin, ceftobiprole, avacopan, amivantamab,
  apremilast, basiliximab, glofitamab, teclistamab, tremelimumab, panitumumab, ceritinib, elranatamab, epcoritamab, brolucizumab, pasireotide, remifentanil, riluzole, … Misses include
  genuine absences (gemigliptin, luseogliflozin, enavogliflozin, fimasartan, pazufloxacin, sultamicillin, ceftizoxime, raltitrexed, mecobalamin) and name-normalisation misses on real FDA
  products (avelumab, gilteritinib, selpercatinib, capivasertib, isavuconazole, palovarotene, risedronate, technetium kits, gadoxetate), i.e. the true rate is higher than 44 %.
- Estimate for all 703: **about 56 (strict) to 80 (with normalisation and a few vaccines/immunoglobulins) МНН, 8–11 %**; ЖНВЛП about 14–20 of 68. Positions covered: far below 1 %
  (the 703 cards hold 1.3 % of positions in total). A separate random check of 45 single-component gap cards (hand-translated) gave 8 clear FDA matches (18 %) and 4–5
  plausible partial matches (vaccine/toxoid families; two of those openFDA queries returned nothing), consistent with the above once the vaccine/herbal majority is included.

### 3.4 How to translate consistently with AGENTS.md

AGENTS forbids «generated model text replacing original source material». A translation is allowed only as an **additional, labelled derivative that never takes the
place of the original and never takes the place of a Russian official text**. Proposed design (to be fixed in an ADR):

1. **Original first.** Store the foreign document byte-exact (SPL XML or openFDA JSON record with `set_id`, `version`, `effective_time`, fetch date, SHA-256, licence/terms
   snapshot) as its own source class, e.g. `foreign-label` with `authorityTier: foreign-regulator-label`. Original English sections are shown and searchable.
2. **Translation as a separate artifact.** Per section: `translationOf: <source chunk id>`, engine name and version, run date, prompt/config hash, source-chunk SHA-256.
   Stored in its own module (e.g. `minimed.medications.foreign-labels.ru`), never merged into the «Инструкция» tab or the official-instruction index; no `officialSourceUrl` of a
   Russian registration is attached.
3. **Visible, unavoidable label** at the top of every translated section: «Машинный перевод зарубежной (США/ЕС) этикетки. Не инструкция, зарегистрированная в РФ;
   показания, дозы и противопоказания могут отличаться. Оригинал: …» with a one-tap switch to the English original.
4. **Terminology and invariants**: glossary from ЕСКЛП/НСИ/ГРЛС (МНН, form names, section headings from Russian ОХЛП structure); automatic checks that numbers, units, ranges, percentages
   and Latin INN tokens in the source section equal those in the translation; any section failing a check stays English-only. No inferred or "completed" content; no summarisation.
5. **Scope guard**: translate only for МНН cards with no Russian official text and no sibling text (§1.4), and not for vaccines, biologic combinations or products whose foreign
   registration is for a different formulation. `trustedDoseData: false`; the dose paragraph is shown but is not read by calculators or the clinical parser.
6. **Review state**: `requiresReview: true`; no clinical review claim. The same flags as the ГРЛС modules (`requiresReview`, source block, edition).

### 3.5 Translation engines, size and cost

Sizes ✔ from two real openFDA labels (telotristat 56 k characters, levamlodipine 55 k characters ≈ 9 k words ≈ 15–18 k English tokens each; a Russian rendering
≈ 30 k output tokens). For 60–100 labels: **≈ 3 M Russian output tokens, ≈ 0.6–1 GB of text/JSON including originals ○** (tiny next to the 1.8 GB openFDA download, which is not needed:
per-substance API queries suffice).

| Engine | Licence (checked on HF today ✔) | Local on this Mac (M2 Max, 64 GB ✔) | Estimated time for ≈ 3 M output tokens ○ | Quality ○ |
|---|---|---|---|---|
| `Helsinki-NLP/opus-mt-en-ru` (Marian, ~77 M) | Apache-2.0 | yes, CPU, very fast | about 1–2 h | weak on pharmacological terminology and long sentences; needs glossary post-edit |
| `google/madlad400-3b-mt` / `7b-mt` | Apache-2.0 | yes (CTranslate2 or llama.cpp-class runtime) | 3B ≈ 8–14 h; 7B ≈ 1–2 days | decent general quality, no medical tuning |
| `google/translategemma-4b-it` / `12b-it` (2026-01) | Gemma terms (read the use policy before adopting) | yes (MLX/llama.cpp) | 4B ≈ 1 day; 12B ≈ 2–3 days | best candidate for fluency; must be evaluated on pharmacology text |
| `facebook/nllb-200-*` | **CC-BY-NC-4.0** | possible | — | do not use if outputs ever ship publicly |
| Qwen3-8B (Apache-2.0) / hosted LLM batch API | Apache-2.0 / vendor terms | 8B ≈ 2 days locally | — | good with a glossary prompt; a hosted model sends third-party public text off-device (a separate owner decision: the `medbase ai-export` rights gate concerns licensed text, foreign public labels are different but still the owner's call) |

All timings are order-of-magnitude estimates; **nothing was downloaded or run**. The pilot below measures them.

Pilot protocol (≈ 1 day, no repository risk): pick 20 substances that have **both** a Russian official text and an FDA label; translate their FDA label sections; compare automatically against the
Russian ОХЛП of the same substance (terminology coverage, number/unit equality, section heading mapping) and have one clinician rate a sample of 40 paragraphs. The result decides whether
to translate at all, and with which engine, before touching the 56–80 gap substances.

### 3.6 Decisions and ADR this needs

- ADR «Foreign labels and machine translation» (new source class, authority tier, storage in its own module, labelling and scope guards of §3.4; AGENTS' ban on generated text
  replacing source material is respected by construction).
- Owner decisions: (a) is any machine-translated clinical text acceptable in the app at all, even labelled; (b) local-only or allowed to use a hosted model; (c) openFDA/DailyMed
  reuse with the third-party-copyright caveat (and EMA with in-copy attribution); (d) which scope (only gap МНН, only ЖНВЛП, innovative substances only).
- Do not start before the §1.4 fallback is decided: it covers the same user need for 94 % of positions with an official Russian text, which a translation never will be.

## 4. Ranked recommendation

Gains are positions with an official Russian text for their substance/form/strength unless stated; effort in working days of one agent.

| Rank | Action | Expected gain | Effort | Needs |
|---|---|---|---|---|
| **1** | **Same-substance fallback in the drug screen**: for a product without its own document, show the text of another registration of the same МНН × form × strength (СМНН node; prefer originator, then ОХЛП > instruction > leaflet), labelled «Инструкция другого препарата того же состава: <ТН, держатель, РУ>; показания и дозы вашего препарата могут отличаться»; index = existing `registrationNumbers` of the modules plus the ЕСКЛП node membership; second level (same form class) only as a clearly weaker plaque | positions with a text 43.7 % → **94.3 %** (ЖНВЛП 41.6 % → 96.3 %); trade-name × form class units 53.5 % → 87.8 % | 3–5 (index at module build time, drug-screen UI, tests, e2e) | owner decision D1, short ADR on «substitution is labelled, never silent» |
| **2** | **Ship what is already on disk and keep the loop running**: M1 pilot (245 registrations, 94 ЖНВЛП) as a source class `manufacturer-site`; refresh the instruction modules every 2–4 weeks with the collector's new documents; repair the 3 left-out documents; re-OCR the 114 low-quality scans; mark ОХЛП/leaflet kind visibly | +240 registrations (+1.9 % of covered), 47 uncovered groups (17 ЖНВЛП); collector ≈ +13 groups/day; quality on 114 documents | 3–4 | owner decision D2 (`label-unique`) |
| **3** | **Ask officially**: НЦЭСМП (ОХЛП/ЛВ of the 6 306 uncovered EAEU registrations, list ready from plan 02.10.2026), Минздрав/ГРЛС access request, and price/licence questions to ЛС ГЭОТАР and РЛС Aurora (offline storage for personal use, verbatim «original instructions», cost) | the only scalable path: up to +6 306 EAEU registrations and all 1 412 uncovered groups; a paid API would also give daily updates | 0.5 to draft the letters; reply time weeks | owner sends (I cannot send on your behalf), D3 |
| 4 | Register adapters: `rceth.by` + `register.ndda.kz` (361 registrations, 184 ЖНВЛП), `ns03.ru`/`dalkhimpharm.ru`/`avexima.ru` (≈ 100–150); check the EAEU OData archive for a dossier key (50 MB, needs your OK) | ≈ +500–650 registrations (≈ 4–5 % of the gap), few new groups | 6–10 | D4 (no terms found ≠ permission; same class of decision as ГРЛС robots) |
| 5 | Foreign labels + labelled machine translation, only for gap МНН, behind the pilot of §3.5 | 56–80 МНН (8–11 % of the 703; ЖНВЛП 14–20), < 1 % of positions; mostly innovative drugs | 10–15 after the ADR (pipeline, module, UI label, pilot) | ADR, D5 |
| — | Do not do: medi.ru, pharmacies, Wayback, HF/РЛС datasets, changing host/cookies to pass the CAPTCHA, ЛС ГЭОТАР/Видаль scraping | — | — | — |

Order logic: 1 is the only item that changes what the doctor sees for most products this week and costs no external permission; 2 is free and already paid for;
3 is a letter that can run in parallel with everything; 4 and 5 are marginal compared with 1 and 3.

### Owner decisions required

- **D1** Allow a labelled same-substance (СМНН-node) fallback text in the drug screen? Variants: node only (94.3 %), node + form class (97.3 %), none. Who is shown first when several
  documents exist (originator, ОХЛП)?
- **D2** Accept M1 `label-unique` matches (190 of the 245; name + form + strength + holder, no registration number printed) as a separate, labelled source class, and publish
  them in the next refresh?
- **D3** Send (or authorise me to draft) the НЦЭСМП/Минздрав requests and the price inquiries to ЛС ГЭОТАР and РЛС Aurora; budget ceiling for a contract if one is offered.
- **D4** Permit adapters for Belarus/Kazakhstan registers and the three extra holder sites, and the 50 MB EAEU OData archive download, given that no terms were found.
- **D5** Foreign labels with machine translation: yes/no in principle, local-only vs hosted model, scope, and approval of an ADR to be written. Allmed's own redistribution
  rights remain unresolved (`DRUG_KNOWLEDGE_PIPELINE.md`); that decision is separate.

### Decisions (owner, 2026-10-05)

- **D1 — decided (delegated to the coordinator): yes, a labelled same-substance fallback in the drug screen.**
  Level 1: another registration with the same МНН, dosage form and strength → the label «Инструкция другого
  производителя: то же вещество, форма и дозировка», naming the source product, holder and registration. Level 2, only when level 1
  has nothing: same МНН and same form class, a different strength → the same label plus the warning «Дозировка отличается:
  проверьте дозы по своему препарату». It is never presented as the product's own instruction, texts are never merged, exact
  provenance is kept, and nothing is shown across different МНН or form classes. Donor order (the open question above): fewest
  differences, ГРЛС before holder-site documents, professional text (ОХЛП, instruction) before the leaflet, foreign holder
  (originator proxy), earliest registration, registration number. Implemented as MED3, [ADR-0023](../adr/0023-same-substance-instruction-fallback.md);
  two additions the owner's wording did not cover, recorded in the ADR: an unstated registry strength («НЕ УКАЗАНО») never counts as
  the same strength (level 2 with the warning «Дозировка в реестре не указана…»), and a different wording of the form at level 2 gets
  its own warning.
- **D2 — yes:** the already collected M1 manufacturer-site registrations ship as a separately labelled source class
  (`manufacturer-site`) with the match method visible in provenance and in the drug screen. Only matches with a registration
  match (number in the text, number on the page, `label-unique`) are attached; ambiguous ones are not.
  Level 2 later reads «Инструкция другого производителя: то же вещество, есть отличия» (coordinator correction: the level-1
  label must not claim the same strength above a strength warning).
- **D2a — keep Microgen (owner, 2026-10-05):** 103 of the 240 shipped registrations come from microgen.ru, whose `robots.txt`
  disallows `/` for named AI crawlers (`anthropic-ai`, `GPTBot`, `CCBot`, `ChatGPT-User` …) while the `*` rules allow the
  product pages; the pages were collected under the `*` rules. The owner keeps them under the same personal-use decision as the
  slow ГРЛС collection; no further collection from that site was requested.
- **D3 — no** official requests for now. **D4 — no** Belarus/Kazakhstan registers for now (the owner expects Russian sources to
  carry them, since the products are sold here). **D5 — no** machine-translated foreign labels.

## 5. Method, limits, what was not verified

- Numbers in §1 come from the current repo state at 2026-10-05: the 15 module reports (`data/build/grls-instruction-modules/reports`) joined with the text manifest
  (`plan_instructions`), the ГРЛС export 02.10.2026, the 15 ЕСКЛП release databases (`data/build/release-esklp`, 3 324 МНН documents, positions deduplicated by КЛП code) and
  `apps/app/public/content/medications.db` (Allmed). The scratch scripts (derived from `tools/ingest/scripts/measure_grls_instruction_coverage.py`) were not committed.
- Allmed matching in §1.2 ignores the dosage-form compatibility check, so "+ Allmed" is an upper bound. ЖНВЛП is the ГРЛС/ЕСКЛП flag (`essentialDrug`) at registration, node or position
  level, not a separate reading of the ЖНВЛП list. Positions are packs, so they weigh widely packaged products more; trade-name units are the closer proxy for what a doctor sees.
- Dosage-form class and group logic are the collector's (`grls_groups.py`); some unusual forms fall into a generic class, which can overstate form-class fallback coverage.
- The 14 309 vs 8 325 gap denominators were not reconciled; the 2 971 vs 2 965 group counts were not reconciled.
- Not verified today: terms of use of `rceth.by` and `register.ndda.kz` beyond what is quoted; the EAEU `/spd2` and `/platformsvc` APIs (not probed beyond the config); the 50 MB OData archive;
  health of `regmed.ru` downloads; medi.ru freshness (not re-sampled); MHRA, Health Canada and TGA licences; EMA product counts; translation engine speeds and quality (nothing was run);
  openFDA hit counts use strict name matching (underestimate), no DailyMed or EMA lookup was done for the gap list; the 45-card hand check used FDA names I supplied.
- The Russian TLS root was not used. `esklp.egisz.rosminzdrav.ru` and НСИ were not contacted.
- Network use in this session: ≈ 150 `api.fda.gov` queries (1 s apart), 11 Hugging Face model-metadata calls, the page fetches and HEAD requests listed in §2 and §3.
  The one temporary file (a 757 KB web-app JavaScript bundle) was deleted.
- Not changed: packs, catalogs, app code, `docs/CURRENT_STATE.md` (this is a plan, not an implemented or measured change of behaviour); only this document and the MED2 row of `STATE.md`.
