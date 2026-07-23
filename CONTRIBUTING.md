# Contributing

LocalMed Search is currently a private prototype. Keep changes small, reviewable, and tied to
a milestone or issue.

## Local checks

```bash
bun install
bun run content:sync
bun run content:build
bun run verify
```

## Branches and commits

Use short-lived feature branches and Conventional Commits, for example:

```text
feat(search): add document filter
fix(ingest): preserve ordered list boundaries
test(storage): cover corrupted content pack
```

## Pull requests

A pull request must explain the user-visible result, architecture impact, schema changes,
checks executed, and known limitations. Never commit real clinical queries or proprietary
source PDFs.
