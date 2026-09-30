# ADR-0022: Port the application to Kotlin Multiplatform and Compose

- Status: accepted target; implementation and release qualification in progress.
- Decision: user request, 29–30 September 2026, after the last published WebView release.
- Supersedes the spike-only scope of [ADR-0021](0021-native-search-spike-kmp.md).

## Decision

Continue the existing `native/` KMP project into the Android/iOS/Desktop application. Keep the
SolidJS browser application operational. Shared native UI calls typed MedicalCore operations;
core owns retrieval, exact source navigation and content lifecycle. SQL, HTTP, filesystem and
platform services remain behind adapters. Use the existing bundled SQLite driver and platform
streaming/checksum/compression APIs; add no backend or model requirement.

The released immutable core and module indexes remain authoritative. Preserve exact source
identities, editions, raw checksums, anchors, paragraphs and provenance. An inventory or pointer
is not proof of readability. Experimental reference identities remain source-local and subject
to review; matching names never establishes a clinical same-as relation.

Port existing features in verified vertical slices. Keep the working retrieval and source reader
usable while later slices are implemented. Do not introduce placeholder feature controls that
claim clinical analysis, personal storage or tools already work. Native Wasm is a separate
unqualified prototype; it does not replace the functioning browser.

## Release gates

- Cross-language fixtures compare real released corpus queries, exact identity ambiguities,
  branch execution, ranking, excerpts and source navigation. Lookup parity alone does not qualify
  clinical, hybrid or semantic search.
- Source install/cancellation/retry, offline operation, Back, reading/list restoration and
  light/dark contrast are exercised through actual target applications.
- Existing assessment/calculator schemas, interpretations, personal features and native platform
  integrations must retain their contracts; newly ported medical behavior needs its existing
  meaningful domain checks.
- A production Android package replacement requires a verified, data-preserving migration of
  WebView preferences/history/downloads and personal/encrypted data. The prototype package is
  separate and cannot read the production sandbox. Never clear or silently replace user data.
- Build/compile evidence, emulators/simulators and physical devices are separate claims. Missing
  runtime or physical qualification remains explicit; it is not converted into a passing gate.

The [current state](../CURRENT_STATE.md) records the first measured product slice and next tasks.
The portable JSON CLI remains the existing future idea; this decision adds no new CLI surface.
