# Setup

## Required tools

- Node.js 22.12 or later;
- Bun 1.2.3;
- Python 3.12 or later;
- uv;
- Git.

## Bootstrap

Linux/macOS:

```bash
./scripts/bootstrap.sh
```

PowerShell:

```powershell
./scripts/bootstrap.ps1
```

Manual equivalent:

```bash
corepack enable
bun install --frozen-lockfile
uv sync --project tools/ingest --all-groups --locked
bun run content:build
bun run verify
```

## Development

```bash
bun run dev
bun run dev:landing
```

## Common problems

### FTS5 unavailable

The web tests use the committed SQLite WASM package and assert FTS5. A future native adapter must use
a SQLite build compiled with FTS5. Open the app status page to inspect the runtime capability.

### Generated content differs

Run `bun run content:build`, inspect the builder report, and commit generated JSON only when the source
fixture changed intentionally. Do not edit generated JSON by hand.

### Playwright browser missing

```bash
bunx playwright install chromium --with-deps
```

### iOS commands on Linux/Windows

iOS compilation requires macOS and Xcode. The shared web bundle can still be built elsewhere.
