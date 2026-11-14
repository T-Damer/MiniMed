# Performance log (STATE PERFLOG1, 2026-11-14)

An opt-in log, in release builds, of where the app lags on a real phone — mostly to find the lag the
owner still feels after 0.6.98 around the conversation recorder. Off by default; off it costs one
boolean check per mark and loads nothing.

## For the owner: turn it on, use the app, send the log

The log is **not offered to everyone** (owner 2026-11-14 «можно просто добавить метку именно на мой
телефон»): there is no switch in Settings until a device has had the log turned on.

1. **Turn it on for one phone**, once, over adb (with the phone connected; the agent asks before
   running it):

   ```bash
   adb shell am start -S -n org.med.web/dev.localmed.search.MainActivity --ez minimed.perfLog true
   ```

   The app restarts with the log on. The flag lives in the app's own preferences on that phone
   (`LocalMedPerfPlugin`), survives restarts and app updates, and turns itself off **two days**
   later. `--ez minimed.perfLog false` turns it off. In a browser, `?perf=1` in the address does
   the same (`?perf=0` off).
2. From then on **Настройки → Основные** on that phone shows «Журнал производительности» with its
   switch (off / on again), how much is recorded, «Поделиться журналом» and a bin button
   («Очистить журнал»). Other phones never see the row.
3. Use the app as usual, especially where it lags: record a conversation for a few minutes with the
   screen on, search, open documents, the diary. The log is written every minute and whenever the
   app goes to the background, so it survives the app being closed (up to the last minute is lost if
   the system kills it); the last three sessions are kept.
4. **«Поделиться журналом»** opens the Android share sheet with one JSON file
   (`minimed-perf-<version>-<date>-<time>.json`); send it to yourself in Telegram, save it to
   «Файлы», or attach it for the agent. In a browser it downloads.

What it never records: text, search queries, transcripts, patient names or ids, document ids, file
names. Only timings, counts, screen names like `notes/patients/:id` (every non-route word replaced by
`:id`) and fixed names from the code (`recorder.start`, `asr.stretch`). `e2e/perf-log.spec.ts` types
a query, records a dialogue and creates a patient with the log on, then checks that none of those
words — and no Russian at all outside the app's own summary lines — is in the shared file.

## For the agent: read the log

```bash
bun scripts/perf-log-report.ts ~/Downloads/minimed-perf-0.6.99-20261114-1030.json --out report.md
```

