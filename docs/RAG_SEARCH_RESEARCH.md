# RAG/search architecture research

**Reviewed:** 2026-09-04

**Scope:** offline-first Russian medical navigation; retrieval before optional generation; no
hosted backend; private patient data stays on-device.

## Recommendation

Keep the current deterministic pipeline as the product path:

```text
normalize → extract facts/negation → bounded query branches
→ FTS5/aliases + optional neural candidates → deterministic fusion/filters
→ exact source chunk, section, anchor, and corpus-gap result
→ local file references; optional cloud answer only after explicit document selection
```

The smallest useful staged architecture is:

1. **Now:** retain SQLite FTS5, aliases, deterministic typo handling, deterministic portable
   embeddings, and hybrid fusion. Benchmark on clinician-authored Russian queries before adding
   another index. FTS5 already supplies BM25, weighted columns, snippets, and highlights
   ([SQLite FTS5](https://www.sqlite.org/fts5.html)); RusBEIR finds BM25 a strong Russian
   full-document baseline and stresses preprocessing for morphologically rich Russian
   ([Kovalev et al., 2025](https://arxiv.org/abs/2504.12879)).
2. **First neural experiment:** add one frozen neural embedding profile at pack-build time and
   query-time only when the model is installed. Keep lexical candidates and fallback mandatory;
   compare Recall@5, MRR@5, section recall, exact-context resolution, pack bytes, cold start,
   p50/p95 latency, RAM, and battery on representative devices. `multilingual-e5-small` is the
   first candidate: the authors publish 384-dimensional, 12-layer multilingual E5-small and an
   official implementation/model table ([E5 repository](https://github.com/microsoft/unilm/tree/master/e5),
   [technical report](https://arxiv.org/abs/2402.05672)). This is a candidate, not evidence of
   Russian clinical quality.
3. **Second experiment, only if ranking remains the bottleneck:** rerank the top 20–50 lexical /
   vector candidates with a local cross-encoder. `BAAI/bge-reranker-v2-m3` is a plausible
   multilingual Apache-2.0 candidate, but its model card reports a 0.6B model; treat it as an
   optional high-memory download, not a mobile default
   ([model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)).
4. **Later:** if an answer service is added, send only documents the user explicitly selected from
   the local retrieval result. Keep personal notes and patient records out of cloud requests by
   default. The local application remains the source navigator and never requires generation.

Do not add GraphRAG, ColBERT, or LLM-generated query2doc expansion to the release path yet. They
increase build/storage/runtime complexity before MiniMed has a real-corpus gain over its existing
baseline.

## Measured E5 prototype

The 4 September 2026 CLI experiment used the pinned q8
`Xenova/multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78` artifact against 5,061
index rows representing 4,208 documents. Its generated 500-query suite covered cases, medicines,
documents and exact phrases, symptoms, diseases, syndromes, tools, synthetic notes, and synthetic
patients. Both lexical and hybrid paths found the expected file in the first 20 results for all 500
queries. The 20-result limit is a UI cap, not the relevance target: the primary browsing metric is
Recall@4.

A second index-layout experiment canonicalized each pointer, summary, and installed full clinical
recommendation as one document family instead of letting near-duplicates consume result positions.
Case assembly now keeps the two leading recommendation candidates with one definition/description
for each. For cases, fusion reserves three leading lexical candidates and one E5 candidate; symptom
queries reserve two of each. With this layout, lexical Recall@4 was `0.998` and hybrid Recall@4 was
`1.00`; hybrid Recall@1 improved from `0.924` to `0.940`, and MRR@20 from `0.9560` to `0.9675`.
Hybrid improved 13 ranks, worsened one, returned every exact-phrase document in the first four, and
leaked zero patient cards in the five locked-vault cases. The offline tokenizer path was also fixed
to load the pinned local cache without a Hugging Face metadata request.

The q8 model is about 113 MiB and the disposable index about 27 MiB. This generated benchmark is
engineering evidence, not physician-authored qualification. The revised layout shows that E5 can
improve retrieval, but it still does not justify making the 113 MiB model a bundled dependency. The
production path therefore remains unchanged. E5 is now a viable optional research candidate pending
clinician-written blind queries and physical Android latency, memory, storage, battery, and thermal
checks.

## Comparison

| Approach | What it adds | Offline/Russian/mobile trade-off | Decision for MiniMed |
|---|---|---|---|
| **Classic hybrid RAG** | Lexical retrieval plus dense retrieval, then fusion and source-grounded generation. The original RAG work combines a generator with a non-parametric dense index and explicitly motivates provenance and updateability ([Lewis et al., 2020](https://arxiv.org/abs/2005.11401)). | Strong complementarity: exact drug names, units, negation cues, and legal wording remain lexical; paraphrases can be dense. Two candidate paths and one fusion step are manageable offline. | **Keep and measure.** Existing FTS5 + deterministic vector fusion is the right baseline; neural vectors are an optional profile, never a dependency. |
| **Query expansion** | Adds aliases, spelling variants, related terms, or generated pseudo-document text. Query2doc improved BM25 by 3–15% on general ad-hoc IR benchmarks, but corpus-steered work identifies hallucination and corpus-mismatch risks ([Query2doc](https://aclanthology.org/2023.emnlp-main.585/), [CSQE](https://aclanthology.org/2024.eacl-short.34/)). | Static Russian aliases are cheap, inspectable, and safe when bounded. LLM expansion can add an unmentioned diagnosis, erase a negation, or introduce a dose/route not present in the query; generation also costs battery and may expose private text if remote. | **Use deterministic expansion only.** If optional AI is tested, it may suggest bounded alias candidates after facts/negation are frozen; never rewrite or replace the original query. |
| **Dense embeddings** | Maps semantically similar query/chunk text near each other; useful for colloquial Russian and lexical gaps. Russian evaluations show neural models can win many tasks, while long-document input limits remain material ([RusBEIR](https://arxiv.org/abs/2504.12879), [ruMTEB](https://arxiv.org/abs/2408.12503)). | Precomputed vectors keep indexing offline; query encoding still needs a local model, tokenizer, memory, model version, and parity checks. Dense similarity does not prove a fact, applicability, or dose. | **Stage 1 candidate.** Use only for candidate generation and evaluate against the current deterministic baseline. |
| **Cross-encoder reranking** | Scores query–passage pairs jointly; this is generally more accurate than a bi-encoder but slower and cannot precompute independent sentence embeddings ([Sentence Transformers docs](https://www.sbert.net/docs/package_reference/cross_encoder/model.html), [Nogueira & Cho, 2019](https://arxiv.org/abs/1901.04085)). | Excellent for a small candidate set, poor as first-pass mobile retrieval. CPU latency, model size, and thermal cost are unpredictable on low-end phones. | **Stage 2 only.** Rerank a bounded top-K after deterministic filtering; preserve original rank and fallback if unavailable or slow. |
| **Late interaction / ColBERT** | Encodes query and document separately but compares token-level vectors at search time; document vectors can be precomputed, retaining more fine-grained matching than a single vector ([ColBERT](https://arxiv.org/abs/2004.12832)). ColBERTv2 compresses late-interaction storage 6–10×, but the paper still describes the uncompressed footprint as an order of magnitude larger than single-vector retrieval ([ColBERTv2](https://aclanthology.org/2022.naacl-main.272/)). | Better term-level matching than one vector, but many vectors per chunk, more index engineering, token-level query compute, and larger pack/update costs. The multilingual Jina-ColBERT-v2 candidate is 0.6B, 94-language, and CC-BY-NC; its published repository is multi-gigabyte ([model card](https://huggingface.co/jinaai/jina-colbert-v2)). | **Defer.** Revisit only after single-vector hybrid + reranking misses a measured Russian retrieval target and storage/device budgets are known. |
| **GraphRAG / knowledge graph** | Extracts entities, relationships, claims, communities, and summaries; supports local entity-neighborhood search and global corpus-level map/reduce search ([Microsoft GraphRAG indexing docs](https://github.com/microsoft/graphrag/blob/main/docs/index/overview.md), [GraphRAG paper](https://arxiv.org/abs/2404.16130)). | The official implementation uses an LLM-heavy indexing pipeline and warns it can consume substantial LLM resources ([getting started](https://github.com/microsoft/graphrag/blob/main/docs/get_started.md)). Generated claims/summaries create a second derived corpus, versioning burden, and an additional route for unsupported medical relations. | **Do not use as general retrieval.** Keep only explicit, reviewable, source-span-linked relations already allowed by MiniMed’s content pipeline; derive no treatment edge from graph proximity. |
| **Constrained answer generation with citations** | A local model turns an evidence bundle into bounded structured output with citations. ALCE separates fluency, correctness, and citation quality and reports incomplete citation support 50% of the time for the best systems on its ELI5 benchmark ([Gao et al., 2023](https://aclanthology.org/2023.emnlp-main.398/)). | JSON/schema constraints stop malformed output, not unsupported medicine. Citation IDs must be allow-listed and excerpts must be exact members of retrieved chunks; source version, population, route, units, and conflicts remain deterministic checks. | **Optional final layer only.** On retrieval failure, stale evidence, conflict, missing facts, or validator failure, show deterministic results / clarification / gap and abstain. |

## What neural methods can and cannot replace

| Function | Neural role | Required authority |
|---|---|---|
| Russian paraphrase, typo, alias, and colloquial recall | Suggest or rank additional candidates; never delete the original branch. | Deterministic alias dictionary, bounded typo rules, and exact FTS evidence. |
| Age, weight, decimal/unit extraction | May propose a field for review or prefill. | Deterministic parser plus range/unit validation; never infer a missing value. |
| Route, formulation, strength, and indication | May improve candidate ordering. | Structured catalog identity and source-backed applicability; route/strength mismatch must be a hard exclusion where supported. |
| Negation, allergy, red flags, “already administered,” and unsafe intent | **Must not be replaced.** Embeddings and generators represent similarity, not a safety-preserving polarity contract. | Deterministic polarity/span logic and explicit abstention tests. |
| Dose selection or dose arithmetic | **Must not be replaced.** A model may locate a passage but must not invent, normalize, or calculate a regimen. | Reviewed typed calculator/rule, required inputs, units, population/route checks, and exact source span. |
| Answer wording | May summarize only retrieved evidence. | Schema validation, allowed chunk IDs, exact excerpt membership, citation coverage, contradiction checks, and stale-query rejection. |

This division is especially important for Russian clinical text: RuMedBench covers Russian medical
NLI, QA, and NER, and reports that humans retain an advantage on tasks requiring knowledge and
reasoning ([Blinov et al., 2022](https://arxiv.org/abs/2201.06499)). That is not a direct dose-safety
benchmark, but it is sufficient reason not to treat a small general model as the authority for
clinical slots or polarity.

## Privacy and implementation guardrails

- Keep patient facts, notes, embeddings, and personal-search inputs on-device; do not add telemetry
  or a hosted fallback. A future cloud-answer action may send only its explicit query and
  user-selected non-personal documents. A local model is a privacy property only if its runtime and
  model download path are also local after installation.
- Prefer the existing SQLite/worker boundary and add no library until a measured gap exists. If a
  neural encoder is later shipped, freeze tokenizer, weights, revision, dimensions, quantization,
  checksum, and builder/runtime parity. ONNX Runtime Mobile officially supports inference on Android
  and iOS and supplies mobile model/runtime optimization paths
  ([official docs](https://onnxruntime.ai/docs/get-started/with-mobile.html)); the current local
  llama.cpp path is also an established local-inference option ([official repository](https://github.com/ggml-org/llama.cpp)).
- Store neural vectors as optional pack data and make absence, mismatch, timeout, or OOM a clean
  lexical fallback. Never let a model block source opening or change deterministic calculator gates.
- Qualify every candidate on MiniMed’s real Russian corpus, not only public English IR scores: recall,
  section/anchor correctness, negation and missing-input behavior, citation support, unsupported-claim
  rate, conflict abstention, cold start, p95 latency, peak RAM, package size, thermal/battery impact,
  and offline behavior.

## Bottom line

MiniMed should be a **deterministic hybrid navigator with optional local neural recall**. The local
product returns source files and exact fragments; any future cloud answer is a separate explicit
action over selected non-personal documents. Query expansion, cross-encoder reranking, and generation
remain separately measured opt-ins; ColBERT and GraphRAG should wait. None can replace deterministic
parsing for age, weight, route, negation, or dose safety.
