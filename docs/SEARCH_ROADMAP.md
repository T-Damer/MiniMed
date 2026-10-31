# Search roadmap

The ordered plan for search quality. Owner rule (2026-10-05): every new search proposal is compared
with this list first — which item it matches or replaces, expected gain, cost, how it is measured —
and the list is updated when the proposal is better. How search works today:
[`SEARCH_ARCHITECTURE.md`](SEARCH_ARCHITECTURE.md).

## Principles

- Measure before and after on a fixed query set; keep the release gates (`benchmark:real:release`,
  `benchmark:all`) within tolerance.
- Results are source documents. No generated text in the search path, no hand-written
  symptom→drug or symptom→disease dictionaries in the product (benchmarks may use hand labels).
- Everything works offline; the optional e5 model only adds candidates, lexical search stays the
  complete fallback.
- An exact name must never be outranked by a paraphrase in name-lookup scopes.

## Where search stands (2026-10-05)

| Query kind | Set | Lexical | With e5 | Status |
|---|---|---:|---:|---|
| Exact names, codes (app path) | `benchmark:real:release` lookup; `benchmark:doctor-lookup` | R@1 0.803, R@5 0.934; doctor R@5 0.7 → 0.9 → 1.0 (S3) | — (lexical by design) | S2, S3 done |
| Name on the wrong keyboard layout or in Latin letters | `name-variant-queries.json`, 720 generated | hit@1 0.063, hit@5 0.094 → 0.947 / 0.956 | — | S3 item 3 shipped |
| Name with one slip in the first letters (neighbour key, sound-alike, other) | `typo-queries.json`, 698 generated | hit@1 0.239, hit@5 0.328 → 0.845 / 0.984 | — | item 19 shipped |
| Name with two slips or a real misspelling anywhere (dropped/doubled letter, sound-alike spelling, ц/тс) | `typo-queries.json` `hard`, 1 849 generated | hit@1 0.930, hit@5 0.952 → 0.954 / 0.975 | — | item 24 shipped |
| Owner queries («Все», lookup) | `owner-queries.json`, 54 | hit@1 0.167, hit@5 0.444 (rush 0.581, thoughtful 0.261) → 0.278, 0.574 (0.774, 0.304) | with the query model, description recommendations (items 5/14): hit@5 0.463 → 0.833 (rush 0.677 → 0.903, thoughtful 0.174 → 0.739) | S3 items 3–4; items 5/14 shipped 2026-10-14 |
| Diagnosis phrase → КР | Q1 RuCCoD, test | R@5 0.20 (KR packs) | 0.70 | shipped 0.6.48 |
| Diagnosis phrase → КР through the МКБ card | Q1 RuCCoD, test, `run-icd-bridge.ts` | core only 0.417 → 0.536; core + mkb.db 0.298 → 0.476; 723 КР modules 0.274 → 0.476 | 0.643 → 0.643 (no change) | S3 item 4 shipped (lexical) |
| Complaint → КР | Q1 RuMedPrime, test | R@5 0.04 (0.10 with the pointers) , unchanged by the bridge | 0.28 (0.19 in the S3 re-run) | weakest area |
| Drug by indication («от головы») | `drug-indication-queries.json`, 45 | hit@1 0.16, hit@5 0.47 | hit@1 0.62, hit@5 0.91 | E3 shipped to main |
| Drug names | 100 ГРЛС trade names | top-1 0.99 | 1.00 | E3 gate |
| Drug by trade name («Аспирин», «Нурофен», «Но-шпа», «Валидол») | `srch1-queries.json`, 315 names derived from the shipped drug index, core.db alone | «Все»: card first 0.911, among the first three 0.943 → 0.978 / 1.000; «Препараты»: 0.959 / 1.000 → 0.978 / 1.000 | — | SRCH1 |
| Drug by INN name (own card first) | `srch1-queries.json`, 150 names | 1.000 / 1.000 (unchanged) | — | SRCH1 gate |
| Class word («макролиды», «статинами», «ингибиторы АПФ», «бета-блокаторы») | `class-queries.json`, 52 classes × 2 scopes | no class card → class card 104/104, groups right 104/104, drugs lead 104/104, expected drugs listed 232/232, 22/22 negatives clean | — | SRCH1 (owner decision 2026-10-14) |
| Class word inside a longer query («макролиды детям», «статины при беременности», «ингибиторы АПФ кашель») | `class-queries.json` `phrases`, 46 queries × 2 scopes + 12 negatives | no class card → class card 92/92, groups right 92/92, leading drugs in the class 92/92, documents below keep the plain order 92/92; 24/24 negatives clean | — | SRCH2; owner queries hit@5 0.556 → 0.574 (rush 0.742 → 0.774), hit@1 unchanged |
| Drug by ATC code («J05AX13», «J05», «о05») | `benchmark:atc`, 2 192 generated | every full code finds its card; 220/220 variants identical | — | ATC5, code groups in front of the text hits |
| Drug safety questions («X при беременности / при ГВ / ребёнку 3 лет») | `safe1-queries.json`, 44 (card, not ranking) | card correct 44/44, see item 15 | — | SAFE1, answer card above the results |
| Drug comparison queries («X или Y», «X vs Y», «сравнить X и Y», «чем отличается X от Y») | `cmp1-queries.json`, 35 (card, not ranking) | card correct 35/35, see item 16 | — | CMP1, comparison card above the results |
| Dose questions («амоксициллин ребенок 20 кг», «парацетамол 15 кг») | `dose-queries.json`, 134 (card, not ranking) | exact 134/134, wrong 0, see item 20 | — | RX1, dose card above the results |
| Description → term («воспаление слизистой желудка» → гастрит) | `reverse-term-queries.json`, 35 | hit@5 0.80 | 0.49 | lexical kept (E5 rejected) |
| Diagnosis / complaint → МКБ card | Q1, «Болезни» scope | R@5 0.28 / 0.03 | 0.39 / 0.02 | cards are the bridge's input (item 4); e5 on cards rejected |

