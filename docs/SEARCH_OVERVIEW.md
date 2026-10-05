# How search works — short version (2026-10-05)

One page for the owner and for anyone starting search work. Code map:
[`SEARCH_ARCHITECTURE.md`](SEARCH_ARCHITECTURE.md); behaviour rules: [`SEARCH.md`](SEARCH.md);
measured plan: [`SEARCH_ROADMAP.md`](SEARCH_ROADMAP.md).

## What happens to a query

1. **Where to search.** The tab picks the documents: «Все», «Болезни», «Рекомендации»,
   «Препараты», «Законы», tools. Only the core and the downloaded modules are searched; a core
   pointer shows a document that is not downloaded yet and offers its module.
2. **Understanding the words.** Spelling, ё/е, abbreviations (АД, ОАК, СРБ), colloquial aliases
   («температурит» → лихорадка), drug forms and routes (сироп, в/м), negations («нет кашля») and
   numbers (age, weight, temperature) are recognised. Words that only describe the form or the
   audience («таблетки», «у ребёнка») never count as the subject. A name that finds nothing as
   typed is retried on the other keyboard layout, as a Latin spelling («nurofen» → «нурофен») or
   through a drug's Latin name, and the page says which spelling was searched.
3. **Word search.** SQLite FTS5 with BM25 over every downloaded pack, several weighted branches per
   query. Exact names, codes and titles are pinned to the top.
4. **Search by meaning (optional).** With the e5-small model downloaded (Settings → «Поиск по
   смыслу», 129 MB, runs on the device), the query is turned into a vector and compared with the
   vectors stored inside the modules: every chunk of the clinical recommendations, and the
   «Показания» sections of drug instructions. Used in «Клинический разбор», «Рекомендации» and
   «Препараты»; the other tabs stay word-only so an exact name is never outranked by a paraphrase.
5. **Ranking.** Word and meaning scores are combined (the meaning score is taken relative to the
   query's best match), chunks are grouped by document, titles naming the subject rise, replaced
   editions of a recommendation are hidden, and a pointer and its downloaded document merge. A card
   that names the diagnosis («J20.9 Острый бронхит неуточнённый») brings the recommendations that
   list its МКБ code.
6. **Result.** Always the source text with the matching passage and a link to the exact place in
   the document. Nothing is generated.

## How good it is (held-out measurements)

| Query | Example | Words only | With meaning |
|---|---|---:|---:|
| Exact name or code | «амоксициллин», «J18.9» | right document first 80%, top 5 93% | (words only) |
| Diagnosis in own words → КР | «острый бронхит неуточнённый» | top 5 20% (27% → 48% with the МКБ bridge, 723 КР modules) | 70% |
| Complaint → КР | «боли в эпигастрии после еды…» | top 5 4% | 28% |
| Drug by indication | «таблетки от головы», «от изжоги» | top 5 47% | 91% |
| Description → disease | «воспаление слизистой желудка» | top 5 80% | (words only) |

## Limits

- Complaints listing several unrelated symptoms remain the weakest case.
- Only downloaded modules are searched in full; vectors exist only for КР and drug indications.
- Phone latency of search by meaning is not measured yet (laptop: 150–250 ms for all 774 КР).
