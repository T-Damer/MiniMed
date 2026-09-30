# Native first product slice — 30 September 2026

This is a measured slice of the full application port, not feature-complete replacement.
The released WebView application remains 0.6.45.

## Implemented contract

- UI → shared core → content/file ports → platform adapters. One SQLite owner and gate are
  shared by lookup and original-source reads; closure drains pending work before releasing handles.
- Published core `13f238f7fefe1b19eefa19ac9de0ea89fabff34ed96e98d987277f15ab03025f`,
  440,942,592 decoded bytes; 76,212,355-byte gzip is streamed to private staging. Encoded/decoded
  checksums, sizes, SQLite integrity, foreign keys and exact membership are checked before activation.
- Catalog generation preserves 782 source identities and membership. Four unsupported zstd
  transports are replaced with independently verified gzip releases of the identical decoded index;
  catalogs are validated through the existing contracts. No extra decompression library is added.
- Source selection requires exact module/version/document/version/raw checksum membership. A
  pointer is not a readable document. Proven local classification anchors without a source mapping
  open the verified original from its beginning; foreign/unknown anchors are never invented.
- Private state saves query/list position, catalog and original-reader trail/positions atomically.
  Canceled/late installations cannot reactivate a popped reader; persistence errors are visible.
- Reader preserves original text, source ids/anchors, section hierarchy, pages and character spans.
  Its opaque paper paints behind system bars. User scrolling down hides controls and up reveals
  them; header layout changes do not masquerade as user scrolling.

## Qualification

- 60 Desktop tests pass: unchanged 151 query/group/passage goldens and 206 SQL branch fixtures,
  core/installation/cancellation/navigation/catalog/anchor tests and UI error/contrast helpers.
- Actual Desktop fresh consent and remote bootstrap yield core `13f238f…`. Actual regulatory
  download yields 401,408 bytes and `61b82c9cc8a6899b24e7b6208642a35ef1a448e15c08990df3c79c7b911ca040`.
  Its three exact catalog members are verified; missing catalog titles are stated honestly.
- Actual Desktop missing-source offline failure/retry, original reading, superseded-source status,
  down/up controls, reader restart at chunk `chunk.0da7b6b6ef977f55`/49 px, and lookup restart at
  item 2/194 px pass. Offline testing uses an application-only unavailable HTTPS proxy.
- Owned Android 36 emulator fresh bootstrap and actual native lookup pass with the exact released
  core checksum. The public-query measurement hook is explicitly not a keyboard typing test.
- Android build/lint, Desktop bundle, Wasm compilation and native source checks pass. Wasm
  explicitly has no real content IO/SQLite; it never pretends to install a source.
- iOS device and simulator Kotlin plus simulator test sources compile; device framework and Swift
  host link. Full Xcode packaging/runtime qualification needs an installed iOS simulator runtime.
- The shared WebView pointer fix passes 17 unit cases and an actual released MKB zstd install plus
  reopening regression. It is a source change after the signed 0.6.45 APK, not part of that APK.

Ignored evidence is under `playwright/`: `native-ui-slice-verification.json`,
`native-android-verification.json`, `native-ui-reader-scroll-targets.log`,
`native-ios-final-compile.log`, `native-ios-swift-host.log`, and `pointer-anchor-e2e.log`.

## Remaining gates

Exact-identity/current-definition runtime, complete clinical/source-scope parity, rich original
rendering and remaining existing application features are not yet ported. Current first-slice
Desktop GUI evidence uses the system dark theme; both theme contrast helpers are unit-tested.
JVM HTTP cancellation is checked between reads; a blocked read may take the 15-second timeout.
No physical Android/iOS, real iOS simulator or production personal-data migration pass is claimed.
The connected Xiaomi rejected USB installation; its existing data was not cleared. No production
package replacement is made before a data-preserving migration is qualified.
