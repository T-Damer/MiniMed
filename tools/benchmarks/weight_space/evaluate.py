"""Full tester-box contract pipeline (with the repair attempt) for baseline vs the chosen edit.

usage: evaluate.py K LAYER[,LAYER...]
"""

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
import wsp

RUNS = wsp.WSP / "runs"
k = int(sys.argv[1])
layers = [int(x) for x in sys.argv[2].split(",")]

tok, model = wsp.load()
items = wsp.cases()
test_ids = {item["id"] for item in items[1::2]}
# General-ability check: next-token loss on source passages the model never had to generate.
texts = [e.text for item in items for e in item["evidence"]][:120]

report = {"k": k, "layers": layers, "test_ids": sorted(test_ids)}
report["baseline_nll"] = wsp.nll(tok, model, texts)
baseline = wsp.evaluate(tok, model, items, label="base")

diff = torch.load(RUNS / "directions16.pt")["diff"].to(wsp.DEVICE)
report["changed_matrices"] = len(layers)
report["changed_weights"] = wsp.ablate(model, diff[k], layers)
report["edited_nll"] = wsp.nll(tok, model, texts)
edited = wsp.evaluate(tok, model, items, label="edit")

for name, rows in (("baseline", baseline), ("edited", edited)):
    report[name] = {
        "all": wsp.summary(rows),
        "test": wsp.summary([r for r in rows if r["id"] in test_ids]),
        "train": wsp.summary([r for r in rows if r["id"] not in test_ids]),
        "rows": rows,
    }
(RUNS / f"evaluate-{k}-{'-'.join(map(str, layers))}.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=1)
)
for name in ("baseline", "edited"):
    print(name, "test", report[name]["test"], "all", report[name]["all"])
print("nll", round(report["baseline_nll"], 4), "->", round(report["edited_nll"], 4))
