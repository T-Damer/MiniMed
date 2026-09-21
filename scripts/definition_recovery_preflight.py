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

# Resolve the locked package through the workspace instead of assuming hoisting layout.
Path('.definition-vite-launcher.cjs').write_text('''
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const local = createRequire(path.resolve('apps/app/package.json'));
const manifest = local.resolve('vite/package.json');
const bin = local(manifest).bin;
const relative = typeof bin === 'string' ? bin : bin.vite;
if (typeof relative !== 'string') throw new Error('Locked Vite package has no CLI');
const entry = path.resolve(path.dirname(manifest), relative);
process.argv = [process.execPath, entry, ...process.argv.slice(2)];
import(pathToFileURL(entry).href).catch(error => { console.error(error); process.exitCode = 1; });
''')
path = Path('.github/workflows/definition-mass-extraction-followup.yml')
text = path.read_text()
old = 'bunx vite --config apps/app/.definition-check.config.ts'
assert text.count(old) == 1
text = text.replace(old, 'node .definition-vite-launcher.cjs --config apps/app/.definition-check.config.ts')
old = "trap 'kill \"$server\" 2>/dev/null || true' EXIT"
assert text.count(old) == 1
text = text.replace(old, "trap 'cat \"$RUNNER_TEMP/definition-vite.log\"; kill \"$server\" 2>/dev/null || true' EXIT")
path.write_text(text)
