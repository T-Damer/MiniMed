# Local search assistant

The local model has a deliberately narrow job: understand the clinical case and give a coarse
relevance-based reorder of already-retrieved sources. It is not the source of medical facts, and it
never extracts a diagnosis, a dose, or a citation.

An earlier version of this design let the model extract diagnosis candidates and dose evidence with
citation validation. That was dropped: it was slow (a large JSON completion per search), and the
citation-matching machinery was solving a harder problem than the product actually needed — the
model's real value here is search-result ordering, not clinical claim extraction. See ADR 0011's
catalog-trim amendment for the surrounding context.

## Runtime

```text
query
  → deterministic analysis and SQLite retrieval (returned immediately, never blocked on the model)
  → bounded candidate chunks
  → background: query understanding (search terms, clarifying questions)
  → background: coarse relevance label per candidate (H/M/L)
  → applied reorder or untouched search fallback
```

Each candidate contains a stable chunk ID, title, category, and bounded snippet. The model receives
at most six candidates and has no arbitrary database or network access. `search()` always resolves
with the deterministic order — the two background steps above are published afterward through
`GroundedMedicalCore.subscribeAssistant()`, so results render immediately and are upgraded in place
once the model finishes.

## Allowed output

- Search terms and clarifying questions (query understanding).
- A relevance label (H/M/L) per candidate ID, used only to reorder results already found by
  deterministic search.

Nothing else. The model cannot add a candidate that wasn't already retrieved, and it never produces
a diagnosis, a dose, or a quoted excerpt.

## Fail closed

The original deterministic order remains visible when:

- no validated model session is ready;
- generation fails or a newer query supersedes it;
- the relevance response contains no recognizable `id:letter` labels.

Query understanding (terms/clarifying questions) is independent and best-effort: its failure alone
does not block the relevance reorder, and the reorder's failure does not clear an already-successful
understanding — each degrades on its own.

## Current evidence limit

Clinical usefulness of the reorder still requires evaluation with real local-model outputs and
real physician queries — a plausible-looking reorder is not the same as a clinically better one.