## Ordered plan

1. **Exact-lookup misses** (S2, done 2026-10-05; remaining: narrative cases need the clinical parser). Go through every miss of the release lookup set and the drug name
   sets; fix causes such as a query word matching inside another word («головной» → «Болиголов»),
   service words («от», «таблетки») acting as the subject, and generic form words outranking it.
2. **Description → term, symptoms → disease** (E5) — measured, not shipped: see the rejected table.
   Lexical search after S2 already answers description queries (hit@5 0.80).
3. **Keyboard layout and transliteration for names** — done (S3, 2026-10-06). «ьуеащкьшт» and
   «vtnajhvby» → «метформин», «nurofen» → «нурофен», «Nurofen» → «Нурофен» through the drug's declared
   Latin name. Only when the typed form names nothing in the first five groups; the typed response is
   never changed otherwise. Numbers and design: [`SEARCH_ARCHITECTURE.md`](SEARCH_ARCHITECTURE.md).
   Left: names with several equally plausible spellings («пэгаспаргаза» ← «pegaspargaza»), soft signs in
   long adjectives («дуоденальная» ← «duodenalnaya»), and Latin typed on the Russian layout without a
   `nameLat` (only the transliteration path).
4. **Diagnosis → МКБ code → КР bridge** — done in lexical mode (S3, 2026-10-06). A card (or disease
   article) whose title covers ≥ 80 % of the query words puts the recommendations that list its code
   first in «Клинический разбор»; in «Все» they follow the card and the first recommendation found
   by words. e5 mode is unchanged (R@5 0.643 both ways: e5 already finds them). Complaints are not
   helped: a symptom list names no card, and the dev-set variant that bridged weaker cards too
   (+0.11 R@5 on complaints) broke the demo and lookup gates — see the rejected table.
5. **Semantic candidates in «Все»** — done with item 14 (CMPL1, 2026-10-14), see there.
6. **Related documents from existing links** («Похожие по теме»): disease card → its КР and drugs,
   drug → КР that name it (`clinical-medication-relations`), from source data only.
7. **Owner query set.** 20–50 queries in the owner's own wording with the expected documents, as a
   gate next to the public sets; every item above is re-measured on it.
