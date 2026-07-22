# Local model harness

MiniMed's local model is optional. Search, source opening, history, and deterministic query analysis
remain available when the model is absent, downloading, unloaded, unsupported, or broken.

## Current scope

The experimental slice implements:

- a validated remote/cache/bundled model catalog;
- six curated logical candidates, including two Russian-specific Vikhr models;
- a lightweight startup device probe;
- deterministic automatic recommendation;
- browser/Android-WebView GGUF loading through a dynamically imported wllama runtime;
- a short Russian constrained-output warm-up benchmark;
- cached benchmark results and temporary failure suppression;
- one smaller-candidate fallback;
- a bottom status toast;
- System-page controls for automatic selection, automatic loading, manual override, unload, and
  explicit licence acceptance.

It does **not** yet:

- use generated text in medical search or answers;
- implement native LiteRT-LM or Cactus inference;
- prove that any candidate improves the Russian clinical benchmark;
- validate model SHA-256 through a streaming browser installer;
- publish mirrored model assets in a MiniMed GitHub Release;
- support iOS inference.

## Candidate catalog

The bundled preview catalog contains:

| Model | Initial tier | Smallest current artifact | Current runtime path |
| --- | --- | ---: | --- |
| Vikhr Qwen 2.5 0.5B Q4 | compact/Russian | about 398 MB | browser/Android WebView GGUF |
| Qwen3 0.6B Q8 | compact/control | about 639 MB | browser/Android WebView GGUF |
| Gemma 3 1B IT | balanced | about 584 MB LiteRT; 806 MB GGUF | GGUF now; LiteRT declared for follow-up |
| QVikhr 3 1.7B Q4 | balanced/Russian | about 1.11 GB | browser/Android WebView GGUF |
| Qwen3 1.7B Q8 | balanced/control | about 1.83 GB | browser/Android WebView GGUF |
| Llama 3.2 3B Instruct Q4 | quality/experimental | about 2.02 GB | native Cactus declared for follow-up |

The displayed tier is not a clinical-quality claim. The Russian-tuned models receive a higher initial
Russian priority because they are instruction-tuned specifically for Russian, but they still have to
pass MiniMed's own extraction, structured-output, negation, omission, and retrieval benchmarks.

The generic Qwen models remain in the catalog as controls. This lets the benchmark determine whether
Russian fine-tuning helps our actual physician queries instead of assuming that it does.

## Russian model survey

The initial survey found several useful Russian open-weight families:

- **Vikhr Qwen 2.5 0.5B**: Apache-2.0, GGUF, approximately 398 MB at Q4_K_M, intended for
  low-end/mobile Russian instruction following;
- **QVikhr 3 1.7B noreasoning**: Apache-2.0, GGUF, approximately 1.11 GB at Q4_K_M, based on
  Qwen3 and tuned for Russian instruction following without a reasoning preamble;
- **Vikhr Llama 3.2 1B** and **Vikhr Qwen 2.5 1.5B**: viable additional benchmark candidates,
  but omitted from the first expanded catalog to avoid adding near-duplicate tiers before the harness
  produces measurements;
- **YandexGPT 5 Lite 8B**, **T-Tech T-lite 8B**, and Russian Saiga 8B/12B variants: useful
  desktop or high-memory candidates, but their Q4 artifacts are several gigabytes and are not suitable
  as default mobile downloads;
- older Sber/AI-Forever ruGPT and ruT5 models are valuable Russian research models, but the small
  variants are not modern chat/instruction models and therefore are poor fits for MiniMed's startup
  query-planning role.

Large Russian models may later be offered under a separate `desktop` or `high-memory` compatibility
class. They must not displace the mobile candidates merely because they have more parameters.

## Automatic selection

Candidates are filtered before ranking:

1. artifact is published in the catalog;
2. platform and runtime are available;
3. licence terms have been accepted when required;
4. reported memory meets the model minimum when known;
5. free storage includes artifact size plus a safety margin;
6. browser artifact stays below the current single-file memory/download ceiling;
7. the candidate has not recently failed on the device.

