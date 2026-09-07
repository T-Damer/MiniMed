# Release process

## Pre-release checklist

1. Update `CHANGELOG.md` and root `release.json`; update the corpus manifest only when its snapshot
   version also changes.
2. Run `bun run content:restore:core` to restore the checksum-verified compressed discovery core.
   Verify the existing generated artifacts; rebuild only artifacts whose inputs changed. Never replace
   `apps/app/public/content/core.db` with the smaller pilot/fixture pack. Source SQLite databases and
   private full medication builds remain untouched by application publication.
3. Run `bun run verify`.
4. Run targeted browser E2E for changed UI flows. The complete Web E2E workflow is manual.
5. Run relevant native smoke checks when native behavior changes. Android native qualification is manual.
6. Review the generated benchmark and integrity reports.
7. Confirm no real patient data, source PDFs, or API keys are tracked.
8. Push a release commit only from a clean working tree; the release workflow creates the tag and
   prerelease after all gates pass.

Application and downloadable-corpus versions are independent. An app-only release may reuse the current
verified corpus version; release evidence records both versions.

Android release checks verify the downloadable `core.db` against the tracked build report, checksum, SQLite integrity,
foreign keys and FTS counts, and assert that the APK omits the core. First launch installs the
checksum-verified core from the pinned public mirror; keep that mirror reachable before publishing.
Automatic pilot rebuilds produce benchmark evidence only; they do not
commit a replacement core. GitHub Pages and Android use the same canonical filename. Git stores `content/bundled/core.db.gz`
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

A release should include:

- static web bundle;
- content pack DB and manifest/report where redistribution is permitted;
- search benchmark report;
- checksums;
- platform build(s) that passed native smoke;
- concise known limitations.

## Compatibility policy before 1.0

Breaking changes are allowed, but every release must state:

- supported SQL schema version;
- supported content-pack schema version;
- whether old packs can be migrated or must be rebuilt;
- whether bookmarks/anchors are preserved.

## Rollback

Native core replacement is checksum-verified and preserves a backup until commit. Physical process-kill and low-storage qualification of downloadable packs remains open. A failed update must leave the previously active pack untouched. Application releases should retain the prior installable
artifact until the new version completes closed-beta smoke testing.
