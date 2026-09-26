# Definition reference R2 and first-run package setup

Date: 2026-09-22. Draft PR #180, `experiment/system-one-search-benchmark`, still stacked on #174. No merge or public release.

Delivered application changes and browser evidence: `95932e697e8ebd957ead74e9e73a2d636195c883`.
Successful verification: https://github.com/T-Damer/MiniMed/actions/runs/35666818734
The run checked input `358b2ec6605b697f18c03d50ac3e073d35078801` plus its staged, subsequently committed corrections.
Numeric evidence: [browser report](definition-reference-app-browser-2026-09-22.json).
Active plan: [DEFINITION_REFERENCE_PLAN.md](../DEFINITION_REFERENCE_PLAN.md).

## Implemented user path

The real application now opens a full-screen first-run package list. The core appears first in bold with an asterisk and an explicit explanation that it is required for search. Personal files and settings remain usable without it. Other actual catalog packages are grouped by capability and remain optional; each row has its own description, installation state, progress and applicable download/retry/cancel action. Unavailable or unpublished packages do not acquire invented download URLs.

Closing setup persists its dismissal and does not cancel downloads or close the owning database worker. Later downloads continue through existing package surfaces. New optional tool packages are not installed automatically simply because they are published; updates of already installed packages retain their existing policy.

The normal search screen has a dictionary entry. It uses the existing installer, installed-module registry, MedicalStore/MedicalCore and OPFS owner. A reference-only mount is excluded from ordinary clinical document projections. The old whole-JSON definition preview is no longer mounted. Requests return at most 20 headers, eight block descriptors per page and 4,096 Unicode code points per requested text slice; source identity and provenance are read on demand. These are source records requiring review, not approved canonical concepts or generated clinical answers.

## Browser verification

The harness uses the real App, Solid rendering, installer and SQLite-WASM/OPFS path. It installs the complete public draft dictionary but uses the existing synthetic demo core, not the full released clinical core. It verifies full-screen phone geometry at 390 by 844 pixels, the mandatory label, no core database GET before consent, dismissal during an active core download, complete dictionary installation, a sourced bounded card, and successful database reuse after application reload with database network reads blocked.

Exactly one core database GET and one dictionary archive GET occurred across installation and reload. No uncaught page errors or unexpected external requests occurred. Two existing metadata-only catalog refresh attempts were blocked and used the bundled fallback; they were not removed or described as zero network attempts. Development JavaScript and the core report remained served during the reload. This is therefore restricted-network database-reuse evidence, not complete production offline-start qualification.

The final scoped type checks and selected storage, setup, consent, worker and lifecycle tests passed. This is not a green whole-repository CI or a merge-readiness audit. Browser-discovered corrections include indeterminate native progress rendering, waiting for the active core capability after registry activation, preserving the same core factory during reconnect, and reopening an unambiguous checksum-qualified OPFS core when HEAD cannot supply its size.

## Actual size and memory boundary

The tested local edition has 18,133 source/editorial records. Its verified gzip transport is **27,399,431 bytes** and its installed SQLite file is **110,960,640 bytes**. Schema 7 numeric links remain the application baseline; optional metadata-fragment and annotation layouts are not enabled by this slice.

**Installation memory is not qualified as small.** The CDP main-page snapshot after opening a reference card reported `usedSize: 97,652,228` bytes and `backingStorageSize: 404,325,878` bytes. Before dictionary installation, the core-ready backing-storage snapshot was 70,623,543 bytes. The report preserves all snapshots. They are not additive total-RAM measurements, a measured peak, Android PSS, worker memory or a controlled steady-state comparison. Removing whole-corpus JSON hydration does not eliminate the existing install-time binary buffers and copies. Their ownership and lifetime, along with real device/process peaks, remain an explicit follow-up qualification task.

## Reproduce the local preview

Use the repository's locked dependencies, then prepare a fresh immutable edition:

```bash
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.22-r2 --built-at 2026-09-22
```

Choose a new version when those output files already exist. This checks the public input receipts, builds the numeric SQLite edition, verifies gzip decoding, and writes an ignored local descriptor and ignored database files. Start the usual development application and select the prepared dictionary package. Existing experimental-package settings are respected.

The reproducible browser harness is `scripts/verify-reference-app.mjs`; run it with Node after preparing the local edition and installing the supported Playwright Chromium runtime. The completed temporary workflows and patch helpers were removed after delivery.

## Still open

Native Android/device behavior, full production/offline-bundle checks, install/process peak memory, the complete interrupted/corrupt-update and rollback matrix, and owner-only PDF annotation integration remain unqualified. Independent clinical and reverse-search relevance validation is separate from this integration. No private PDF or derived text, database binary, model, APK, release asset or Actions artifact was published. The 18,133-record edition remains a local development preview, not a new public download.
