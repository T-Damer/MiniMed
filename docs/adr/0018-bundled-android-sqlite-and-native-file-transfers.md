# ADR 0018 — Bundled Android SQLite and persistent system transfers

Date: 2026-09-06. Status: implemented in draft PR #164; qualification remains explicit.

## Context and decision

The owner's measurements found native opens failing after 75–98 seconds, with missing system FTS5.
This does not attribute all that time to quick_check. PR #164 first moved capability probing before
large-file work. The owner subsequently approved native SQLite and a ready downloader in the same
PR, without a UI rewrite.

Keep Solid/Capacitor, MedicalStore, native vector scoring and immutable pack semantics. The final
Android engine is SQLCipher Community `net.zetetic:sqlcipher-android:4.17.0`, with the documented
`androidx.sqlite:sqlite:2.6.2` companion. Kotlin is pinned to 2.2.10 to match the artifact's runtime.
4.18.0 requires compileSdk 37; this project remains on 36. The selected publication is SDK-compatible; earlier requery 3.50.4 and JitPack-commit candidates failed
resolution and are not dependencies of this implementation. No JitPack repository is required.

SQLCipher is used with an empty key: downloaded and bundled public packs remain ordinary SQLite,
with no encryption, rekeying, schema migration or second connection owner. Existing paths, native
BLOB vector scoring and read-only access remain. Load the bundled library during native capability
qualification, not in the UI. The engine is behind NativePackDatabase, whose corruption handler
retains rejected bytes instead of the library default's deletion. Disable library Java SQL logging;
our diagnostics contain only phases. A new verifier identity invalidates old cached validation.

The community Capacitor SQLite plugin was considered. Replacing the entire existing bridge would
also require reworking native BLOB scoring or creating a second owner. Using the published native
engine directly keeps the smaller existing bridge. iOS SQLite and browser WASM/OPFS are unchanged.
No PSS reduction is claimed without matched measurements. The engine pin requires security updates.

## Native downloads

Pin `@capgo/capacitor-downloader` 8.3.0 (MPL-2.0). Android remote HTTPS calls through downloadWithRetry
use system DownloadManager. Relative/bundled files, browser and iOS retain their existing transport.
Core uses downloadFileWithRetry: retain the staged file through native streaming SHA-256, fsync and
atomic replacement, without materializing the core in JavaScript. Optional module/model consumers
still request bytes after transfer; exact membership, size, checksum and schema checks are preserved.
This does not move all optional databases out of WASM or unify every feature's queue presentation.

A versioned Bun patch persists upstream's app-ID to system-ID mappings synchronously. It reconciles
enqueue/journal interruption using staged URI, opaque system-record marker and original URL, even
when a pending transfer's local URI is null. Reuse existing transfers and cap pending, running and
paused system transfers at three across plugin instances. This is a conservative limit, not a
measured optimum. Destinations are confined to opaque app-owned staging files. Plugin destruction
stops polling, not the OS transfer. The patch preserves its license and needs review on upgrades.
Staging bytes and device-specific system IDs are excluded from backup; user notes are untouched.

Existing queues validate catalog eligibility on restoration. Transport completion is not installation.
An existing consented core transfer is recovered on launch; a first download still requires a user
action. Cancellation awaits OS removal. The Android plugin does not support individual pause/resume,
so no such controls are claimed. OS force-stop is not an ordinary background transition. Native
transfer does not imply verification/installation continues while the application is not running.

## Trust and validation

Bad hash or interrupted copy cannot replace a prior core. Verification and installation have separate
labels. Source data, schema, stable IDs, notes, private Allmed and release state are unchanged.
Tests cover file lifetime, size mismatch, failed validation, cancellation, restored admission,
serialization and native file commit. Instrumentation executes real FTS5 against the full core.
DownloadManager instrumentation covers plugin recreation and a missing journal entry, not actual
OS process-kill. Permanent native CI saves the complete ARM64 APK separately from x86 storage tests.
Each check must pass on the relevant source commit; source-only tests do not prove device behavior.

Physical PSS, OS eviction, bulk navigation, optional-package ownership, iOS background transfers,
ECG 99% and completely unified download presentation remain separate acceptance work.

## Primary sources

- https://github.com/sqlcipher/sqlcipher-android
- https://central.sonatype.com/artifact/net.zetetic/sqlcipher-android/4.17.0
- https://github.com/Cap-go/capacitor-downloader/tree/fbc88a3517fda3f5d39de4e2aad9e73147a191d0
- https://bun.com/docs/pm/cli/patch
