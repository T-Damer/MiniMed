# Disk cleanup, 2026-09-27: recovery manifest

Disk had only ~31 GB free out of 926 GB while this session's GRLS work needed headroom for OCR and
SQLite builds. The user authorized reclaiming ~35 GB, **only for what is provably recoverable**,
recorded here before any deletion. Nothing is deleted unless its recovery method and checksum are
both confirmed in this file.

## 1. `data/build/omlx-bakeoff/runs/` — local OCR/VLM model bake-off (user's own trials)

`scripts/omlx_bakeoff.py` drives a comparison of several local OCR/vision-language models; each
`runs/<owner>_<model>/` directory turned out to be a full `git clone` (with `.git/`, working tree,
and a git-lfs object store) of the model's public Hugging Face repository, checked out at one
commit, with no local modifications (`git status --porcelain` was empty in every one). That makes
every one of these directories a byte-identical, verifiable download — not a private artifact.

Verified before deleting (remote reachability was not re-checked over the network; these are the
public `mlx-community`/`dots-studio` Hugging Face model pages, matching the directory names):

| Run directory | Hugging Face repo (git remote `origin`) | Commit | Weight file | SHA-256 | Size |
|---|---|---|---|---|---|
| `dots-studio_dots.ocr` | `https://huggingface.co/dots-studio/dots.ocr` | `c0111ce6bc07803dbc267932ffef0ae3a51dc951` | `model-00001-of-00002.safetensors` | `ea1d532184f3adf5cbcfcc00b2cf5b2abfa6fe182768a3ae63d441a9b5fc99ac` | ~11 GB (2 shards) |
| | | | `model-00002-of-00002.safetensors` | `26ab1ec6c8b4e4116befbd59af42159f1dbcb0ad0c045a15e890bb2f6e8b0dae` | |
| `mlx-community_DeepSeek-OCR-4bit` | `https://huggingface.co/mlx-community/DeepSeek-OCR-4bit` | `4958b6b0d46d7dc3cf27556989dab659996ea426` | `model.safetensors` | `cf97cb093ef54cd6847bf088d31fb5b507d5fd6e23f6f14ec486f2ec1e03c2eb` | 4.6 GB |
| `mlx-community_GLM-OCR-4bit` | `https://huggingface.co/mlx-community/GLM-OCR-4bit` | `97f587506984cc92fa69b2694b4128e53db6b081` | `model.safetensors` | `089e0339fcbc0fbf2225c3bd1cd94c6b4d49fdb3b1adfbb35ea22eb60b2afc95` | 2.3 GB |
| `mlx-community_Qwen3-VL-4B-Instruct-4bit` | `https://huggingface.co/mlx-community/Qwen3-VL-4B-Instruct-4bit` | `2fd8dacbdb8f1e54b8c005f081ec5bf79c56376b` | `model.safetensors` | `90eeb02604181dbcccd0a30a1f550a4a8928ca7dcbee4aee1449239306cfdfca` | 6.9 GB |
| `mlx-community_Unlimited-OCR-mxfp8` | `https://huggingface.co/mlx-community/Unlimited-OCR-mxfp8` | `abe730540fedc644751037b01ea0ce4acf478845` | `model.safetensors` | `eef3e920d4ef9429ef6353b4b98c34ed8935f678f91ff3bcf7de8ed73a7530db` | 7.1 GB |
| `dots.mocr_dots.ocr` | — | — | — | — | 0 B (already empty, nothing to reclaim) |

**Restore command** (per repo): `git clone <repo URL> <target>` then
`git -C <target> checkout <commit>`; verify with `shasum -a 256 <weight file>` against the table
above. All five repos are public model pages on Hugging Face; no authentication or private access
is implied by cloning them.

**What was deleted**: only the nested Hugging Face git-clone directories that hold the weights
(`runs/<name>/<owner>--<model>/`), reclaiming ~31.9 GB.

**What was kept, unchanged, next to the same run directories** (small, and not reproducible by a
repository/revision/checksum — these are this session's own comparison output, not a re-downloadable
artifact):
- `data/build/omlx-bakeoff/bakeoff-report.json` (2.7 MB, the aggregate comparison report)
- `data/build/omlx-bakeoff/runs/*/page-results.jsonl` (per-model OCR output on the test pages, <1 MB each)
- `data/build/omlx-bakeoff/runs/*/omlx-serve.log` (small run logs)
- `data/build/omlx-bakeoff/manual_reference.json`, `page-images/`, and the top-level `*.log` files

## 2. `data/build/medications-unified.pre-validation-fix.db` — NOT deleted

`data/build/medications-unified.pre-validation-fix.checkpoint.json` and
`data/build/medications-unified-run.sh` together document the exact command that produces
`medications-unified.db` (and, at an intermediate `--resume` checkpoint, the `.pre-validation-fix`
snapshot):

```sh
medbase compose \
  --input apps/app/public/content/medications.db \
  --input data/build/grls-instructions-current-189-v2.db \
  --input /private/tmp/minimed-esklp-full.AUX5bN/esklp-full.db \
  --output data/build/medications-unified.db \
  --edition-manifest data/build/medications-unified-edition-manifest.json \
  --edition-id minimed.medications.ru --edition-version 2026-09-02-preview.1 \
  --title 'Лекарственные препараты' --built-at 2026-09-02T12:30:00Z \
  --schema-version 2 --resume
```

Two of the three recorded input checksums verify against files still on disk right now:

- `apps/app/public/content/medications.db` → `sha256:5291b2da4dc34b4cf08323c2fd1a24a3a60fddc60a7034772c08124b817922c6` ✅ matches
- `data/build/grls-instructions-current-189-v2.db` → `sha256:7f9dd107a858d83a6260b7c4320589c0726daa9c042b1abf0c36bc9a59fc8ede` ✅ matches
- `/private/tmp/minimed-esklp-full.AUX5bN/esklp-full.db` → **not present** (an ephemeral `/private/tmp` working directory from that build session; macOS does not persist it across reboots)

So the command is known and two-thirds of its inputs are verified present, but the third input
(a large ESKLP-derived pack) would first need to be rebuilt through the separate ESKLP ingestion
pipeline (`medbase-regulated-catalog esklp`) before this exact compose could be re-run end to end
right now. That is not a zero-effort, immediate reproduction, so per the instruction to delete only
what reproduction is confirmed for, **this file was left in place**. The working
`data/build/medications-unified.db` itself was never touched, per the explicit instruction not to.

## Result

Reclaimed: ~31.9 GB (omlx-bakeoff model weights only). Left in place: `medications-unified.db`
(working file, untouched by instruction), `medications-unified.pre-validation-fix.db` (2.8 GB,
reproduction not fully self-contained right now), and every small report/result file noted above.
