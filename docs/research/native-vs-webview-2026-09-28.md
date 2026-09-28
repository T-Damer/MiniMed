# Native (KMP/Compose) vs. WebView (Capacitor) search page — Xiaomi 14, 2026-09-28

Status: measurement pass complete for what time allowed — native side is solid (cold start ×5,
one query timing, scroll framestats, memory, size, plus a full multiplatform build/test pass and a
web-visual-parity restyle); WebView side is partial (cold start ×5 and one memory/size reading
landed; query latency, scrolling and post-query memory did not, blocked by a real emulator OOM —
see Environment). This file is written directly (not committed) per the coordinator's instruction.

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

## Caveats (read before drawing conclusions)

- Both APKs are debug-signed; production R8/ProGuard behavior for the WebView app and true
  production JS minification/bundle-splitting differences are not represented identically for
  both (native's build type does apply R8; whether it was used for the measured run is stated in
  the results section above, not assumed here).
- The native spike's search matcher is a deliberately simplified single-branch FTS5 matcher (see
  ADR 0021, "What this spike does and does not reproduce"); result-quality is not comparable
  between the two apps, only latency/rendering.
- SQL-only timing is only available for the native side (see Methodology §4).
- The "search ready" wall-clock measurement is not independent of the "first frame" measurement
  for either app (it is measured from the same `am start` invocation), so don't subtract one from
  the other expecting a clean "post-first-frame core-init time" — that would need a per-app
  first-frame timestamp from inside the process, which neither app currently emits.
- Corpus shape: this core.db is predominantly a pointer/catalog corpus, not a large body of full
  guideline text — the "long document" scroll scenario used the longest available document, which
  is still short relative to what a document-heavy corpus release would contain.
- **The WebView side of this report is materially incomplete.** Query latency, scroll/framestats,
  post-query memory, and a wall-clock search-ready number all failed to land for WebView because
  of the emulator OOM described above. What *is* solid for WebView: 5 cold-start TotalTime runs,
  one PSS reading (pre-query), and APK size. Do not read the query-latency/scrolling tables as
  "native wins" by default — WebView's numbers are missing, not bad.
- Query latency and scrolling numbers overall rest on very small sample counts (n=1 for the query
  timing breakdown, two swipe batches for scrolling) given how much of this pass's time went into
  diagnosing the HyperOS input block, the emulator heap OOM, and the mid-session restyle. Treat
  every number in this file as directional, not a settled benchmark result.
- Input methodology: every query in this report was submitted programmatically (CDP for WebView,
  a debug broadcast receiver for native), never via real typing or touch — see Methodology §3.
  `adb shell input swipe` was used for scrolling (real synthetic touch, works identically for both
  apps on the emulator), but note its sparse point-interpolation (Methodology §5) before trusting
  the frame-time percentiles too far.
