"""One-time recovery of fixture defaults; no production ranking or gold changes."""
from pathlib import Path

path = Path('packages/core/src/query-document-index.test.ts')
text = path.read_text()
old = 'ContentPackSeedSchema, type SearchFilters'
assert text.count(old) == 1
text = text.replace(old, 'ContentPackSeedSchema, SearchRequestSchema, type SearchFilters')
assert text.count('core.search({') == 9
text = text.replace('core.search({', "core.search({ ...SearchRequestSchema.parse({ query: 'fixture' }),")
path.write_text(text)
