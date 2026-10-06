# Drug interactions: what the app shows, and whether a severity layer is lawful and useful (INT1, 2026-10-06)

Status: research and measurements. The tool described in section 1 is implemented (INT1). The owner decided
on 2026-10-06 (section 5) and the severity layer of section 3 is implemented as an optional module (INT2, section 6).

## 0. Summary

- The shipped tool «Взаимодействие препаратов» is a search over the text of the official Russian
  instructions already in the drug modules. It quotes the sentences of each instruction that name the other
  drug (by МНН) or its class (by the official НСИ «АТХ» group name) and links to the place in the
  instruction. It does not rate, rank or translate anything.
- Coverage is limited by what instructions say, not by the tool: **12.2 % of the pairs among the
  200 most common substances have at least one sentence in either instruction** (section 2).
- No free structured pair-interaction source with Russian text exists (gap audit item 5 stays true).
  Open sources with severity exist in English only. A **severity-label-only layer** is technically cheap
  (ATC-code join, no translation) but only **DDInter 2.0 is plausible, and it is CC BY-NC-SA 4.0**: fine for
  a personal, non-commercial, non-distributed build, a problem if the app or the data pack is ever
  published beyond personal use. Recommendation: do not build it now; decision list in section 4.

## 1. What shipped

| Part | Where |
|---|---|
| Build script (deterministic, local; reads the published instruction modules after checking their SHA-256 against the catalog) | `scripts/build-drug-interactions.ts` |
| Index asset (offsets and a checksum per section, **no instruction text**), lazy chunk | `apps/app/src/features/drug-interactions/data/interaction-index.json` (2.0 MB, 672 kB gzip) |
| Report with coverage numbers | `data/build/drug-interactions/report.json` (local) |
| Sentence spans, matcher, class phrases, index, view model | `apps/app/src/features/drug-interactions/` |
| Tool route | `#/notes/drug-interactions?d=<typed name>&c=<card id>` |
| Search entry | `parseInteractionQuery` + `InteractionSuggestionCard` in `SearchWorkspace` («Все источники», «Препараты») |

How it reads the sources:

1. **Sections.** «Взаимодействие с другими лекарственными средствами» (section type `interactions`), and
   «Особые указания», «Противопоказания», «С осторожностью» (flagged by section, shown after the interaction
   section). A patient leaflet has no typed interaction section: its general sections are searched only for
   sentences that also say something about taking drugs together (flag «листок-вкладыш»).
2. **Sentences.** A canonical string per section (its chunks joined by a newline); a sentence ends at «.»
   «!» «?» followed by a capital letter; a heading line without a full stop stays with the sentence after
   it. The index stores `[start, end)` offsets plus a 4-hex checksum of the section text. The text shown
   is read from the installed instruction; if the section text changed (another edition) the sentence is
   reported as changed, never guessed.
3. **Substances.** Names of the 3 324 ЕСКЛП МНН cards (their components for combinations), whole-word and
   inflection-aware (same light stemmer as the search, applied to a fixed point plus plural adjective
   endings). A short name is never found inside a longer word («боли» ≠ «Болиголов»). The instruction's own
   substance (and any word of its name) is never a hit.
4. **Classes.** Derived from the НСИ «АТХ» names v3.8 (levels 2–4, section V excluded): a name is cut at its
   qualifiers, container words (found by frequency, not listed) are dropped, a class named by an adjective
   counts only in the plural («слабительные», not «слабительное действие»). Hand-made parts, all in code with
   their basis: 35 class aliases (`CLASS_ALIASES`: НПВП, антикоагулянты, статины, … each pointing at official
   ATC codes and refused by the build if the code is not in НСИ), 6 substance names and aliases for ethanol/alcohol
   (`SUBSTANCE_ALIASES`), 13 substance names that are also anatomy or laboratory words
   (`NON_DRUG_SUBSTANCE_KEYS`), 4 elements searched only in the interaction section
   (`ANALYTE_SUBSTANCE_KEYS`) and a list of name pieces that are not classes (`NOT_A_CLASS_PREFIXES`).
