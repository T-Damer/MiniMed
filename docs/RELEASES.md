# Release process

## Pre-release checklist

1. Update `CHANGELOG.md` and root `release.json`; update the corpus manifest only when its snapshot
   version also changes.
2. Run `bun run content:restore:core` to restore the checksum-verified compressed discovery core.
   Verify the existing generated artifacts; rebuild only artifacts whose inputs changed. Never replace
   `apps/app/public/content/core.db` with the smaller fixture pack. Source SQLite databases and
   private full medication builds remain untouched by application publication.
3. Run `bun run verify`.
4. Run targeted browser E2E for changed UI flows. The complete Web E2E workflow is manual.
5. Run relevant native smoke checks when native behavior changes. Android native qualification is manual.
6. With every companion pack (`mkb.db`, `medications.db`, `ambulatory.db`, `regulatory.db`,
   `reference.db`) present in `apps/app/public/content`, run `bun run benchmark:real:release`: the
   app's «Клинический разбор» path over the full released corpus, checked against the ratchet
   baseline in `tools/benchmarks/real-corpus-baseline.json` (a metric may not fall more than 0.02).
   CI runs `benchmark:all`, the same query sets over `core.db` alone. After a search improvement,
   raise the baseline with `--write-baseline` in a separate commit. The release run also mounts the
   released modules of the recommendations the lookup queries target (`kr.rf.<id>`) from
   `data/build/release-clinical/` when present, because a catalog pointer in core carries only a
   title; a baseline is keyed by the databases mounted (`recommendations×7`).
7. Review the generated benchmark and integrity reports.
8. Confirm no real patient data, source PDFs, or API keys are tracked.
9. Run `bun run forms:check-updates` (local, needs the network; `--rebuild` re-fetches and rebuilds a
   changed source on macOS). It compares the official file of every order the form schemas come from
   (`tools/ingest/medical-form-sources.json`) with the registry and looks for amending or repealing
   orders on publication.pravo.gov.ru; the report is `data/build/forms-update-check.json`. `unchanged`
   is the only clean result: `new`, `changed` or «HUMAN REVIEW REQUIRED» means the form schemas need a
   review (docs/FORMS_PLAN.md «Update check») before the release; a network `error` is not a pass —
   repeat it. List reviewed related orders in `acknowledgedOrders`. After any change of a form's
   layout or of the print CSS run `bun run forms:overlay` (renders every form and compares it with the
   official scan; the figures of the last run are committed in
   `tools/ingest/medical-form-overlay-results.json`, a violation needs a written reason).
10. Push a release commit only from a clean working tree; the release workflow creates the tag and
   prerelease after all gates pass.

Application and downloadable-corpus versions are independent. An app-only release may reuse the current
verified corpus version; release evidence records both versions.

Android release checks verify the downloadable `core.db` against the tracked build report, checksum, SQLite integrity,
foreign keys and FTS counts, and assert that the APK omits the core. First launch installs the
checksum-verified core from the pinned public mirror; keep that mirror reachable before publishing.
No workflow commits a replacement core. GitHub Pages and Android use the same canonical filename. Git stores `content/bundled/core.db.gz`
(the uncompressed database exceeds GitHub’s file limit); update that archive together with the
report whenever the discovery core changes. Dev/build/verification restore and checksum-check it.

```bash
git status --short
bun run verify
bun run test:e2e
git commit -m "release: MiniMed <version>"
git push origin main
```

## GitHub checks

PRs run the fast code, unit-test and content checks. Full browser E2E and Android emulator
qualification are available through `workflow_dispatch`; they do not run on every PR.
The Android release workflow runs manually or for a `release: MiniMed` commit on `main`,
so ordinary pushes and PRs do not build a duplicate release APK.

## Artifacts

### Compressed module indexes

Downloadable SQLite indexes support `compression: "gzip"`. The installer checks the downloaded
`sha256` and `sizeBytes`, decompresses on the device, verifies `decodedSha256` and
`decodedSizeBytes`, then runs the existing SQLite/schema checks before activation. Download sizes
refer to the archive; installed sizes refer to SQLite. ZIP image packs keep their existing path.
The decoder uses `DecompressionStream('gzip')`; it does not add a codec dependency. Brotli is not
the distribution default because native decompression is not yet available in Chrome/Android
WebView according to [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/DecompressionStream.json).

Prepare an archive and its artifact fields with the pinned Bun runtime:

```bash
bun scripts/compress-module-index.mjs --input path/to/module.db --output path/to/module.db.gz --report playwright/compression/module-artifact.json
bun test scripts/compress-module-index.test.mjs
```

The command verifies a lossless round trip and leaves the source database untouched. Use the emitted
fields in a newly published artifact/catalog, set its URL to the `.db.gz` file, and require the app
release containing this decoder. Do not overwrite an existing released artifact or advertise a URL
before publishing its bytes and CORS mirror. Previously published uncompressed indexes remain valid.
Serve the `.gz` as archive bytes, not as an HTTP `Content-Encoding: gzip` response that fetch would
silently decode before transport checksum verification.
The optional decoder belongs to the module installer; the separately installed Android core retains
its existing URL/checksum contract. This does not change background-transfer support or eliminate
the installer's existing in-memory SQLite buffer.

#### zstd module indexes and the Android core

