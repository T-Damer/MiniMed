"""One-time recovery of fixture defaults and browser launcher; no production ranking changes."""
from pathlib import Path

path = Path('packages/core/src/query-document-index.test.ts')
text = path.read_text()
old = 'ContentPackSeedSchema, type SearchFilters'
assert text.count(old) == 1
text = text.replace(old, 'ContentPackSeedSchema, SearchRequestSchema, type SearchFilters')
assert text.count('core.search({') == 9
text = text.replace('core.search({', "core.search({ ...SearchRequestSchema.parse({ query: 'fixture' }),")
path.write_text(text)

# Bun installs the locked toolchain. Vite's Node CLI is launched explicitly from its
# workspace package; a missing root-level bunx executable must not hide startup errors.
path = Path('.github/workflows/definition-mass-extraction-followup.yml')
text = path.read_text()
old = 'bunx vite --config apps/app/.definition-check.config.ts'
assert text.count(old) == 1
text = text.replace(old, 'node apps/app/node_modules/vite/bin/vite.js --config apps/app/.definition-check.config.ts')
old = "trap 'kill \"$server\" 2>/dev/null || true' EXIT"
assert text.count(old) == 1
text = text.replace(old, "trap 'cat \"$RUNNER_TEMP/definition-vite.log\"; kill \"$server\" 2>/dev/null || true' EXIT")
path.write_text(text)