8. **Complaints, second attempt.** Candidates to measure, in order: e5 on the clinical analysis's
   positive facts in addition to the raw text; a small on-device cross-encoder reranker over the top
   20 (size and latency first); a larger embedding model for КР only if a phone measurement allows
   (EmbeddingGemma 2 measured 2026-10-07: complaints R@5 0.255 → 0.303, not significant, query 66×
   slower — see the rejected table).
   **8a. Strong build-time model, small on-device query encoder** (KD1, owner 2026-10-09; replaces
   «a larger embedding model … if a phone measurement allows») — done 2026-10-11. Giga-Embeddings-
   instruct 480M encodes the КР and drug-indication passages at build time (projected to 384 d, int8
   as before); an e5-small-sized student trained to reproduce Giga's query vectors runs on the phone
   (130 MB download, 3.7 ms p50 on one CPU thread), since 2026-10-11 also trained on train-split
   complaint/diagnosis → КР pairs (student v4c; no Q1 record, patient or source file). Through
   MedicalCore, clinical hybrid, Q1 test: R@1 0.301 → 0.454, R@5 0.497 → 0.718, complaints R@5
   0.278 → 0.633 (v3 without pairs: 0.344 / 0.564 / 0.430). The pairs share Q1's ICD mapping; on
   the owner's own queries that name a КР (45, independent targets) R@5 0.667 → 0.822, R@1 0.400 →
   0.578 (v3 0.844 / 0.533: the supervised term is even there). Drug indications hit@1 0.600 → 0.578, hit@5
   0.911 → 0.867 (45 queries), trade names unchanged; queries whose vectors are unsure (best cosine
   below 0.25–0.35, e.g. «от молочницы», which the student reads as «молочная железа») fall back to
   lexical ranking (`SemanticFusion.confidence`) —
   [`research/embedding-distillation-2026-10-09.md`](research/embedding-distillation-2026-10-09.md).
9. **Explain semantic hits.** Highlight the best-matching sentence of a vector hit, since no query
   word may occur in it.
10. **Approximate vector search** only when a phone measurement of the exact scan exceeds ~300 ms.

Candidates from the owner query baseline (2026-10-06, `bun run benchmark:owner-queries`; none
started). The committed baseline numbers (rush hit@5 0.774, thoughtful 0.304) were taken in a tree
that already held the S3 code; the clean pre-S3 state, measured with `S3_OFF=1`, is hit@1 0.167 /
hit@5 0.444 (rush 0.581, thoughtful 0.261), and with S3 0.278 / 0.574 (0.774, 0.304):

11. **Abbreviation expansion derived from the sources.** «аг лечение» → the 274н sanatorium order,
    «фп антикоагулянты», «окс», «хсн» are weak. КР «Список сокращений» sections define
    «АГ – артериальная гипертензия»; expand from those definitions (and the core's
    `clinical-abbrev` identities), not from a hand-written list.
12. **Equal-title tie-break.** krasotaimedicina «Мигрень» / «Острый панкреатит» rank above the КР with
    the identical title, and МКБ nodes crowd the top five («жаропонижающее ребенку» → poisoning codes
    T39/X40). Candidate: prefer the recommendation for equal title matches (owner decision pending;
    measure on `owner-queries.json` and the lookup gate first).
13. **Missing-letter drug typo** («цефтриаксн» finds nothing relevant) — done with item 19
    (2026-10-13): the core's medication spelling branch already found the drug; «Все» dropped it
    because its title stem was not in the query. `ScopedMedicalCore` now keeps drugs that branch
    matched.
14. **Descriptions and case vignettes in «Все»** (items 5 + 14, CMPL1, 2026-10-14; QA 10-13: «боль в
    груди при вдохе» and «таблетки от головы» found only МКБ codes, the query model was never used in
    «Все»). A lookup that names nothing (no title or alias begins with every typed word), has at least
    two Cyrillic words and was not rewritten or corrected also runs the clinical hybrid search; up to
    three recommendations found by meaning go right behind the first lexical group
    (`SearchResponse.descriptionRecommendations`, core option `descriptionRecommendations`). Without
    the model the response says `model-missing` and «Все» shows one row offering the download. Names,
    codes and Latin terms are never touched; the lexical gates run without a model and are unchanged by
    construction. Owner queries in «Все» with the model: hit@5 0.463 → 0.833, hit@1 0.296 → 0.315
    (`bun tools/benchmarks/src/run-description-recommendations.ts`); one forbidden hit appears
    («аг лечение»: the abbreviation, item 11). Costs one more search (clinical hybrid) for such queries
    only. Left: abbreviations (item 11), a weak extra next to the right one («аг лечение» →
    autoimmune haemolytic anaemia, cosine above the right one, so no cutoff helps), not measured on a phone.

