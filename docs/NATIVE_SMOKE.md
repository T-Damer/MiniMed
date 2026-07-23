# Native SQLite smoke checklist — 0.2.2

The source-level bridge and fallback are implemented. This checklist is the remaining physical
release gate; it cannot be completed in a container without Android/iOS toolchains and devices.

## Android preparation

Requirements:

- JDK 21;
- Android Studio and SDK Platform 36 / Build Tools 36.0.0;
- an attached physical device with USB debugging;
- Bun and Node versions declared in the repository.

```bash
corepack enable
bun install --frozen-lockfile
bun run content:sync
bun run content:build
bun run build:app
bun run native:sync:android
bun run native:source:check

cd apps/app/android
./gradlew assembleDebug
```

Install through Android Studio or:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Android checks

- app launches with airplane mode enabled;
- **Система → Хранилище** reports `SQLITE-NATIVE`;
- SQLite version and `FTS5: available` are visible;
- all synthetic documents are listed;
- the five long-case fixtures return their expected first document;
- exact chunk, neighboring context, and full section open;
- force-stop and relaunch preserve the native pack;
- device reboot preserves the native pack;
- repeated launch does not recopy an unchanged checksum;
- no clinical query/source text appears in Logcat;
- failed native probing falls back to `SQLITE-WASM` without a blank screen;
- 30-query p50/p95 and cold-start time are recorded;
- behavior is checked with low storage and low-memory process recreation.

## iOS preparation

Run on macOS with current Xcode:

```bash
corepack enable
bun install --frozen-lockfile
bun run content:sync
bun run content:build
bun run build:app
bun run native:sync:ios
bun run native:source:check
bun run --filter @localmed/app cap:open:ios
```

Build and install on a physical iPhone/iPad, then repeat the Android checks using the Xcode console
and iOS storage/process controls.

## Pack update/recovery drill

1. Build and install pack A; record its checksum.
2. Change only the generated demo pack and build pack B.
3. Upgrade the app and confirm B becomes active.
4. During development, stop the process after backup creation and before marker commit.
5. Relaunch and confirm a valid prior target is restored or the new valid target is retained.
6. Corrupt a development copy and confirm native startup rejects it and falls back safely.

## Test record

```text
commit:
tag:
content pack checksum:
device:
chip:
OS:
app build:
SQLite version:
storage backend:
FTS5 available:
cold start:
queries passed:
p50/p95:
process memory:
restart/reboot result:
update/recovery result:
known issues:
```
