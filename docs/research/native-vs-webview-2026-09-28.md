# Native (KMP/Compose) vs. WebView (Capacitor) search page — Xiaomi 14, 2026-09-28

Status: **complete for both apps, including stage 4 (full pipeline).** The WebView OOM described
below was root-caused and fixed by the coordinator on `main` (`ff006d84 fix(storage-capacitor):
read the navigation catalog in 1024-document pages` — `CapacitorMedicalStore.listNavigationDocuments`
was returning the whole catalog, ~13M characters of metadata projection in one plugin response, in
one shot; now paginated 1024 documents at a time). WebView was rebuilt from that commit in a second
worktree and re-measured — see "Post-fix measurements" below, which superseded the earlier partial
WebView numbers for query latency, scrolling and post-query memory. **2026-09-29 update**: native's
UI now runs the *full* ported lexical pipeline (stage 2A–2D: `buildLookupQueryPlan`, SQL branch
execution, fusion/grouping/ranking, `QueryDocumentIndex`) instead of the stage-1 simplified
single-branch matcher, and WebView was rebuilt again from current HEAD `main` (`4db077a4`) — see
"Stage 4: full pipeline measurements" below, which does **not** supersede "Post-fix measurements"
(that section's native numbers are the old simplified-matcher baseline, kept for the
before/after comparison) but supersedes it as the *current* apples-to-apples native-vs-WebView
comparison. This file is written directly (not committed) per the coordinator's instruction.

## What is being compared

- **Native spike**: `native/androidApp` (`dev.localmed.nativespike.debug`), Kotlin Multiplatform +
  Compose Multiplatform, opens `core.db` directly via `androidx.sqlite` bundled SQLite driver
  (FTS5). See `docs/adr/0021-native-search-spike-kmp.md` for what its search matcher does and does
  not reproduce from the web app's ranking.
- **WebView**: Capacitor + SolidJS, built from git tag `v0.6.42` in a disposable worktree
  (`git worktree add --detach <scratchpad>/wt-0642 v0.6.42`), **not** the officially-signed GitHub
  release APK. Reason: the phone already has `dev.localmed.search` 0.6.39 installed signed with a
  released CI key; 0.6.42's GitHub release asset is signed with a *different* ephemeral CI
  debug key, so `adb install -r` over the existing app fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Uninstalling the existing app to make room was explicitly
  ruled out (it is the user's own installed instance; the task rules also say "uninstall nothing
  of the user's"). Instead this worktree's `apps/app/android/app/build.gradle` has one
  worktree-local, **uncommitted** change: `buildTypes.debug { applicationIdSuffix ".perf" }` (plus a
  debug-variant-only `app_name` string override for on-screen identification), so it installs as
  `dev.localmed.search.perf` next to the existing app without touching it. Everything else
  (`bun run build:app`, `bun run native:sync:android`, `gradlew assembleDebug`) mirrors
  `.github/workflows/public-pilot-android-release.yml` exactly; the CI-only verification/content
  steps (`bun run verify`, `benchmark:queries:*`, `content:rebuild:regulatory`) were **not** rerun —
  they gate whether a build is release-worthy, they don't change the built APK, and
  `content:rebuild:regulatory` specifically risks changing `core.db` away from the exact byte
  content this comparison depends on.
- **core.db**: byte-identical on both sides. Verified: local
  `apps/app/public/content/core.db` sha256 `d0797f8c33e7d1050831d8ff02958f49b9f30f10335f716ac3fe287407e1572a`
  matches the v0.6.42 release's `DB-SHA256.txt` exactly (the coordinator separately confirmed
  0.6.41→0.6.42 shipped no core.db change). The worktree build symlinks this same file rather than
  copying it.

## Multiplatform build and tests (2026-09-28, while the phone was disconnected/locked)

