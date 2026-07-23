# Public Russian clinical-recommendation pilot

MiniMed `0.4.0-alpha.1` contains a small source-linked pilot corpus derived from seven Russian
pediatric clinical recommendations plus eight medication-registry identity cards.

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
15 documents
58 sections
58 chunks
18 aliases
1 embedding profile
58 embeddings
```

The pack is built with:

```bash
bun run content:lint:pilot
bun run content:build:pilot
bun run benchmark:pilot
```

## Retrieval benchmark

`tools/benchmarks/pilot-rf-queries.json` contains 50 engineering queries: six per recommendation and
one registry query per medication card. The current deterministic build scores Recall@1 `1.00`,
Recall@5 `1.00`, MRR@5 `1.00`, and top-section accuracy `1.00`.

The query suite includes a regression for a negated treatment-response phrase such as “нет ответа на стартовый антибиотик через 72 часа при пневмонии”; the negative span must stop at the temporal reassessment boundary so the diagnosis remains searchable.

This is a small engineering benchmark, not a clinical validation study. Before a physician beta, it
still needs independently authored cases and clinician-reviewed expected sections.

## Public repository boundary

The public pack contains only paraphrased source-linked cards. Full PDFs, OCR output, books, local hospital protocols and patient cases must remain outside the public repository under ignored private workspaces such as `data/raw/` and `data/intermediate/`.
