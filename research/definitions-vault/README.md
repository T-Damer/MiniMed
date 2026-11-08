# Definitions as a vault of linked notes — measurement prototype

This folder is research only. The app's data path does not read it, and nothing in `content/` was
changed. The findings are in `docs/research/definitions-vault-2026-11.md`.

- `vault/` holds the pilot: 85 concepts and 246 definitions converted from today's JSON/YAML.
  - One note per concept (`<canonical term>.md`, with « — » in place of «:»).
  - The frontmatter holds `id`, `title`, `aliases`, `kind`, `related` and `sources`.
  - Each definition is a `## <source>` block. Under it come the verbatim text, a `^def-…` block id
    and a ```` ```def ```` fence with the original record. In that record, `"@text"` stands in for
    the text, so the record round-trips byte for byte.
  - Records without text (term entries, discovered names, completion targets, colloquial aliases)
    sit under `## Записи`.
  - File headers (sources, receipts) are in `_источники/`.
- `tools/vault.py` converts, builds, validates and compares:
  - `convert` turns the JSON layer into notes. `--link` inserts exact-match `[[links]]`.
  - `build` turns the notes back into the exact JSON/YAML files of today. Links are stripped.
  - `validate` checks for bad or duplicate ids, an alias on two concepts, an alias equal to another
    concept's title, a missing source or locator, a missing hash, and `textSha256` ≠ text.
  - `compare` (whole layer) and `pilot-compare` (projection) do byte comparisons with `content/`.
- The measurement scripts are `tools/inventory.py`, `tools/link_stats.py` and
  `tools/obsidian_probe.ts`. The probe runs an isolated Obsidian profile and never touches the
  owner's vault or settings. Outputs go to `out/`.

```bash
cd research/definitions-vault/tools
python3 vault.py convert --out ../vault --pilot ../pilot-concepts.json --link
python3 vault.py build --vault ../vault --out /tmp/defvault-built
python3 vault.py pilot-compare --built /tmp/defvault-built --pilot ../pilot-concepts.json
python3 vault.py validate --vault ../vault
```

The whole-layer round trip (`convert --out <scratch>` without `--pilot`, then `build` and
`compare`) writes about 24 900 notes / 93 MB. Run it outside the repository.
