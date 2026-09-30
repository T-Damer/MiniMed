# ADR-0021: Native search-page spike in Kotlin Multiplatform + Compose Multiplatform

- Status: spike / proposed — Android target measured on-device; desktop (JVM) and iOS
  (device + simulator) targets now genuinely build and pass tests; web (Wasm) target builds but is
  **not working** (stub data only, unresolved runtime error) — see the 2026-09-28 update at the
  bottom for what changed since this ADR's first version.
- Date: 2026-09-28 (updated same day after building desktop/iOS/web targets)

## Context

MiniMed ships today as a Capacitor + SolidJS WebView app (`apps/app`) over a SQLite core database
(`packages/storage-sqlite`, `apps/app/public/content/core.db`). The product invariant
(AGENTS.md: "Product invariant") requires the app to stay useful with no network, no LLM and no
hosted backend — the WebView already satisfies this, so the question this spike answers is purely
whether a native UI layer over the same on-device database would be faster and smoother than the
WebView for the app's single most latency-sensitive surface: search. It does not answer whether to
migrate the whole app; `docs/CURRENT_STATE.md` already names "native migration" as the next
planned step, and this spike is scoped input toward that decision, not the decision itself.

The coordinator chose the technology up front (Kotlin Multiplatform + Compose Multiplatform); this
ADR records why that choice is reasonable given the project's constraints and what alternatives
were set aside, plus the concrete build the spike produced.

## Decision (spike)

Build a standalone Gradle KMP project at `native/` (`native/shared` + `native/androidApp`),
untouched by and not touching `apps/`, `packages/`, `tools/`, or CI. It opens the *exact* released
`core.db` (pushed to the device, not bundled in git or the APK) directly with FTS5 via
`androidx.sqlite`'s **bundled** SQLite driver, so results and query latency are measured against
the same content and index the WebView app ships. The UI is a search field, a document-grouped
result list with title/section/snippet/kind badge, and a simple section reader — the same shape as
`apps/app/src/features/search/SearchHome.tsx` / `SearchWorkspace.tsx`, without attempting to copy
its exact ranking (see "What this spike does not reproduce" below). Originally only
`androidTarget()` was built; `native/shared/build.gradle.kts` now also declares `jvm("desktop")`,
`iosArm64()`/`iosSimulatorArm64()` and `wasmJs()` — see the 2026-09-28 update below for what
actually works on each.

## Why Kotlin Multiplatform + Compose Multiplatform

- **One shared module, real native rendering everywhere it ships.** KMP's `expect`/`actual` puts
  the search/ranking logic once in `commonMain`, with Compose Multiplatform giving the same
  declarative UI code on Android, iOS, desktop (JVM) and web (Wasm) without a JS bridge or an
  embedded browser engine on any of them — the property this spike exists to test (is dropping the
  WebView actually faster).
- **FTS5 is a solved, guaranteed problem — confirmed on 3 of 4 real-database targets.**
  `androidx.sqlite`'s bundled driver ships its own SQLite build with FTS5 always enabled,
  independent of the OS's system SQLite — the same reasoning
  `docs/adr/0018-bundled-android-sqlite-and-native-file-transfers.md` already used for the
  Capacitor app's native SQLite path. Its Gradle Module Metadata publishes `androidJvm`, `jvm`,
  `iosArm64` and `iosSimulatorArm64` variants with an identical Kotlin API, and this ADR's
  2026-09-28 update below confirms all three actually build, run their tests, and (for
  Android/desktop) execute real FTS5 queries — one `NativeSearchDatabase` implementation
  (`sqliteBundledMain`), not three. Web (Wasm) has no such artifact at all — see below.
- **JVM/Android-first fits how this codebase already thinks about native code.** The Capacitor
  Android project is a normal Gradle/Kotlin project already (`apps/app/android`), on the same
  Gradle (8.14.3) and AGP (8.13.0) lineage this spike reuses. No new language runtime, packaging
  format, or CI toolchain family enters the repo.
- **Honest cost, revised after actually building the other targets (was originally overstated
  here):** this machine turned out to have full Xcode 26.6 installed at `/Applications/Xcode.app`
  (reachable via a `DEVELOPER_DIR` env var, no `xcode-select` system change) — the original version
  of this ADR wrongly said otherwise from a plain `xcode-select -p` check, which only reflects the
  *default* CLI-tools pointer, not what's actually installed. iOS and desktop both turned out to
  work for real. Web is the one target where the original "immature/no browser SQLite" caution
  held up, and got worse in practice: even the UI-only stub build does not render at runtime in
  this environment (opaque `JsException`, root cause not found — see the update below). Compose
  Multiplatform's iOS/desktop maturity is no longer a documented concern here; its Wasm maturity
  still is, empirically, not just by inference from "no SQLite exists."

