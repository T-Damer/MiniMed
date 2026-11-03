"""Baseline: generate all 20 contract prompts, save tokens for direction extraction."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import wsp

OUT = wsp.WSP / "runs"
OUT.mkdir(exist_ok=True)

tok, model = wsp.load()
items = wsp.cases()
generations = {}
for item in items:
    answer, new, _, hit = wsp.generate(tok, model, item["system"], item["prompt"])
    generations[item["id"]] = new
    print(
        f"{item['id'][:26]:26} tokens={len(new)} rep={wsp.repetition(new):.2f} limit={int(hit)}",
        flush=True,
    )
(OUT / "baseline-generations.json").write_text(json.dumps(generations))
