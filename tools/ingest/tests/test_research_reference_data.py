import json
from itertools import pairwise
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


def _int(value: object) -> int:
    assert isinstance(value, (int, float)) and not isinstance(value, bool)
    assert value == int(value)
    return int(value)


def _float(value: object) -> float:
    assert isinstance(value, (int, float)) and not isinstance(value, bool)
    return float(value)


def test_pediatric_bp_research_dataset_shape_and_ordering() -> None:
    data = _load("pediatric-bp-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    for sex in ("boys", "girls"):
        rows = _rows(data, "rows", sex)
        assert len(rows) == 51
        assert sorted({_int(row[0]) for row in rows}) == list(range(1, 18))

        for age in range(1, 18):
            age_rows = [row for row in rows if _int(row[0]) == age]
            assert [_int(row[1]) for row in age_rows] == [90, 95, 99]
            assert all(len(row) == 16 for row in age_rows)

            for row in age_rows:
                systolic = [_int(value) for value in row[2:9]]
                diastolic = [_int(value) for value in row[9:16]]
                assert systolic == sorted(systolic)
                assert diastolic == sorted(diastolic)

            for column in range(2, 16):
                values = [_int(row[column]) for row in age_rows]
                assert values[0] < values[1] < values[2]


def test_pediatric_height_research_dataset_shape_and_ordering() -> None:
    data = _load("pediatric-height-percentiles-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = _rows(data, "rows")
    assert len(rows) == 17
    assert [_int(row[0]) for row in rows] == list(range(1, 18))
    assert all(len(row) == 15 for row in rows)

    for row in rows:
        boys = [_float(value) for value in row[1:8]]
        girls = [_float(value) for value in row[8:15]]
        assert boys == sorted(boys)
        assert girls == sorted(girls)

    for column in range(1, 15):
        values = [_float(row[column]) for row in rows]
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
    assert [_int(row[0]) for row in rows] == list(range(2, 19))
    assert all(len(row) == 11 for row in rows)

    for row in rows:
        boys = [_float(value) for value in row[1:6]]
        girls = [_float(value) for value in row[6:11]]
        assert boys == sorted(boys)
        assert girls == sorted(girls)

    for column in range(1, 11):
        values = [_float(row[column]) for row in rows]
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
            assert _int(sex_data["n"]) > 0
            for metric in ("mass", "index"):
                values = cast(list[object], sex_data[metric])
                numeric = [_float(value) for value in values]
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


def test_neonatal_bp_research_dataset_shape_and_ordering() -> None:
    data = _load("neonatal-bp-by-gestational-age-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = _rows(data, "rows")
    assert len(rows) == 10
    assert [_int(row[0]) for row in rows] == [44, 42, 40, 38, 36, 34, 32, 30, 28, 26]

    for row in rows:
        assert len(row) == 4
        percentiles = row[1:]
        assert all(isinstance(cell, list) and len(cell) == 3 for cell in percentiles)
        for component in range(3):
            values = [_int(cast(list[object], cell)[component]) for cell in percentiles]
            assert values[0] < values[1] < values[2]


def test_infant_one_year_bp_research_dataset_shape_and_ordering() -> None:
    data = _load("infant-bp-age-1-year-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    for sex in ("boys", "girls"):
        rows = _rows(data, "rows", sex)
        assert [_int(row[0]) for row in rows] == [50, 90, 95, 99]

        for row in rows:
            assert len(row) == 3
            systolic = [_int(value) for value in cast(list[object], row[1])]
            diastolic = [_int(value) for value in cast(list[object], row[2])]
            assert len(systolic) == 7
            assert len(diastolic) == 7
            assert systolic == sorted(systolic)
            assert diastolic == sorted(diastolic)

        for column in range(7):
            systolic_values = [_int(cast(list[object], row[1])[column]) for row in rows]
            diastolic_values = [_int(cast(list[object], row[2])[column]) for row in rows]
            assert systolic_values == sorted(systolic_values)
            assert diastolic_values == sorted(diastolic_values)


def test_pediatric_bmi_adult_equivalent_thresholds_are_complete() -> None:
    data = _load("pediatric-bmi-adult-equivalent-thresholds-kr571-v2-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = _rows(data, "rows")
    assert len(rows) == 33
    ages = [_float(row[0]) for row in rows]
    assert ages[0] == 2
    assert ages[-1] == 18
    assert all(right - left == 0.5 for left, right in pairwise(ages))

    for row in rows:
        boys_bmi25 = _float(row[1])
        girls_bmi25 = _float(row[2])
        boys_bmi30 = _float(row[3])
        girls_bmi30 = _float(row[4])
        assert boys_bmi25 < boys_bmi30
        assert girls_bmi25 < girls_bmi30

    assert rows[-1] == [18, 25, 25, 30, 30]


def test_infant_complementary_feeding_research_dataset_preserves_blanks_and_meat_split() -> None:
    data = _load("infant-complementary-feeding-scheme-program2019.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["ageColumnsMonths"] == ["4-5", "6", "7", "8", "9-12"]

    rows = cast(list[dict[str, object]], data["rows"])
    assert len(rows) == 13

    by_id = {str(row["id"]): row for row in rows}
    meat_values = cast(list[object], by_id["meat"]["values"])
    assert meat_values[0] is None
    month_six = cast(dict[str, object], meat_values[1])
    assert month_six == {"industrialPuree": "5-30", "boiledMeat": "3-15"}

    curd_values = cast(list[object], by_id["curd"]["values"])
    assert curd_values[:3] == [None, None, None]
    assert curd_values[3:] == ["10-40", "50"]

    footnotes = cast(dict[str, object], data["footnotes"])
    assert footnotes["*"] == "не в качестве первого прикорма"
    assert footnotes["**"] == "по показаниям с 6 мес."


def test_newborn_colostrum_volume_research_dataset_ranges_are_ordered() -> None:
    data = _load("newborn-colostrum-volume-per-feed-program2019.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = cast(list[dict[str, object]], data["rows"])
    assert [row["lifeHours"] for row in rows] == ["0-24", "24-48", "48-72", "72-96"]

    minimums = [_int(row["minMlPerFeed"]) for row in rows]
    maximums = [_int(row["maxMlPerFeed"]) for row in rows]
    assert all(left <= right for left, right in zip(minimums, maximums, strict=True))
    assert minimums == sorted(minimums)
    assert maximums == sorted(maximums)


def test_infant_neuropsych_development_milestones_cover_first_year_without_interpretation() -> None:
    data = _load("infant-neuropsych-development-milestones-minzdrav-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["verificationStatus"] == "visual-table-review-source-context-limited"

    ages = cast(list[dict[str, object]], data["ages"])
    assert [_int(row["ageMonths"]) for row in ages] == list(range(1, 13))

    domains = cast(dict[str, object], data["domains"])
    assert set(domains) == {"Az", "As", "E", "Dr", "Do", "Rp", "Ra", "N", "S"}

    for row in ages:
        items = cast(list[list[object]], row["items"])
        assert items
        for domain, semantic_id in items:
            assert str(domain) in domains
            assert str(semantic_id)
            assert " " not in str(semantic_id)

    assert sum(len(cast(list[object], row["items"])) for row in ages) == 69
    assert "interpretation" not in data
    assert "cutoff" not in data


def test_infant_energy_macronutrient_needs_cover_first_year_age_bands() -> None:
    data = _load("infant-energy-macronutrient-needs-program2019.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = cast(list[dict[str, object]], data["rows"])
    assert [row["ageMonths"] for row in rows] == ["0-3", "4-6", "7-12"]
    assert [_int(row["energyKcalKg"]) for row in rows] == [115, 115, 110]
    assert [_float(row["proteinTotalGKg"]) for row in rows] == [2.2, 2.6, 2.9]
    assert [_float(row["carbohydrateGKg"]) for row in rows] == [13.0, 13.0, 13.0]

    for row in rows:
        assert _float(row["proteinAnimalGKg"]) <= _float(row["proteinTotalGKg"])
        assert _float(row["fatVegetableGKg"]) <= _float(row["fatTotalGKg"])


def test_infant_formula_volume_caloric_method_keeps_source_boundaries_explicit() -> None:
    data = _load("infant-formula-volume-caloric-method-program2019.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    energy_target = cast(dict[str, object], data["energyTarget"])
    assert _int(energy_target["kcalPerKgPerDay"]) == 115

    caps = cast(list[dict[str, object]], data["volumeCapsSource"])
    assert [(row["ageLabelSource"], row["maxMlPerDay"]) for row in caps] == [
        ("3 мес.", 850),
        ("4 мес.", 900),
        ("после 5 мес.", 1000),
    ]
    assert caps[-1]["requiresBoundaryReview"] is True

    boundary = cast(dict[str, object], data["calculationBoundary"])
    assert boundary["formulaEnergyDensityRequired"] is True
    assert boundary["directVolumeFormulaAbsent"] is True
    assert boundary["equationStatus"] == "derived-implementation-contract-requires-review"


def test_infant_micronutrient_needs_cover_same_age_bands_and_units() -> None:
    data = _load("infant-micronutrient-needs-program2019.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["ageBandsMonths"] == ["0-3", "4-6", "7-12"]

    minerals = cast(dict[str, object], data["minerals"])
    mineral_rows = cast(list[dict[str, object]], minerals["rows"])
    assert [row["ageMonths"] for row in mineral_rows] == ["0-3", "4-6", "7-12"]
    assert [_int(row["iron"]) for row in mineral_rows] == [4, 7, 10]
    assert [_float(row["iodine"]) for row in mineral_rows] == [0.04, 0.04, 0.05]

    vitamins = cast(dict[str, object], data["vitamins"])
    vitamin_rows = cast(list[dict[str, object]], vitamins["rows"])
    assert [row["ageMonths"] for row in vitamin_rows] == ["0-3", "4-6", "7-12"]
    assert [_int(row["vitaminA"]) for row in vitamin_rows] == [400, 400, 400]
    assert [_int(row["vitaminD"]) for row in vitamin_rows] == [10, 10, 10]
    assert [_int(row["folate"]) for row in vitamin_rows] == [40, 40, 60]

    mineral_units = cast(dict[str, object], minerals["units"])
    assert mineral_units["iodine"] == "mg_per_day_as_source"
