# ADR 0011 — Automatic optional local-model selection

- Status: accepted for experimental implementation
- Date: 2026-07-22

## Context

MiniMed must remain useful before, during, and after local-model initialization. The model is an
optional query-planning and reranking component, not the source of medical truth. Mobile and browser
devices vary substantially in available memory, storage, runtime support, thermal behavior, and model
performance. Asking every user to understand quantization and runtime formats would expose an
implementation detail instead of a clinical-search feature.

The first candidate set contains four small models:

- Qwen3 0.6B;
- Gemma 3 1B IT;
- Qwen3 1.7B;
- Llama 3.2 3B Instruct.

Some model families have licence terms that require explicit acceptance. Some artifacts are suitable
for browser WASM/WebGPU, while others require a later native LiteRT-LM or Cactus adapter.

## Decision

1. Start deterministic SQLite/FTS/vector retrieval before starting the model controller.
2. Probe the device after core initialization and select the highest-ranked compatible candidate.
3. Rank by Russian benchmark priority, quality baseline, memory margin, storage margin, runtime,
   artifact size, WebGPU availability, network constraints, and recent failures.
4. Automatically download and load the selected model when automatic loading is enabled.
5. Never auto-accept third-party model licence terms. A gated model becomes eligible only after the
   user explicitly accepts its terms in Settings.
6. Cache successful benchmark results for the same model artifact and device fingerprint. Re-run on
   model/runtime/device changes or after the cache expires.
7. Cache failures temporarily so a repeatedly crashing or structurally invalid model does not run at
   every launch. Try a smaller compatible candidate once before falling back to deterministic search.
8. Suppress large downloads in automated browser tests and when the platform reports data-saver or a
   very slow connection.
9. Keep model selection and runtime behind provider-neutral TypeScript contracts. Browser GGUF uses a
   dynamically loaded wllama adapter; LiteRT-LM and Cactus remain separate native adapters.
10. Store the mutable catalog in the repository and large immutable artifacts in GitHub Releases. Do
    not commit model weights to Git history.
11. Allow a user to disable automatic loading, unload the active model, restore automatic selection,
    or choose a compatible model in Settings.
12. Do not route model output into clinical answers in this slice. The first runtime benchmark checks
    only load viability and constrained Russian JSON output.

## Startup lifecycle

```text
application opens
  -> SQLite/core initializes
  -> model catalog loads with remote/cache/bundled fallback
  -> lightweight device probe
  -> deterministic recommendation
  -> artifact download/cache
  -> model initialization
  -> short Russian structured-output benchmark
  -> ready OR smaller-model fallback OR deterministic-only mode
```

A small bottom toast reports the current phase. It must not block search interaction.

## Selection is not clinical validation

A device recommendation means only that a model appears compatible and comparatively suitable for
that device. It does not mean the model is clinically reliable. Before model output influences query
planning or ranking, every candidate must be evaluated against MiniMed's Russian source-grounded,
negation, population, omission, contradiction, and dangerous-advice benchmark contracts.

## Consequences

### Positive

- users get a reasonable model without understanding model formats;
- deterministic search stays immediately available;
- the same logical catalog can carry browser and native artifacts;
- failed models degrade safely instead of breaking application boot;
- models can be replaced through a validated catalog rather than an application release;
- explicit settings preserve user control after automatic setup.

### Negative

- first launch may download hundreds of megabytes;
- browser memory reporting is approximate and browser storage quotas vary;
- WebAssembly model initialization can still fail despite the lightweight probe;
- model artefact SHA-256 verification needs a streaming downloader/native installer before this path
  can be promoted from experimental;
- licence-gated models cannot participate in first-run automatic selection until their terms have
  been accepted;
- native acceleration requires follow-up adapters and physical-device benchmarks.

## Rejected alternatives

- **Bundle one model in the APK:** increases every download and prevents independent model updates.
- **Ask the user to choose on first launch:** exposes parameters and quantization before MiniMed has
  measured the device.
- **Run a full generative benchmark every launch:** wastes time, battery, and heat; cache by device and
  artifact instead.
- **Let the local model replace deterministic parsing:** violates the offline fallback and makes basic
  safety behavior depend on a probabilistic component.
- **Commit weights to the repository:** bloats Git history and violates repository policy.