The remaining candidates are ranked by:

- curated Russian priority;
- baseline quality score;
- memory margin;
- native runtime bonus;
- WebGPU availability;
- model download size;
- CPU probe result;
- data-saver and connection conditions.

Artifacts up to 1.25 GB can be selected automatically when the model otherwise fits. Larger automatic
downloads receive a strong penalty unless the device has at least 12 GB RAM and meets the model's
recommended memory. This permits QVikhr 1.7B on suitable 8 GB devices while keeping Qwen 1.7B Q8 and
larger candidates conservative.

This recommendation is a device-fit estimate. The loaded model then has to return valid compact JSON
for a fixed Russian query. A failure records a seven-day cooldown and tries one smaller candidate.

## Benchmark cache

Successful benchmark records are keyed by:

```text
model id + artifact id + device fingerprint
```

The device fingerprint includes platform, native/web container, reported memory, CPU concurrency,
WebGPU state, and CPU probe bucket. A successful result is reused for up to 30 days. The model still
has to initialize at the current launch; cached results avoid repeating generation.

The benchmark records:

- model and artifact identifiers;
- runtime;
- load time;
- short-generation time;
- output character count;
- structured-JSON validity;
- device fingerprint;
- timestamp.

Clinical quality metrics remain in the repository benchmark suite rather than this startup probe.

## Browser and Android behavior

The first adapter uses wllama loaded at runtime from a catalog-controlled ESM and WASM URL. It runs
GGUF through WebAssembly workers, with a conservative context limit and optional WebGPU layers.

In a Capacitor Android WebView, the same adapter is the current fallback. The catalog already carries
`litert-native` and `cactus-native` artifact entries so a later Capacitor plugin can take precedence
without changing selection or UI contracts.

Automated browsers expose `navigator.webdriver`; MiniMed performs selection but does not download a
large model in that environment.

## Distribution

Large weights do not belong in Git history.

The intended layout is:

```text
repository main branch
  apps/app/src/features/models/catalog.preview.json

GitHub Release: local-models-preview
  vikhr-qwen2.5-0.5b-instruct-q4_k_m.gguf
  qwen3-0.6b-q8_0.gguf
  gemma3-1b-it-q4_k_m.gguf
  gemma3-1b-it-int4.litertlm
  qvikhr-3-1.7b-instruction-noreasoning-q4_k_m.gguf
  qwen3-1.7b-q8_0.gguf
  llama-3.2-3b-instruct-q4_k_m.gguf
```

Configuration:

```env
VITE_LOCAL_MODEL_CATALOG_URL=https://raw.githubusercontent.com/T-Damer/MiniMed/main/apps/app/src/features/models/catalog.preview.json
VITE_LOCAL_MODEL_ASSET_BASE_URL=https://github.com/T-Damer/MiniMed/releases/download/local-models-preview
VITE_LOCAL_MODEL_ALLOW_UPSTREAM=true
VITE_LOCAL_MODEL_WEBGPU=true
VITE_LOCAL_MODEL_AUTOLOAD=true
```

The loader tries the configured mirror path first and can fall back to the immutable upstream URL in
the catalog. Before a production release, mirrored files must be uploaded, sizes and SHA-256 values
must be verified, and the catalog version must be frozen.

## Licence handling

Apache-licensed Qwen and Vikhr candidates are eligible immediately. Gemma and Llama catalog entries
require an explicit Settings action that links to and records acceptance of the corresponding terms.
MiniMed never infers acceptance from application installation.

## Medical safety boundary

The startup benchmark does not evaluate treatment correctness. Model output must not become trusted
medical content. Future query-planning integration must:

- return a strict validated schema;
- preserve deterministic red-flag and negation handling;
- retrieve source material before synthesis;
- copy numerical facts from structured reviewed records;
- expose exact source links;
- fall back on invalid output or timeout;
- beat deterministic baselines on the Russian clinical benchmark;
- pass dangerous-omission, population-applicability, contradiction, and unsupported-claim gates.