User request mid-spike: "one codebase should build for web, Android, iOS, desktop" and "the native
side needs tests, write them up." `native/shared` now declares `androidTarget()`, `jvm("desktop")`,
`iosArm64()`, `iosSimulatorArm64()` and `wasmJs()` alongside the Android app from checkpoint 1, plus
a `commonTest` source set. All Gradle invocations below use JDK 21
(`native/gradle.properties`'s pinned `org.gradle.java.home`, same as checkpoints 1–2) and, for iOS,
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` set **only as an env var for these
Gradle invocations** — this machine has full Xcode 26.6 installed (not just Command Line Tools, as
ADR 0021 originally and incorrectly assumed), reached without changing the system-wide
`xcode-select` pointer, which would be a system-settings change this session does not make.

### What's shared vs. platform-specific

- **`commonMain`** (all 5 targets): the domain logic (`text/TextNormalization.kt`,
  `text/SnippetSegments.kt`, `text/FormatMs.kt`, `model/`, `search/SearchEngine.kt`) and the entire
  Compose UI (`ui/App.kt`, `SearchScreen.kt`, `ReaderScreen.kt`, `Theme.kt`) — one implementation,
  not one per platform.
- **`sqliteBundledMain`** (new intermediate source set, depended on by `androidMain`, `desktopMain`,
  `iosMain`): a *single* `NativeSearchDatabase` actual (moved verbatim from checkpoint 1's
  Android-only file) shared by Android, desktop and iOS. This works because `androidx.sqlite`'s
  Gradle Module Metadata (checked directly:
  `curl .../androidx/sqlite/sqlite-bundled/2.6.2/sqlite-bundled-2.6.2.module`) publishes
  `androidJvm`, `jvm`, `iosArm64` and `iosSimulatorArm64` variants with an identical Kotlin API —
  there was nothing platform-specific left to write per target. (Pinned to **2.6.2**, not 2.7.1:
  2.7.1's iOS klib was built with a newer Kotlin compiler ABI (2.3.20) than this project's Kotlin
  2.2.10 can read — see "What broke" below. 2.6.2 is also what `apps/app/android` itself already
  pins for `androidx.sqlite:sqlite`, so this is now consistent with the real app, not a new drift.)
- **`wasmJsMain`**: its own `NativeSearchDatabase` actual, but a deliberate **stub**, not a real
  database — see "Web has no real SQLite" below.
- Per-platform app shells: `androidApp` (checkpoint 1), new `desktopApp` (Compose Desktop `Window`),
  and `wasmJsMain`'s own `main.kt` (`ComposeViewport`). iOS has no app shell yet, only the linked
  framework (see the iOS row below) — a real iOS app would still need an `iosApp` Xcode project
  embedding it, out of scope for this pass.

### Test/build results by target

| Target | Command | Result | Notes |
|---|---|---|---|
| commonTest logic | `:shared:desktopTest` | **PASS** — 18/18 | Fastest way to run `commonTest` (plain JVM, no emulator/simulator) |
| Android | `:shared:testDebugUnitTest` | **PASS** — 18/18 | |
| Android app | `:androidApp:assembleDebug` | **PASS** | Debug APK 17,910,064 bytes (up from checkpoint 1's ~15.3 MB — shared module grew) |
| Desktop (JVM) | `:shared:desktopTest` | **PASS** — 18/18 | Same 18 tests as Android/iOS/wasmJs — one `commonTest`, five run targets |
| Desktop packaging (DMG) | `:desktopApp:packageDistributionForCurrentOS` | **FAILED — stopped, not worked around** | Compose Desktop's `checkRuntime` task refuses to jpackage with a Homebrew JDK ("may cause issues with packaging", [compose-multiplatform#3107](https://github.com/JetBrains/compose-multiplatform/issues/3107)); this machine has only Homebrew JDKs (21, 26), no Temurin/Corretto/Zulu. The escape hatch is `compose.desktop.packaging.checkJdkVendor=false`, which was **not** set — bypassing a known-issue safety check to force a possibly-broken installer isn't the same as it working. |
| Desktop runnable jar (fallback) | `:desktopApp:packageUberJarForCurrentOS` | **PASS** | 48,175,748-byte fat jar. Actually launched: `java -jar ... ` with `MINIMED_CORE_DB=<real core.db>`, process stayed alive 6s with an empty stderr/stdout log (no exceptions), killed cleanly. No attached display in this session for a screenshot, so "opens a window" is inferred from a clean process lifecycle, not seen directly — stated as a limit, not glossed over. |
| iOS Simulator tests | `:shared:iosSimulatorArm64Test` | **PASS — 18/18, after fixing a real bug this run found** | See "What broke" below |
| iOS Simulator framework | `:shared:linkDebugFrameworkIosSimulatorArm64` | **PASS** | `shared.framework`, 51 MB (unstripped debug) |
| iOS device framework | `:shared:linkDebugFrameworkIosArm64` | **PASS** | Also 51 MB; both linked in the same run, ~2m8s combined |
| Web (wasmJs) tests | `:shared:wasmJsBrowserTest` | **PASS — 18/18** | Karma + headless Chrome; Kotlin's tooling downloads its own Node.js (required loosening `settings.gradle.kts`'s repo mode — see "What broke") |
| Web (wasmJs) production build | `:shared:wasmJsBrowserDistribution` | **Builds, but NOT verified working — do not read this as "web works"** | 14 MB (`index.html` + `shared.js` + 2 `.wasm` files, ~11.5 MB combined). Loaded in a real Chrome 152 browser (this session's Browser pane) via a local static server (127.0.0.1-bound, both with and without `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers): the page stays blank and the console logs a bare `JsException: Exception was thrown while running JavaScript code` with no further stack reachable from JS (checked: MIME types correct, both prod and dev/unminified builds fail identically, not a COOP/COEP cross-origin-isolation issue). Root cause not found within this spike's time budget. |

### Web has no real SQLite — by design, not by oversight

`androidx.sqlite-bundled` publishes no `wasmJs`/`js` variant at all (same Module Metadata check as
above — only android/jvm/ios/linux/macos/tvos/watchos). There is no browser-native SQLite either.
`NativeSearchDatabase.wasmJs.kt` is therefore an explicit, loudly-commented **stub** returning one
fixed sample document; `NativeSearchSpikeApp` takes a `demoNotice: String?` parameter and the wasmJs
`main.kt` passes a red banner reading (in Russian) "WEB DEMO: no real core.db (no SQLite engine in
the browser, see ADR-0021). Fixed test data shown." — every other platform passes `null` and shows
no banner. This satisfies the instruction not to present a stub as finished, both in code comments
and in the running app's own UI, independent of whether the runtime issue above gets fixed.

### What broke (and what that's worth knowing)