15. **Questions about a drug in pregnancy, lactation and a child's age** (SAFE1, 2026-10-06; owner
    request, gap audit item 5). Compared with the list first: it is not ranking work (items 1–5, 8 stay
    as they are) and not a drug-by-indication search (E3): the drug is named, the question is what its
    own instruction says. Closest items: 6 (related documents from source data) and the INT1 card
    «Проверить взаимодействие». Shipped as a **card above the results** («Все источники», «Препараты»),
    the ranking and every exact-name gate untouched. A deterministic parser
    (`medication-safety/safety-query.ts`: intent words, an age, the rest is the name) →
    the app's own medication search with the S3 name-variant fallback → the build-time index of
    offsets and checksums (`scripts/build-medication-safety.ts`, no instruction text) → the sentences
    quoted from the installed instruction with their section, source and «Открыть в инструкции».
    No verdict is worded by the app; «В инструкции об этом не сказано» names the instruction that was
    read. Measured on its own set (`bun run benchmark:safe1`) and the exact-name gates before/after:
    [`research/medication-safety-2026-10-06.md`](research/medication-safety-2026-10-06.md).
    Left: the substance's other manufacturers' instructions are one switch away, not compared; trade
    names inside quoted text are not matched; a symptom or disease question («давление при
    беременности») shows no card by design (no hand-written symptom→drug dictionary).

16. **Comparing drugs** (CMP1, 2026-10-06; owner request «compare drugs by parameters»). Compared with the list first: not
    ranking work (items 1–5, 8 stay as they are) and not a drug-by-indication search (E3): the drugs are named and the
    question is how their own registry rows and instructions differ. Closest items: 6 (related documents from source
    data), the INT1 card «Проверить взаимодействие» and the SAFE1 card (item 15); same shape, shipped as a **card above the
    results** and a tool, with the ranking and every exact-name gate untouched. A deterministic parser
    (`drug-comparison/comparison-query.ts`: a cue phrase, or «или» / «vs» between names) → the app's own medication search
    (S3 variants, whole-word match, genitive names re-looked-up as their stem) → the card appears only if every part of the
    query names a drug (so «менингит или энцефалит» has none) → the tool: registry rows, six instruction sections quoted
    and matched across the drugs with deterministic marks («у обоих» / «только у X», threshold and rules in the research
    note), no generated text, no «лучше / хуже». Measured on its own set (`bun run benchmark:cmp1`) and the exact-name gates
    before / after: [`research/drug-comparison-2026-10-06.md`](research/drug-comparison-2026-10-06.md). Left: statements on
    one topic worded differently are not matched; the first instruction of each substance is read, other manufacturers'
    are one switch away; a disease or symptom pair gets no card by design.

17. **Presenting results** (UX9, 2026-10-07; owner screenshots). Compared with the list first: no
    ranking item changes (1–5, 8 stay as they are, every gate untouched); closest are 6 (related
    documents from source data) and the cards above the results (15, 16). Shipped as presentation:
    the dictionary entries of one name fold into one definition preview (the best-covered entry, or the
    definition section of a found document of that name), technical fragments of catalogue cards come
    after the card's own text in plain words, and background re-runs never replace the list without
    «Обновить». Measured by the app-path e2e suites, not by recall; recall gates unchanged by
    construction. Left: the preview does not yet read a definition from a full КР that is installed but
    not among the results.

18. **Source-name queries and the drug overview line** (2026-10-09; QA R5 and S6). Compared with the list first: not
    ranking work (items 1–5, 8 stay as they are, every exact-name gate untouched) and not a content rebuild; closest are 3
    (name variants: another way a typed name misses) and 17 (presentation). A query that starts, ends or (for a long name)
    contains a source name — derived from the documents' `publisher` / `sourceLabel` / `issuer` and the declared collections —
    is searched inside that source with the rest of the words; a bare name lists the source. A bare drug name opens with an
    overview line instead of the catalogue identity line. Measured on `source-name-queries.json` (`bun run
    benchmark:source-names`): first five results from the named source 0.53 → 1.00, expected document 8/9 → 9/9, negatives
    13/13 plain. Left: «Видаль» (not in the corpus), publishers of a clinical recommendation (not in the catalogue metadata),
    web addresses as aliases (not in the search projection). Details: [`SEARCH.md`](SEARCH.md), «Search by source name».

