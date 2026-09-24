# RapidFuzz OSA medication-name experiment — 2026-09-24

Isolated benchmark only; RapidFuzz is not an application dependency.

- Deterministic cases: 929.
- Current MiniMed candidate matcher: Top-1 872/929, Top-8 906/929.
- RapidFuzz scorer: OSA.normalized_similarity; cutoffs are swept rather than selected against one hand-picked example.
- osa-full-names is library-only; osa-with-source-marker-projection adds only the same source-backed one-letter marker projection used by MiniMed.

| cutoff | RapidFuzz projected Top-1 | Top-8 | negative controls with candidates | us/case |
| ---: | ---: | ---: | ---: | ---: |
| 0.65 | 889/929 | 929/929 | 0/10 | 1696.2 |
| 0.70 | 889/929 | 929/929 | 0/10 | 1690.1 |
| 0.75 | 867/929 | 904/929 | 0/10 | 1690.1 |
| 0.80 | 778/929 | 812/929 | 0/10 | 1701.6 |
| 0.85 | 749/929 | 783/929 | 0/10 | 1696.4 |
| 0.90 | 378/929 | 388/929 | 0/10 | 1690.4 |

The JSON receipt contains per-family metrics and bounded miss samples. Mechanical corruptions are not independent clinician logs, and candidate recall is not medication substitution or diagnostic validation.
