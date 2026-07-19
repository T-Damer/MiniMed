# Native SQLite content-pack adapter — 0.2.1

## Purpose

The mobile application must open the same generated SQLite content pack as the browser without
rebuilding it in JavaScript memory on every launch. Version 0.2.1 adds a Capacitor-local native
adapter behind the existing `MedicalStore` contract.

```text
SolidJS UI
  → MedicalCore
  → MedicalStore
      ├─ CapacitorMedicalStore → Android/iOS system SQLite
      ├─ SqliteMedicalStore    → SQLite WASM fallback
      └─ InMemoryMedicalStore  → tests
```

No UI feature owns SQL or platform code. Search analysis, branch planning, result fusion, anchors,
and source navigation remain in portable TypeScript.

## Startup sequence

1. The application reads `public/content/core-demo-report.json` and obtains the expected SHA-256.
2. On Android/iOS, `CapacitorMedicalStore` calls the local `LocalMedDatabase` plugin.
3. The plugin copies the bundled `.db` into private application storage only when the checksum
   marker differs.
4. Installation uses a temporary file and preserves the previous pack as a backup until the new
   file and checksum marker are committed.
5. The plugin opens the installed file read-only.
6. `PRAGMA quick_check`, schema metadata, document count, and a real FTS5 `MATCH` query are probed.
7. If registration, copy, integrity, or FTS5 fails, composition closes the native attempt and opens
   the same packaged database through SQLite WASM.
8. If the compiled database itself is unavailable, the small JSON seed remains the last recovery
   path for the synthetic demo only.

The fallback is intentional: some platform SQLite builds may lack a compatible FTS5 module. A
mobile build must remain usable rather than fail at boot.

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