19. **Misspelt words in any name** (TYPO1, 2026-10-13; owner: «Помоач» for «Помрач», «Оменция» for
    «Аменция» found nothing). Compared with the list first: extends item 3 (another way a typed name
    misses, same «only when the typed query names nothing» rule and the same fallback) and absorbs
    item 13; no ranking item changes. Matching from the start of a word already forgave a late slip;
    a slip in the first letters found nothing. A weighted edit distance to the beginning of every
    title, alias, terminology and exact source name (neighbouring key or sound-alike letter = half an
    edit) corrects the word, the corrected query replaces the response only when it names the result,
    and the search box shows the wrong letters struck out and the right ones added. Measured on
    `typo-queries.json` (`bun tools/benchmarks/src/run-typo-queries.ts`: 698 real names with one slip
    in the first three letters, 231 with a late slip, 220 controls): first-letter slips hit@5 0.328 →
    0.984 (0.794 from the «Все» drug fix alone), hit@1 0.239 → 0.845; disease articles hit@5 0.36 →
    0.94, КР 0.92 → 1.00, trade names 0.88 → 1.00; controls (codes, Latin terms, correct names, the
    owner's 54 queries) unchanged 220/220; no case lost a hit; corrected queries p95 0.64 → 1.3 s on a
    laptop (one more search, only after a miss). Left: body-text words are not corrected (no
    vocabulary of them on the device). 2026-10-14 (QA): a word only a close name answered («пневмания» →
    the trade name «Внеплания», «амоксицилин» → «АМОКСИЦИЛЛИН») is corrected too when the corrected
    search names it exactly, and a stem followed by a consonant in the vocabulary («амоксицил» +
    «лин») is no word form: first-letter hit@1 0.845 → 0.990, hit@5 0.984 → 0.990, controls unchanged
    but the owner's «цефтриаксн», now corrected. A corrected multi-word query that finds nothing as a whole
    («лечение оменции») stays uncorrected; not measured on a phone. Design:
    [`SEARCH_ARCHITECTURE.md`](SEARCH_ARCHITECTURE.md) «Misspelt words».

20. **Dose questions with patient data** (RX1, 2026-10-14; owner QA «Амоксициллин, доза ребёнку 20 кг»). Compared with the list
    first: not ranking work (items 1–5, 8 stay as they are, every exact-name gate untouched) and not a drug-by-indication search (E3);
    closest are the cards above the results (15 SAFE1, 16 CMP1): same shape, same rule that a card never changes the order. A
    deterministic parser (`prescription/dose-query.ts`: age, weight, duration, state words, form / strength words, the rest is the
    name) → the app's own medication search (S3 variants, spelling correction) → the dose-rule index (offsets and checksums, no text;
    [ADR-0025](adr/0025-dose-rule-index-and-prescription-draft.md)) → the dose sentences of the installed instruction that fit the
    patient, quoted, with the computed intake, «Открыть в инструкции», «Оформить рецепт» and the recipe icon. Nothing fits: the
    instruction states no dose, its section is linked; not installed: the download is offered in place with its size. Measured on
    `dose-queries.json` (`bun run benchmark:dose`): 134 cases, exact 134, wrong answers 0, missing 0; `benchmark:all` within
    tolerance, search code unchanged. Left: a table row read without its clearance band, unstated-population adult rules for «пожилой»,
    instructions of other manufacturers are one switch away; details: [`research/dose-rules-2026-10-14.md`](research/dose-rules-2026-10-14.md).

