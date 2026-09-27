# ADR-0021: Native search-page spike in Kotlin Multiplatform + Compose Multiplatform

- Status: spike / proposed
- Date: 2026-09-28

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
its exact ranking (see "What this spike does not reproduce" below). Only `androidTarget()` is
actually built and run; `native/shared/build.gradle.kts` documents inline, target by target, what
adding desktop/iOS/web would each require.

## Why Kotlin Multiplatform + Compose Multiplatform

- **One shared module, real native rendering everywhere it ships.** KMP's `expect`/`actual` puts
  the search/ranking logic once in `commonMain`, with Compose Multiplatform giving the same
  declarative UI code on Android, iOS, desktop (JVM) and web (Wasm) without a JS bridge or an
  embedded browser engine on any of them — the property this spike exists to test (is dropping the
  WebView actually faster).
- **FTS5 is a solved, guaranteed problem.** `androidx.sqlite`'s bundled driver ships its own SQLite
  build with FTS5 always enabled, independent of the OEM's system SQLite — the same reasoning
  `docs/adr/0018-bundled-android-sqlite-and-native-file-transfers.md` already used for the
  Capacitor app's native SQLite path. A KMP app gets this for Android and desktop for free; iOS has
  no equivalent artifact yet (see the iOS row below), which is a real gap, not a rounding error.
- **JVM/Android-first fits how this codebase already thinks about native code.** The Capacitor
  Android project is a normal Gradle/Kotlin project already (`apps/app/android`), on the same
  Gradle (8.14.3) and AGP (8.13.0) lineage this spike reuses. No new language runtime, packaging
  format, or CI toolchain family enters the repo.
- **Honest cost:** Compose Multiplatform's iOS and web (Wasm) targets are real but immature next to
  Android/desktop, and this Mac has no full Xcode install (`xcode-select -p` resolves to
  `CommandLineTools` only) — see the commented-out target blocks in
  `native/shared/build.gradle.kts` for exactly what iOS would need (full Xcode, a Kotlin/Native iOS
  SQLite binding with FTS5, an `iosApp` Xcode project) and what Wasm would need (no
  browser-native SQLite exists, so a Wasm target would end up calling back into the same
  wa-sqlite/OPFS engine `packages/storage-sqlite` already uses — not a native speed win at all for
  that target).

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
  (`docs/research/native-search-spike-2026-09.md`) are one input among several (also: cost of
  porting `search-lexical`, `MedicalCore` contracts, diaries/assessments/calculators, the ECG
  pipeline, and every other feature currently in `apps/app`, none of which this spike touches).
