# Browser speaker diarization handoff — 2026-09-25

## Decision

MiniMed browser transcription keeps quantized Whisper Base/Small as the working ASR path and now
stores word-derived timestamps as structured transcript segments. Speaker diarization is an optional
second stage. It must not be inferred from a single Whisper stream or approximated from pauses.

The implemented seam is:

```text
audio Blob
  -> browser decode/resample to mono Float32 PCM 16 kHz
  -> optional BrowserDiarizationEngine(PCM) -> speaker regions
  -> Whisper worker with return_timestamps="word" -> timestamped words
  -> maximum temporal-overlap alignment
  -> merge adjacent words of the same speaker into transcript turns
  -> local IndexedDB transcript + editable speaker labels/text
```

When no diarizer is active, the same word timestamps are merged into ordinary `speaker-1` turns and
the UI explicitly says that speaker separation is not enabled.

## Upstream sherpa-onnx evidence

Pinned source tag: `k2-fsa/sherpa-onnx@v1.13.8`.

The tag contains a first-party browser/WASM speaker-diarization implementation:

- `build-wasm-simd-speaker-diarization.sh` builds with
  `SHERPA_ONNX_ENABLE_WASM_SPEAKER_DIARIZATION=ON` and Emscripten 4.0.23.
- `wasm/speaker-diarization/sherpa-onnx-speaker-diarization.js` exposes
  `createOfflineSpeakerDiarization(Module, config)`.
- Its `process(Float32Array)` result is a list of
  `{ start, end, speaker, confidence }` regions.
- The official example uses pyannote segmentation plus a speaker-embedding model and
  clustering with either a known speaker count or a threshold.
- The tag's publication workflow copies the built browser bundle to the official
  Hugging Face Space:
  `https://huggingface.co/spaces/k2-fsa/web-assembly-speaker-diarization-sherpa-onnx`.

Relevant upstream source:

- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/build-wasm-simd-speaker-diarization.sh
- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/wasm/speaker-diarization/sherpa-onnx-speaker-diarization.js
- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/wasm/speaker-diarization/app-speaker-diarization.js
- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/.github/workflows/wasm-simd-hf-space-speaker-diarization.yaml

## Why the runtime is not wired yet

The GitHub Release API for `v1.13.8` does not currently expose a speaker-diarization WASM archive,
although the tagged workflow is configured to upload one.

The official Hugging Face Space has a known update commit
`54c69069962f232c9f873b5afc58788d1e27f088`. At that commit the WASM LFS pointer reports:

- SHA-256: `2fb950b66b849378a96c1bcd8823ba1c471c896af3c11853ec0e6eb361b2c283`
- size: `10,455,758` bytes

However, MiniMed has not yet captured immutable identities for the complete browser runtime set,
especially the Emscripten `.data` payload and every JS loader file belonging to the same build.
Loading `main` or a partially pinned runtime would violate MiniMed's model/artifact policy.

Therefore the current branch deliberately stops at the engine seam and deterministic alignment.
No network diarization service is used and no speaker result is fabricated.

A second implementation was reviewed: `@siteed/sherpa-onnx.rn@1.3.1` documents browser/WASM
speaker diarization and its source contains a dedicated web loader, worker manager and diarization
mixin. It is useful implementation evidence, but MiniMed does not add the package: its npm surface is
a React-Native/native package with postinstall/native dependencies, while the browser assets are
served separately from jsDelivr. A separate GitHub release asset with an immutable digest for the
complete web runtime was not found during this pass. Vendoring or loading floating CDN assets would
weaken the existing artifact-admission policy, so the package remains a reference rather than a
runtime dependency.

## Current browser implementation

Integration branch: `feature/browser-integration` (source work originated on `feature/browser-transcription`).

Implemented:

- Whisper requests word-level timestamps.
- Worker output carries timestamp segments in milliseconds.
- `speaker-alignment.ts` maps words to diarization regions by maximum temporal overlap.
- Words without a real overlapping region retain their existing speaker instead of picking the
  nearest speaker.
- Adjacent words are merged into readable speaker turns with punctuation-aware spacing.
- `BrowserDiarizationEngine` is optional and has no fake default implementation.
- Stored note transcripts now support segments, editable speaker names, errors and retries.
- ASR failures persist as `failed`; OCR preemption does not get misreported as an ASR failure.
- Persisted audio attachments keep their `NoteFile` in the viewer, fixing the previous path where
  saved recordings could not actually start transcription.
- The audio viewer has an editable transcript panel and clearly distinguishes Whisper timestamps
  from real speaker diarization.
- The pyannote segmentation and CAMPPlus speaker-embedding artifacts are now pinned to immutable
  Hugging Face commits and exact sizes/SHA-256 values in
  `browser-diarization-models.ts`. Their combined declared size is 31,137,484 bytes.
- Model transfer uses MiniMed's resumable/retry transport, but downloaded bytes are not admitted to a
  future WASM runtime until `crypto.subtle` reproduces the pinned SHA-256. Unit coverage includes
  exact admission, wrong-size rejection and wrong-hash rejection.
- Successfully admitted model blobs are stored in a versioned IndexedDB cache keyed by model id plus
  the pinned size/SHA metadata. Every cache read re-verifies size and SHA before returning bytes; a
  stale/corrupt record is deleted and downloaded again. This preserves offline reuse after the first
  successful download without treating the resumable partial store as a permanent model cache.
- Empty diarization output never sets `diarized=true`; speaker labels are only exposed after real
  speaker regions exist. Plain Whisper timestamps are presented neutrally as «Речь».

## Next safe integration step

Before enabling sherpa WASM:

1. Capture immutable URL, size and SHA-256 for the **complete** JS/WASM runtime produced by one build.
   The model artifacts themselves are already pinned and verified.
2. Load the verified Emscripten runtime inside a dedicated worker, not the main UI thread, and copy
   the already-admitted pyannote/CAMPPlus bytes into its virtual filesystem.
3. Run diarization and Whisper sequentially inside the existing transcription parity job so two
   large inference engines do not compete for memory.
4. Qualify two-speaker Russian conversations, overlapping speech, long pauses, noise and
   one-speaker recordings before presenting diarization as ready.

The browser transcript/storage/UI contract should not need another migration when that runtime is
connected.