21. **Drugs by ATC code** (ATC5, 2026-10-14; owner: «ATC search must work in the main search and in the other drug
    searches, along with the name»). Compared with the list first: extends item 3 (a typed code or a wrongly typed
    layout still names a drug) and the МКБ-code lookup of item 4; not ranking work, every name gate untouched (results
    identical with the directory off and on). A query that, spaces ignored, has the code shape (`J05`, `J05A`, `J05AX`,
    `J05AX1`, `J05AX13`; Cyrillic look-alikes А В С Е Н К М О Р Т Х У and Russian-layout keys read; a letter with one digit,
    a lone letter, any word is no code) lists the drugs carrying it in front of the text hits: exact level first, then by
    name, each with the code that matched («J05AX13 · в реестре: L03AX» for an agreed code, ATC3). The codes come from the
    drug directory the app hands the core (`createMedicalCore({drugCodes})`, built from the shipped comparison index), so it
    works offline and for drugs whose module is not installed. The pickers of the comparison, interaction and prescription
    tools, the safety and dose cards and the medication list read the same answer. Measured on generated queries
    (`bun run benchmark:atc`, 2 192 full codes of the 2 787 cards that carry one): every code finds its card (2 192/2 192, top-5
    2 093), 13/13 agreed pairs show both codes, 220/220 typing variants give the same drugs, 0 of 8 word negatives match;
    `benchmark:all`, name variants and CMP1 unchanged. Left: a text that reads as two codes («м01ае01» is `M01AE01` by look,
    `V01FT01` by key) is answered by the first reading that names a drug; ATC levels 1 (a lone letter) are never read as a
    code; drugs are found as substance cards, not as the products under them. Design:
    [`SEARCH_ARCHITECTURE.md`](SEARCH_ARCHITECTURE.md) «Drugs by ATC code».

22. **QA pass 2026-10-14: brand names, class words, homeopathic mixtures, nonsense** (SRCH1, 2026-10-14; `docs/research/qa-haiku-2026-10-14.md`
    «Search quality» and the owner decision on class words). Compared with the list first: not ranking work in items 1–5 and 8 (every exact-name
    gate untouched, results identical on `benchmark:cmp1` / `benchmark:atc`); closest are 3 (a typed name that finds nothing), 12 (the equal-title
    tie-break, left open) and 21 (ATC5: the same directory port). Shipped: a brand typed whole finds its substance card and leads in «Все» (the
    pointer's own trade-name rows count as the card's names), «Препараты» puts homeopathic mixtures behind the ordinary cards that name the query,
    a class word as the whole query returns the class card, then its drugs (single substances first, commoner first, ≤ 12, each with the ATC code
    that matched), then the usual documents; markup and short Latin words are no queries; the drug pickers share one any-component name rule; the
    marks, «Обновить», the label of a calculator and the reader dictionary stop making the QA's mistakes; the query is in the address. Measured on
    their own sets (`bun run benchmark:srch1`, `bun run benchmark:class`, table above) and the unchanged gates: `benchmark:all` lookup R@1 0.180 /
    R@5 0.279 / MRR 0.214 unchanged, the 19-query demo set MRR 0.105 → 0.096 (one query, «аугментин пневмония»: the Амоксиклав card is no longer
    dropped in «Все», the recommendation moves from second to third; hit@5 unchanged); typo and name-variant sets in `CURRENT_STATE.md` «SRCH1».
    Left: complaints and descriptions as class words («лекарства от давления»: no hand-written symptom → class table, by principle); equal-title
    tie-break (item 12). **SRCH2 (2026-10-15):** a class word inside a longer query («макролиды детям», «статины при беременности», «ингибиторы АПФ
    кашель») shows the class card and the three commonest drugs, the documents below ranked by the whole query; only for a plural class word or a
    capital abbreviation with ≤ 3 other words that name no substance (`classInQuery`, `restNamesDrug`); `benchmark:class` `phrases`. The reference
    documents flagged `calculationRequired`: the CKD-EPI 2021 and WHO child-growth documents are linked to their calculators, the WHO BMI table and
    CKiD U25 wait for a calculator that implements them.

