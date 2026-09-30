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

The subsequent reference-search slice is qualified against all 23 complete ordered production
cards at requested limits 1, 20 and 200 (capped at 20). Description candidates remain bounded and
passage-local; opposing polarity and duplicate source links cannot create a combined match.
Whole-edition consent/install/offline restoration and wrong-edition rejection have executable
checks. The combined Desktop suite now passes 86 tests without skips, including unchanged lookup,
exact identity, original text and SQL oracles. Android lint and Android/Desktop/Wasm builds pass;
updated iOS Kotlin/test sources, device framework and actual Swift host compile/link.

Actual Desktop UI reaches block 17 and all seven pages of a 26,155-codepoint original block,
restores offset 24,576 after an offline process restart and returns to the same reference search.
On Android, the visible complete original page checksum matches the released pack; all three
ambiguous senses remain reachable, missing-definition status is explicit and all nine blocks
load across the second cursor page. These are owned emulator/Desktop profiles, not physical
Android or iOS runtime qualification.

Grey-background actions use the readable route foreground. Long-name cards keep their opening
action visible; the final identity card can align at the leading edge. A stable reader list keeps
focused controls mounted while text changes, and restores the text viewport after loading.

Additional evidence: `native-definition-search-verification.json`,
`native-reference-ui-full-results/`, `native-android-definition-verification.json`,
`native-reference-long-restored-offline.png` and `native-reference-ios-compile.log` in `playwright/`.

The Android follow-up also uses the actual Russian keyboard and verifies all seven complete
Unicode pages against the released pack, including offline restoration at offset 24,576.
Evidence: `native-android-reference-pages-verification.json` in `playwright/`.

Clinical lexical search and independent native settings/history are now qualified in
[native-clinical-user-2026-09-30.md](native-clinical-user-2026-09-30.md). Mounted scopes, hybrid
retrieval, remaining application features and production personal-data migration remain open.
