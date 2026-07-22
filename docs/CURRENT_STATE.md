# Current state

MiniMed is an offline-first Russian clinical search prototype with deterministic local retrieval,
source-preserving content packs, optional semantic search, modular content catalogs, and an
experimental optional local-model harness.

## Search and content

- SQLite FTS5 and deterministic Russian query analysis remain the always-available baseline.
- Versioned content packs preserve document, section, chunk, page, and source provenance.
- Compact precomputed embeddings support lexical, semantic, and hybrid retrieval.
- The application can load the bundled core pack and inspect optional content modules through a
  remote/cache/bundled catalog.
- Structured knowledge, medicine relationships, and editorial review remain separate from vector
  similarity and generated text.

## Local model experiment

The current branch adds a provider-neutral local-model controller after core search initialization.
It probes platform capability, ranks compatible artifacts, downloads and loads a selected model in
the background, runs a short Russian structured-output viability check, caches results, and falls back
to a smaller candidate or deterministic-only mode.

The first comparison catalog contains six candidates:

- Vikhr Qwen 2.5 0.5B Q4;
- Qwen3 0.6B Q8;
- Gemma 3 1B IT;
- QVikhr 3 1.7B Q4;
- Qwen3 1.7B Q8;
- Llama 3.2 3B Instruct Q4.

Vikhr/QVikhr provide Russian-tuned mobile-size candidates. Their generic Qwen relatives stay in the
catalog as controls, so MiniMed can measure whether Russian adaptation improves its real query suite.
Large 8B-class Russian models are deferred to a future desktop/high-memory tier.

Browser and Android WebView currently use the experimental wllama GGUF adapter. LiteRT-LM and Cactus
artifacts are represented in the catalog but require later native adapters before they can win
automatic selection.

## Safety boundary

- Core search starts before any model work and never depends on the model.
- Model output is not yet connected to diagnosis, treatment, retrieval ranking, or answer generation.
- Automatic selection estimates device fit, not clinical reliability.
- Licence-gated families require explicit acceptance in Settings.
- Numerical medical facts and trusted clinical relationships remain reviewed structured data.
- Any future query-planning or reranking integration must beat deterministic baselines and pass
  source-grounding, negation, population, contradiction, omission, and unsupported-claim gates.

## Distribution boundary

Model weights are not committed to Git. The repository stores only a versioned catalog with artifact
metadata, mirror paths, upstream URLs, sizes, checksums, runtime requirements, and licences. The
intended production distribution uses immutable GitHub Release assets behind an environment-configured
base URL, with verified upstream fallback where licensing allows it.
