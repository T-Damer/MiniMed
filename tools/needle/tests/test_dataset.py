"""Dataset generator invariants."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from needle_med.dataset import (
    ASSESSMENT_PHRASES,
    build_calculator_pool,
    check_grounding,
    generate_dataset,
    load_tool_schemas,
    validate_samples,
)


def test_generation_produces_valid_split(tmp_path: Path) -> None:
    out = tmp_path / "needle"
    stats = generate_dataset(out, seed=7, scale=0.2)
    train_lines = (out / "train.jsonl").read_text(encoding="utf-8").splitlines()
    val_lines = (out / "val.jsonl").read_text(encoding="utf-8").splitlines()
    assert train_lines and val_lines
    assert stats["train"] == len(train_lines)
    assert stats["val"] == len(val_lines)
    for line in train_lines + val_lines:
        sample = json.loads(line)
        assert set(sample) >= {"query", "tools", "answers"}
        assert "_target" not in sample
        assert sample["query"].strip()


def test_tool_catalogs_stay_in_sync() -> None:
    schemas = load_tool_schemas()
    pool, known_calculators = build_calculator_pool(schemas)
    pool_ids = {spec.calc_id for spec in pool}
    assert "dose-by-weight" in pool_ids and "dose-by-weight" in known_calculators
    assert len(pool) > 15
    enum = schemas["run_assessment"]["parameters"]["properties"]["assessment_id"]["enum"]
    assert set(enum) == set(ASSESSMENT_PHRASES)
    search_enum = schemas["search_medical_documents"]["parameters"]["properties"]["scope"]["enum"]
    assert set(search_enum) == {"diagnosis", "guidelines", "medications", "legal"}


def test_grounding_rejects_unevidenced_values() -> None:
    assert check_grounding("ребёнок весом 18 кг", {"weight_kg": 18}) is None
    assert check_grounding("калий 3,4", {"potassium_mmol_l": 3.4}) is None
    assert check_grounding("женщина 55 лет", {"sex": "female", "age_years": 55}) is None
    assert check_grounding("вес 18 кг", {"weight_kg": 42}) == "weight_kg=42 not grounded"
    result = check_grounding("масса 20 кг", {"sex": "female"})
    assert result is not None and result.startswith("sex")


def test_validate_reports_duplicates_and_unknown_tools() -> None:
    schemas = load_tool_schemas()
    off_topic: dict[str, Any] = {
        "query": "который час?",
        "tools": [schemas["find_icd"]],
        "answers": [],
        "_target": "off-topic",
    }
    duplicate = dict(off_topic)
    errors = validate_samples([off_topic, duplicate], schemas, frozenset())
    assert any("duplicate" in error for error in errors)

    bad_tool: dict[str, Any] = {
        "query": "код МКБ при пневмонии",
        "tools": [schemas["find_icd"]],
        "answers": [{"name": "find_interaction", "arguments": {}}],
        "_target": "find_icd",
        "reasoning": "",
    }
    errors = validate_samples([bad_tool], schemas, frozenset())
    assert any("not declared" in error for error in errors)
