# Automated content database updates

MiniMed can synchronize URL and local-file inputs, rebuild the vectorized SQLite pack, run the retrieval gate and update the application asset.

## Source manifest

A sync manifest is separate from the medical metadata registry consumed by `medbase prepare`. It describes transport only:

```yaml
version: 1
sources:
  - id: official-recommendation
    location: https://example.org/recommendation.pdf
    target: official-recommendation.pdf
    content_type: pdf
    max_bytes: 104857600

  - id: local-protocol
    location: local-protocol.md
    target: local-protocol.md
    content_type: markdown
```

`location` may be:

- an HTTPS URL;
- an HTTP URL on localhost for tests;
- a local path relative to `--input-root`, or to the manifest directory when no input root is supplied.

`target` is always resolved below `--output-root`; traversal outside that directory is rejected.

## Manual synchronization

```bash
uv run --project tools/ingest medbase sync \
  --manifest docs/examples/source-sync.yaml \
  --input-root /path/to/local-inputs \
  --output-root data/synced/private-pilot \
  --cache-root .cache/localmed/sources \
  --report data/build/source-sync-report.json
```

Force a full HTTP refresh:

```bash
uv run --project tools/ingest medbase sync ... --force-refresh
```

Use the last validated cache without network access:

```bash
uv run --project tools/ingest medbase sync ... --offline
```

## Cache behavior

Remote cache metadata records:

- source and final URL;
- SHA-256;
- byte size;
- ETag;
- Last-Modified;
- fetch time;
- content type.

A normal refresh sends `If-None-Match` and `If-Modified-Since` when available. HTTP `304` reuses the cached payload. A transient network failure may reuse a previously checksum-validated cache entry and records a warning in the report. `--force-refresh` skips conditional headers.

Local files use a content-addressed cache keyed by SHA-256. Output files are replaced atomically only when their checksum changes.

## GitHub Actions

`.github/workflows/automated-content-rebuild.yml` runs:

- on every push to `main`;
- on manual `workflow_dispatch`;
- on pull requests as a validation-only build.

A commit message containing:

```text
MEM:UPD
```

forces an unconditional remote refresh. The manual workflow also exposes a `force_refresh` checkbox.

The workflow:

1. restores `.cache/localmed/sources`;
2. synchronizes links and files;
3. validates the prepared corpus;
4. rebuilds SQLite, FTS5 and precomputed vectors;
5. runs the pilot retrieval benchmark;
6. builds the web application against the generated pack;
7. uploads the database and reports as an Actions artifact;
8. on `main`, commits the application database only when its bytes changed.

The artifact retains the synchronization report, compiled database, build report and retrieval benchmark so every automatic update has inspectable evidence. The generated bot commit includes `[skip db rebuild]` to prevent a workflow loop.

## Public and private repositories

The public MiniMed workflow currently synchronizes tracked source-linked paraphrase files. Full recommendation PDFs, copyrighted books, OCR exports, local hospital protocols and patient material must not be introduced into the public manifest.

For a private corpus, copy the workflow into a private repository or private build environment and point it to a private sync manifest. Repository secrets are appropriate for authenticated source servers, but credentials must never be written into the manifest or cache report.

## Update safety

A database is published only after:

- payload size and format checks;
- optional immutable SHA-256 validation;
- path-traversal rejection;
- deterministic corpus lint;
- SQLite integrity checks during compilation;
- the configured retrieval benchmark;
- successful application build.

This automation rebuilds and verifies the retrieval artifact. It does not medically approve a changed recommendation. New remote editions should still be reviewed through their source diff and extraction diagnostics before production activation.
