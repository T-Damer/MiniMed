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
| Exact names, codes (app path) | `benchmark:real:release` lookup; `benchmark:doctor-lookup` | R@1 0.803, R@5 0.934; doctor R@5 0.7 → 0.9 | — (lexical by design) | S2 done |
| Diagnosis phrase → КР | Q1 RuCCoD, test | R@5 0.20 | 0.70 | shipped 0.6.48 |
| Complaint → КР | Q1 RuMedPrime, test | R@5 0.04 | 0.28 | weakest area |
| Drug by indication («от головы») | `drug-indication-queries.json`, 45 | hit@1 0.16, hit@5 0.47 | hit@1 0.62, hit@5 0.91 | E3 shipped to main |
| Drug names | 100 ГРЛС trade names | top-1 0.99 | 1.00 | E3 gate |
| Description → term («воспаление слизистой желудка» → гастрит) | `reverse-term-queries.json`, 35 | hit@5 0.80 | 0.49 | lexical kept (E5 rejected) |
| Diagnosis / complaint → МКБ card | Q1, «Болезни» scope | R@5 0.28 / 0.03 | 0.39 / 0.02 | see item 4 |

## Ordered plan

1. **Exact-lookup misses** (S2, done 2026-10-05; remaining: narrative cases need the clinical parser). Go through every miss of the release lookup set and the drug name
   sets; fix causes such as a query word matching inside another word («головной» → «Болиголов»),
   service words («от», «таблетки») acting as the subject, and generic form words outranking it.
2. **Description → term, symptoms → disease** (E5) — measured, not shipped: see the rejected table.
   Lexical search after S2 already answers description queries (hit@5 0.80).
3. **Keyboard layout and transliteration for names.** «ьуеащкьшт» → «метформин», «nurofen» →
   «нурофен»: deterministic, cheap, common on phones; only as a fallback when the typed form finds
   nothing exact.
4. **Diagnosis → МКБ code → КР bridge.** Match the query to an МКБ card (lexically or by e5), then
   lift the recommendations that list that code. Deterministic data already exists (КР carry their
   МКБ codes); expected to help diagnosis phrasing in lexical mode too.
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

## Measured and rejected

| Idea | Result | Date |
|---|---|---|
| Plain reciprocal-rank fusion of lexical and e5 | worse than e5 alone on КР (E1) | 2026-10-02 |
| rubert-tiny2, USER-base instead of e5-small | lower R@5 on КР (E1) | 2026-10-02 |
| Feature-hash fusion constants for e5 | R@5 0.166 vs 0.497 calibrated | 2026-10-05 |
| One vector per complaint clause + document coverage | complaint R@5 0.326 → 0.27–0.29 | 2026-10-05 |
| Rule list «от X / при X» → indication search | not needed: indication vectors answer it without rules | 2026-10-05 |
| e5 on МКБ card names/synonyms + disease-article overview/symptoms in «Болезни» | description → term hit@5 0.80 → 0.49; diagnosis → card R@5 0.28 → 0.39; short МКБ rows attract unrelated cards | 2026-10-05 |

## Open owner decisions

- e5 query model (129 MB): recommended as an onboarding checkbox, on by default, downloaded with the
  first section; bundling it in the APK (+~125 MB) is the alternative.
