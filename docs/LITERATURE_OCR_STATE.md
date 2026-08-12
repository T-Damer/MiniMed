# Literature OCR state

Running ledger of every private-library file that has gone through OCR, its cost, and its current quality
status. This is the "what's been spent and what's actually usable" dashboard — for the source
classification see [LITERATURE_BANK.md](LITERATURE_BANK.md), for open questions on specific content see
[LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md). Update this file whenever a new file is OCR'd or
a quality/review status changes; nothing here is published or trusted content by itself.

**Quality column key**: `automated-clean` = passed an automated garbled-text scan only, no person has read
it yet — treat as "OCR pipeline didn't visibly break," not "content is correct." `hand-verified` = a person
(or this session's targeted page-by-page check) actually read the output against the source scan.
`issues-open` = has open items in the review queue.

## Batch run 2026-08-11 (this session, Replicate `datalab-to/marker`, `fast` mode, cost confirmed via API)

| File | Pages | Cost | Quality | Status |
| --- | ---: | ---: | --- | --- |
| `sample.ocr-draft.json` (5-page bake-off test) | 5 | $0.02 | **hand-verified** — read in full, matches source | reference sample only, not book content |
| `pdb.procentil-mzh.ocr-draft.json` | 8 | $0.03 | automated-clean, partially hand-checked | **issues-open** — no source attribution, two unreconciled norm systems |
| `pdb.pochivalov.ocr-draft.json` | 272 | $1.09 | automated-clean, one table hand-verified in the bake-off | **issues-open** — 256 of 257 tables and 123 of 124 dose mentions not hand-checked |
| `pdb.kapitan.merged.ocr-draft.json` (4 parts) | 458 | $1.83 | automated-clean only | **issues-open** — 1036 tables not hand-checked; part 4 (renal norms) is highest-value, review first |
| **Subtotal** | **743** | **$2.97** | | |

## Pre-existing batch, found 2026-08-09 (not run this session — predates this investigation)

Cost not confirmed via the Replicate API used in this session (these predictions do not appear in that
account's history — likely run under a different token/account). Figures below are **estimated** at the
same $0.004/page fast-mode rate; treat as approximate until the actual billing source is confirmed.

| File | Pages | Est. cost | Quality | Status |
| --- | ---: | ---: | --- | --- |
| `neo.volodin_nr.ocr-draft.json` | 750 | ~$3.00 | automated-clean only | not reviewed |
| `neo.shabalov.ocr-draft.json` | 704 | ~$2.82 | automated-clean only | not reviewed |
| `ft.moiseev_t1.ocr-draft.json` | 960 | ~$3.84 | automated-clean only | not reviewed |
| `trauma.kotelnikov.ocr-draft.json` | 560 | ~$2.24 | automated-clean only | not reviewed |
| `lor.bogomilsky.ocr-draft.json` | 432 | ~$1.73 | automated-clean only | not reviewed |
| `ftiz.lozovskaya.ocr-draft.json` | 198 | ~$0.79 | automated-clean only | not reviewed |
| `psych.obschaya.ocr-draft.json` | 109 | ~$0.44 | automated-clean only | not reviewed |
| **Subtotal** | **3,713** | **~$14.85** | | |

## Running total

- **Pages OCR'd across all files: 4,456**
- **Cost: $2.97 confirmed (this session) + ~$14.85 estimated (pre-existing batch) ≈ $17.82 total**
- **Hand-verified: 5 pages** (the bake-off sample). Everything else is only automated-scanned — clean of
  garbled text, but no numeric value from any of these files is confirmed correct against its source scan.
- **Nothing here is "ideal" yet in the sense of ready-to-use** — "automated-clean" only means the OCR
  pipeline didn't visibly break, not that a clinician has confirmed the tables/norms are right. The
  pre-existing 2026-08-09 batch (3,713 of the 4,456 total pages) has not been quality-checked at all since
  being found — same open question flagged in [LITERATURE_BANK.md](LITERATURE_BANK.md).

## Next update triggers

Update this file when: a new file goes through OCR (add a row, update the running total); a file moves
from automated-clean to hand-verified; a [LITERATURE_REVIEW_QUEUE.md](LITERATURE_REVIEW_QUEUE.md) item
tied to a file is resolved and its status here should change accordingly.
