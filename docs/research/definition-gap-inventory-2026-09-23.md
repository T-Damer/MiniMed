# Definition gaps: acquisition and an offline research queue

## Verified source acquisition

[Run 35847400492](https://github.com/T-Damer/MiniMed/actions/runs/35847400492)
filled five existing empty identities: **Афония, Ксеростомия, Гематокрит,
Электромиография, Асфиксия**. The separate **Гиперсаливация** candidate remains
pending because its selected source was unreachable from the acquisition runner.
A failed request is not permission to synthesize the definition or bypass source access rules.

The measured edition has **8,415 source-local definitions**, **7,632 name-only records**
and **16,047 searchable identities**. This is a five-record coverage improvement, not five
new identities or a canonical concept count. The old 34,322 blocks, names and source links
were preserved. All five completed cards were readable through the ordinary SQLite adapter
and ranked first by their exact titles. Both authored descriptive probes remained outside
Top-20; no general reverse-search improvement is claimed.

Evidence: [acquisition outcomes](clinic-definition-acquisition-2026-09-23.json) and
[SQLite/reader comparison](clinic-definition-completion-2026-09-23.json).
Excerpts remain local-dev and require review. The input preserves source locators and real
page/paragraph/excerpt hashes, not generated medical prose or redistribution approval.

## Research queue

`localmed_ingest.definition_gap_inventory` reads the ordinary source, discovered-name and
accepted-completion manifests. It never fetches pages and does not mutate the projection.
Every still-empty source identity appears exactly once, with its original title, kind and
discovery receipt. Normalized titles select one of three review buckets:

- `ready-for-source-research`: one empty identity with no same-title definition.
- `ambiguous-discovered-title`: several empty identities share that normalized title.
- `same-title-definition-needs-sense-review`: a definition already has that title; an editor
  must check its meaning instead of importing or merging it automatically.

Aliases do not prove title identity. A source gloss, contextual mention or different-kind
title collision cannot silently become a clinical definition. Counts of identities and
normalized titles are reported separately. None of these states grants clinical approval.

```bash
uv sync --project tools/ingest --all-groups --locked
uv run --project tools/ingest python -m localmed_ingest.definition_gap_inventory \
  --root . --output data/build/definition-gaps-review.json
uv run --project tools/ingest pytest -q \
  tools/ingest/tests/test_definition_gap_inventory.py
```

Choose a new output path when repeating the inventory; prior receipts are not overwritten.
Use the queue before selecting new source excerpts, then bind acquisition to the exact
identity/receipt. Do not fill all equal-looking names with one guessed medical meaning.

## Repeatable verification

`.github/workflows/clinic-definition-verify.yml` now checks **committed code**, rather than
patching the builders and fixtures inside a runner. It has read-only repository permissions,
no push token, no live source acquisition, no artifact uploads and no dependency cache.
The obsolete one-shot `clinic-definition-completions.yml` patcher has been removed.

The workflow runs strict formatting, lint, typing and the scoped regression suite, then
rebuilds the ordinary compact SQLite edition with network calls rejected. Its final audit
compares every queued identity and coverage state with the actual database, checks logical
and gzip round trips, integrity and foreign keys, and rejects any tracked-file mutation.
Measured queue counts and checksums are printed to the workflow log; the full queue and DB
stay on the runner. This is not Android/browser UI qualification or a whole-repository CI pass.

For a local edition, use the same existing preparer with a new DEV version:

```bash
uv run --project tools/ingest python scripts/prepare-definition-reference.py \
  --version 2026.09.23-clinic-gaps-local --built-at 2026-09-23
```

No APK, released core, private source book or public database binary was replaced.