23. **A section that finds nothing: the other sections answer** (SRCH3, 2026-10-31; owner request 13: «Поиск по запросу
    «Флувоксами» не дал результатов в разделе «Педиатрия»», «Результаты раздела «Препараты»:»). Compared with the list first:
    not ranking work (items 1–5 and 8 stay as they are, every gate untouched by construction: the fallback runs only after the
    scoped search returned nothing at all, so no ranking inside a scope changes); closest are 3 and 19 (a query that finds
    nothing still finds its name: the wider search is the core's «Все» search, so the layout, transliteration and spelling
    fallbacks apply to it too, «Флувоксами» is corrected there) and 17 (presentation of results). Shipped in the UI layer only
    (`search-scope-fallback.ts`, `SearchScopeFallbackList.tsx`, the results list of `SearchWorkspace`): after an empty scoped
    lookup (a section, or a group such as «Педиатрия» of «Все источники») the words are searched in «Все источники» and the
    hits are listed by section under «Результаты раздела «…»:», sections ordered by their best hit, ranking kept inside a
    section, with one line saying where nothing was found; the picker keeps the picked scope, a tap on a subheader opens that
    section with the same words. **Per mode:** lookup sections and groups — yes; «Клинический разбор» — no (it already searches
    every source except ICD-11, so an empty answer is not a section miss and the wider search would add only a wrong label);
    calculators, questionnaires (tool lists) and personal notes — no. Measured by unit tests (decision and grouping) and the
    e2e `search-scope-fallback.spec.ts` (an empty «Нормативные документы» search of a disease shows the other sections, a tap
    opens one with the query; a scope that finds something is never widened; nothing anywhere keeps «Ничего не найдено»), not
    by recall. Cost: one more «Все» search, only after an empty scoped answer, before the list is shown (one loading state).
    Left: identity hits of the wider search (names of modules not installed) are not shown, the saved copy of a scoped answer is
    widened again on replay (one search), not measured on a phone.

24. **More forgiving spelling: real misspellings anywhere in a word** (TYPO2, 2026-10-31; owner request 14: «not just mixing some
    letters, but actually writing something wrong and still getting the right name»). Compared with the list first: extends
    item 19 (same rule — only when the typed query names nothing, the corrected query must name the result, the box shows the
    correction) and item 3; no ranking item changes. Item 19 already corrected one weighted slip anywhere in the word by its
    budget (0.5 up to five letters, 1 up to eight, 1.5 up to eleven, 2 beyond); the gaps were the budget of a seven- or
    eight-letter name, «ц»/«тс» and «щ»/«сч», word forms of a left-out letter («складчатй» looked like a stem with an ending, so it
    was never tried), a name beginning plus the typed ending beating the whole name («гемолитичесая» → «гемолитическя»), and the
    acceptance of a far correction. Shipped (`word-typo.ts`, `name-variant-fallback.ts`, one branch of `withNameVariantFallback`):
    budget 0.5 up to five letters, 1 at six, 1.5 at seven, **2 from eight** (two full edits); «ц» for «тс» and «щ» for «сч»/«шч»
    (and back) half an edit; a word form (stem + a tail an ending could be) is corrected by one cheap edit to a whole name word; a
    whole name word beats a name beginning with the typed ending on it unless it is cheaper by more than a quarter edit; a
    correction above one edit ("stretched") applies only when the typed words found nothing a title or alias within two edits
    of them answers, and only when its own result names the corrected words (before, an empty answer took any correction that
    found something). Dropped or doubled letters, о/а, е/и/я, и/ы, voiced/voiceless pairs, signs and doubled consonants were
    already half an edit and are measured, not changed. **Measured** (`bun tools/benchmarks/src/run-typo-queries.ts`; the set
    `typo-queries.json` keeps its 929 cases and 220 controls and gains 1 849 `hard` cases generated from the same 235 names by
    `build-typo-queries.ts`: a mid-word slip, two cheap slips, two unrelated letters, a dropped and a doubled letter, two sound-alike
    vowels, doubled/single and voiced/voiceless consonants, ь/ъ, ц/тс, щ/ш, -ий/-ый, a vowel by sound plus a dropped or doubled
    letter; plus 200 nonsense words), correction on, item 19 code → this change: **hard hit@1 0.930 → 0.954, hit@5 0.952 → 0.975**
    (on the 1 831 cases whose correctly typed name is itself found in the first five: 0.939 → 0.963, 0.962 → 0.985): two unrelated
    letters 0.748/0.836 → 0.814/0.934, dropped letter 0.927/0.949 → 0.966/0.974, two sound-alike vowels 0.945/0.964 →
    0.973/0.977, vowel by sound plus a slip 0.873/0.927 → 0.909/0.958, ь/ъ 0.912/0.941 → 0.941/0.941, -ий/-ый 0.762/0.810 →
    1.000/1.000, two cheap slips 0.978/0.982 → 0.987/0.991; the first-letter set 0.990 → 0.991 (hit@5 0.990 → 0.991). **Controls
    unchanged 220/220** (no control's first ten groups differ from item 19's); 2 of 2 778 cases lost a hit@5 (a tie between two
    equally near names: «эпетор» → «эпитоп» for «эплетор», «целеакя» → «целевая»); nonsense words rewritten by a correction
    10 → 14 of 200. Latency on a laptop, quiet machine, a third of the set, corrected queries p50/p95: 228/1295 → 259/1322 ms
    (all queries 229/1291 → 259/1303). Without the stretched-correction rules the budget alone rewrote 31 nonsense words and lost 4
    hits; budgets of 2 from seven letters measured the same as 1.5 at seven and were not kept. Left out: a correction between
    names that are equally near is still a guess (the heavier name wins); the hard set's remaining misses are mostly the cases whose
    own name is not found in the first five groups, two unrelated letters in short words, a typed form of a different real word,
    and meta words (a query word such as «лекарственный» is never corrected); body-text words stay uncorrected (no vocabulary of
    them on the device); not measured on a phone.

