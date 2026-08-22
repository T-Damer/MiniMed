"""Evaluate a Needle checkpoint on the MiniMed held-out validation split.

Usage (inside the ``train`` dependency group):

    uv run --project tools/needle --group train python tools/needle/eval_model.py \
        --data data/needle/val.jsonl [--weights checkpoints/my.cact] [--limit 50]

Reports JSON-parse rate, tool-name F1, argument exactness, off-topic refusal
rate, and exact-match rate, then prints a few failing samples.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

TOOLS_PATH = Path(__file__).resolve().parent / "minimed_tools.json"


def _arguments_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return abs(float(left) - float(right)) < 1e-6
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _arguments_equal(left[key], right[key]) for key in left
        )
    return left == right


def score_row(
    row: dict[str, Any], function_calls: list[dict[str, Any]], success: bool
) -> dict[str, bool]:
    expected = row["answers"]
    if not expected:
        refused = success and not function_calls
        return {"parse": success, "names": refused, "args": refused, "exact": refused}
    parse_ok = success and len(function_calls) > 0
    expected_names = [answer["name"] for answer in expected]
    names_ok = sorted(str(name) for name in expected_names) == sorted(
        str(call.get("name")) for call in function_calls
    )
    args_ok = names_ok and all(
        any(
            call.get("name") == answer["name"]
            and _arguments_equal(call.get("arguments"), answer.get("arguments"))
            for call in function_calls
        )
        for answer in expected
    )
    return {
        "parse": parse_ok,
        "names": names_ok,
        "args": args_ok,
        "exact": parse_ok and names_ok and args_ok,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="JSONL file with expected answers")
    parser.add_argument("--weights", type=Path, default=None, help="tuned .cact/.pkl checkpoint")
    parser.add_argument("--limit", type=int, default=None)
    options = parser.parse_args()

    try:
        from needle import Needle
    except ImportError as error:  # pragma: no cover - environment guard
        raise SystemExit(
            "cactus-needle is not installed. Run: uv sync --project tools/needle --group train"
        ) from error

    from needle_med.dataset import _slim_schema

    schemas = [_slim_schema(tool) for tool in json.loads(TOOLS_PATH.read_text(encoding="utf-8"))]
    weights = str(options.weights) if options.weights else None
    # The default 64 KiB buffer can split multi-byte UTF-8 characters on long
    # Cyrillic tool catalogs, so give the engine a larger response buffer.
    agent = Needle(tools=schemas, weights=weights, buffer_size=262144)

    def tolerant_complete(bound: Any, text: str, max_new_tokens: int = 256) -> dict[str, Any]:
        """Work around upstream engines emitting truncated multi-byte characters."""
        from needle import _lib

        bound._bind()
        return_code = _lib().needle_complete(
            text.encode("utf-8"), int(max_new_tokens), bound._buffer, len(bound._buffer)
        )
        if return_code < 0:
            raise RuntimeError(f"needle_complete failed (code {return_code})")
        raw = bound._buffer.value
        return json.loads(raw.decode("utf-8", errors="replace"))

    agent.complete = lambda text, max_new_tokens=256: tolerant_complete(agent, text, max_new_tokens)

    rows = [
        json.loads(line)
        for line in options.data.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if options.limit:
        rows = rows[: options.limit]

    totals = {"parse": 0, "names": 0, "args": 0, "exact": 0}
    per_tool: dict[str, dict[str, int]] = {}
    failures: list[str] = []
    for index, row in enumerate(rows):
        try:
            result = agent.complete(str(row["query"]))
        except Exception as error:
            failures.append(f"[{index}] engine error: {error}\n    query: {row['query']}")
            continue
        calls = list(result.get("function_calls") or [])
        marks = score_row(row, calls, bool(result.get("success")))
        for key in totals:
            if marks[key]:
                totals[key] += 1
        label = str(row["answers"][0]["name"]) if row["answers"] else "off-topic"
        stats_row = per_tool.setdefault(label, {"n": 0, "exact": 0})
        stats_row["n"] += 1
        if marks["exact"]:
            stats_row["exact"] += 1
        elif not row["answers"]:
            pass
        else:
            failures.append(
                f"[{index}] query: {row['query'][:110]}\n"
                f"    expected: {json.dumps(row['answers'], ensure_ascii=False)[:180]}\n"
                f"    actual:   {json.dumps(calls, ensure_ascii=False)[:180]}"
            )

    total = max(1, len(rows))
    print(f"samples:      {len(rows)}")
    print(f"parse rate:   {totals['parse'] / total:.1%}")
    print(f"name match:   {totals['names'] / total:.1%}")
    print(f"args exact:   {totals['args'] / total:.1%}")
    print(f"exact match:  {totals['exact'] / total:.1%}")
    print("\nper tool:")
    for label in sorted(per_tool):
        stats_row = per_tool[label]
        rate = stats_row["exact"] / max(1, stats_row["n"])
        print(f"  {label:28s} {stats_row['exact']:3d}/{stats_row['n']:<3d} ({rate:.1%})")
    shown = failures[:8]
    if shown:
        print("\nfailing samples:")
        print("\n".join(shown))


if __name__ == "__main__":
    main()