1. **A real, previously-undetected cross-platform bug**, found by actually running the tests on
   iOS: `TextNormalization.kt`'s original implementation used `Regex("[^0-9a-zа-я\\s.,:+/%-]")` — a
   character class with a Cyrillic range. On Kotlin/Native (iOS) this silently dropped every
   Cyrillic character (`normalizeSurfaceText("Менингит у ребёнка")` returned `""`), while the exact
   same code was correct on Android/desktop/wasmJs (JVM's and V8's regex engines both handle the
   `а-я` range correctly; Kotlin/Native's apparently did not, at least at this Kotlin version).
   6 of 18 tests failed with this. Fixed by replacing the regex-based charset filter and tokenizer
   with plain `Char in 'а'..'я'` range comparisons (`isKeepableChar`/`isTokenChar` in
   `TextNormalization.kt`) — ordinary UTF-16 code-unit arithmetic, nothing regex-engine-specific
   left to diverge. All 18 tests then passed identically on all 4 real targets (Android, desktop,
   iOS, wasmJs). This is exactly the kind of bug "test on every platform" is supposed to catch, and
   it would have shipped silently in an Android-only spike.
2. **`"%.1f".format(x)`** (`kotlin.text.format`) is JVM-only — doesn't exist on Kotlin/Native or
   Kotlin/Wasm. Replaced with a small hand-rolled `formatFixed1` in commonMain
   (`text/FormatMs.kt`).
3. **`androidx.sqlite-bundled:2.7.1`'s iOS klib requires a newer Kotlin compiler** (ABI 2.3.20) than
   this project's Kotlin 2.2.10 can read (`KLIB resolver: ... incompatible ABI version`).
   Downgraded to 2.6.2 (see above) rather than bumping the whole project's Kotlin/Compose
   Multiplatform/AGP versions to chase it — that cascades into the same compileSdk-37 wall ADR 0021
   already avoided for the Android target.
4. **Compose Multiplatform 1.9.3's `wasmJs { }` needs `@OptIn(ExperimentalWasmDsl::class)`**, and
   `ComposeViewport(...)` needs `@OptIn(ExperimentalComposeUiApi::class)` — both genuinely
   experimental APIs, opted into explicitly rather than suppressed globally.
5. **Root `native/build.gradle.kts`'s hand-written `clean` task collided with the wasmJs target's
   own `NodeJsRootPlugin`**, which applies Gradle's `base` plugin (and its own `clean` task) to the
   root project the first time any `wasmJs` task runs. Removed the hand-written one; the plugin's
   does the same thing.
6. **`native/settings.gradle.kts`'s `RepositoriesMode.FAIL_ON_PROJECT_REPOS`** blocked the Kotlin/JS
   tooling from adding its own ivy repository (`nodejs.org/dist`) to fetch a Node.js distribution
   for `wasmJsBrowserTest`. Relaxed to `PREFER_PROJECT` (tried `PREFER_SETTINGS` first — still
   blocked it, since the project repo is added by plugin-internal code outside Gradle's normal
   repository-declaration tracking).
7. **`desktopApp`'s `jvmToolchain(17)`** triggered Gradle's toolchain auto-provisioning, which
   isn't configured for downloads and found no standalone JDK 17 (only 21 and 26 exist on this
   machine). Removed — compiling with whatever JDK the Gradle daemon already runs on (21, pinned)
   is fine for a desktop-only spike app.

## Build provenance caveat

Both builds compared here are **debug-signed**, not production-signed:
- WebView: local `gradlew assembleDebug` of the `v0.6.42` tag — the same task CI runs
  (`Assemble debug-signed APK` step), same Gradle/AGP/JDK. APK size ≈100,974,348 bytes vs. the
  officially released 100,971,608 bytes (the ~2.7 KB difference is the added debug-only
  `app_name` resource + a different local debug-keystore signature block, not a code difference).
- Native: `native/androidApp` debug build (see ADR 0021); a "release-like" R8-minified build type
  exists in `native/androidApp/build.gradle.kts` but debug-signed only — no production signing key
  is available in this environment either way.

Neither app in this comparison is what end users actually run (a Play/production-signed release);
treat every number below as directional, not a production SLA.

## Environment — two, not one (user decision after the input-injection blocker)

**Physical device: Xiaomi 14 "houji"** (`23127PN0CC`), serial `dc9509b7`, HyperOS, Android 16
(API 36), 1200×2670, up to 120 Hz. Cold-start numbers only (see below) — HyperOS returns
`SecurityException: Injecting input events requires ... INJECT_EVENTS permission` for
`adb shell input tap/text/keyevent`, blanket, confirmed on all three subcommands. That blocks
typed queries and swipe/fling entirely; the toggle that would fix it
("Отладка USB (настройки безопасности)" in Developer Options) is a device security setting this
agent does not change itself, and the user chose not to wait for it.

**Emulator: local AVD `minimed_spike_120hz`**, `system-images;android-36;google_apis;arm64-v8a`,
config.ini set to 1200×2670 @ 480 dpi (matching the Xiaomi 14's panel) and `hw.lcd.vsync=120`,
`-gpu host`, no network exposure beyond the host. `adb shell input` works normally here (no
HyperOS-style block), so queries and scrolling are driven the same way for both apps — see
Methodology below. Confirmed **120 Hz active**, not just nominal: `dumpsys display`'s
`renderFrameRate` defaulted to `60.000004` even though `vsyncRate=120.00 Hz` was already active in
SurfaceFlinger (Android's per-app render-frame-rate policy caps new AVDs at 60 by default); fixed
with `adb shell settings put system peak_refresh_rate 120.0` / `min_refresh_rate 120.0`, after
which `renderFrameRate` read `120.00001` — checked before every framestats run.

Absolute numbers from the emulator are **not** the Xiaomi 14's real-world numbers (host Apple
Silicon GPU via `-gpu host`, not the phone's Adreno/whatever, and Android's own CPU emulation
overhead even on arm64-v8a). They are useful for the *native vs. WebView* comparison because both
apps ran on the identical emulator instance, back to back, same session.

### A second, real blocker found on the emulator: WebView OOMs on broad queries

`dev.localmed.search.perf`'s Capacitor plugin bridge (`LocalMedDatabasePlugin.query`,
`apps/app/android` — not touched, out of scope to fix) serializes an entire query result to one
JSON string before sending it to JS. For a broad query like "менингит" that allocation is
**~71.8 MB in one shot**, which throws `OutOfMemoryError` against this AVD's default per-app
Dalvik heap-growth-limit of 192 MB (`dalvik.vm.heapgrowthlimit`) — confirmed as the exact ceiling
(`target footprint 170483104, growth limit 201326592` in every crash). Tried and did **not** work:
`config.ini`'s `vm.heapSize`, `adb shell setprop dalvik.vm.heapgrowthlimit` after boot (zygote
already had the old value), and `-prop dalvik.vm.heapgrowthlimit=512m` at emulator launch (the
density-class default still won for this specific property, even though the sibling
`-prop dalvik.vm.heapsize=768m` did take effect, confirmed via `getprop`). Not fixable without
either modifying `apps/app` (declaring `android:largeHeap`, out of scope) or a full custom system
image. **Consequence**: WebView query-latency and scroll-after-query numbers below are
incomplete — documented as a gap, not silently skipped or faked. Whether the real Xiaomi 14 (a
flagship with a materially higher stock heap ceiling) would hit this at all is unverified, since
HyperOS blocked input before this scenario was ever reached there.

