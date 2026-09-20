# Pediatric SIRS threshold extraction — 2026-09-20

## Source

Current Russian clinical recommendation **«Острая респираторная вирусная инфекция (ОРВИ)»**,
ID 25_3, approved 2026, children, Appendix A3.4.

Current appendix:
https://www.consultant.ru/document/cons_doc_LAW_543697/37bfdd6aa47d1fad9b40ec916b338a5ee1d89720/

Structured artifact:

`docs/research/data/pediatric-sirs-thresholds-kr25_3-2026.json`

## Table 7 — age-specific clinical/laboratory thresholds

The source provides age-specific thresholds for:

- respiratory rate;
- tachycardia;
- bradycardia where listed;
- high/low leukocyte count;
- systolic blood pressure.

MiniMed stores these as **syndrome screening thresholds**, not normal vital-sign ranges.

Older age rows in the source have no bradycardia value. Those fields remain `null`.

## Table 8 — laboratory cutoffs

For children older than one month the source separately lists:

- leukocytosis;
- leukopenia;
- neutrophilia;
- C-reactive protein;
- procalcitonin.

The neutrophil, CRP and PCT source cells contain **cutoff ranges**, not one number. The artifact keeps
the full source ranges and marks them non-executable until reviewed rather than choosing an endpoint.

## Explicit source discrepancy

For age 1 month–1 year:

- Table 7 prints leukocytosis as >17.5 ×10^9/L;
- Table 8 prints leukocytosis as >17.7 ×10^9/L.

Both values are retained with source-table identity. MiniMed does not silently normalize one into the
other.

## Semantic boundary

This dataset is declared:

`syndrome_screening_thresholds_not_reference_intervals`

It must not be used to create:

- universal pediatric normal ranges;
- an autonomous SIRS diagnosis;
- an autonomous sepsis diagnosis;
- a bacterial-infection diagnosis from one marker.

A future clinical rule needs a separately reviewed syndrome definition and full patient context.
