# Content workspace

`content/fixtures` contains synthetic, non-clinical material used by tests and the web demo. These
files explicitly declare `synthetic_fixture: true`.

Real source PDFs/TXT exports belong in `data/raw/` and are ignored by Git. A private registry can be
copied from `docs/examples/private-sources.yaml`, then prepared with:

```bash
pnpm content:prepare:private
pnpm content:lint:private
pnpm content:build:private
```

The preparer writes source-preserving Markdown and extraction diagnostics under
`data/intermediate/private-pilot/`. The final builder creates stable sections/chunks/anchors and a
SQLite/FTS5 pack. Do not hand-edit generated pack files.
