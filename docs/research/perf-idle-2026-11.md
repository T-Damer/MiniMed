# Idle CPU, screen switches and memory — November 2026 (STATE PERF6)

Owner 2026-11-11: «телефон греется при переходах и работе с функциями». Measured first, then fixed
by measured cost. Follows PERF5 ([perf-2026-11.md](perf-2026-11.md)), which measured start-up,
search and the reader; this one measures what the app does **while nobody touches it**, what a
**switch between screens** costs, and **memory over a navigation loop**.

## How it was measured

- **Script:** `apps/app/e2e/perf-idle.spec.ts` (not a gate; `PERF_IDLE=1`). Three tests:
  - *idle* — per screen, after it settles (`PERF_SETTLE_MS`, 5 s; 25 s for the settled rounds), an
    idle window (`PERF_WINDOW_MS`, 8 s): **CPU time of every browser process** (renderer, GPU /
    compositor, browser; `ps` over the process tree of the profile), main-thread task/script time,
    layouts and style recalculations (CDP `Performance.getMetrics`), **compositor frames drawn**
    (`DrawFrame` in a trace), timer and animation-frame callbacks by the place that scheduled them,
    network requests, endless animations still running, DOM nodes, heap.
  - *memory* (`PERF_LOOPS=n`, `-g memory`) — walk the 14 screens n times; heap after a forced GC,
    DOM nodes, listeners after each walk (`PERF_LOOP_DETAIL=1`: after each screen).
  - *switching* (`PERF_NAV=1`, `-g switching`) — after a first walk has mounted everything, the CPU
    of all processes and the main-thread work in the 2 s after each address change;
    `PERF_NAV_PROFILE=<screen>` profiles one switch (`PERF_PROFILE_OUT` saves the `.cpuprofile`).
  - `PERF_SCREENS=diaries,search` picks screens, `PERF_CSS='…'` adds a style rule to every page —
    an experiment («this part switched off») without a build.

  ```bash
  bun run build:app
  PERF_IDLE=1 PERF_THROTTLE=1 E2E_PORT=4291 bunx playwright test perf-idle -g idle --workers=1
  PERF_IDLE=1 PERF_NAV=1 E2E_PORT=4291 bunx playwright test perf-idle -g switching --workers=1
  PERF_IDLE=1 PERF_LOOPS=4 E2E_PORT=4291 bunx playwright test perf-idle -g memory --workers=1
  ```

- **Build, data, device:** the production build (`vite preview`), the profile `perf-baseline`
  fills (`playwright/perf-profile`: the real core in OPFS), Chromium headless shell (Playwright
  1.62.1) as a phone, 390×844 at 2.75×, on an M2 Max. **Process CPU is measured without CPU
  throttling**: CDP's 4× throttle costs ~800 ms of renderer CPU per second by itself, which hides
  everything else. Unit below: **CPU ms per second** of wall time (1000 = one core busy).
