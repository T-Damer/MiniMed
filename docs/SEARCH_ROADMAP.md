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
| Owner queries («Все», lookup) | `owner-queries.json`, 54 | hit@1 0.167, hit@5 0.444 (rush 0.581, thoughtful 0.261) → 0.278, 0.574 (0.774, 0.304) | — | S3 items 3–4 |
| Diagnosis phrase → КР | Q1 RuCCoD, test | R@5 0.20 (KR packs) | 0.70 | shipped 0.6.48 |
| Diagnosis phrase → КР through the МКБ card | Q1 RuCCoD, test, `run-icd-bridge.ts` | core only 0.417 → 0.536; core + mkb.db 0.298 → 0.476; 723 КР modules 0.274 → 0.476 | 0.643 → 0.643 (no change) | S3 item 4 shipped (lexical) |
| Complaint → КР | Q1 RuMedPrime, test | R@5 0.04 (0.10 with the pointers) , unchanged by the bridge | 0.28 (0.19 in the S3 re-run) | weakest area |
| Drug by indication («от головы») | `drug-indication-queries.json`, 45 | hit@1 0.16, hit@5 0.47 | hit@1 0.62, hit@5 0.91 | E3 shipped to main |
| Drug names | 100 ГРЛС trade names | top-1 0.99 | 1.00 | E3 gate |
| Drug safety questions («X при беременности / при ГВ / ребёнку 3 лет») | `safe1-queries.json`, 44 (card, not ranking) | card correct 44/44, see item 15 | — | SAFE1, answer card above the results |
| Drug comparison queries («X или Y», «X vs Y», «сравнить X и Y», «чем отличается X от Y») | `cmp1-queries.json`, 35 (card, not ranking) | card correct 35/35, see item 16 | — | CMP1, comparison card above the results |
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
5. **Semantic candidates in «Все»** once items 1–2 show no name regression in the per-scope gates;
   «Все» is the default search box.
6. **Related documents from existing links** («Похожие по теме»): disease card → its КР and drugs,
   drug → КР that name it (`clinical-medication-relations`), from source data only.
7. **Owner query set.** 20–50 queries in the owner's own wording with the expected documents, as a
   gate next to the public sets; every item above is re-measured on it.
8. **Complaints, second attempt.** Candidates to measure, in order: e5 on the clinical analysis's
   positive facts in addition to the raw text; a small on-device cross-encoder reranker over the top
   20 (size and latency first); a larger embedding model for КР only if a phone measurement allows.
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
13. **Missing-letter drug typo** («цефтриаксн» finds nothing relevant): spelling candidates for
    names one letter shorter than a registered name (`medication-spelling.ts` starts at five letters).
14. **Case vignettes** («Внезапная слабость в правой руке и нарушение речи два часа назад»): route
    long case-like queries to the clinical analysis / e5 path automatically; same ground as item 5 and 8.

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

## Open owner decisions

- e5 query model (129 MB): recommended as an onboarding checkbox, on by default, downloaded with the
  first section; bundling it in the APK (+~125 MB) is the alternative.
