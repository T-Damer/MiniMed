# Native SQLite content-pack adapter — 0.2.1

## Purpose

The mobile application must open the same generated SQLite content pack as the browser without
rebuilding it in JavaScript memory on every launch. Version 0.2.1 adds a Capacitor-local native
adapter behind the existing `MedicalStore` contract.

```text
SolidJS UI
  → MedicalCore
  → MedicalStore
      ├─ CapacitorMedicalStore → bundled Android SQLite / iOS SQLite
      ├─ SqliteMedicalStore    → SQLite WASM fallback
      └─ InMemoryMedicalStore  → tests
```

No UI feature owns SQL or platform code. Search analysis, branch planning, result fusion, anchors,
and source navigation remain in portable TypeScript.

## Startup sequence

See ADR 0018 for the Android bundled engine and persistent native transfer integration.

The current Android APK downloads the required core into private storage after explicit consent;
iOS retains the bundled copy. The immutable artifact remains identified by its published SHA-256.

1. Read `core-report.json`; ensure the Android core is installed, downloading only on user action.
2. Android `openPack` probes FTS5 on a tiny in-memory database **before** touching the large file.
   Unsupported runtimes immediately select the existing WASM/OPFS fallback on the installed file.
3. Recover interrupted installs and compare the verified-edition stamp. If the stamp does not match,
   stream SHA-256 over the file. Open SQLite read-only and perform `PRAGMA quick_check` only on an
   unstamped edition. Query schema metadata and the actual FTS index on each open.
4. Save the stamp only after all checks succeed and the file identity remains unchanged. It contains
   expected checksum, SQLite version, verifier revision, device/inode, change time, mtime and size.
   Replacement/recovery explicitly delete it; content migrations change the artifact checksum and
   validation changes must bump `PackValidationIdentity`'s revision. This is a cache for immutable
   app-private files, not protection against malicious same-identity filesystem modifications.
5. Native operations are serialized. JS awaits actual completion and cleanup rather than racing
   an uncancellable timeout. Closing an adapter waits for its acquisition; repeated initialization
   of one adapter acquires one lease. A failed integrity check must not fall back onto corrupt bytes.
6. Unknown-size and large cores stream through the existing OPFS worker. The small-core JS path
   has a bounded body reader even when HEAD underreports its size. The worker retains ownership
   of its pool for queries and must close before another owner can reuse it.

Android logcat tag `LocalMedDatabase` reports `capabilitiesMs`, `installedFileMs`, `sqliteOpenMs`,
`integrityMs`, `metadataMs`, `totalMs`, `integrityCached` and `failedPhase` when applicable. Unreached
phases are absent, not zero-duration successes. Timing logs exclude query text, SQL arguments and
file paths. Successful bridge health includes `openTimings`; these local diagnostics do not upload
telemetry. The UI separately marks navigation and search readiness with the Performance API.

Native capability probing/cache behavior still needs real-device timing and interruption
qualification. An unavailable compiled core is an explicit preparation/error state, not a silent
substitution of a small demonstration corpus.

## Bridge surface

The native plugin exposes only three methods:

```ts
interface LocalMedDatabasePlugin {
  openPack(options: {
    assetPath: string;
    databaseName: string;
    expectedSha256: string;
  }): Promise<NativeDatabaseHealth>;

  query(options: {
    sql: string;
    argsJson?: string;
  }): Promise<{ rows: readonly NativeSqlRow[] }>;

  close(): Promise<void>;
}
```

Constraints:

- the database is opened read-only;
- the bridge accepts a single `SELECT` or `WITH` statement;
- semicolons and SQL comments are rejected;
- values are passed separately from SQL;
- BLOB columns are not exposed to JavaScript;
- asset paths are restricted to `public/content/`;
- database names are restricted to a conservative filename pattern;
- user query text is never logged by the plugin.

The bridge is deliberately small. Dynamic pack installation, migrations, and write-side authoring
will use separate commands rather than turning this into a generic SQL administration API.

## Platform files

```text
packages/storage-capacitor/
  src/plugin.ts
  src/capacitor-medical-store.ts

apps/app/android/app/src/main/java/dev/localmed/search/
  MainActivity.java
  LocalMedDatabasePlugin.java

apps/app/ios/App/App/
  LocalMedBridgeViewController.swift
  LocalMedDatabasePlugin.swift
```

Android registration occurs in `MainActivity`. iOS uses a custom `CAPBridgeViewController` selected
in the main storyboard and registers the plugin after the Capacitor bridge loads.

## Persistence semantics

The installed file lives in private application storage:

- Android: `files/localmed/content/<databaseName>`;
- iOS: `Application Support/LocalMed/content/<databaseName>`.

The bundled content pack is immutable at runtime and reproducible from the app bundle, so its
native directory is excluded from Android cloud/device-transfer backup rules and marked excluded
from iOS backup. Bookmarks and query history still use their current browser storage path; they are
not part of the medical content pack.

The `StorageHealth` contract reports:

```text
backend: sqlite-native | sqlite-wasm | in-memory
persistent: true | false
```

The System screen exposes these values so a tester can verify which path actually won at startup.

## Update/recovery model

For a new packaged checksum:

```text
bundle asset
  → copy to .tmp
  → verify SHA-256
  → move previous target to .backup
  → move .tmp to target
  → write checksum marker
  → delete .backup
```

At the next launch, an interrupted state is recovered before another install attempt:

- target absent + backup present → restore backup;
- target present + backup present → keep target and remove stale backup.

Version 0.2.1 validates this algorithm at source level. Process-kill tests still require physical
Android and iOS devices.

## Required physical-device smoke

1. Install a debug build with the synthetic pack.
2. Open **Система** and record platform, SQLite version, FTS5 status, and storage backend.
3. Confirm backend is `SQLITE-NATIVE`. If it is `SQLITE-WASM`, collect the startup error from the
   JavaScript console without logging any clinical query.
4. Search the five committed long-case scenarios and open source context.
5. Force-stop the app, relaunch, and confirm the backend remains native and the pack was not copied
   again.
6. Reboot the device and repeat one search in airplane mode.
7. Install a build with a changed pack checksum and verify replacement.
8. Interrupt an update during development and verify the prior pack is recoverable.
9. Record cold-start, p50/p95 search latency, package size, and process memory.

See [`NATIVE_SMOKE.md`](NATIVE_SMOKE.md) for the test record template.
