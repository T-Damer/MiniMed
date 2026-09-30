# Native exact identities and source definitions — 30 September 2026

This follows the first product slice. The native application is still a separate prototype;
the production WebView package and its personal data have not been replaced.

- Shared core reads all exact name senses from the released `13f238f…` core. Names are NFKC,
  case/ё and ECMAScript-whitespace normalized; punctuation, short names and stop words remain
  significant. Matching a name does not assert that different source identities are equivalent.
- The current `2026.9.30` definition edition is verified by its actual catalog tuple, encoded and
  decoded artifact hashes, schema 7, numeric link layout and 31,488-entry manifest. Future layouts
  are rejected explicitly. The adapter borrows the existing immutable SQLite owner.
- Original blocks retain their roles, exact source metadata and coordinates. Text uses eight-block
  cursors and 4,096 Unicode-codepoint pages; passages are neither summarized nor concatenated.
  Source-local/requires-review and needs-definition remain visible distinctions.
- Private schema 1 (including the producer's omitted default version) converts atomically to
  explicit schema 2, preserving installed editions, query, filtered catalog, ordered reader trail,
  anchors and positions. Unknown/malformed formats fail without resetting private data.
- UI and host Back share the current route's save callback. Save failure retains the route;
  semantic block/page changes save immediately, while viewport changes use the existing debounce.

Qualification: all 80 Desktop tests pass, with no skips. The existing 151 lookup queries and
206 SQL branches remain equal to the production pipeline. New oracles cover 259 exact-name
cases and 22 cards, 73 source blocks and 88 text pages; complete text/provenance/source hashes
match the actual `f3d5c…` reference pack. Tiny installation fixtures copy real numeric-layout
rows verbatim and exercise exact edition rejection and offline mixed reader trails.

An actual Android APK upgrade over the previous emulator profile preserves the installed registry,
query/list state, catalog filter, source target, chunk and pixel offset. This is emulator evidence,
not a physical-device pass. Current iOS device/simulator Kotlin and test sources compile, and the
device framework links; simulator runtime and full Xcode packaging are still unqualified.

Evidence lives in ignored `playwright/`: `native-identity-reader-verification.json`,
`native-identity-ui-full-results/`, `native-identity-ui-targets.log`,
`native-android-schema2-upgrade-verification.json` and `native-identity-ios-compile.log`.

Full reference description search, clinical/hybrid search, application features and production
personal-data migration are subsequent gates. The 23 reference-search and 85 lexical-clinical
oracles are prepared; fixture generation alone is not native runtime qualification.
