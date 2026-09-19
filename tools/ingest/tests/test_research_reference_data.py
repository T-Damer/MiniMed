from __future__ import annotations

import json
from pathlib import Path
from typing import cast


ROOT = Path(__file__).resolve().parents[3]
RESEARCH_DATA = ROOT / "docs" / "research" / "data"


def _load(name: str) -> dict[str, object]:
    value: object = json.loads((RESEARCH_DATA / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _rows(data: dict[str, object], *path: str) -> list[list[object]]:
    value: object = data
    for key in path:
        assert isinstance(value, dict)
        value = cast(dict[str, object], value)[key]
    assert isinstance(value, list)
    return cast(list[list[object]], value)


def test_pediatric_bp_research_dataset_shape_and_ordering() -> None:
    data = _load("pediatric-bp-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    for sex in ("boys", "girls"):
        rows = _rows(data, "rows", sex)
        assert len(rows) == 51
        assert sorted({int(row[0]) for row in rows}) == list(range(1, 18))

        for age in range(1, 18):
            age_rows = [row for row in rows if int(row[0]) == age]
            assert [int(row[1]) for row in age_rows] == [90, 95, 99]
            assert all(len(row) == 16 for row in age_rows)

            for row in age_rows:
                systolic = [int(value) for value in row[2:9]]
                diastolic = [int(value) for value in row[9:16]]
                assert systolic == sorted(systolic)
                assert diastolic == sorted(diastolic)

            for column in range(2, 16):
                values = [int(row[column]) for row in age_rows]
                assert values[0] < values[1] < values[2]


def test_pediatric_height_research_dataset_shape_and_ordering() -> None:
    data = _load("pediatric-height-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = _rows(data, "rows")
    assert len(rows) == 17
    assert [int(row[0]) for row in rows] == list(range(1, 18))
    assert all(len(row) == 15 for row in rows)

    for row in rows:
        boys = [float(value) for value in row[1:8]]
        girls = [float(value) for value in row[8:15]]
        assert boys == sorted(boys)
        assert girls == sorted(girls)

    for column in range(1, 15):
        values = [float(row[column]) for row in rows]
        assert values == sorted(values)


def test_pediatric_abpm_research_dataset_preserves_known_source_anomaly() -> None:
    data = _load("pediatric-abpm-reference-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["verificationStatus"] == "single-source-transcription-with-source-anomaly"

    assert len(_rows(data, "rows", "byAge", "boys")) == 12
    assert len(_rows(data, "rows", "byAge", "girls")) == 12
    assert len(_rows(data, "rows", "byHeight", "boys")) == 14
    assert len(_rows(data, "rows", "byHeight", "girls")) == 12

    checks = cast(dict[str, object], data["automatedChecks"])
    anomalies = cast(list[dict[str, object]], checks["withinPeriodPercentileOrderingAnomalies"])
    assert anomalies == [
        {
            "component": "sbp",
            "dimension": "ageYears",
            "dimensionValue": 16,
            "handling": "preserve-source-value-review-required",
            "lowerPercentile": 90,
            "lowerValue": 123,
            "period": "night",
            "sex": "boys",
            "upperPercentile": 95,
            "upperValue": 122,
        }
    ]


def test_pediatric_waist_research_dataset_shape_and_ordering() -> None:
    data = _load("pediatric-waist-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = _rows(data, "rows")
    assert len(rows) == 17
    assert [int(row[0]) for row in rows] == list(range(2, 19))
    assert all(len(row) == 11 for row in rows)

    for row in rows:
        boys = [float(value) for value in row[1:6]]
        girls = [float(value) for value in row[6:11]]
        assert boys == sorted(boys)
        assert girls == sorted(girls)

    for column in range(1, 11):
        values = [float(row[column]) for row in rows]
        assert values == sorted(values)


def test_pediatric_lv_mass_research_dataset_percentiles_stay_inside_source_range() -> None:
    data = _load("pediatric-lv-mass-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    bands = cast(list[dict[str, object]], data["bands"])
    assert len(bands) == 10

    for band in bands:
        for sex in ("boys", "girls"):
            sex_data = cast(dict[str, object], band[sex])
            assert int(sex_data["n"]) > 0
            for metric in ("mass", "index"):
                values = cast(list[object], sex_data[metric])
                numeric = [float(value) for value in values]
                assert len(numeric) == 8
                percentiles = numeric[:6]
                minimum, maximum = numeric[6:]
                assert percentiles == sorted(percentiles)
                assert minimum <= percentiles[0]
                assert percentiles[-1] <= maximum


def test_pediatric_lipid_research_dataset_keeps_missing_operators_explicit() -> None:
    data = _load("pediatric-lipid-reference-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["verificationStatus"] == (
        "single-source-html-cell-transcription-with-operator-gaps"
    )

    rows = cast(list[dict[str, object]], data["rows"])
    assert len(rows) == 6
    total_cholesterol = rows[0]
    high = cast(dict[str, object], total_cholesterol["high"])
    assert high["mmolL"] == "5.2"
    assert high["operatorStatus"] == "missing-in-rendered-source"

    hdl = rows[-1]
    target = cast(dict[str, object], hdl["target"])
    target_operator = cast(dict[str, object], target["operatorStatus"])
    assert target["mmolL"] == "1.16"
    assert target_operator["mmolL"] == "missing-in-rendered-source"