- **The phone** (owner's OK 2026-11-11): his Xiaomi 14 (HyperOS, 120 Hz, WebView Chrome 156) with the installed
  MiniMed **0.6.93 — the code before these fixes** (installing a new build was not part of the OK, so the phone has
  «before» numbers only; «after» comes from the Mac). Read over adb and CDP (`webview_devtools_remote_<pid>`, no
  typing): CPU ticks of the app process (its RenderThread draws the WebView), the WebView renderer and
  SurfaceFlinger from `/proc/<pid>/stat`, frames from `dumpsys gfxinfo`, main-thread time from CDP, skin
  temperature from `dumpsys thermalservice`. Scripts were kept out of the repository (ad hoc, read-only).
- The headless Mac GPU is software (SwiftShader); on the phone the same endless animations cost the app's draw
  thread and the system compositor instead (below).

## On the owner's phone (0.6.93, before the fixes; CPU ms per second, 1000 = one core)

Second walk (everything mounted), 15 s settle, 10 s window:

| screen | app (draw) | WebView renderer | SurfaceFlinger | frames/s | main thread ms/s | endless animation |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| search home | 1 072 | 217 | 416 | 240 | 45 | ECG trace |
| drug interactions | 1 128 | 325 | 443 | 240 | 51 | ECG trace |
| diaries (signed in, patient list) | 781 | 3 391 | 148 | 36 | 918 | garden sway, falling leaves |
| knowledge base | 1 190 | 2 499 | 279 | 210 | 811 | download spinners (an install was running) |
| files, calculators, ECG by photo, settings | 4–8 | 102–110 | 7–18 | 0 | 1–2 | — |

- The ECG trace alone keeps **about 1.5 cores** busy on an idle search home (draw thread + compositor at 240 frames a
  second as gfxinfo counts them); the diary garden **about 4** (120 style recalculations and 120 layouts a second,
  384 ms/s of main thread measured separately). Both are gone in this branch (Mac: 0 frames, 13–45 ms/s).
- Notes showed 870 ms/s of main thread right after the knowledge base and 2 ms/s when left alone: background work
  (a running install, the notes sync), not the screen.
- **Memory:** the WebView renderer held **1.9 GB PSS, 557 MB of it in compressed swap** (app process 317 MB); the JS
  heap read 622 → 1 020 MB over the walks (`performance.memory`, coarse). Swapping that much also costs CPU. Not
  investigated further (next steps).
- **Heat:** skin 36.1 °C before (another app in front) → 40.0 °C after ~9 min of MiniMed in front → 42.1 °C after
  ~15 min (USB-powered the whole time, which adds heat of its own).

## Ranked causes and fixes (by measured cost)

### Idle (nothing touched; CPU ms per second, two rounds each, settled 25 s)

| screen | before | after | what it was |
| --- | ---: | ---: | --- |
| diaries (sign-in / patient list) | 845 / 871 | 75 / 75 | the garden: 18 SVG leaves swaying forever (SVG child transforms are not composited: style + layout + paint 128× a second) under the sign-in card's `backdrop-filter: blur`, which the GPU re-blurred every frame (601 GPU ms/s) |
| search home | 151 / 159 | 44 / 34 | `PageHero`'s ECG trace drifting forever: 120 frames a second drawn (GPU 73–99 ms/s); the carousel's autoplay scroll |
| search home after visiting every screen | 155 / 185 | 28 / 34 | same |
| drug interactions, any page with the ECG band | 119–181 (at 5 s) | rests after 6 s | same trace |
| every other screen | 11–22 | 11–18 | timers only (frame-health 5 s, reminders 30 s) |

Final build, every screen, settled 25 s, one round (CPU ms/s · frames drawn per second): search home
45 · 10 (the carousel's autoplay while on screen), files 19 · 0, knowledge base 19 · 0, notes 15 · 0, diaries 19 ·
0, news 16 · 0, calculators 13 · 0, tests 16 · 0, ECG by photo 13 · 0, drug interactions 31 · 5, settings 19 · 0,
reader КР 714_2 13 · 0, search home after the loop 29 · 5. No endless animation runs on any of them. (Before, at
5 s settle: search home 199 · 120, diaries 896 · 120, drug interactions 181 · 120; the rest 14–146.)

Experiments on the diary screen (`PERF_CSS`, one part off at a time, CPU ms/s): all 885; sway off
855 (layouts 128 → 0/s); falling leaves off 993; sign-in logo/pulse off 751; **blur off 444**
(GPU 601 → 148). Search home: ECG off 269 → 80 (frames 120 → 5/s).

**Fixes:**

1. *Garden settles* (`diary-dashboard.css`): leaves sway twice and stop, loose leaves fall once,
   the sign-in logo and pulse play three times; the sign-in card has no backdrop blur (under a 94 %
   surface it barely showed). The garden still grows and sways on each visit (~10 s).
2. *ECG trace rests* (`components/PageHero.tsx`): it moves on arrival and while the doctor touches
   the app, and stands still 6 s after the last touch (pointer, key, wheel, input); a change of the
   app's frame health wakes it. Paused, it draws no frames.
3. *Carousel stops off screen* (`components/Carousel.tsx`): the autoplay timer runs only while the
   carousel intersects the screen; before, the search home's carousel advanced every 7 s behind
   every other tab (kept alive with `display: none`).
4. *CalmError's breathing art* plays four breaths and rests (an error screen left open).

### Switching screens (warm: every screen mounted; CPU ms in the 2 s after the address changes)

| screen | before | after |
| --- | ---: | ---: |
| reopen КР 714_2 in the reader | 3 830 (main thread 1 349) | 170 (53) |
| settings (right after the reader) | 1 100 | 240 |
| files | 899 | 330 |
| diaries | 1 750 | 1 650 |
| 14-screen walk, total | 12 219 | 6 980 |

**Cause:** `DocumentPageHost` rebuilt the **whole core** (`connectInstalledModules` → a new
`MedicalCore` → `warmUp()`: every search index again, ~1 s of main thread on the Mac, several on a
phone) whenever `getDocument` said «not found». In the measured profile five installed packs were
missing from OPFS, so every open of КР 714_2 rebuilt the core, found nothing new, and the next
open did it again. On a phone whose storage was cleaned the same loop would run on every document
open. **Fix:** rebuild only when the installed set changed since the current core was built
(`coreServesInstalledSet()`, `state/search-data-version.ts`); an install that has not reached the
core still gets its rebuild.

### Memory over a navigation loop

Heap after GC 180 MB at start → 340 MB after the first walk → +3.5 MB per further walk (344, 348,
352 after walks 2–4). Most of the first step is the first visit to «База знаний» (heap 180 → ~320
MB: the release catalog, parsed and validated). DOM nodes after GC: with one GC per walk they grew
6 000 per walk (9 k → 27 k), with a GC after every screen they stayed at ~3 000 over two walks —
garbage one collection did not reach, not a leak. Kept-alive screens hold ~1 000 attached nodes in
all (the reader's 48 k-node case from PERF5 is a long КР, not measured here).

## Left as they are (next steps, by size)

1. **Screen switches still cost 200–800 ms of CPU** each on the Mac (search home ~550, drug
   interactions ~790, knowledge base 560–830, diaries ~1 650 with the garden's intro). Every switch
   restyles the document 50–65 times; 24 `:has()` rules on `html`/`body`/`.app-shell` and one bare
   `html.ui-using-pointer :has(:focus-visible)` make every DOM change re-check the shell. Not
   profiled further here.
2. **«База знаний» first visit: +140 MB of heap** for the release catalog (PERF5 moved it out of
   start-up; it still loads whole on the first visit).
3. **Five installed packs missing from OPFS** in the measured profile: the registry says installed,
   the files are gone. The app now stops rebuilding the core for them, but nothing tells the doctor
   or repairs the install; a phone with a cleaned storage would show the summary instead of the
   full text.
4. **Phone «after» numbers** need this branch installed on the phone (the same adb/CDP reading).
5. **Renderer memory on the phone: 1.9 GB PSS, 557 MB swapped** — find what holds it (SQLite wasm heaps of the
   module workers, kept-alive readers, the catalog) with a heap snapshot over CDP.
