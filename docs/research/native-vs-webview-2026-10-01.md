# Native vs. WebView on one core — emulator, 2026-10-01

User request: an honest side-by-side on the same core after the 120 Hz cap on the user's Xiaomi
turned out to be HyperOS remembering a 60 Hz limit per package name (both apps reach 120 Hz under
new ids, `org.med.spike` and `org.med.web`). Tool: `bun scripts/device-app-bench.ts` (native
`assembleBenchmark` build — release R8 with the query hook — and the WebView `assembleDebug` build as
users get it; 10 doctor-lookup queries × 3 reps; 20 scroll swipes on the result list).

Emulator `minimed_spike_120hz` (arm64, host GPU emulation), host heavily loaded (load average ≈ 10),
so absolute numbers are inflated for both; relative gaps are the point.

| | Native | WebView |
| --- | --- | --- |
| Cold start to first frame, median | 1.8 s | 3.7 s |
| Start to search ready, median | 52 s (core open + background index) | 28 s |
| Query to painted results, median / p95 | 3.25 s / 10.2 s (all 20 groups) | 0.32 s / 1.17 s (first 8 groups) |
| Scroll frame time p50 / p99 | 66 / 130 ms (vsync 16.7 ms) | 14 / 16 ms (vsync 8.3 ms) |
| Memory (PSS) after the session | 203 MB | 116 MB |

Notes:

- Query timing ends differently: native logs the frame after all result groups are composed, WebView
  stops when the first result group exists (8 visible). Both are «results on screen» for the user;
  even the third repetition shows native at 2–3 s against WebView's 0.25–0.4 s.
- The WebView search pipeline has had the per-document lexical window and catalog work since the
  2026-09-29 comparison (when native led, 1.07 s vs 1.8 s); the native port has not.
- Emulator scrolling is not representative of Compose on hardware: on the user's phone the native
  release scrolled at 9 ms p50 / 13 ms p99 frames. A real-device run of this script is the next check.
