# Data ledger

Large local data lives outside Git (`data/`, `release-clinical/`, `output/`, parts of
`apps/app/public/content/`, `model-mirror/`). The machine-readable ledger
[`data-ledger.json`](data-ledger.json) records every artifact of at least 50 MiB: what it is, what
produces and reads it, how to get it back, and whether it may be deleted. `Med/` holds the user's
own textbooks and is out of scope: never move, rewrite or delete it.

```bash
bun run data:ledger                        # measure, sum by class, list candidates and unknowns
bun run data:ledger -- --write             # store measured bytes/dates in the ledger
bun run data:ledger -- --strict            # exit 1 if something is unrecorded or vanished
bun run data:ledger -- --commands          # print rm commands for "safe" candidates only
bun run data:ledger -- --commands --tier=confirm   # include "confirm" candidates
```

## Classes

| Class | Meaning | Recover by |
|---|---|---|
| SOURCE | Raw downloads/scrapes; expensive or impossible to recreate | nothing: keep |
| RELEASED | Published as a GitHub release asset or `datasets/*` branch | `gh release download <tag>` / branch checkout |
| REBUILDABLE | Output of a recorded command over SOURCE/RELEASED inputs | the `rebuild` command in the ledger |
| DUPLICATE | Identical bytes (or a verified superset) at another recorded path | the other path |
| BACKUP | Historical checkpoint nothing reads | not needed; released versions are on GitHub |
| OBSOLETE | Superseded or abandoned output nothing reads | not needed |

## Where things live (2026-09-29, 97 entries)

| Area | What | Class |
|---|---|---|
| `data/raw/*` | GRLS instruction PDFs (13 GiB), krasotaimedicina crawl (4.3 GiB), clinical PDFs, GRLS registry, vaccine PDFs | SOURCE |
| `data/intermediate/rls-mkb`, `allmed-*` | RLS MKB scrape state; Allmed workspace (its snapshot is not on this machine) | SOURCE |
| `data/intermediate/grls-full-final` | all GRLS OCR/extractions (8 868); `grls-full-v1…v6` are contained batches | REBUILDABLE / DUPLICATE |
| `data/build/release-clinical`, `release-esklp`, `official-clinical-documents-2026-07-27`, `mkb.db` | local copies of published data | RELEASED |
| `data/build/official-clinical-2026-10-02` | incremental КР refresh: 30 published `.db.zst` (`zst/`) and the plan; raw JSON of 763 current + 496 replaced editions lives in `data/raw/official-clinical-documents` | RELEASED / SOURCE |
| `data/build/*-module`, `definition-reference` | module builds whose `.db.gz` are released | RELEASED |
| `data/build/core-*`, `core.0.7.0-test7*`, `diseases.db`, `official-clinical-documents` | `bun run content:core:build` inputs/outputs | REBUILDABLE |
| `data/build/core.0.7.0-test1…6*`, `ux-icd-*`, `core-before-*`, `mkb-legacy.db` | superseded experiments | OBSOLETE / BACKUP |
| `apps/app/public/content/core.db` | released discovery core (`content:restore:core`) | RELEASED — never touch by hand |

The per-artifact producer, consumers, release tag and rebuild command are in the JSON.

## Rules

- Before creating a new artifact of 50 MiB or more, or after a pipeline changes its output, add or
  update its ledger entry and run `bun run data:ledger -- --write`. Unrecorded artifacts show up in
  every report.
- Deletion is the project owner's decision. Agents may propose candidates and print commands; they
  never delete. SOURCE is never a candidate (the script refuses). `confirm` candidates need a
  specific yes from the owner; `safe` ones only need the owner to run the printed commands.
- `output/release-*`: the AGENTS.md rule (newest releases, never fewer than 2) wins over the ledger.
- Before deleting a RELEASED or DUPLICATE copy, verify that the other copy still exists (the report
  lists recorded artifacts that vanished).
- While the project is active, keep at least one local copy of every RELEASED artifact that the
  current catalog or app uses (owner decision 2026-09-29): GitHub is not the only copy, in case the
  account or service becomes unavailable. A RELEASED path is a delete candidate only when it is no
  longer referenced or another local copy exists.
- Never hand-edit a generated database to "fix" the ledger; rebuild through the recorded command.
