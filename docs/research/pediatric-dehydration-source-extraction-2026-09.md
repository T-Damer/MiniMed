# Pediatric dehydration assessment extraction — 2026-09-20

## Current source

Current Russian clinical recommendation **«Острая респираторная вирусная инфекция (ОРВИ)»**,
ID 25_3, approved in 2026, children, revision due no later than 2028.

The recommendation explicitly recommends assessing dehydration when clinically relevant, including
fever and/or vomiting/diarrhea, because this affects the need for and method of rehydration. It points
to Appendix G1 for the Clinical Dehydration Scale (CDS).

Current recommendation:
https://www.consultant.ru/document/cons_doc_LAW_543697/

CDS appendix:
https://www.consultant.ru/document/cons_doc_LAW_543697/38b0c4fb0dccb638322867cfb5cfdbe1a3e0a2ee/

## Structured CDS artifact

`docs/research/data/cds-dehydration-assessment-kr25_3-2026.json`

The source table contains four items scored 0–2:

- appearance;
- eyes;
- mucous membranes;
- tears.

The total score is 0–8.

The current recommendation gives the interpretation directly:

- 0: dehydration absent;
- 1–4: mild dehydration;
- 5–8: moderate/severe dehydration.

The source does **not** give a split point inside 5–8. MiniMed therefore stores
`moderate_or_severe_dehydration` as one source category and does not invent separate moderate and
severe score ranges.

## Validation provenance

The current recommendation cites:

- Goldman et al., Pediatrics 2008, DOI 10.1542/peds.2007-3141;
- Jauregui et al., PLoS One 2014, DOI 10.1371/journal.pone.0095739.

The original validation context includes children with acute gastroenteritis. The 2026 ARVI
recommendation reuses CDS when dehydration needs assessment in respiratory-infection care. That
population/context distinction is retained in the artifact.

## Boundary to fluid calculations

CDS is an assessment scale, not a fluid-deficit calculator.

The research artifact explicitly does not derive:

- percent body-weight fluid deficit;
- ml/kg rehydration volume;
- oral-vs-IV treatment order;
- replacement for ongoing losses.

Those require separate source-backed clinical contracts.

## PEWS status

The same 2026 recommendation references the 2023 Kommunarka methodology for PEWS, but the current
recommendation page does not itself reproduce a canonical PEWS scoring matrix. Because PEWS exists in
multiple implementations, MiniMed should not import an arbitrary NHS/third-party variant under the
Russian recommendation's name.

PEWS remains a separate source-retrieval task until the cited methodology or an equivalent exact
version is available for review.
