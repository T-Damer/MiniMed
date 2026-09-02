# Automated content database updates

MiniMed can synchronize URL and local-file inputs, rebuild a pilot SQLite pack and run the retrieval gate. Publishing a replacement discovery core is a separate release step.

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
- Content-Disposition;
- Content-Length;
- fetch time;
- content type.

A normal refresh sends `If-None-Match` and `If-Modified-Since` when available. HTTP `304` reuses the cached payload. A transient network failure may reuse a previously checksum-validated cache entry and records a warning in the report. `--force-refresh` skips conditional headers.

For binary archives whose server provides neither `ETag` nor `Last-Modified`, a normal refresh first
sends `HEAD`. Matching `Content-Disposition` and `Content-Length` reuse the checksum-validated cache;
any difference triggers a complete download and a new SHA-256. The filename/size pair is only a fast
preflight signal — the downloaded bytes remain identified by their checksum.

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
6. builds the web application with the tracked discovery core;
7. uploads synchronization, build and retrieval reports as an Actions artifact.

The reports make each rebuild inspectable. The workflow has read-only repository permission and never
replaces or commits `core.db`: the smaller pilot pack must not erase its catalog pointers. A commit
containing `[skip db rebuild]` still skips this optional pilot job.

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
