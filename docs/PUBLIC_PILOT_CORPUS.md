# Public Russian clinical-recommendation pilot

MiniMed `0.3.0-alpha.5` contains a small source-linked pilot corpus derived from seven Russian pediatric clinical recommendations.

Source metadata and public links were reviewed on 19 July 2026. The official Minzdrav document remains authoritative if a linked mirror or this pilot card differs from it.

## Scope

| Topic | Official ID | Year | Official source |
|---|---:|---:|---|
| Внебольничная пневмония у детей | `714_2` | 2025 | `https://cr.minzdrav.gov.ru/preview-cr/714_2` |
| Бронхит у детей | `381_3` | 2024 | `https://cr.minzdrav.gov.ru/view-cr/381_3` |
| Острый бронхиолит у детей | `360_3` | 2024 | `https://cr.minzdrav.gov.ru/preview-cr/360_3` |
| Инфекция мочевых путей | `281_3` | 2024 | `https://cr.minzdrav.gov.ru/view-cr/281_3` |
| Корь у детей | `563_2` | 2024 | `https://cr.minzdrav.gov.ru/schema/563_2` |
| Ротавирусный гастроэнтерит у детей | `755_1` | 2023 | `https://cr.minzdrav.gov.ru/schema/755_1` |
| Менингококковая инфекция у детей | `58_2` | 2023 | `https://cr.minzdrav.gov.ru/schema/58_2` |

## Content policy

The public pilot does **not** redistribute complete recommendation documents. Each card is a concise paraphrase intended for retrieval and source navigation.

Every source-derived paragraph contains hidden provenance metadata with:

- the official recommendation ID;
- the official Minzdrav URL;
- a readable public mirror URL;
- the source section;
- `contentMode: paraphrase`.

The original recommendation remains authoritative. The cards omit dosage tables and many exceptions and must not be treated as a substitute for the full source.

## Build result

The deterministic builder should produce:

```text
7 documents
42 sections
42 chunks
14 aliases
1 embedding profile
42 embeddings
```

The pack is built with:

```bash
pnpm content:lint:pilot
pnpm content:build:pilot
pnpm benchmark:pilot
```

## Retrieval benchmark

`tools/benchmarks/pilot-rf-queries.json` contains 35 physician-style engineering queries, five per recommendation. It measures Recall@1, Recall@5, MRR@5, zero-result rate, hybrid-path use, semantic-path use and latency.

The query suite includes a regression for a negated treatment-response phrase such as “нет ответа на стартовый антибиотик через 72 часа при пневмонии”; the negative span must stop at the temporal reassessment boundary so the diagnosis remains searchable.

This is a small engineering benchmark, not a clinical validation study. Before a physician beta, it must be extended with at least 50–100 independently authored queries and reviewed expected sections.

## Public repository boundary

The public pack contains only paraphrased source-linked cards. Full PDFs, OCR output, books, local hospital protocols and patient cases must remain outside the public repository under ignored private workspaces such as `data/raw/` and `data/intermediate/`.
