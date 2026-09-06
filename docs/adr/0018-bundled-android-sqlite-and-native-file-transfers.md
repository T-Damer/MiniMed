# ADR 0018 — Bundled Android SQLite and persistent system transfers

Date: 2026-09-06. Status: implemented in draft PR #164; device qualification remains explicit.

## Context and decision

The owner's measurements found two native opens failing after 75–98 seconds because system SQLite
had no FTS5. PR #164 first moved capability probing before large-file work. The owner subsequently
approved ready native SQLite and downloader integration in the same PR, without a UI rewrite.

Keep Solid/Capacitor, `MedicalStore`, native vector scoring and immutable pack semantics. On Android,
use `com.github.requery:sqlite-android:3.50.4` behind the existing `LocalMedDatabase` plugin. Its FTS5
binary is shipped with the app, not selected by the OS vendor. JitPack is restricted to that group.
Verification-stamp revision changes with the engine. This is not a new ORM or a database migration.

The community Capacitor SQLite plugin was considered. Its NC connection can open a file read-only,
but replacing our already-integrated bridge would also require reworking native BLOB vector scoring
or introducing a second connection owner. The smaller requery variant preserves that implementation.
The iOS native SQLite path and browser WASM/OPFS are unchanged. No claim is made about reduced PSS
until matched measurements are available. Dependency/security updates remain necessary; this pin is
not a claim that SQLite 3.50.4 is the latest upstream SQLite release.

## Native downloads

Pin `@capgo/capacitor-downloader` 8.3.0 (MPL-2.0). On Android all remote HTTPS calls through
`downloadWithRetry` use its system DownloadManager transport. Relative/bundled files, browser and iOS
keep the existing transport. No global fetch patch is installed and no downloader SDK reaches UI.
The core uses `downloadFileWithRetry` from that same retry/admission layer: it retains a file handle
through native streaming SHA-256, fsync and atomic replacement, never reading the core into JS.
Module/model consumers still request bytes after transfer; their existing size/checksum/schema and
exact document-membership verification remain unchanged. This does not move every optional database
out of WASM or unify all feature queue UIs.

Upstream's Android implementation stores app-ID → system-ID mappings only in memory. A versioned Bun
patch persists mappings synchronously, reconciles the enqueue/journal crash window using the staging
URI, opaque system-record marker and original URL (also while the pending file URI is null), reuses an existing transfer, and bounds active system transfers to three,
including those retained across process death. It also confines destinations to opaque app-owned
staging IDs and stops event polling when the plugin is destroyed (not the transfer). The patch keeps
the upstream license and fails to apply on unexpected source changes; updates require review.

Application queues still validate catalog eligibility on restoration. A completed native transfer is
not an installed module. Reopening the core restores an existing consented transfer automatically;
first download still requires the owner's explicit action. User cancellation awaits system removal.
Android does not support per-transfer pause/resume in this plugin; no pause button or promise is added.
DownloadManager handles network interruptions within its supported conditions. A terminal failure
may require a fresh download. Force-stop and OS restrictions are not equivalent to a normal background
transition and do not imply guaranteed execution while the app is stopped.

## Trust and validation

The native stage is outside the installed content directory. Failed SHA-256 or interrupted writes
cannot replace the prior core. Verification and installation have distinct progress labels; queued
and transferred bytes are not presented as search readiness. Third-party sources, schema, stable IDs,
local notes, Allmed/private files, clinical claims and publication state are unchanged.

Regression tests cover completed-file lifetime, length mismatch, checksum/install failure, cancellation,
restored-slot admission, serialization, native file commit and interrupted source reads. Instrumentation
also exercises the real DownloadManager across plugin recreation and a missing journal entry; this is not an OS process-kill test. SQLite instrumentation executes the bundled FTS5 binary and can open/reopen the full installed core without changing it. The
latter requires a real prepared core and must not be silently replaced with a fixture.

Physical-device PSS, process eviction, bulk navigation, all optional-package ownership, iOS background
transport, ECG 99% and unified download presentation remain separate qualification/work items.

## Reviewed primary sources

- https://github.com/requery/sqlite-android
- https://github.com/Cap-go/capacitor-downloader/tree/fbc88a3517fda3f5d39de4e2aad9e73147a191d0
- https://bun.com/docs/pm/cli/patch
