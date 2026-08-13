# ADR-0014: Native llama.cpp inference runtime for Android

- Status: accepted for experimental implementation
- Date: 2026-08-13

## Context

ADR 0011 declared native inference as the intended next step for the local-model harness and
scaffolded the catalog/selection layers for it ahead of time (`LocalModelRuntimeKind`, native
runtime scoring bonuses, per-model native artifact entries). A first attempt used Cactus Compute's
Kotlin Multiplatform SDK (`com.cactuscompute:cactus:1.4.1-beta`); it built and ran, but real-device
testing found that Cactus's SDK versions from v1 onward moved away from GGUF to a proprietary
`.cact` format, only loadable from Cactus's own hosted model catalog. MiniMed's chosen Russian
models (Vikhr, QVikhr) are not in that catalog, and converting them requires a paid Cactus plan —
this made the whole approach a dead end for MiniMed's actual model choices, so it was rolled back
in full.

This ADR replaces it with a runtime built directly on `llama.cpp` (the same open-source engine the
existing `wllama-web` runtime already uses via WebAssembly), compiled natively for Android through
the NDK. This loads the exact same GGUF artifacts `wllama-web` already downloads and verifies — no
proprietary conversion step, no vendor licensing gate, and real native ARM64 speed instead of
WebAssembly (informal on-device benchmarking during development showed roughly 100–200 tokens/sec
generation, native, versus wllama's WASM/CPU path).

## Decision

1. Vendor a trimmed copy of the `llama.cpp` source (MIT-licensed, `ggml-org/llama.cpp`) under
   `apps/app/android/app/src/main/cpp/llama.cpp/` — only `ggml/`, `src/`, `common/`, `include/`,
   `cmake/`, `vendor/`, `licenses/`, the top-level `CMakeLists.txt`, and the `LICENSE`/`AUTHORS`/
   `README.md` attribution files. Everything else — `tools/`, `examples/`, `tests/`, `app/`,
   `benches/`, the Python conversion/GGUF tooling, upstream's own CI/lint/editor configs, and other
   contributor-facing tooling — is stripped: none of it is reachable from the build once
   `LLAMA_STANDALONE` is off (confirmed by option guards in upstream's top-level `CMakeLists.txt`:
   `LLAMA_BUILD_TESTS`/`TOOLS`/`EXAMPLES`/`SERVER`/`APP` all default to `LLAMA_STANDALONE`), and a
   full clean rebuild after trimming confirmed nothing was actually needed. This trims the vendored
   footprint from the full ~1.6 GB checkout (including `.git` and build artifacts) to about 33 MB of
   source.
2. Adapt `llama.cpp`'s own official Android sample (`examples/llama.android`, also MIT-licensed) as
   the JNI bridge: `apps/app/android/app/src/main/cpp/ai_chat.cpp` and `logging.h` (native,
   unmodified apart from an API-24-compatibility fix — see Consequences), plus
   `com.arm.aichat.InferenceEngine`/`InferenceEngineImpl` (Kotlin, kept under their original
   package so the JNI symbol names in `ai_chat.cpp` stay valid without modification, except for one
   behavioral patch — see Consequences). This is deliberately reused rather than hand-written: it
   already solves model loading, a single-threaded coroutine dispatcher for thread-safety with the
   native code, and Flow-based token streaming.
3. `apps/app/android/app/src/main/cpp/CMakeLists.txt` builds a single `ai-chat` shared library,
   wired into Gradle via `externalNativeBuild { cmake { ... } }` in `app/build.gradle` — the native
   build is now a real part of `:app:assembleDebug`/`:app:assembleRelease`, not a manually
   cross-compiled artifact pushed by hand.
4. A new Capacitor plugin, `LlamaInferencePlugin`
   (`apps/app/android/app/src/main/java/dev/localmed/search/LlamaInferencePlugin.kt`), mirrors
   `LocalMedDatabasePlugin`'s and the earlier Cactus attempt's pattern exactly: streaming download
   straight to `context.filesDir/localmed/models/`, incremental SHA-256 verification, resumable
   `Range` requests, before ever touching `InferenceEngine.loadModel()`.
5. `LlamaNativeRuntime`/`LlamaNativeSession` (`apps/app/src/features/models/llama-runtime.ts`)
   implement the existing `LocalModelRuntime`/`LocalModelSession` contract unchanged, gated to
   `platform === 'android' && nativeContainer`. `LocalModelController.runtimes()` gets one added
   entry alongside `BrowserWllamaRuntime` — no other controller/selection logic changes.
6. `catalog.preview.json` gets a `llama-native` sibling artifact for every model that already had a
   published `wllama-web` GGUF artifact (`vikhr-qwen2.5-0.5b-q4`, `qvikhr-3-1.7b-q4`) — same URL,
   same SHA-256, since it is the identical file.
   `selection.ts` scores `llama-native` above `wllama-web` and above the still-unimplemented
   `cactus-native` on native Android devices, second only to the also-unimplemented
   `litert-native`.

## Consequences

### Positive

- Confirmed working end-to-end on a real (emulated) Android device in this session: native
  download with SHA-256 verification, native model load, and a real generated, valid structured
  JSON response (`{"intent":"search","ageYears":3,"concepts":["астма"]}`) from
  `vikhr-qwen2.5-0.5b-q4`, reaching the app's `ready` state.
- No proprietary format, no vendor licensing gate, no paid tier — MiniMed's own chosen GGUF
  artifacts load as-is.
- `LocalModelController`, `selection.ts`, `GroundedMedicalCore.ts`, and `ModelSettings.tsx`'s core
  logic needed no changes beyond the runtime registration and catalog data, confirming the
  provider-neutral `LocalModelRuntime` abstraction holds up across a second native backend attempt.
- Reuses the exact download/checksum/resume idiom already proven by `LocalMedDatabasePlugin` and
  the earlier Cactus attempt, so this remains the first (and now second) place in the app with real
  enforced checksum verification of a downloaded artifact.

### Negative

- Introduces a real native build toolchain dependency (NDK 27.3.13750724, CMake 3.22.1, a Kotlin
  Gradle plugin) and ~33 MB of vendored third-party C++ source in the repository — a materially
  bigger footprint than the earlier SQLite native bridge (ADR 0006).
- 32-bit `armeabi-v7a` is explicitly unsupported: `ggml`'s `llamafile` SGEMM kernel needs NEON FP16
  intrinsics not available for that ABI under this toolchain configuration, and real-world Android
  devices from the last several years are effectively all `arm64-v8a`, so this was accepted rather
  than solved.
- KleidiAI (Arm's optimized CPU matmul kernels) is deliberately disabled: its CMake integration
  fetches source over the network at *configure* time (`FetchContent`), which is not reliable in
  CI or offline dev environments. Plain CPU inference already benchmarks well without it; this can
  be revisited if a vendored/offline KleidiAI source becomes available.
- Debug APK size grew substantially (`libggml*.so` + `libllama.so` + `libllama-common.so` +
  `libomp.so` add roughly 25 MB uncompressed to `lib/arm64-v8a/`) — acceptable for local
  experimentation, but release-build size/stripping needs a real look before shipping broadly.
- `libomp.so` (the NDK's OpenMP runtime, needed because `GGML_OPENMP` is on) is not something the
  NDK's CMake toolchain packages automatically for a shared-library `add_subdirectory()` build; it
  is vendored directly into `app/src/main/jniLibs/arm64-v8a/` from the NDK's own toolchain
  directory so Gradle bundles it. This is a manual step that must be repeated if the pinned NDK
  version ever changes.
- `InferenceEngineImpl.setSystemPrompt()` upstream only allows one call, immediately after
  `loadModel()`, matching a persistent-chat-session usage pattern — `GroundedMedicalCore`'s two
  independent structured tasks (query-plan, then rerank) each need their own system prompt, so this
  one-shot guard was removed (the native side already resets state safely on every call; see the
  comment at `InferenceEngineImpl.setSystemPrompt`). Found and fixed via a real failure surfaced by
  `GroundedMedicalCore`'s fail-closed path during on-device verification, not by inspection.
- No streaming token callback is wired into the plugin in this pass — `complete()` joins the full
  `Flow<String>` into one string before resolving, matching the existing non-streaming
  `LocalModelSession.completeStructured()` contract; a future streaming-answer UI would need this
  revisited.
- iOS is out of scope for this pass, same reasoning as the Cactus attempt: it needs its own
  Xcode/CMake project wiring and is deferred to a follow-up once useful on Android.

## Rejected alternatives

- **Cactus Compute SDK**: superseded by this ADR — see Context above and the (now removed)
  ADR that documented it.
- **Google LiteRT-LM**: still a plausible official alternative (already scaffolded as
  `litert-native` in the catalog/types), but requires converting Vikhr/QVikhr to `.litertlm` first
  and it is unverified whether Google's conversion pipeline supports the Qwen3-family architecture
  these models are built on. Deferred rather than rejected outright — worth revisiting later.
- **ONNX Runtime GenAI**: another plausible free/open alternative requiring a one-time model
  conversion; not pursued in this pass because the llama.cpp path needed zero conversion and was
  already proven to work with a quick native CLI spike before any Capacitor plugin work began.