## Query set (10 queries, from `tools/benchmarks/`)

`doctor-lookup-queries.json` (8) + `real-corpus-demo-queries.json` (2 short) — see
`native-vs-webview-2026-09-28.json` → `queries` for the exact list and ids.

## Methodology

1. **Cold start → first frame**: `adb shell am start -W -n <pkg>/<activity>` after
   `am force-stop`, `TotalTime` field. 5 runs each app, **on both** the phone and the emulator.
2. **Cold start → "search ready"**: native reads its own logcat line
   (`MiniMedNativeSpike: search-ready tookMs=…`, wall-clock from `Activity.onCreate`). WebView is
   read via the Chrome DevTools Protocol: `adb forward` onto the app's
   `webview_devtools_remote_<pid>` abstract socket, poll
   `performance.getEntriesByName('minimed:search-ready')` (the exact mark
   `apps/app/src/app/use-app-session.ts` sets); confirmed present (the mark fires) but a fully
   wall-clock-correlated number (device `performance.timeOrigin` vs. the host's `am start`
   timestamp are different clock domains) was not completed within this pass's time budget — see
   Results.
3. **Query latency, end-to-end — driven programmatically, not by touch/keyboard, on purpose.**
   `adb shell input text` cannot type Cyrillic at all — confirmed directly:
   `adb shell input text "менингит"` throws `NullPointerException` inside
   `InputShellCommand.sendText` (it maps characters through the current `KeyCharacterMap`, which
   has no entries for Cyrillic on a stock US layout; ASCII input, e.g. `"test123"`, works fine and
   was verified separately). So neither app's query latency could be measured via real typing
   regardless of the HyperOS/emulator input-injection question. Both apps are instead driven via a
   programmatic side-channel that bypasses the keyboard/IME entirely, analogous on each platform:
   - **WebView**: CDP `Runtime.evaluate` sets the `<textarea>` search field's value via its native
     property setter and dispatches a real `input` event (Solid's binding listens for that DOM
     event, so this exercises the same reactive path typing would), then polls the DOM for
     `.result-card` elements.
   - **Native**: a debug-only `BroadcastReceiver` added to `native/androidApp`'s `MainActivity`
     only (never `apps/app`), triggered via
     `adb shell am broadcast -a dev.localmed.nativespike.BENCH_QUERY --es query "<text>"`; it sets
     the same `query` state a keystroke would (`SearchScreen`'s new `externalQuery` parameter),
     and timing is captured from broadcast-received to two consecutive `withFrameNanos` callbacks
     after the resulting `outcome` is set (the first is where Compose schedules recomposition for
     the new state, the second guarantees that recomposition was actually measured/laid
     out/drawn), logged as `MiniMedNativeSpikeBench: query="…" sqlMs=… searchFnMs=… totalToFrameMs=…`.
   Explicitly **not** a touch-driven or IME-driven measurement for either app — stated once here,
   applies to every query-latency number below.
4. **Query latency, SQL-only**: measured only for the **native** side
   (`SearchEngine.measureSqlOnlyMs`, logged as `sqlMs=…` above) — the exact same FTS5 MATCH
   expression, run through `androidx.sqlite`'s bundled driver. **Not measured for the WebView
   side**: its SQL runs through `net.zetetic:sqlcipher-android:4.17.0` (empty-key/plaintext mode,
   `apps/app/android/app/build.gradle`) via a Capacitor plugin bridge — a different engine build
   than the native spike's `androidx.sqlite-bundled`, so the native SQL-only number is *not* a
   stand-in for it. Isolating the WebView's own SQL-vs-bridge split would need instrumenting its
   TS/native plugin code, out of scope for this worktree (limited to the applicationId suffix and
   app name). Made moot in practice anyway by the OOM above for most real queries.
5. **Scrolling**: `dumpsys gfxinfo <pkg> reset` then, on the emulator only,
   `adb shell input swipe <x1> <y1> <x2> <y2> <durationMs>` repeated (15–20×) over the loaded
   result list, then `dumpsys gfxinfo <pkg> framestats`. Note on `input swipe` itself: it
   interpolates a fixed, small number of intermediate touch-move points regardless of the duration
   argument — it does **not** sample continuously at the display's refresh rate the way a real
   finger does, so a single swipe call yields only a handful of rendered frames; repeating it many
   times was necessary to get a frame count large enough for a meaningful percentile. Janky-frame %
   and p50/p90/p95/p99 are against the 8.33 ms (120 Hz) budget, confirmed active beforehand (see
   Environment).
6. **Memory**: `dumpsys meminfo <pkg>` TOTAL PSS after search-ready (WebView: after cold start,
   before the OOM-triggering query — see Environment).
7. **APK size**: on-device `pm path` + `stat` (installed/on-disk size), plus the build artifact
   size for reference.

## Results

Raw numbers: `native-vs-webview-2026-09-28.json`. Every emulator number below is from the
**web-styled native UI** (see "Web visual-parity restyle" below) unless marked "(simple UI)" —
the coordinator asked to remeasure after restyling specifically because a more complex UI changes
frame cost, so the styled numbers are the ones that matter for the comparison; the plain-UI pass
was only ever exploratory (n=1, not a formal 5-run set) before the restyle request arrived
mid-session, and is kept only where it's the only data point available.

### Cold start — device (Xiaomi 14, real hardware)

| App | First frame (TotalTime, ms) | Search ready (ms, wall-clock from Activity start) |
|---|---|---|
| Native, simple UI (n=1, exploratory) | 1032 | 652 |
| WebView | not measured — input-injection blocker (see Environment) hit before this step |

### Cold start — emulator, web-styled native UI (5 runs each, ms)

| App | TotalTime: median | TotalTime: p95 | TotalTime: all 5 runs |
|---|---|---|---|
| Native | 1802 | 2056 | 1917, 1469, 1802, 2091, 1586 |
| WebView | 1645 | 1897 | 1938, 1426, 1506, 1645, 1676 |

Native's own `search-ready` (wall-clock from `Activity.onCreate`, includes DB open + warm-up
query) for the same 5 styled-UI runs: 939, 964, 931, 1151, 1338 — median 964 ms, p95 ≈1298 ms.
WebView's `performance.mark('minimed:search-ready')` was confirmed present via CDP but a
wall-clock-correlated number was not completed in this pass (see Methodology §2) — not fabricated,
left blank.

