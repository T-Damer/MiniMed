"""Extract per-layer looping directions on the train split and pick layers by train-only generations."""

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
import wsp

RUNS = wsp.WSP / "runs"
tok, model = wsp.load()
items = wsp.cases()
train = items[0::2]
generations = json.loads((RUNS / "baseline-generations.json").read_text())

mean_loop, mean_ok, counts = wsp.hidden_means(tok, model, train, generations)
print("positions", counts)
diff = mean_loop - mean_ok
for k in range(diff.shape[0]):
    cos = torch.nn.functional.cosine_similarity(diff[k], mean_ok[k], dim=0).item()
    print(
        f"layer {k:2} |diff|={diff[k].norm():8.2f} |ok|={mean_ok[k].norm():8.2f} cos(diff,ok)={cos:+.2f}"
    )
torch.save({"diff": diff.cpu(), "counts": counts}, RUNS / "directions.pt")

original = {
    i: layer.mlp.down_proj.weight.detach().clone()
    for i, layer in enumerate(model.model.layers)
}


def restore():
    with torch.no_grad():
        for i, layer in enumerate(model.model.layers):
            layer.mlp.down_proj.weight.copy_(original[i])


def score(label):
    rows = []
    for item in train:
        answer, new, _, hit = wsp.generate(tok, model, item["system"], item["prompt"])
        rows.append(
            {
                "rep": wsp.repetition(new),
                "hit": hit,
                "json": wsp.tb.extract_json(answer) is not None,
            }
        )
    s = {
        "label": label,
        "mean_rep": round(sum(r["rep"] for r in rows) / len(rows), 3),
        "looping": sum(r["rep"] >= 0.2 for r in rows),
        "hit": sum(r["hit"] for r in rows),
        "json": sum(r["json"] for r in rows),
    }
    print(s, flush=True)
    return s


results = [score("baseline")]
layers = model.config.num_hidden_layers
# Exp. 8 shape: one direction, removed from the MLP outputs of two adjacent layers.
for k in range(6, layers + 1, 2):
    restore()
    changed = wsp.ablate(model, diff[k], [k - 2, k - 1])
    results.append(
        score(f"dir@{k} -> mlp{k - 2},{k - 1}")
        | {"k": k, "layers": [k - 2, k - 1], "changed": changed}
    )
# Abliteration shape: the same direction removed from every MLP output.
for k in (12, 16, 20):
    restore()
    changed = wsp.ablate(model, diff[k], list(range(layers)))
    results.append(
        score(f"dir@{k} -> all mlp")
        | {"k": k, "layers": list(range(layers)), "changed": changed}
    )
(RUNS / "search.json").write_text(json.dumps(results, indent=1))