## Measured and rejected

| Idea | Result | Date |
|---|---|---|
| Plain reciprocal-rank fusion of lexical and e5 | worse than e5 alone on КР (E1) | 2026-10-02 |
| rubert-tiny2, USER-base instead of e5-small | lower R@5 on КР (E1) | 2026-10-02 |
| Feature-hash fusion constants for e5 | R@5 0.166 vs 0.497 calibrated | 2026-10-05 |
| One vector per complaint clause + document coverage | complaint R@5 0.326 → 0.27–0.29 | 2026-10-05 |
| Aleph Alpha Kolibri-1 (78B MoE chat LLM) for search | not an embedder/reranker; English/German only, 47–78 GB; [note](research/kolibri-1-2026-10-05.md) | 2026-10-05 |
| Rule list «от X / при X» → indication search | not needed: indication vectors answer it without rules | 2026-10-05 |
| e5 on МКБ card names/synonyms + disease-article overview/symptoms in «Болезни» | description → term hit@5 0.80 → 0.49; diagnosis → card R@5 0.28 → 0.39; short МКБ rows attract unrelated cards | 2026-10-05 |
| МКБ bridge from every card, recommendations first (clinical analysis) | Q1 dev КР R@5 0.162 → 0.347 (complaints 0.07 → 0.21), but the app-path demo set loses recall@1 0.526 → 0.211–0.421: a card matched through one word of «аугментин пневмония» puts «пневмония у детей» before the adult recommendation | 2026-10-06 |
| МКБ bridge placed right behind its card / by score / appended, in name lookup | right behind the card: lookup recall@1 0.803 → 0.689, mrr 0.855 → 0.766; appended: Q1 dev R@5 0.174 (no gain) | 2026-10-06 |
| МКБ bridge in name lookup without «first group is a card» | `benchmark:all` lookup recall@1 0.180 → 0.115: «парацетамол», «ибупрофен», «цефтриаксон» get recommendations in front of the drug through «Отравление парацетамолом» and neighbours | 2026-10-06 |
| МКБ bridge on top of e5 hybrid | Q1 test, 723 КР modules: R@5 0.423 → 0.423, MRR 0.350 → 0.351 — nothing to add | 2026-10-06 |
| KD1 hybrid: clause mixing (query vector + mean of its clause vectors), document evidence (a document's next vector hits add to its best), 200 vector candidates | Q1 dev complaints R@5 0.651 → 0.698 (clause 0.5) but test 0.633 → 0.646, R@1 −1 query; owner set R@5 0.822 → 0.822; document evidence and 200 candidates ±0; extra encodes per clause — not kept (CMPL1) | 2026-10-14 |
| EmbeddingGemma 2 (text 270M) instead of e5-small on КР | Q1, 330 queries, 774 КР modules: R@5 0.452 → 0.497 (95 % CI −0.003…+0.094), R@1 0.288 → 0.270; complaints 0.255 → 0.303; query 4.3 → 284 ms on one CPU thread, model 118 → 314 MB; [note](research/embeddinggemma-2-2026-10-07.md) | 2026-10-07 |

## Open owner decisions

- ~~e5 query model (129 MB): onboarding checkbox, or bundled in the APK~~ — **resolved (owner, 2026-10-15):
  bundled in the Android APK** (KD1 query model, about +125 MB, «under 300 MB is fine»); web and iOS keep
  the optional download. See `docs/SEMANTIC_RETRIEVAL.md` «Bundled in the Android APK».
