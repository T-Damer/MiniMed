# Release process

## Pre-release checklist

1. Update `CHANGELOG.md` and package versions.
2. Rebuild generated content artifacts.
3. Run `pnpm verify`.
4. Run browser E2E.
5. Run the relevant native smoke checklist.
6. Review the generated benchmark and integrity reports.
7. Confirm no real patient data, source PDFs, or API keys are tracked.
8. Tag only from a clean working tree.

```bash
git status --short
pnpm verify
pnpm test:e2e
git tag -s v0.2.2 -m "LocalMed Search v0.2.2"
git push origin main --tags
```

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

Bundled native pack replacement is checksum-verified and preserves a backup until commit. External
downloadable packs remain disabled until the same invariant is covered by physical process-kill tests and
a signed installer contract. A failed update must leave the previously active pack untouched. Application releases should retain the prior installable
artifact until the new version completes closed-beta smoke testing.
