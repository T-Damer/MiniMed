# ADR 0018 — Bundled Android SQLite and persistent system transfers

Date: 2026-09-06. Status: implemented in draft PR #164; qualification remains explicit.

## Context and decision

The owner's measurements found two native opens failing after 75–98 seconds because system SQLite
had no FTS5. PR #164 first moved capability probing before large-file work. The owner subsequently
approved ready native SQLite and downloader integration in the same PR, without a UI rewrite.

Keep Solid/Capacitor, `MedicalStore`, native vector scoring and immutable pack semantics. Use requery
SQLite 3.50.4 source commit `0bbaa7a8b4c485c0d4b385425113fe33ead6c3c0` behind `LocalMedDatabase`.
The upstream README's `3.50.4` tag is unpublished (qualification found a dependency-resolution error),
so the JitPack coordinate is pinned to that exact commit, never `master-SNAPSHOT`. Binary resolution
and device execution must pass CI before this dependency can be considered qualified. JitPack is
restricted to the requery group. Verification-stamp revision changes with the engine.

The community Capacitor SQLite plugin was considered. Replacing the existing bridge would also need
reworking native BLOB vector scoring or introducing another connection owner. The smaller requery
variant preserves it. iOS native SQLite and browser WASM/OPFS are unchanged. No PSS reduction is
claimed without matched measurements; the engine pin still needs future security updates.

## Native downloads

Pin `@capgo/capacitor-downloader` 8.3.0 (MPL-2.0). Android remote HTTPS calls through `downloadWithRetry`
use system DownloadManager. Relative/bundled files, browser and iOS retain their existing transport.
The core uses `downloadFileWithRetry`: it retains a staged file through native streaming SHA-256,
fsync and atomic replacement, never materializing the core in JavaScript. Optional module/model
consumers still request bytes after transfer; exact membership, size, checksum and schema checks
are preserved. This does not move all optional databases out of WASM or unify every queue UI.

A versioned Bun patch persists upstream's app-ID to system-ID mappings synchronously. It reconciles
the enqueue/journal interruption using the staged URI, opaque system-record marker and original URL,
including pending transfers without a local URI. It reuses existing transfers and limits pending,
running and paused system transfers to three across plugin instances. Destinations are confined to
opaque app-owned staging files. Plugin destruction stops polling, not the OS transfer. The patch
preserves the upstream license and must be reviewed on updates. Staging and device-specific system
IDs are excluded from cloud backup and device transfer; user notes are not touched.

Existing queues still validate catalog eligibility on restoration. Completed transfers are not
installed modules. An existing consented core transfer is resumed automatically; a first download
still requires explicit user action. Cancellation awaits OS removal. Android per-transfer pause and
resume are not supported by this plugin, so no unsupported controls are added. OS force-stop is not
equivalent to an ordinary background transition and does not imply guaranteed execution.

## Trust and validation

A failed hash or interrupted copy cannot replace the prior core. Verification and installation have
separate progress labels. Source data, schema, stable IDs, notes, private Allmed and release state
are unchanged. Tests cover staged-file lifetime, size mismatch, failed validation, cancellation,
restored admission, serialization and native file commit. Instrumentation uses real FTS5 and the
full core; the DownloadManager test covers plugin recreation and a missing journal entry, not an
actual OS process-kill. The permanent Android qualification workflow retains the complete ARM64 APK
separately from the x86 storage-test variant and reports real device logs without claiming UI timing.

Physical PSS, OS eviction, bulk navigation, optional-package ownership, iOS background transfers,
ECG 99% and fully unified download presentation remain separate work and acceptance tests.

## Primary sources

- https://github.com/requery/sqlite-android/tree/0bbaa7a8b4c485c0d4b385425113fe33ead6c3c0
- https://github.com/Cap-go/capacitor-downloader/tree/fbc88a3517fda3f5d39de4e2aad9e73147a191d0
- https://bun.com/docs/pm/cli/patch