Large indexes are published as `compression: "zstd"`: a plain concatenation of independent frames
of at most 64 MiB of decoded data, each made by `zstd -19 --long=26` from a file (so every frame
declares its content size). Any zstd decoder reads it. The browser installer decodes it **frame by
frame inside the OPFS worker straight into the module's pool**, hashing the decoded bytes
incrementally; the artifact's `decodedSizeBytes`/`decodedSha256` are verified before the file is
associated with the pool, so neither a decoded copy in memory nor a second copy in IndexedDB exists.
fzstd's streaming decoder is not used for this: it moves its whole 64 MiB window after every block
(≈10 s for a 340 MB index against ≈1 s frame by frame). A single huge frame still installs, through
the generic in-memory decode.

```bash
bun scripts/repack-module-indexes-zstd.ts --family esklp|clinical --source-dir DIR --out-dir DIR \
  [--compacted] [--catalog-out candidate.catalog.json]
```

New modules that have no catalog artifact yet (the ГРЛС instruction groups, Allmed, the manufacturer-site
instructions) go through
`bun scripts/package-instruction-modules.ts --family grls|allmed|manufacturer --source-dir DIR --out-dir DIR --tag TAG
--catalog-in FILE --catalog-out FILE`, which creates or completes their catalog entries (the tags
`grls-instructions-…`, `allmed-…` and `manufacturer-instructions-…` resolve to `datasets/<tag>/modules/`, like
`esklp-…`). `--family grls` leaves `minimed.medications.instructions.manufacturer-site.ru` alone: that module is its
own family and collection (`manufacturer-instructions`). A blob must stay below 100 MB.
`--family ddinter` packages the optional DDInter severity-label module (INT2, tag `ddinter-severity-…`, built by
`tools/ingest/scripts/build_ddinter_severity_module.py build`; CC BY-NC-SA 4.0, see `docs/research/drug-interactions-2026-10-06.md` §6).
After a ЕСКЛП or instruction-module refresh rebuild it as well as the interaction index (`bun run content:drug-interactions`).
After such a module refresh, rebuild the same-substance fallback asset (`bun run content:substance-fallback`, ADR-0023) so
registrations that gained or lost a document get current donors.

The script verifies every output with the app's own decoder, writes a candidate catalog and a report
(file, URL, sizes, checksums, mirror path) and never touches a published asset. Publishing is a
separate, explicit step: upload the files to the mirror locations in the report, then commit the
candidate catalog. Modules that use zstd need `minAppVersion` 0.6.45 or newer.

An incremental clinical snapshot (new КР editions after a registry refresh) is published with
`scripts/publish-module-zstd-mirror.sh --family clinical --tag <new snapshot id> --source-dir DIR --create`,
which starts the branch `datasets/<tag>` without touching any existing branch, then
`scripts/add-clinical-delta-modules.ts` adds the modules to the catalog and marks the replaced
editions `superseded` (procedure in [CONTENT_PIPELINE.md](CONTENT_PIPELINE.md)). Move the catalog's
`publishedAt` forward: a remote catalog replaces the bundled one only when it is newer.

The Android core is downloaded as the release's `core.db.gz` (the archive of the same file the
browser bundle uses): `core-report.json` records `distributions.android.{url, compression,
transferSha256, transferSizeBytes}` next to the decoded `checksum` the native installer verifies.

A release should include:

- static web bundle;
- content pack DB and manifest/report where redistribution is permitted;
- search benchmark report;
- checksums;
- platform build(s) that passed native smoke;
- concise known limitations.

## Android signing

Prerelease APKs are debug builds signed with one persistent key, so a new release installs over the
previous one and keeps the user's local data. Releases up to 0.6.42 were signed with a fresh
ephemeral CI debug key each time and cannot be updated in place; moving to the persistent key needs
one last reinstall (export a notes backup first).

- Key: PKCS12 `minimed-prerelease.p12`, alias `minimed-prerelease`, certificate SHA-256
  `684fde01054b3860f02f406c4d90a55f0c2bb2370f624770848ebbf4d42fb970` (pinned as
  `PRERELEASE_CERT_SHA256` in `android-release.yml`; the release fails on any other
  certificate).
- CI reads the repository secrets `MINIMED_ANDROID_KEYSTORE_BASE64`,
  `MINIMED_ANDROID_KEYSTORE_PASSWORD` and `MINIMED_ANDROID_KEY_ALIAS`; Gradle signs the debug build
  with it only when `MINIMED_ANDROID_KEYSTORE_FILE` is set, so local builds keep the default debug key.
- The owner's copy lives outside the repository in `~/.minimed-signing/` (keystore and password
  file, mode 600). GitHub secrets cannot be read back: losing that copy means another forced
  reinstall for every user. Never commit the key or pass it to app, test or browser processes.

## Compatibility policy before 1.0

Breaking changes are allowed, but every release must state:

- supported SQL schema version;
- supported content-pack schema version;
- whether old packs can be migrated or must be rebuilt;
- whether bookmarks/anchors are preserved.

## Rollback

Native core replacement is checksum-verified and preserves a backup until commit. Physical process-kill and low-storage qualification of downloadable packs remains open. A failed update must leave the previously active pack untouched. Application releases should retain the prior installable
artifact until the new version completes closed-beta smoke testing.
