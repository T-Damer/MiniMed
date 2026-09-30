# Native clinical search and user state — 30 September 2026

The separate native application adds explicit clinical lexical search over the verified current
core. It preserves the production WebView application and its existing personal data.

All 85 production clinical cases match 152 extracted facts, 356 branches and 2,863 complete ordered
source passages: document/version/section/chunk identities, anchors, excerpts, highlights and
scores. Branch windows observe the actual production store calls, including branch terms, real
candidate limits and clinical diversification; 31 prior replayed windows were corrected without
changing final retrieval. All 151 lookup cases and 206 SQL branches remain unchanged. Clinical
analysis shares the existing vocabulary and SQLite owner. SQL timing sums actual SQL stages.

The UI exposes lookup/clinical selection, source-local facts and warnings, expandable branch and
calculation proposals, and real suggestion insertion. Exact-name cards remain lookup-only.
Cancellation/query/mode guards prevent a previous search from replacing the current result.
Opening a clinical passage preserves its exact original anchor; reader Back and offline restart
retain the mode, query and viewport.

Theme and text-size preferences and the last 40 completed searches use an independent validated
private file. Atomic writes publish state only after success. History records retrieval mode and
completion time, keeps newer entries during an older retry, and replays through the real core.
Confirmed clearing/deletion do not alter installed content. Unknown or damaged state fails without
resetting the file; failed pending writes remain visible and retryable. Settings are available
before medical-core download. Covered screens cannot retain underlay accessibility/focus or IME.

Qualification: 108 Desktop tests pass with no failures, errors or skips; Android lint and
Android/Desktop/Wasm builds pass. Actual Desktop checks exercise both themes, scale/restart,
history/replay/clear, clinical facts/negation/suggestions, rapid mode/query changes and an offline
restored clinical viewport. Actual owned Android emulator checks exercise settings/history and
clinical original opening, two-mode history, replay deduplication and package-only offline restart.
The Android clinical query uses the existing DEBUG hook with a public oracle case; mode/history
actions use the real UI. It is not a claim of typing that clinical case on a physical device.

Current iOS device/simulator Kotlin and simulator test sources compile; the device framework and
Swift host link. Full Xcode packaging and runtime qualification still require an installed iOS
simulator runtime. No physical Android or iOS runtime pass is claimed.

Evidence in ignored `playwright/`: `native-clinical-ui-build-verification.json`,
`native-clinical-ui-final-results/`, `native-clinical-ui-verification.json`,
`native-user-ui-verification.json`, `native-android-user-verification.json`,
`native-android-clinical-verification.json`, `native-branch-observation-verification.json`,
`native-clinical-user-ios-compile.log` and `native-clinical-user-ios-swift-host.log`.

Search still uses only the current core. Verified mounted modules/scopes, schema-driven tools,
rich original rendering, personal features and a qualified production-data migration remain open.
