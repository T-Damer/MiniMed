# Session recorder: lag and transcription — November 2026 (STATE REC1)

Owner 2026-11-13, after recording 2–3 therapy sessions on the phone: the text was wrong, the
recording could not be found, the recorder looked bad, **the app lagged a lot while recording**, and
playback was a plain browser player. This note covers the measurements behind the lag fix and the
transcription diagnosis; the product changes are in `docs/CURRENT_STATE.md` «Session recorder».

## How it was measured

- **Script:** `apps/app/e2e/recorder-perf.spec.ts` (not a gate; `PERF_REC=1`). The production build
  (`vite preview`), Chromium headless shell as a phone (390×844 at 2.75×) on an M2 Max, no CPU
  throttling (same method as [perf-idle-2026-11.md](perf-idle-2026-11.md)). The microphone is
  Chromium's fake device fed by a **synthetic** dialogue (macOS `say -v Milena`, 42 s, looped); no
  real recording was used. The speech worker is the e2e stand-in (answers at once), so the numbers
  are the recorder's own work around recognition — decoding, resampling, drawing, saving.
- After 20 s of settling on the search home, recording starts, the model «downloads», the window
  is collapsed and 10 s windows are taken at recording ages 30, 90 and 180 s: CPU of every browser
  process (`ps` over the profile's process tree, ms per second), main-thread task time and style
  recalculations (CDP `Performance.getMetrics`), long tasks and animation-frame gaps (in the page),
  recognitions sent to the worker.
- `PERF_REC_DECODE=1min.webm,10min.webm,30min.webm` times, in the page, the step the old recorder
  repeated every 7 s: decode the **whole** recording so far into a 16 kHz OfflineAudioContext and
  render it again (`decodeToPcm16k`). Files made with ffmpeg (libopus 48 kbps mono) from the same
  synthetic dialogue.

```bash
PERF_REC=1 PERF_REC_WAV=dialog48k.wav PERF_REC_DECODE=synth-1min.webm,synth-10min.webm,synth-30min.webm \
  CHROMIUM_PATH=… E2E_PORT=4291 bunx playwright test recorder-perf --workers=1 --project=chromium
```

## Before (main at f41a1ede1, release 0.6.96)

The old live text decoded the whole file so far every 7 s:

| recording length | decode + resample, once | new Float32 copy |
| ---: | ---: | ---: |
| 1 min | 97 ms | 4 MB |
| 10 min | 1 004 ms | 37 MB |
| 30 min | 2 958 ms | 110 MB |

On an M2 Max this grows linearly with the recording — every 7 s. At 30 min a step takes 3 s of a
core plus 110 MB of fresh samples (and the `slice` of the window), so the garbage collector runs
constantly; a phone core is several times slower, so by the middle of a 50-min session the decoder
never rests and the WebView fights the GC. That is the lag the owner felt, and it grew with the
session — exactly the shape of the complaint.

The steady part (recording 30–180 s, collapsed bar on the search home):

| age | CPU total ms/s | renderer | main-thread task ms/s | style recalcs/s | long tasks |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30 s | 200 | 126 | 37 | 60 | 0 |
| 90 s | 235 | 164 | 39 | 60 | 0 |
| 180 s | 223 | 163 | 33 | 60 | 0 |

60 style recalculations a second: the recording bar's endless pulsing dot and its 12 level bars
re-styled every 200 ms.

## After (this branch)

Same scenario, same machine, recorder collapsed into the floating button (its live waveform drawing
on the search home):

| age | CPU total ms/s | renderer | main-thread task ms/s | style recalcs/s | long tasks |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30 s | 98 | 65 | 19 | 0 | 0 |
| 90 s | 111 | 76 | 20 | 0 | 0 |
| 180 s | 103 | 72 | 20 | 0 | 0 |

- **Whole-browser CPU −52 %** (200–235 → 98–111 ms/s), renderer −50 %, main thread −45 %, style
  recalculations 60 → 0 a second; GPU process 38–48 → 21–22 ms/s.
- **Nothing grows with the length of the recording any more.** No step decodes the file: the
  AudioWorklet hands over 50 ms of 16 kHz samples (20 messages a second), the speech detector costs
  well under a millisecond a second, and a stretch is sent only at a pause. The decode table above
  is gone from the recording path entirely; a 30-min point costs what the 30-s point costs.
- What remains: the canvas waveform (redrawn at most 20 times a second, only while on screen and
  not paused), one IndexedDB write a second for the compressed slice and one every 5 s for the
  kept samples, the time label once a second.
- Recognition itself (the Whisper worker) is not in these numbers (the stand-in answers at once).
  On a phone it is the biggest cost while it runs; the governor now stops it — for the rest of that
  recording — when it reads slower than real time (smoothed factor > 1.15), when 45 s of speech wait
  in its queue, when the main thread spent over a third of the last 15 s in long tasks, or on a weak
  phone (≤ 2 GB or ≤ 2 cores). The audio is never affected; the text then comes from «Расшифровать».

## Transcription: why the text was wrong

1. **Model.** Whisper Base q8 is the default («Быстрая», marked as preferred for Russian). It is the
   weakest usable Whisper on conversational Russian; Small is markedly better but too slow to run
   live on a phone in WASM. The native GigaAM v3 model the Android build already ships for the
   patient-card dictaphone is a Russian model and far better, but the conversation recorder never
   used it (follow-up below).
2. **Cuts through words.** The stretch sent to the model was «whatever arrived in the last 6–28 s»,
   cut at an arbitrary sample, without overlap: the words at both edges of every 7-s step were heard
   in halves.
3. **Silence and padding.** Whisper pads every stretch to 30 s; a quiet stretch makes it «hear» its
   training subtitles («Продолжение следует…», «Субтитры сделал …») or loop a phrase. The old silence
   check was one RMS over the whole stretch, which an automatic-gain-controlled room passes.
4. **Call processing on a table microphone.** `echoCancellation` and `noiseSuppression` are tuned for
   a headset call; across a table they suppress and garble the farther speaker.
5. **«Расшифровать» of a stored file** was refused above 10 minutes.
6. Sample rate and resampling were correct (decodeAudioData into a 16 kHz context); not a cause.

What changed: an AudioWorklet taps the microphone at 16 kHz (Chromium resamples; no decoding), a
30-ms energy detector cuts stretches at pauses (8–24 s, at the quietest moment of a monologue),
near-silent stretches are never sent, Whisper's subtitle phantoms and loops are dropped, the
microphone records without call processing (AGC kept), and stored 16 kHz samples make
«Расшифровать» work for any length.

**Measured** (`apps/app/e2e/recorder-quality.spec.ts`, `REC_QUALITY=1`): the real Whisper Base q8
from Hugging Face in headless Chromium, the 42-s synthetic dialogue (Milena TTS, 7 turns, a
psychiatrist's questions about sleep, mood and sertraline) looped by the fake microphone for 130 s,
the live text scored against the script by word error rate (numbers written as digits count as
errors on both sides):

| build | heard words / reference | WER |
| --- | ---: | ---: |
| REC1 | 240 / 243 | **0.119** |

The same run of the build before REC1 (served from its `dist`, same origin and cached model) did not
finish in headless Chromium: after a first recording, its window stayed at «Начать запись» for the
second one in both attempts, so there is **no same-audio before/after WER**. The diagnosis below
rests on the code and on what the worker logged, not on a measured difference.

The REC1 text has no phantom lines and no repeated stretches; what remains wrong is the model's own
hearing («ташнота», «снаидневной», «серторальныйн»). Synthetic speech is clean and close to the
microphone, so these numbers flatter both builds against a real session; they compare the
pipelines, not the absolute quality on the owner's recordings.

**Double decoding.** The worker log showed every live stretch failing the word-timestamp pass
(«Model outputs must contain cross attentions…», the q8 exports have no cross attentions) and being
decoded again: the old live text cost two Whisper passes per stretch. Live stretches now ask for text
only (their time is known), and the working timestamp mode is remembered per model for files.

## Not measured

- The owner's phone: installing a build needs the owner's OK; numbers above are from the Mac.
- Recording with the screen off (WebView in the background) was not tested.
- Real recordings were never used (patient-sensitive); only synthetic speech.

## REC2: GigaAM v3 on Android (2026-11-13)

The Android app now reads the recorder's 16 kHz stretches with the native GigaAM v3 model
(sherpa-onnx NeMo CTC with punctuation, greedy search, int8, 2 threads) through the plugin method
`recognizePcm`, whenever its models are installed; Whisper stays the engine in the browser and on
Android until the download finishes. Same synthetic dialogue and scoring as above
(`dialog48k.wav`, Milena TTS, 7 turns, looped; `apps/app/e2e/word-error-rate.ts`).

- **Where:** Android emulator `minimed_spike_120hz` (API 36, arm64, 4 cores, 3 GB, on the M2 Max),
  WebView 133, debug APK built as `org.med.web.rec2` beside the emulator's own install. The WebView's
  fake microphone plays the WAV (`/data/local/tmp/webview-command-line` on a userdebug image); no
  real microphone or speech. Driver: `scripts/recorder-quality-android.ts` (plain CDP over the
  WebView's DevTools socket; it refuses any serial that is not an emulator). The models were
  downloaded through the recorder's own card («Скачать · 256 МБ»).

| engine | where | recorded | heard / reference words | WER (as scored) | WER, digits as words, aligned to the loop end |
| --- | --- | ---: | ---: | ---: | ---: |
| Whisper Base q8 (REC1) | Chromium on the Mac | 130 s | 240 / 243 | 0.119 | 0.098 (24 / 246) |
| **GigaAM v3** | Android emulator | 142 s | 255 / 243 | **0.091** | **0.000** (0 / 252) |

- «As scored» is the REC1 method: the script repeated round(seconds / 42.5) times, digits counted as
  errors. GigaAM writes numbers as digits («в 4:00 утра», «по 50 мг», «через 2 недели») and the
  142-s run heard the start of a fourth loop, so all 22 of its scored errors are those two effects;
  with digits spelled out and the reference cut where the audio stopped it heard every word.
  Whisper's remaining errors under the same normalisation are its own hearing («ташнота»,
  «снаидневной», «серторальныйн»).
- **Speed:** 13 stretches, 135 s of audio, real-time factor **0.15** (slowest stretch 9.4 s read in
  2.5 s), including the base64 bridge. Live text never deferred: a line appeared every ~10 s, right
  after each pause. A second, 45-s run: RTF 0.23. The emulator shares the Mac's cores, so a phone
  may differ either way; the REC1 governor (`LIVE_MAX_REALTIME_FACTOR` 1.15) is kept unchanged.
- **Found on the way:** Capacitor's `PluginCall.getLong` returns null for a JSON number that fits an
  `Int`, so `inspectModel` / `installModelFile` rejected every native model («Expected model size is
  missing») — the patient-card dictaphone's models could never be checked or installed on a device.
  The size is now read as any `Number`.
- **Owner's phone** (2026-11-14, owner OK; Xiaomi 23127PN0CC, HyperOS user build, 0.6.97 + REC2
  signed with the prerelease key over 0.6.95, data kept). The WebView of a user build ignores the
  debug command-line file, so the fake microphone is not available there: the driver's guard
  (every audio input must be Chromium's «Fake …» device) stopped before any recording — it opened
  the microphone only to read its label and closed it at once; nothing was recorded or kept. The
  native path was measured without a microphone instead: the four pinned model files (checked
  against their SHA-256 on the Mac) were staged and installed through the plugin's own
  `installModelFile` (size and SHA-256 verified on the phone, 3 s for the 225 MB model), then the
  same dialogue as 16 kHz PCM, cut at its pauses into 4 stretches (6.8–12.7 s), went through
  `recognizePcm` three times:

  | | per loop of the script (81 words) |
  | --- | ---: |
  | WER as scored | 0.074 (digits) |
  | WER, digits as words | 0.012 (one error: «принимаю.ропусков») |
  | real-time factor, median stretch | 0.09 |
  | real-time factor, mean (11 calls after the first) | 0.13 (two stretches took ~4 s) |
  | first call (builds the recognizer) | 3.3 s for 12.5 s |

  The text was identical in all three loops. Not covered on the phone: the WebView microphone, the
  AudioWorklet tap and the VAD (covered on the emulator), and the in-app download (covered on the
  emulator).
- **Not measured:** a real room or a real session (never used), screen-off recording.