5. **Which instruction is read.** Per drug (МНН card) the best indexed instruction: one with its own
   interaction section, ГРЛС before a holder's site, ОХЛП/instruction before a leaflet. The screen says it
   is «инструкция препарата X, одна из инструкций по этому веществу» (ADR-0023 labelling). At most three
   instructions per card are indexed (generics repeat each other's text); an instruction of the exact product
   the doctor holds is not selectable (a drug is picked as a substance).

Known gaps (kept visible, not patched): trade names inside the instruction text are not searched;
«производные X» and compound classes are found only through the official group name; lithium, «Mg2+»-style
notations and OCR-damaged words are missed; the index knows instructions only from the shipped modules (the
ГРЛС collector adds ~14 registrations a day, a rebuild picks them up); a doc with several registrations of
different cards uses the union of their substances as «own».

## 2. Measurements (index built 2026-10-06 from the 16 released instruction modules)

| What | Number |
|---|---|
| Instruction documents read / indexed (≤ 3 per card) | 9 216 / 4 495 |
| Documents with a typed interaction section | 4 296 (46.6 %) |
| ЕСКЛП МНН cards with an instruction in the modules | 2 398 of 3 324 (72.1 %) |
| … with an indexed «Взаимодействие» section | 1 484 (44.6 % of all cards, 61.9 % of cards with an instruction) |
| … with at least one indexed sentence | 1 761 (53.0 %) |
| Sentences in the index | 28 851 (interactions 18 367; special 6 216; contraindications 1 568; caution 1 242; leaflet 1 458) |
| 200 most common substances (single-substance cards with most registrations; includes kislorod, natriya khlorid, etanol) with an instruction / with an interaction section | 200 / 198 |
| **Pairs among them with ≥ 1 sentence in either instruction** | **2 430 of 19 900 (12.2 %)**; 2 126 (10.7 %) from the interaction section itself |

The share is a property of the instruction texts (they name few partners explicitly and often by an
unmatched class). «Not found» is never «safe».

**Extraction precision, hand-checked** (50 sentences per sample, stratified 27 interaction section /
12 special / 4 contraindications / 3 caution / 4 leaflet; the sample was read in full and each sentence
judged on two questions: M — is every target the build assigned really a drug or class named there; R — is
the sentence about taking that drug together with another, which is what a pair view needs). Four rounds,
each round after fixes made from the previous one; only the last is a fresh draw on the final build:

| Round | M, all targets right | M, at least one right | R, relevant to a pair |
|---|---|---|---|
| 1 (first build) | 39/50 (78 %) | 43/50 (86 %) | 39/50 (78 %) |
| 3 | 47/50 (94 %) | 48/50 (96 %) | 39/50 (78 %) |
| **4 (final build)** | **48/50 (96 %)** | **50/50 (100 %)** | **43/50 (86 %)** |

Round 4 by section: interaction section 27/27 relevant; «Особые указания» 6/12; contraindications 4/4;
caution 2/3; leaflet 4/4. So the interaction-section sentences are reliable; **«Особые указания» sentences
are half noise** (class effects of the drug's own group, composition notes, adverse-effect statements) and
are displayed after the interaction section and labelled by section. The sample is small (95 % interval of
43/50: 74–93 %) and tuned in earlier rounds; it is an honest estimate, not a guarantee. Known remaining
errors in round 4: the instruction's own name read as a drug (1), a branch of the classification that shares
a class word («Миорелаксанты» also in anal fissure drugs) (1), hypersensitivity and composition sentences.

**Search regression check.** The search entry adds a card and changes no query, ranking or core code. Measured
before and after the change on the same tree (`benchmark:real:release`, `benchmark:doctor-lookup`,
`benchmark:owner-queries`): every recall / MRR / hit figure is identical (release lookup R@1 0.803, R@5 0.934;
doctor-lookup R@5 1.0, MRR 0.875; owner queries hit@1 0.278 / 0.323, hit@5 0.574 / 0.774); only latency noise
differs.

## 3. Open structured sources with severity

Checked 2026-10-06 (what could be read; the NCBI/PMC page is behind a CAPTCHA and was not opened).

| Source | Content | Licence / redistribution | Coverage and fit |
|---|---|---|---|
| **DDInter 2.0** (Nucleic Acids Res. 2025, ddinter2.scbdd.com) | 2 310 drugs, 302 516 DDI records with a risk level (Major / Moderate / Minor / Unknown in the DDInter papers), mechanism and management text in English | **CC BY-NC-SA 4.0** (stated on the site's terms page): no commercial use; share-alike | Broadest open set. English only; drug records carry ATC codes in the DDInter papers (to verify on a download) — then the join to ЕСКЛП cards, which carry ATC codes, needs **no translation** |
| **ONC high-priority DDI list** (Phansalkar et al., JAMIA 2012) | 15 consensus high-severity pairs/classes for EHR alerts | A journal article (publisher's copyright); the list itself is facts, short | Tiny; useful only as a cross-check of the ~15 worst combinations |
| **KEGG DRUG** (DDI tables) | Japanese-curated interactions | Academic web use free; service providers and commercial use need a paid licence; FTP is a paid subscription (kegg.jp/kegg/legal.html) | Redistribution in an app is not allowed without a licence: rejected |
| DrugBank interactions | Large, text in English | CC BY-NC for academic download, commercial licence otherwise (from general knowledge, not re-verified) | Same NC issue as DDInter, and it needs registration (no logins here) |
| FDA label text (DailyMed/openFDA `drug_interactions`) | US prescribing information, public domain | Free to reuse | English labels, no severity; machine translation declined (D5) |
| FDA table of CYP/transporter substrates, inhibitors, inducers | Mechanism class lists, public domain | Free | Mechanism, not severity; English; could feed «ингибитор CYP3A4» wording only through a translation we are not allowed to make |
| Vidal, РЛС, ЛС ГЭОТАР, Stockley, Lexicomp | The Russian pair data a doctor would want | Proprietary (the Vidal checker is linked out only) | Not usable |

Conclusions:

- **Matching to Russian МНН** does not need INN translation if a source gives ATC codes: join on the ATC
  code (level 5 for single substances, ЕСКЛП `atcCodes`), then fall back to Latin INN ↔ Cyrillic МНН with
  the registered transliteration rules already in `name-variants.ts` only for verification. Combination
  cards join through their components.
- **A severity layer would be labels only** («тяжёлое / умеренное / лёгкое по DDInter» next to a pair that
  already has Russian quoted sentences), never English text in the place of Russian, never a replacement of
  the instruction sentences, and never shown for a pair with no row. It would also have to say «оценка
  источника DDInter, на английских данных; не из инструкции» and that DDInter's levels are not the
  instructions' wording.
- **Lawful?** For this personal project, using DDInter data locally under CC BY-NC-SA is permitted; the
  `NC` and `SA` conditions bind any redistribution: a public release of a pack containing it would have to
  carry CC BY-NC-SA 4.0 and could not be used commercially. The repository is public only temporarily
  (owner note), but a pack on the GitHub mirror is a distribution.
- **Useful?** It would add severity to ~2 400 of 19 900 top-200 pairs we already show, and surface pairs the
  instructions never name (the other ~90 %). The second is the real value and also the real risk: a
  severity for a pair the doctor's own instructions do not name is a clinical claim from an English
  database of unknown currency, outside the «source text only» invariant of the product.

## 4. Recommendation and decisions needed

Recommendation: **do not add DDInter now.** If a severity label is wanted, add it later as a separate,
labelled, optional local module (not in the core), restricted to pairs that already have instruction
sentences, after the owner accepts the licence consequence. Decisions:

1. **Severity layer: yes / no.** If yes: (a) local-only personal module that is never published, or
   (b) a published optional module under CC BY-NC-SA 4.0 with attribution (the app is then non-commercial
   by construction).
2. **Scope if yes:** labels only on pairs that have instruction sentences (recommended), or also on pairs
   the instructions do not connect (a different product claim).
3. **Verification before building:** download one DDInter file by hand (no automation; the site was only
   read), confirm that it carries ATC codes and the exact severity vocabulary, and measure the ATC join
   against the 3 324 cards.
4. **«Особые указания» sentences:** keep them (flagged, shown after the interaction section) or hide them
   behind a «ещё из других разделов» fold (round 4: 6 of 12 were not about taking drugs together).
5. **Leaflets:** whether to index only the best instruction per card as now, or also keep a second text of a
   different kind (leaflet) for substances whose best instruction has no interaction section.

Not done: official requests (D3), machine translation (D5), any scraping of Vidal or other proprietary
checkers (only the «Проверить на vidal.ru» link-out, which sends nothing), Android/WebView testing.

## 5. Owner decisions (2026-10-06, answers to section 4)

1. **Severity layer: yes**, as an optional, separately downloadable module from DDInter 2.0 (CC BY-NC-SA 4.0:
   attribution and licence are shown in the module and in the tool's source block; the app is personal and
   non-commercial). **Labels only**: «Серьёзное / Умеренное / Слабое / Степень не определена по DDInter»
   (DDInter's Major / Moderate / Minor / Unknown). No English description or mechanism text is stored or shown;
   the owner declined machine translation.
2. **A label only on a pair that already has at least one instruction sentence** (never a label without a
   quotable source), named «по DDInter», with the note that it comes from an international database and not
   from the instruction. Implemented as: the pair needs a sentence that is quotable now (the instruction is
   installed and the sentence resolves), so a pair whose instruction is not downloaded yet shows no label.
3. **Sentences from «Особые указания» and the other non-interaction sections are folded** behind «ещё из других
   разделов (N)», collapsed by default; interaction-section sentences stay visible. Folded sections:
   «Особые указания», «Противопоказания», «С осторожностью». A leaflet's general-text sentences (the leaflet has
   no typed interaction section; they are filtered for sentences about taking drugs together, 4/4 relevant in the
   round-4 sample) stay visible: this is the one place where the rule was read as «interaction content», a
   judgement call recorded here.
4. **INT1's single best-instruction-per-substance rule is kept** for leaflet-only substances (no second text).

## 6. INT2: the severity module

### 6.1 Licence and download check (2026-10-06)

- `https://ddinter2.scbdd.com/terms/`, «Data licensing»: «made available under a Creative Commons
  Attribution-NonCommercial-ShareAlike 4.0 International license»; the site may be used «for your own personal,
  non-commercial, informational or scholarly use». The terms page also disclaims accuracy and says that the absence of
  an interaction does not mean there is none.
- **Bulk download**: `https://ddinter2.scbdd.com/download/` offers plain static links, no login, no CAPTCHA. It lists
  eight files (ATC letters A, B, D, H, L, P, R, V); the other six letters (C, G, J, M, N, S) are served from the same
  path (`/static/media/download/ddinter_downloads_code_<letter>.csv`) with the same format and were downloaded too, as the
  eight listed files alone lack the cardiovascular, nervous-system, anti-infective and musculoskeletal drugs. A pair
  appears in the file of each of its two ATC letters; the files agree on every pair (0 conflicts).
- **Content of the files**: five columns only: `DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level`. **No ATC codes, no
  descriptions, no mechanism or management text.** Levels: Major / Moderate / Minor / Unknown. 507 655 rows, 1 971 drugs,
  234 981 distinct pairs (Moderate 143 748, Unknown 42 415, Major 39 082, Minor 9 736).
- The per-drug pages carry ATC codes but would need ~2 300 page fetches of ~90 kB (~200 MB): not done (that is
  scraping, not the bulk download). The join therefore uses English names (below).
- Raw files and a checksum manifest: `data/raw/ddinter/` (33 MB, below the data-ledger threshold; local, git-ignored like
  all `data/raw`), `MANIFEST.json` lists the URL, SHA-256 and size of the 14 files and the retrieval date.

### 6.2 Join key and match rate

Join chain (all of it in `tools/ingest/src/localmed_ingest/ddinter_severity.py`, deterministic, 13 pytest cases):

1. **DDInter English name → ATC level-5 code** through the English names of the НСИ «АТХ» dictionary
   (`ATC_NAME_ENG`, v3.8, already in `data/raw/nsi/atc`): exact normalised name (1 422 drugs), then salt words
   dropped on both sides (29), then 21 listed USAN → INN spellings such as acetaminophen → paracetamol, each checked
   against НСИ at build time (15 used). Names with a qualifier in parentheses («Dexamethasone (topical)», 231) are route or
   formulation variants and are not joined. No name matched: 274.
2. **ATC code → ЕСКЛП МНН card of one substance** (no combinations; 2 020 of 3 324 cards). A card lists the ATC codes of every
   registration it groups and that list carries neighbours' codes (a caffeine card with a dexamethasone code produced
   false joins in a first attempt), so a code counts only when the НСИ Russian name equals the card's МНН, or, failing that,
   when the card's own level-5 code names a substance with the same first word.
3. A DDInter pair becomes a card pair when both ends reach a card; several DDInter pairs for one card pair keep the
   most severe level (0 such conflicts remain with the strict card rule).

Measured on the 2026-10-06 ЕСКЛП release and НСИ 3.8:

| What | Number |
|---|---|
| DDInter drugs joined to ≥ 1 card | 815 of 1 971 (41.3 %); most of the rest are not marketed in the RF (prednisone, oxycodone, nortriptyline, …) |
| Single-substance cards with ≥ 1 label | 811 of 2 020 (40.2 %) |
| DDInter pairs joined to card pairs | 78 675 of 234 981 (33.5 %) |
| **Labelled card pairs in the module** | **79 884** (Moderate 36 984, Unknown 28 861, Major 11 713, Minor 2 326) |
| Labelled pairs that also have ≥ 1 instruction sentence (the only ones the tool can show) | **19 213** (Moderate 10 640, Major 3 912, Unknown 3 988, Minor 673) |
| 200 most common substances: with a label | 117 of 200 |
| Their pairs that have an instruction sentence (2 430) and a label | 1 071 (44 %) |

Known gaps (kept visible): names the НСИ dictionary does not have (НСИ v3.8 lacks rabeprazole A02BC04 and posaconazole)
or spells differently from DDInter beyond the 21 listed aliases (the report lists the unmatched drugs by pair count);
combination products are not joined; a substance with several cards (an ester, a prodrug) is labelled only through the
card whose МНН matches.

### 6.3 What shipped

- Preparer `ddinter_severity.py`, CLI `tools/ingest/scripts/build_ddinter_severity_module.py manifest|report|build`.
- Module `minimed.reference.ddinter-severity.ru` (version `ddinter-2.0.2026.10.06`, `kind: reference`, collection
  `ddinter-severity`, `releaseState: preview`, `minAppVersion` 0.6.52, `capabilities.search: false`): 799 documents (one per
  card that is the smaller slug of a labelled pair, plus a manifest document with source, licence and date), 6.5 MB
  installed, **243 KB download**; documents are flagged out of the ordinary search index. Built reproducibly
  (identical SHA-256 on a second build).
- App: `features/drug-interactions/interaction-severity*.ts`, `SeverityDownloadOffer.tsx`, label and fold in the workspace,
  label and source line in the print and share text, `module-search-index.ts` (the installer accepts an empty search index
  for a module that declares no search).