### Query latency (single representative broad query, "менингит" — ~20 result groups)

| App | UI | SQL-only (ms) | App-side compute (ms) | End-to-end to painted frame (ms) |
|---|---|---|---|---|
| Native | simple (n=1, first query post-cold-start, likely JIT-inflated) | 28.8 | 106.2 | 612.3 |
| Native | web-styled (n=1) | 21.4 | — | 171.3 |
| WebView | any | not measured — OOM on this query (see Environment) before a timing signal returned |

Only one query ("менингит") got a clean native reading before time ran out for the full 10-query ×
multiple-rep sweep the original plan called for — the single native styled-UI number (171.3 ms
end-to-end, 21.4 ms SQL) is consistent with the simple-UI SQL number (21–29 ms) but noticeably
faster end-to-end, plausibly because it's a warm run (not the first query after cold start) rather
than because of the UI change; not enough samples to separate those two effects. WebView's number
is entirely absent, not a small/rounded one — every attempt on this query OOM'd (see Environment).

### Scrolling (emulator, web-styled native UI, `input swipe` × repeated — see Methodology §5)

| App | Frames captured | Janky % (>8.33 ms) | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| Native, result list (15 swipes) | 250 | 27.6% | 21 ms | 32 ms | 48 ms | 81 ms |
| Native, result list (20 swipes, separate run) | 428 | 7.7%¹ | 16 ms | 25 ms | 31 ms | 48 ms |
| Native, long document | not measured — ran out of time before the reader-scroll pass |
| WebView, result list | not measured — OOM on every query that would populate the list to scroll |
| WebView, long document | not measured (same reason, and no reader-open path tried yet) |

¹ Two separate swipe batches on the same running instance gave meaningfully different janky%
(27.6% vs. 7.7%) — `dumpsys gfxinfo` accumulates since the last `reset`, and the first batch's
window likely still included some settling/recomposition frames right after the broadcast-driven
query set the list content, despite the 2 s wait before `reset`. Read both as "the emulator's
software-path scroll is measurably above the 8.33 ms/120 Hz budget most of the time," not as a
precise single number — a real fling-gesture driver (continuous samples, not `input swipe`'s
sparse interpolation) would be needed for a trustworthy percentile.

### Memory (TOTAL PSS) and size

| App | PSS after search-ready (KB) | APK size, on-device build artifact (bytes) |
|---|---|---|
| Native (web-styled) | 69,805 (~68 MB) | 17,910,064 (~17.1 MB) |
| WebView | 198,205 (~194 MB), before any query | 100,974,348 (~96.3 MB) |

Native's memory footprint is ~2.8× smaller and its APK ~5.6× smaller than WebView's, measured on
the same emulator instance back to back. "PSS after 10 queries" for WebView could not be measured
(OOM on the first real query); native's PSS above is after search-ready only, not after a query
loop either, for a fair like-for-like comparison at this stage — a queried-state PSS pair remains
future work.

## Web visual-parity restyle (2026-09-28, after the emulator measurement pass started)

Mid-session request: the native port's UI should look like the web app, not a plain Material
scheme, so the scroll/frame comparison is against a UI of comparable visual complexity. Scope,
strictly `native/shared` `commonMain` (same look on every KMP target, per the request) — nothing in
`apps/app` was read for behavior, only for **values**: colors and type tokens copied from
`apps/app/src/styles/theme.css` (light) / `theme-dark.css` (dark), spacing from
`search-home-intro.css`'s `--home-gap` (16 px baseline), and card structure from `global.css`'s
`.result-card`/`.category-stamp`/`.result-path`/`.document-text__paragraph` rules. Exact hex values
and the full token list are documented in `native/shared/.../ui/Theme.kt`'s own header comment.

- **Fonts**: the web theme's `--font-serif` (`Georgia, "Times New Roman", Times, serif`) and
  `--font-mono` (a bundled Cascadia Code, `@font-face` in `theme.css`) are not embedded in this
  spike — no font-licensing/bundling work was done for a measurement spike. Headings/body use
  `FontFamily.Serif` (platform serif — Noto Serif on this Android build) and labels/badges use
  `FontFamily.Monospace` (platform monospace, not Cascadia Code specifically); recorded as a
  stated substitution, not silently passed off as the real fonts.