The report (Markdown) has: long frames by screen, by running feature and by script (chunk, function,
invoker), the ten worst frames with their scripts and character positions, dropped frames while
touching or scrolling per screen, slow interactions (≥ 100 ms input → paint, with input delay /
handlers / paint and the element as `tag.bem-class`), screen settle times, the conversation recorder
(recording minutes, blocking per minute while recording vs otherwise, live-text deferrals and why,
per-engine stretches with real-time factor, waveform / microphone counters, app-process CPU from the
native sampler), timed steps (search, reader, diary pull, the log's own writes) and memory / heat.

A script's `@position` is a character offset in the release chunk; build the same version with
source maps (`bunx vite build --sourcemap` in `apps/app` at that release's commit) to map it.

## What is recorded

Code: `apps/app/src/state/perf-log.ts` (the flag and `perfMark` / `perfSpan` / `perfCount`, always
loaded, ~3 kB), `perf-log-collector.ts` (loaded only while on), `perf-log-analysis.ts` (shared with
the report script), `perf-log-export.ts`, `perf-log-screen.ts`; Android
`LocalMedPerfPlugin.kt`; Settings `features/settings/PerfLogSettings.tsx` (rendered only where `perfLogAvailableHere()`).

| kind | source | fields |
| --- | --- | --- |
| `frame` | Long Animation Frames (≥ 50 ms), buffered from page load; `task` (`longtask`) where LoAF is missing | duration, blocking (past 50 ms), render and style/layout time, up to 3 longest scripts (`invoker`, type, file name, function, char position, forced layout) |
| `event` | Event Timing ≥ 100 ms | event type, element `tag.class`, input delay, handlers, paint |
| `jank` | `requestAnimationFrame` deltas **only for 1.5 s after** a touch, key, wheel or scroll (an always-on loop would make an idle screen draw every frame) | frames, missed refreshes, frames > 50 ms, worst, frame interval estimate |
| `route` / `settle` | `hashchange` → screen name; settle = no DOM change for 0.5 s (≤ 10 s) | first frame, mutations |
| `mark` / `span` / `count` | code marks, see below; also the app's own `minimed:*` performance marks | enum-like fields only |
| `mem` | `performance.memory` every 15 s | JS heap used / total / limit |
| `native` | Android: a background thread samples every 5 s, the page reads the latest every 15 s | app-process CPU in cores (Java, database, GigaAM; **not** the WebView renderer, a sandboxed process), PSS, native heap, free device memory, low-memory flag, battery temperature and level, charging, thermal status and headroom, power-save, fastest core clock |
| `vis` | `visibilitychange` | hidden / visible (screen-off recording) |

Every entry carries the screen and the features running at the time (`a`: open spans such as
`recorder.recording`, `asr.stretch`, `search.core`, `reader.load`), so a long frame is blamed on what
ran.

Marks in the code:

- recorder: `recorder.start` / `.stop` (recorded seconds) / `.pause` / `.resume`, span
  `recorder.recording`; counters `recorder.tap` (the 50 ms microphone block handler),
  `waveform.frame` (every animation frame of the live waveform's loop) and `waveform.draw` (each of
  its ≤ 20 draws a second);
- transcription: span `asr.stretch` (engine `native` = GigaAM / `whisper`, audio seconds, ok) —
  the report divides wall time by audio time for the RTF; mark `asr.defer` (reason `overloaded`,
  `slow`, `backlog`, `no-model`, `errors`; smoothed RTF, queued seconds); span `asr.transcribe-file`
  for «Расшифровать»;
- search: span `search.core` (scope, ok);
- reader: span `reader.load`, mark `reader.text` (section count);
- diary: span `diary.pull` (records, refused);
- the log itself: `perflog.flush` (IndexedDB write), `perflog.tick`.

Bounds: newest 8 000 entries per session in memory (older ones are counted as pushed out), three
sessions in IndexedDB `minimed-perf-log`.

## Cost

- **Off:** `initPerfLog()` reads one `localStorage` key at start-up; each mark is one boolean check.
  No observer, timer, listener or IndexedDB. `e2e/perf-log.spec.ts`: the collector chunk is not
  loaded, no database is created, and the profiler finds no time in the log's files on an idle screen.
- **On:** observers, the 15 s tick, a minute's write; the profiler measured ≈ 1 ms of the log's own
  script time per 10 s of an idle search home (headless Chromium on the M2 Max). The frame sampler
  runs only after input, so it never wakes an idle screen.

## Checked

- `apps/app/src/state/perf-log.test.ts`, `perf-log-analysis.test.ts` (no-content filters, screen
  names, auto-off, off cost, summary and report on a synthetic log).
- `apps/app/e2e/perf-log.spec.ts`: browser (no row by default, `?perf=1`, search, a 180 ms busy frame, recording with live
  text, download, no content, report), Android build in Chromium with native stand-ins (native
  sample and share path with the device flag stand-in, patient name not logged), off/on cost.
- Android emulator: see «Emulator run» below.

## Emulator run (2026-11-14)

`scripts/perf-log-android.ts` on `minimed_spike_120hz` (API 36, arm64, 4 cores, 60 Hz, WebView 133),
debug APK as `org.med.web.perflog1`: switch on in Settings, core download, search / Settings /
«Заметки» with touch scrolls, 90 s of recording with Chromium's fake microphone (a beep, no speech)
and GigaAM installed, stop, the test recording deleted. The report script read the log:

- native sampler present (app-process CPU 0.27–0.30 cores, PSS up to 383 MB with GigaAM loaded,
  free memory, battery temperature, thermal status 0); the CPU clock is unreadable on the emulator;
- 11 native stretches, 88 s of audio, RTF median 0.03 (p90 0.04);
- recorder counters: `recorder.tap` 17 calls/s, 1.8 ms/s; `waveform.draw` 16/s, 2.9 ms/s;
  `waveform.frame` 52/s — the waveform's animation loop runs at the display rate although it draws
  at most 20 times a second (on a 120 Hz phone: ~120 main-thread frames a second while the
  recorder is on screen). A candidate to check in the owner's log, not changed here;
- a first emulator run before GigaAM was installed showed the live text deferring with `no-model`
  after 180 s while the 256 MB download ran — REC1's intended behaviour, now visible in the log.

Device flag, same emulator and build: a plain launch shows no row in Settings and the flag reads 0;
`am start -S … --ez minimed.perfLog true` restarts the app with the log on (row shown, «Пишется»);
`… false` turns it off (row stays, switch off).

Not tested: the owner's phone (needs the owner's OK and the owner's own recording), screen-off
recording with the log on, a real microphone.