## Alternatives considered

- **Flutter.** Also one codebase, arguably more mature multi-platform rendering today (Skia on all
  platforms including iOS, no Xcode-only gap the way Compose iOS has). Rejected for this spike
  because its story for a *native, FTS5-guaranteed* SQLite binding is a third-party plugin
  (`sqlite3` FFI or `drift`), not a first-party Google/JetBrains artifact backed by the same team
  that ships the platform; and Dart is a second language family for a codebase that is
  TypeScript+Kotlin today, not TypeScript+Kotlin+Dart.
- **React Native (+ a native SQLite module, e.g. `op-sqlite` or `expo-sqlite`).** Reuses the
  team's TypeScript skill and possibly some `packages/search-lexical` code verbatim — a real
  advantage this ADR does not dismiss. Rejected for *this* spike specifically because the question
  being measured is "does dropping the WebView's JS engine/DOM help", and RN still runs the search
  logic and (in old architecture) bridge traffic through a JS engine (Hermes) — the New
  Architecture's JSI narrows this gap, but the UI tree is still not native views by default the way
  Compose's is. A future RN spike would be a fair follow-up, not a redundant one.
- **Lynx / Valdi (ByteDance's native-rendering, web-authored UI engines).** Interesting precedent
  for "write once, render as real native views," but neither has JetBrains/Google-grade Android+iOS
  SQLite/FTS5 tooling, first-party Kotlin/Swift interop, or the maturity/support horizon a
  single-maintainer offline-first medical app should bet infrastructure on. Not investigated
  further beyond this note.
- **Plain native (separate Android Kotlin/Views + Swift/SwiftUI apps, no shared layer).** Would
  remove all cross-platform risk above but means writing and maintaining the ranking/search logic
  twice per platform — directly against the "smallest complete vertical slice" and single-owner
  reality of this codebase. Not chosen for that reason alone.

## Constraints from AGENTS.md this ADR exists to satisfy

- AGENTS.md forbids "adding Rust, Tauri, Postgres, Docker, telemetry, or a backend... without a
  dedicated ADR." Kotlin/Gradle is not literally on that list, but the spirit — a new toolchain
  family entering the repo — applies, and this ADR is that dedicated sign-off, scoped to
  `native/`, a spike, and Android only.
- **No backend, offline-first stays true.** The native app opens the same on-device `core.db` the
  WebView reads; it adds no network calls, no server, no telemetry.
- **Source provenance is preserved, not reprocessed.** The spike reads `documents`/`sections`/
  `chunks`/`aliases` as they already exist in the released pack; it performs no re-extraction,
  summarization or "same-as" linking of any kind (Medical source policy, "no silent substitution").
- **Private data.** `core.db` (~423 MB) is never committed to git and never bundled into the APK
  (`ignoreAssetsPattern` already excludes it in `apps/app/android/app/build.gradle`, matching in
  spirit); it is pushed to the device out of band and documented below.

## What this spike does and does not reproduce

The web app's lexical ranking (`packages/search-lexical/src/analysis.ts`, ~2200 lines) does
multi-branch query planning, alias-branch corroboration/dilution, bounded-Levenshtein typo
correction, clinical intent detection, and medication-specific handling. Porting all of that to
Kotlin was explicitly out of scope for a spike (task instructions: "you cannot port the whole TS
ranking; document exactly what differs"). `native/shared/.../text/TextNormalization.kt` ports only:
NFKC+lowercase+ё→е+dash-unification normalization, tokenization with the same stop-word list,
and the same light Russian suffix stemmer — then builds a single-branch FTS5 `MATCH` expression
(`token* OR stem* OR ...`) expanded with exact-alias canonical terms from the `aliases` table,
ranked by SQLite's `bm25()` with column weights approximating title > section path > body text.
Not ported: ICD-10 Cyrillic-lookalike remapping, fuzzy/typo token matching, and everything in
`analysis.ts` beyond that. **Consequence: result-quality/ranking comparisons between the two apps
from this spike are not meaningful — only latency, SQL-engine time, scrolling, memory and size
are.** Any later decision to ship a native search page for real would need to either port
`analysis.ts` to Kotlin or share it through a KMP-compiled core (a much larger undertaking than
this spike), not ship the simplified matcher built here.

## Consequences

- A `native/` Gradle project now exists alongside the Bun/TS workspace, deliberately not wired into
  either. It has its own `gradlew`/`local.properties`/`gradle.properties` and is not part of
  `bun run check`/`typecheck`/`test`/`build` or any CI job.
- If a future ADR decides to actually migrate off Capacitor, this spike's measurements
  (`docs/research/native-vs-webview-2026-09-28.md`) are one input among several (also: cost of
  porting `search-lexical`, `MedicalCore` contracts, diaries/assessments/calculators, the ECG
  pipeline, and every other feature currently in `apps/app`, none of which this spike touches).

## Update, 2026-09-28: desktop/iOS/web targets actually built (not just estimated)

A same-day follow-up request asked whether one codebase could really build for web, Android, iOS
and desktop, and asked for the native side to be tested. Full results, exact commands, and every
error hit (and fixed or not) are in `docs/research/native-vs-webview-2026-09-28.md`, "Multiplatform
build and tests" — summary:

- **Android, desktop (JVM), iOS (device + simulator): all real.** One shared `commonTest` (18
  tests: text normalization, FTS5 MATCH-expression building, snippet-highlight formatting) passes
  identically on all four run targets (`testDebugUnitTest`, `desktopTest`, `iosSimulatorArm64Test`,
  and — see below — `wasmJsBrowserTest`). Both iOS frameworks (`linkDebugFrameworkIosArm64`,
  `linkDebugFrameworkIosSimulatorArm64`) link successfully, 51 MB each (unstripped debug). Desktop
  produces a working 48 MB runnable uber-jar (`packageUberJarForCurrentOS`); the polished DMG
  installer task (`packageDistributionForCurrentOS`) fails on this machine specifically because it
  only has Homebrew-distributed JDKs, which Compose Desktop's own packaging safety check refuses on
  principle (a known upstream issue, not something to silently bypass).
- **A genuinely useful finding from actually testing on iOS**: the original `TextNormalization.kt`
  used `Regex` with a Cyrillic character-class range (`[^0-9a-zа-я...]`). On Kotlin/Native this
  silently matched nothing for Cyrillic text — `normalizeSurfaceText("Менингит у ребёнка")` returned
  `""` — while the identical code was correct on Android/desktop/wasmJs. This would have shipped
  invisibly in an Android-only build; it surfaced immediately once `iosSimulatorArm64Test` actually
  ran. Fixed by replacing the regex character class with plain `Char in 'а'..'я'` range checks
  (ordinary UTF-16 arithmetic, no regex-engine Unicode-class behavior left to diverge between
  platforms). This is the single best argument in this whole ADR for testing on every declared
  target rather than assuming Kotlin "write once" extends to correctness.
- **Web (Wasm) does not have a working SQLite story, confirmed rather than assumed.**
  `androidx.sqlite-bundled`'s own Gradle Module Metadata lists no `wasmJs`/`js` variant at all,
  matching this ADR's original reasoning. `NativeSearchDatabase`'s wasmJs actual is an explicit
  stub (one fixed sample document) and the running UI shows a red banner saying so in Russian —
  never silently substituting fake data for real. Beyond that, the wasmJs build has its own
  separate, unresolved problem: even that stub UI does not render at runtime in this environment.
  `wasmJsBrowserDistribution`/`...DevelopmentExecutableDistribution` both build a valid bundle, and
  `wasmJsBrowserTest` (Karma + headless Chrome) passes all 18 logic tests, but loading the actual
  page in a real Chrome 152 browser produces a blank screen and an opaque
  `JsException: Exception was thrown while running JavaScript code` with no further stack
  reachable from JS — checked and ruled out: wrong MIME types, missing
  `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers, and production-build
  minification (the unminified development build fails identically). Root cause not found within
  this pass's time budget; recorded as open, not worked around or hidden.
- **Practical conclusion for "one codebase, four platforms":** the *domain logic and UI code* are
  genuinely one codebase now (`commonMain`/`commonTest`, unchanged per platform). The *SQLite
  engine* is shared across three of four run targets through one `sqliteBundledMain` source set.
  Web is the one target that is not there: no real data access is possible with this dependency,
  and even the UI-only shell does not demonstrably run yet. "Web, Android, iOS, desktop from one
  codebase" is accurate for Android/iOS/desktop today and aspirational, not delivered, for web.

## Update, 2026-09-30: lookup qualification and real desktop reader checks

The lookup pipeline now ports the source lookup branch instead of the initial single-branch
approximation described above. This qualifies the measured lookup path for the subsequent native
product port, which starts after the final WebView release. Clinical analysis and the complete
native product remain separate work.

The regenerated fixture uses the final source-ID-restored `core.0.6.45.db`, SHA-256
`13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f`. Its 151 committed queries
return 2,905 groups and 6,156 passages. The desktop gate asserts all 151 ordered group lists and
all 151 ordered passage lists: document kind, scores, chunk/document/version/section IDs, source
anchors, actual snippets, matched terms and UTF-16 highlight ranges. Scores use a `1e-6` numeric
tolerance; order and source fields require equality. All 151 final query plans and all 206 SQL
branch hit sequences also match. The tests fail on any mismatch; they no longer merely count the
queries or accept the earlier 148/150 group agreement. The final fixture SHA-256 is
`22725017037a50155f6d3b48782acda861d4bb8a9078a01a5fd324f2cadd3f84`.

The port includes query-aligned source snippets, presentation-row selection, known HTML cleanup,
NFKC offset mapping, ICD normalization, spelling branches and the bounded lookup candidate window
(4x overfetch, at most three chunks per document version). A title or an actual excerpt must
corroborate the query subject; `matchedTerms` and section paths cannot substitute for source text.
The ordinary age-qualified lookup additionally respects explicitly opposing child/adult scope in
source titles. Generic or combined-age titles remain neutral, and clinical analysis keeps its
existing ranking. This restores the 10-case doctor lookup MRR from .55 to its .60 baseline, with
recall@5 .70 and forbidden-free rate 1. The 85-query clinical benchmark still passes its unchanged
baseline. Focused TypeScript ranking tests pass 41/41.

The final desktop suite passes 38 tests, including strict pipeline parity, 1,741 RapidFuzz cases,
query-aligned snippets, population guards and the real `LookupEngine.search` presentation adapter.
The raw alias-expansion diagnostic remains 150/151 because that stage excludes the medication
spelling suggestions added by the full lookup plan; the full plan's alias/branch/term gate is
151/151. These are distinct stage measurements, not a relaxed full-pipeline assertion.

Actual desktop search and reader screens were inspected in the current dark system theme through
an owned `.app` bundle built with the existing Compose `createDistributable` task. A command-only
`compose.desktop.packaging.checkJdkVendor=false` allowed the installed Homebrew JDK to produce this
temporary bundle. It was removed after inspection. Source snippets visibly highlight the queried
phrase, and selecting a passage opens the original reader at its source section. Clinical and
medication pointers keep the pipeline's classified kind instead of being relabelled from the raw
`core_catalog_pointer` source type. Their labels now match the six-kind web presentation contract.
The UI adapter test verifies those kinds and reader anchors against actual pipeline results.

These visual checks used the immutable historical `0.6.44` release core, SHA-256
`d0797f8c33e7d1050831d8ff02958f49b9f30f10335f716ac3fe287407e1572a`; its bytes remained unchanged
after opening and closing the app. They do not claim that the screenshots use the upcoming release
fixture. Evidence is in `playwright/native-kind-clinical-dark.png`,
`playwright/native-kind-medication-dark.png`, `playwright/native-reader-dark.png` and
`playwright/native-desktop-visual-verification.json`. Both themes pass the text-role contrast test
at 4.5:1 or higher; only the current dark theme was visually inspected. Rapid replacement of the
first query showed the current query's results without a false error. The UI exposes no loading
indicator, so this check does not establish an internal loading-state transition or the exact
index-initialization phase when replacement occurred.

After the final ranking and presentation changes, Android shared Kotlin, desktop app Kotlin,
Wasm shared Kotlin, iOS device and simulator shared Kotlin, and iOS simulator test Kotlin all
compile. Strict runtime parity was executed on desktop. This machine currently has no installed
iOS simulator runtime (only watchOS 26.5), so the earlier 2026-09-28 iOS execution remains historical
evidence; no current iOS runtime pass is claimed. Android runtime parity was not rerun in this
qualification. Wasm still has a stub database and no newly verified working product runtime.
Final counters, source guards and command results are recorded in
`playwright/native-lookup-parity-verification.json` and `playwright/native-age-final-targets.log`.

The next native slice still needs a UI-independent core/ports boundary, verified app-private core
bootstrap, catalog/cache decoding, exact module target membership and readable-document checks,
durable install/rollback state, and reader navigation/position restoration. The current spike
accepts an externally supplied database, keeps navigation in composition memory and reads the
reader directly through `NativeSearchDatabase`. It does not yet replace the WebView's download
manager, source selection, user storage, personal files, assessments, calculators, diaries, ECG
or model flows. The 151-query parity gate also does not establish equivalence for clinical
analysis or every possible lookup phrasing; the existing unported treatment-failure title-boost
handling remains a documented lookup edge outside this fixture.
