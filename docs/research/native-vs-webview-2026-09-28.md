# Native (KMP/Compose) vs. WebView (Capacitor) search page — Xiaomi 14, 2026-09-28

Status: measurement in progress. This file is written directly (not committed) per the
coordinator's instruction; numbers below are filled in as each measurement pass completes.

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

## Environment

- Device: Xiaomi 14 "houji" (`23127PN0CC`), serial `dc9509b7`, HyperOS, Android 16 (API 36).
- Display: 1200×2670, up to 120 Hz (`renderFrameRate=120.00001`); confirmed live at measurement
  time — see `raw/display.txt`.
- Thermal status, battery level/charging state at measurement time — see `raw/device-state.txt`.
- adb `dc9509b7`; both apps measured back-to-back, same session, same charger/USB state.

## Query set (10 queries, from `tools/benchmarks/`)

`doctor-lookup-queries.json` (8) + `real-corpus-demo-queries.json` (2 short) — see
`native-vs-webview-2026-09-28.json` → `queries` for the exact list and ids.

## Methodology

1. **Cold start → first frame**: `adb shell am start -W -n <pkg>/<activity>` after
   `am force-stop`, `TotalTime` field. 5 runs each app.
2. **Cold start → "search ready"**: native reads its own logcat line
   (`MiniMedNativeSpike: search-ready tookMs=…`, wall-clock from `Activity.onCreate`). WebView is
   read via the Chrome DevTools Protocol: `adb forward` onto the app's
   `webview_devtools_remote_<pid>` abstract socket, poll
   `performance.getEntriesByName('minimed:search-ready')` (the exact mark
   `apps/app/src/app/use-app-session.ts` sets) until present; elapsed is wall-clock from the
   `am start` call, so it also includes first-frame time (i.e. it's a superset of metric 1, not
   independent of it) — noted explicitly in the table.
3. **Query latency, end-to-end**: WebView — CDP `Runtime.evaluate` sets the search input's value
   and dispatches a real `input` event (equivalent to typing, since Solid's binding listens for
   that DOM event), then polls the DOM for `.result-group`/`.result-card` elements to appear
   (stable BEM classes from `SearchWorkspace.tsx`). Native — the Compose UI's own debounced
   `LaunchedEffect` search path; end-to-end read off the on-screen "Итого: N мс" caption the app
   already renders (`SearchScreen.kt`), which times from keystroke to grouped-result state being
   set (excludes the following recomposition/paint frame, noted as a caveat).
4. **Query latency, SQL-only**: measured only for the **native** side
   (`SearchEngine.measureSqlOnlyMs`, shown on-screen as "SQL: N мс") — the exact same FTS5 MATCH
   expression, run through `androidx.sqlite`'s bundled driver. **Not measured for the WebView
   side**: its SQL runs through `net.zetetic:sqlcipher-android:4.17.0` (empty-key/plaintext mode,
   `apps/app/android/app/build.gradle`) via a Capacitor plugin bridge — a different engine build
   than the native spike's `androidx.sqlite-bundled`, so the native SQL-only number is *not* a
   stand-in for it. Isolating the WebView's own SQL-vs-bridge split would need instrumenting its
   TS/native plugin code, which was out of scope for this worktree (the coordinator's instruction
   limited worktree changes to the applicationId suffix and app name only). This is a known gap,
   not an oversight — flagged rather than papered over.
5. **Scrolling**: `dumpsys gfxinfo <pkg> reset` then `dumpsys gfxinfo <pkg> framestats` after a
   fling through (a) the result list for a broad query and (b) the longest available document
   (the core.db here is mostly a pointer/catalog corpus — 19,987 documents, 54,481 chunks, only
   ~15 are full clinical-recommendation/registry summaries; the longest by chunk count is used for
   the "long document" case, not a typical pointer document — see `raw/longest-document.txt`).
   Janky-frame % and p50/p90/p95/p99 vs. the 8.33 ms (120 Hz) budget.
6. **Memory**: `dumpsys meminfo <pkg>` TOTAL PSS after search-ready and after the 10-query loop.
7. **APK size**: on-device `pm path` + `stat` (installed/on-disk size), plus the build artifact
   size for reference.

## Results

_Filled in after the device unlocks and both apps are installed — see
`native-vs-webview-2026-09-28.json` for raw per-run numbers as they land._

### Cold start (median / p95 of 5 runs, ms)

| App | First frame (TotalTime) | Search ready (wall-clock incl. first frame) |
|---|---|---|
| Native (KMP/Compose) | TBD | TBD |
| WebView (Capacitor, v0.6.42 worktree build) | TBD | TBD |

### Query latency (median / p95 of runs across the 10-query set, ms)

| App | End-to-end | SQL-only |
|---|---|---|
| Native | TBD | TBD |
| WebView | TBD | not measured (see Methodology §4) |

### Scrolling (janky-frame %, p50/p90/p95/p99 vs. 8.33 ms)

| App | Scenario | Janky % | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| Native | Result list | TBD | TBD | TBD | TBD | TBD |
| Native | Long document | TBD | TBD | TBD | TBD | TBD |
| WebView | Result list | TBD | TBD | TBD | TBD | TBD |
| WebView | Long document | TBD | TBD | TBD | TBD | TBD |

### Memory (TOTAL PSS, KB) and size

| App | PSS after ready | PSS after 10 queries | APK size (bytes) |
|---|---|---|---|
| Native | TBD | TBD | TBD |
| WebView | TBD | TBD | TBD |

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