- **What changed**: `Theme.kt` (full color/typography rewrite), `SearchScreen.kt` (search field
  becomes a rounded card on `--theme-search-surface` with a visual-only "Все источники" pill and
  "Клинический разбор" label — no logic behind either, exactly as scoped — and result cards switch
  from Material `Card`/filled chip to flat `--theme-surface-raised` panels with a bordered mono
  "category stamp" and uppercase mono section-path line), `ReaderScreen.kt` (serif body text at
  the web reader's line-height ≈1.7, paper background).
- **Screenshots**: `<scratchpad>/screens/` — `native-styled-home.png` and `native-styled-results.png`
  (this build, emulator, 1200×2670 @480dpi) next to `webview-home-375-reference.png` (a separate
  session's real web capture at 375 CSS px, provided by the coordinator) and
  `webview-results-reference.png` (this session's own real `dev.localmed.search.perf` build,
  "менингит" query, same emulator/device pixel density as the native screenshot — the more
  apples-to-apples pairing of the two). Not committed; paths are local to this machine's scratchpad.
- **Honest gap**: the coordinator asked for native-vs-web screenshots at matched 375dp width
  specifically; what's here is native at its native device density next to two different
  reference sources (one CSS-375px, one same-density real web) rather than one precisely
  width-matched pair — a `resize_window`-to-375-equivalent pass on the native emulator screenshot
  was not done before time ran out.

## Post-fix measurements (2026-09-28, WebView rebuilt from `ff006d84`)

**Build**: same recipe as the `v0.6.42` worktree build (Methodology unchanged) but a fresh
`git worktree add --detach <scratchpad>/wt-headfix ff006d84` (HEAD `main`, includes the pagination
fix) instead of the tag. Same `applicationIdSuffix ".perf"`/app-name worktree-only change, same
`core.db` (byte-identical, re-verified by symlink + sha256). `pm path`/`dumpsys` confirm it
installed **in place** over the previous `.perf` build (same `dev.localmed.search.perf` package,
`versionCode 56`, `versionName 0.6.43-perf`) — app data (including the already-downloaded core
pack) carried over, so this is a warm reinstall, not a fresh first-run.

**The fix works**: ran the full "менингит" query and the entire 10-query set below with zero OOMs
— not one crash across 50+ query submissions and 200+ scroll gestures. Confirmed via `pidof`
staying constant and an empty `logcat` grep for `OutOfMemoryError`/`FATAL` throughout.

**Two measurement-methodology bugs found and fixed while running this pass** (noted for anyone
reusing these scripts):
1. The Welcome/onboarding overlay (`.first-run-setup__start`) covers the real search page on every
   cold start until dismissed — CDP's `document.querySelector('.result-card')` from the earlier
   pass was polling a *different*, decorative demo widget inside that overlay (it has its own fake
   `<textarea>`), never the real one, which is why nothing was ever found. The real result
   selector is `.result-group-header` (confirmed against live DOM, not just static CSS reading).
   Fixed by dismissing the overlay via CDP (`document.querySelector('.first-run-setup__start')
   .click()`) once per cold start before driving any query.
2. `adb shell am broadcast --es query "<multi-word Cyrillic>"` silently mis-parsed: passing the
   query as a separate array element to `subprocess.run`/adb's own arg handling let the *remote*
   shell re-split it on spaces (`клещевой энцефалит у ребенка` arrived as `pkg=энцефалит` — visible
   directly in the broadcast's own echoed `Intent{...}` line). Single-word queries ("менингит")
   never showed this. Fixed by building the whole `am broadcast ...` invocation as **one**
   pre-quoted string passed to `adb shell` , not multiple argv elements.

### Query latency, end-to-end (all 10 queries × 5 reps, CDP-driven, submit → first `.result-group-header`)

| App | n | Median (ms) | p95 (ms) | Min | Max |
|---|---|---|---|---|---|
| WebView | 49 (1 cold-start timeout excluded) | 1481 | 3470 | 988 | 6305 |
| Native | 47 (3 of 50 broadcasts missed — see caveat) | 325.5 | 461.4 | 219.1 | 563.3 |

Native SQL-only (same 47 samples): median 17.4 ms, p95 31.2 ms. Native is **~4.5× faster at the
median, ~7.5× faster at p95** for the same queries against the same `core.db`, same emulator,
same session. WebView's numbers include its Capacitor plugin bridge (JSON serialize/deserialize
across the JS↔native boundary) and Solid's reactive re-render; native's is Compose state → two
`withFrameNanos` frames — see Methodology §3 for exactly what each measures.

### Scrolling (5 runs each, 20 `input swipe` gestures per run, reset before each — see Methodology §5)

| App | Janky % (Android's own threshold, not 120Hz) — all 5 runs | Median | p50, median (ms) | p90, median | p95, median | p99, median |
|---|---|---|---|---|---|---|
| Native | 43.07, 7.09, 4.66, 8.37, 4.02 | 7.09% | 16 | 28 | 32 | 44 |
| WebView | 35.82, 51.85, 52.11, 31.88, 37.99 | 37.99% | 29 | 48 | 69 | 121 |

Native's run 1 (43.07%) is a clear outlier — same pattern as the earlier pass (first scroll after
a fresh query pays for cold layout-cache/JIT, subsequent runs settle to ~4–8%); WebView had no such
outlier, its five runs cluster in a narrower 32–52% band instead. Reading the medians only: native
scrolling is janky about 1 frame in 14, WebView about 1 frame in 2.6, against Android's own jank
threshold (not the stricter 8.33 ms/120 Hz budget — Android's `dumpsys gfxinfo` jank flag uses a
fixed internal deadline that does not appear to adapt to 120 Hz; every p50 above (16–36 ms) already
exceeds 8.33 ms, so under a strict 120 Hz budget both apps are "janky" on most frames — the
comparison that matters here is native-vs-WebView, not either app against a 120 Hz ideal).

### Memory (TOTAL PSS) after the query+scroll session

| App | PSS (KB) | vs. native |
|---|---|---|
| Native | 70,359 (~69 MB) | 1× |
| WebView | 114,349 (~112 MB) | 1.6× |

(WebView's post-query PSS is *lower* than the earlier pre-query/pre-fix reading of 198,205 KB from
the buggy build — consistent with the fix: that build was holding a ~13M-character catalog
response in memory even to reach "search ready", the paginated version doesn't.)

## Stage 4: full pipeline measurements (2026-09-29)

**What changed since "Post-fix measurements"**: `native/androidApp`'s UI now calls
`LookupEngine.search()` (`native/shared/.../search/LookupEngine.kt`), which runs
`runLookupPipelineGroups` — the complete stage 2A–2D port (alias/RapidFuzz-expanded lookup-query
plan, two-phase bm25 SQL branch execution, hydration, fusion, grouping, `QueryDocumentIndex`
exact-identity lookups) — instead of stage 1's deliberately simplified single-branch FTS5 matcher
(`SearchEngine.kt`, left in the tree unreferenced). `LookupEngine`'s constructor builds
`QueryDocumentIndex` and the alias vocabulary once, mirroring `create-medical-core.ts` caching the
same structures for the real app; `MainActivity` builds this on `Dispatchers.IO` before declaring
the app ready and logs the elapsed time as `indexBuildMs`, separately from first-frame time, so
this real startup cost (paid once by the WebView pipeline too) is never silently absorbed into a
falsely-fast native cold-start number.

**WebView side**: rebuilt from current HEAD `main` (`4db077a4`, includes everything from the
`ff006d84` pagination fix through `test(e2e): settle races...`) in a fresh `wt-headfix` worktree,
same `applicationIdSuffix ".perf"` worktree-local patch, same `core.db` (sha256
`d0797f8c33e7d1050831d8ff02958f49b9f30f10335f716ac3fe287407e1572a`, re-verified byte-identical).
`bun run build:app` failed with `SyntaxError: Export named 'parseEnv' not found in module 'util'`
— a Bun 1.2.3 `node:util` polyfill gap (missing Node 21.7+'s `util.parseEnv`), not a project-code
regression (confirmed: `bun.lock` unchanged between the old and new commit). Per AGENTS.md's
documented Node-fallback allowance, `tsc` and `vite build` were invoked directly via real Node
(Homebrew, v26.7.0) in a sanitized env instead of through `bun run`; `cap sync android` and
`./gradlew assembleDebug` (JDK 21 pinned, as for all Gradle work this session) were unaffected —
`assembleDebug` never goes through Bun, and `cap sync` ran fine directly via Node too. Installed
in place over the existing `.perf` build (same package/versionCode/versionName).

Both apps ran their full 10-query × 5-rep sweep and 5×20-swipe scroll session with **zero OOMs and
zero crashes** — the `ff006d84` pagination fix holds on current HEAD.

### Cold start (5 runs each, ms)

| App | TotalTime: median | TotalTime: p95 | TotalTime: all 5 runs |
|---|---|---|---|
| Native | 768 | 900 | 740, 900, 759, 859, 768 |
| WebView | 777 | 853 | 700, 814, 853, 777, 721 |

Native's own `search-ready` (wall-clock from `Activity.onCreate`, includes `dbOpenMs` +
`indexBuildMs`): median 4254 ms, p95 4863 ms (all 5: 4020, 4441, 4101, 4863, 4254). Of that,
`indexBuildMs` (building `QueryDocumentIndex` + the alias vocabulary over the whole ~20k-document
corpus) is the large majority: median 3856.6 ms, p95 4338.9 ms; `dbOpenMs` median is only 429 ms.
**Building the full-pipeline index is roughly 5–6× native's own first-frame TotalTime** — a real,
substantial startup cost the stage-1 matcher never paid. WebView's `performance.mark`
(`minimed:search-ready`) is confirmed present via CDP (3724.3 ms from the page's own
`performance.timeOrigin`) but still not wall-clock-correlated to `am start`'s clock domain — the
same documented gap as the prior pass, not resolved this time either.

### Query latency, end-to-end (10 queries × 5 reps, n=50 each, zero missed, zero OOM)

| App | Median (ms) | p95 (ms) | Min | Max |
|---|---|---|---|---|
| Native, full pipeline | 2114.6 | 2357.5 | 1890.2 | 2380.9 |
| WebView | 707.6 | 972.1 | 629.2 | 2427.4 (cold-JIT outlier, rep 1 of query 1) |

**This reverses the stage-1 conclusion.** Stage 1's simplified single-FTS5-query native matcher
was ~4.5× *faster* than WebView (325.5 ms vs. 1481 ms median). The full ported pipeline is now
~3× *slower* than WebView (2114.6 ms vs. 707.6 ms median). `LookupEngine`'s internal pipeline time
(`pipelineInternalMedianMs` = 1964.6 ms, tracked across all 50 samples, not a one-off) accounts for
almost all of the end-to-end number, so the cost is inside `runLookupPipelineGroups` itself —
RapidFuzz alias/medication-spelling fuzzy matching over the whole alias vocabulary per query, plus
multiple SQL branch executions (bm25 + hydration each) and Kotlin-side fusion/grouping/ranking —
none of which existed in the stage-1 matcher. No attempt was made to optimize this hot path (e.g.
RapidFuzz scans the full alias list with no early-exit/pre-filter); that is legitimate follow-up
work if this port is kept, not a claim made here that it already performs adequately.

### Scrolling (5 runs, 20 swipes each, strict >8.33 ms / 120 Hz budget — per this stage's explicit instruction, not Android's own looser jank threshold)

| App | Janky % (all 5 runs) | p50 median | p90 median | p95 median | p99 median |
|---|---|---|---|---|---|
| Native | 100, 100, 100, 100, 100 | 21.8 ms | 39.3 ms | 43.2 ms | 57.8 ms |
| WebView | 100, 100, 100, 100, 100 | 27.4 ms | 41.9 ms | 42.6 ms | 49.2 ms |

Under this stricter budget both apps are "janky" on essentially every frame (expected: 8.33 ms is a
demanding target for either a Compose or WebView software-composited scroll on an emulator). Native
is modestly ahead at the median (~1.26× faster) but the gap is far smaller than the Android-own-
threshold numbers in "Post-fix measurements" suggested (7.09% vs. 37.99% janky there) — that
comparison used a looser, non-refresh-rate-aware definition of jank; this one uses the budget the
coordinator explicitly asked for this stage.

### Memory (TOTAL PSS) after the query + scroll session

| App | PSS (KB) | vs. native |
|---|---|---|
| Native, full pipeline | 136,567 (~133 MB) | 1× |
| WebView | 120,836 (~118 MB) | 0.88× |

**This also reverses the stage-1 conclusion** (native was ~1.6× *smaller* then: 70,359 vs.
114,349 KB). The full pipeline's `QueryDocumentIndex` (built from all ~20k documents) plus the
complete alias vocabulary, held in memory for the whole process lifetime, is the likely cause; not
root-caused further within this pass's time budget — stated as a real cost of the full port, not
glossed over. Two earlier same-session readings (140,400 KB; 124,684 KB from a stale/backgrounded
process) are consistent with a 120–140 MB band, not a one-off spike.

### APK size (unchanged conclusion)

| App | Bytes | vs. native |
|---|---|---|
| Native | 15,591,021 (~14.9 MB) | 1× |
| WebView | 104,363,895 (~99.5 MB) | 6.7× |

Native is still much smaller — the full pipeline port added Kotlin/JVM code, not new native
dependencies or assets.

### Honest conclusion for stage 4

Porting the full lexical pipeline into the native spike was necessary for an honest comparison —
the stage-1 matcher's single FTS5 query was never representative of what the real app actually
does per search — but doing so **erased or reversed every native performance advantage** stage 1
reported except APK size and (barely) cold start and scroll p50. Cold start is roughly tied.
Query latency and post-session memory now favor WebView. This is not a reason to believe WebView
"won": the native port's hot path has had zero optimization work (RapidFuzz over the full alias
list per query is the obvious first target), and the comparison still is not fully like-for-like
(WebView's own SQL runs through a different engine build via a Capacitor plugin bridge, per the
original Methodology §4 caveat, unchanged). But the honest, current state is: **a straight port of
the existing TypeScript pipeline into Kotlin, unoptimized, is not faster than the shipped WebView
app on this emulator** — the coordinator's original framing ("if faster/smoother — keep it") does
not yet have a "faster" result to point to for query latency or memory; only cold start and scroll
p50 show a (modest) native edge.

### Methodology notes specific to this stage

- The same multi-word-Cyrillic `adb shell am broadcast` re-split bug documented in "Post-fix
  measurements" was re-encountered (and re-fixed) while capturing an ad hoc post-session PSS
  reading, this time from a manually-typed one-off command that passed `--es query "<text with
  spaces>"` as separate shell argv elements instead of one pre-quoted string. This is not a bug
  that gets fixed once in a script and stays fixed — any new invocation built the naive way will
  hit it again.
- The native app being process-alive but backgrounded (a different app in the foreground) silently
  prevented its Compose `LaunchedEffect`/`withFrameNanos` callbacks from firing at all: a broadcast
  sent while backgrounded reports `result=0` (success) but produces no bench log until the app is
  brought back to the foreground. Worth knowing before trusting a "missed" count from an unattended
  run.
- Query latency and scrolling raw numbers: `native-vs-webview-2026-09-28.json` →
  `stage4FullPipeline`.

## Caveats (read before drawing conclusions)

- Both APKs are debug-signed; production R8/ProGuard behavior for the WebView app and true
  production JS minification/bundle-splitting differences are not represented identically for
  both (native's build type does apply R8; whether it was used for the measured run is stated in
  the results section above, not assumed here).
- The native spike's search matcher is a deliberately simplified single-branch FTS5 matcher (see
  ADR 0021, "What this spike does and does not reproduce"); result-quality is not comparable
  between the two apps. Query latency is not a pure platform comparison either: the WebView app
  runs the full `MedicalCore` per query (analysis, alias expansion, several FTS branches, fusion,
  grouping and document metadata), the spike one FTS query. The end-to-end query ratio is an upper
  bound on what a native UI alone would gain; porting the same pipeline would narrow it. Rendering,
  scroll frame times, memory and APK size are the like-for-like part of this comparison.
- SQL-only timing is only available for the native side (see Methodology §4).
- The "search ready" wall-clock measurement is not independent of the "first frame" measurement
  for either app (it is measured from the same `am start` invocation), so don't subtract one from
  the other expecting a clean "post-first-frame core-init time" — that would need a per-app
  first-frame timestamp from inside the process, which neither app currently emits.
- Corpus shape: this core.db is predominantly a pointer/catalog corpus, not a large body of full
  guideline text — the "long document" scroll scenario used the longest available document, which
  is still short relative to what a document-heavy corpus release would contain.
- **Update: the WebView OOM gap above is closed** — see "Post-fix measurements". Query latency
  (n=49), scrolling (5 runs), and post-query PSS all landed for WebView on the fixed build. The one
  number still not wall-clock-correlated for WebView is `search-ready` (mark confirmed present via
  CDP, timestamp not correlated to the host clock — Methodology §2); everything else in this
  bullet list is now resolved and should be read against the "Post-fix measurements" tables, not
  the earlier partial ones.
- The cold-start numbers (5 runs each app) are from the **pre-fix** `v0.6.42` WebView build; the
  pagination fix touches only the navigation-catalog query path, not app boot, so re-running cold
  start on the fixed build was not considered necessary and wasn't done — flagged in case that
  assumption turns out wrong.
- Query latency and scrolling sample counts: native query latency lost 3 of 50 broadcast attempts
  to a `LaunchedEffect` re-key edge case (identical query text sent on a non-adjacent rep doesn't
  always re-fire — see Post-fix measurements); WebView lost 1 of 50 to a cold-start timing race.
  Neither is corrected for; both are treated as honest attrition, not resampled to hit exactly n=50eap OOM, and the mid-session restyle. Treat
  every number in this file as directional, not a settled benchmark result.
- Input methodology: every query in this report was submitted programmatically (CDP for WebView,
  a debug broadcast receiver for native), never via real typing or touch — see Methodology §3.
  `adb shell input swipe` was used for scrolling (real synthetic touch, works identically for both
  apps on the emulator), but note its sparse point-interpolation (Methodology §5) before trusting
  the frame-time percentiles too far.
- **2026-09-29: read "Stage 4: full pipeline measurements" as the current native-vs-WebView
  comparison, not this section or "Post-fix measurements".** Those two sections' native numbers
  are the stage-1 simplified single-branch matcher, since superseded by the full pipeline port;
  they remain here only as the explicit before/after baseline the "Stage 4" section's own
  "Honest conclusion" paragraph compares against.
