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


def test_pediatric_water_beverage_reference_keeps_scope_separate_from_total_fluid() -> None:
    data = _load("pediatric-water-beverages-mr-2.3.1.0253-21.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    rows = cast(list[dict[str, object]], data["rows"])
    infant = rows[0]
    assert infant["age"] == "7-11_months"
    assert _float(infant["minLitersPerDay"]) == 0.2
    assert _float(infant["maxLitersPerDay"]) == 0.3

    context = cast(dict[str, object], data["infantContext"])
    assert context["numericAdditionalFluidFor0To6Months"] is None
    assert context["interpretation"] == "no-numeric-extra-fluid-rule"

    scope = cast(dict[str, object], data["scope"])
    assert scope["quantity"] == "water_and_beverages"
    excluded = cast(list[object], scope["excludes"])
    assert "maintenance_intravenous_fluid" in excluded
    assert "illness_related_rehydration" in excluded


def test_caliper_hematology_expansion_preserves_method_specific_intervals() -> None:
    data = _load("caliper-dxh900-pediatric-hematology-expansion-2020.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    source = cast(dict[str, object], data["source"])
    assert source["analyzer"] == "Beckman Coulter DxH 900"

    parameters = cast(list[dict[str, object]], data["parameters"])
    assert len(parameters) == 14
    by_id = {str(parameter["id"]): parameter for parameter in parameters}
    assert "hemoglobin" not in by_id
    assert "rbc" not in by_id
    assert "wbc" not in by_id
    assert "platelet_count" not in by_id

    for parameter in parameters:
        intervals = cast(list[dict[str, object]], parameter["intervals"])
        assert intervals
        for interval in intervals:
            assert _float(interval["lower"]) < _float(interval["upper"])
            assert str(interval["ageYears"])

    hematocrit = cast(list[dict[str, object]], by_id["hematocrit"]["intervals"])
    adolescent = [row for row in hematocrit if row["ageYears"] == "14-<21"]
    assert adolescent == [
        {"ageYears": "14-<21", "sex": "male", "lower": 0.388, "upper": 0.482},
        {"ageYears": "14-<21", "sex": "female", "lower": 0.344, "upper": 0.437},
    ]

    neutrophils = cast(list[dict[str, object]], by_id["neutrophil_absolute"]["intervals"])
    assert neutrophils[0] == {
        "ageYears": "0-<1",
        "sex": "all",
        "lower": 0.9,
        "upper": 4.6,
    }


def test_pediatric_preventive_exam_schedule_order_211n_preserves_conditionals() -> None:
    data = _load("pediatric-preventive-exam-schedule-order-211n-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["rightsStatus"] == "official-regulatory-act"

    rows = cast(list[dict[str, object]], data["rows"])
    assert len(rows) == 31
    assert [_int(row["order"]) for row in rows] == list(range(1, 32))
    assert len({str(row["age"]) for row in rows}) == 31

    one_month = rows[1]
    assert one_month["age"] == "1_month"
    assert cast(list[object], one_month["studies"]) == [
        "abdominal_ultrasound_complete",
        "kidney_ultrasound",
        "bilateral_hip_ultrasound",
        "echocardiography",
        "neurosonography",
        "ophthalmoscopy_with_mydriasis",
    ]

    eighteen_months = next(row for row in rows if row["age"] == "18_months")
    assert cast(list[object], eighteen_months["studies"]) == ["mental_development_risk_screening"]
    conditional = cast(list[dict[str, object]], eighteen_months["conditionalSpecialists"])
    assert conditional == [
        {
            "condition": "positive_or_at_risk_mental_development_screen",
            "specialist": "neurologist",
        }
    ]

    six_years = next(row for row in rows if row["age"] == "6_years")
    conditional_studies = cast(list[dict[str, object]], six_years["conditionalStudies"])
    assert conditional_studies == [
        {
            "condition": "risk_group_for_cholesterol_screening",
            "study": "cholesterol_express_test_risk_group",
        }
    ]
    sex_specialists = cast(list[dict[str, object]], six_years["conditionalSpecialists"])
    assert {str(item["condition"]) for item in sex_specialists} == {"sex_female", "sex_male"}

    seventeen_years = rows[-1]
    assert seventeen_years["age"] == "17_years"
    assert cast(list[object], seventeen_years["studies"]) == [
        "complete_blood_count",
        "urinalysis",
        "electrocardiography",
    ]


def test_neonatal_jaundice_treatment_thresholds_kr916_are_ordered() -> None:
    data = _load("neonatal-jaundice-treatment-thresholds-kr916-v1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    age_bins = cast(list[object], data["postnatalAgeBins"])
    assert [str(value) for value in age_bins] == [
        "<24h",
        "24-48h",
        "48-72h",
        "72-96h",
        "96-120h",
        ">120h",
    ]

    thresholds = cast(dict[str, object], data["thresholds"])
    standard = [_int(value) for value in cast(list[object], thresholds["standardPhototherapy"])]
    intensive = [_int(value) for value in cast(list[object], thresholds["intensivePhototherapy"])]
    exchange = [_int(value) for value in cast(list[object], thresholds["exchangeTransfusion"])]

    assert standard == [171, 205, 239, 274, 291, 308]
    assert intensive == [188, 274, 308, 342, 376, 376]
    assert exchange == [205, 308, 342, 376, 428, 428]
    assert all(
        standard[index] <= intensive[index] <= exchange[index] for index in range(len(age_bins))
    )


def test_preterm_hyperbilirubinemia_treatment_thresholds_kr917_are_complete() -> None:
    data = _load("preterm-hyperbilirubinemia-treatment-thresholds-kr917-v1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    bands = cast(list[object], data["gestationalOrCorrectedAgeBandsWeeks"])
    assert [str(value) for value in bands] == ["22-25", "26-27", "28-29", "30-31", "32-34"]

    thresholds = cast(dict[str, object], data["thresholds"])
    standard = cast(list[list[object]], thresholds["standardPhototherapy"])
    intensive = cast(list[list[object]], thresholds["intensivePhototherapy"])
    exchange = cast(list[list[object]], thresholds["exchangeTransfusion"])
    assert len(standard) == len(intensive) == len(exchange) == 5

    for row_index in range(5):
        assert len(standard[row_index]) == 6
        assert len(intensive[row_index]) == 6
        assert len(exchange[row_index]) == 6
        for age_index in range(6):
            standard_value = _int(standard[row_index][age_index])
            intensive_value = _int(intensive[row_index][age_index])
            exchange_value = _int(exchange[row_index][age_index])
            assert standard_value <= intensive_value <= exchange_value

    assert [_int(value) for value in standard[0]] == [86, 86, 86, 103, 120, 137]
    assert [_int(value) for value in exchange[-1]] == [171, 274, 308, 342, 376, 376]


def test_neonatal_fluid_parenteral_nutrition_kr905_preserves_source_structure() -> None:
    data = _load("neonatal-fluid-parenteral-nutrition-kr905_1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"

    source = cast(dict[str, object], data["source"])
    assert source["recommendationId"] == "905_1"
    assert source["recommendationYear"] == 2025

    fluid = cast(dict[str, object], data["fluid"])
    transitional = cast(list[dict[str, object]], fluid["transitionalDays"])
    assert [_int(row["day"]) for row in transitional] == [1, 2, 3, 4, 5]

    day_one = transitional[0]
    term = cast(dict[str, object], day_one["term"])
    lt1000 = cast(dict[str, object], day_one["pretermLt1000"])
    assert (_int(term["min"]), _int(term["max"])) == (40, 60)
    assert (_int(lt1000["min"]), _int(lt1000["max"])) == (80, 100)

    intermediate = cast(dict[str, object], fluid["intermediatePhase"])
    assert intermediate["preterm1000To1500"] is None
    assert intermediate["pretermLt1000"] is None

    stable = cast(dict[str, object], fluid["stableGrowthPhase"])
    assert stable["appliesTo"] == "table-wide-merged-cell"
    preferred = cast(dict[str, object], stable["preferred"])
    parenthetical = cast(dict[str, object], stable["parentheticalRange"])
    assert (_int(preferred["min"]), _int(preferred["max"])) == (140, 160)
    assert (_int(parenthetical["min"]), _int(parenthetical["max"])) == (135, 200)

    nutrition = cast(dict[str, object], data["parenteralNutrition"])
    energy = cast(dict[str, object], nutrition["energy"])
    initial = cast(dict[str, object], energy["initialRecommended"])
    target = cast(dict[str, object], energy["targetTotal"])
    target_term = cast(dict[str, object], target["term"])
    target_preterm = cast(dict[str, object], target["preterm"])
    assert (_int(initial["min"]), _int(initial["max"])) == (40, 60)
    assert (_int(target_term["min"]), _int(target_term["max"])) == (85, 100)
    assert (_int(target_preterm["min"]), _int(target_preterm["max"])) == (90, 120)

    electrolytes = cast(dict[str, object], data["electrolytes"])
    sodium = cast(dict[str, object], electrolytes["sodium"])
    assert sodium["startAfterEstablishedDiuresis"] is True
    sodium_rows = cast(list[dict[str, object]], sodium["rows"])
    day_six = sodium_rows[-1]
    preterm_low = cast(dict[str, object], day_six["pretermLt1500"])
    assert (_int(preterm_low["min"]), _int(preterm_low["max"])) == (2, 5)
    assert _int(preterm_low["parentheticalMax"]) == 7

    calcium = cast(dict[str, object], electrolytes["calcium"])
    assert calcium["pretermColumnsMerged"] is True
    magnesium = cast(dict[str, object], electrolytes["magnesium"])
    assert magnesium["pretermColumnsMerged"] is True


def test_neonatal_lab_decision_thresholds_are_not_reference_intervals() -> None:
    data = _load("neonatal-lab-decision-thresholds-krs-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["semanticClass"] == "clinical_decision_thresholds_not_reference_intervals"

    sepsis = cast(dict[str, object], data["sepsis"])
    support = cast(list[dict[str, object]], sepsis["diagnosticSupport"])
    assert len(support) == 15

    by_analyte: dict[str, list[dict[str, object]]] = {}
    for threshold in support:
        by_analyte.setdefault(str(threshold["analyte"]), []).append(threshold)

    platelets = by_analyte["platelets"]
    assert platelets == [
        {
            "analyte": "platelets",
            "operator": "<",
            "value": 123,
            "unit": "10^9/L",
            "context": "thrombocytopenia",
            "gestationalAgeWeeks": ">=33",
            "postnatalAge": "first_72_hours",
        },
        {
            "analyte": "platelets",
            "operator": "<",
            "value": 104,
            "unit": "10^9/L",
            "context": "thrombocytopenia",
            "gestationalAgeWeeks": "<=32",
            "postnatalAge": "first_72_hours",
        },
        {
            "analyte": "platelets",
            "operator": "<",
            "value": 150,
            "unit": "10^9/L",
            "context": "thrombocytopenia",
            "gestationalAgeWeeks": "any",
            "postnatalAge": ">72_hours",
        },
    ]

    neutropenia_groups = cast(list[dict[str, object]], sepsis["neutropeniaByBirthWeight"])
    assert [group["birthWeight"] for group in neutropenia_groups] == ["<=1500_g", ">1500_g"]

    low_weight = cast(list[dict[str, object]], neutropenia_groups[0]["thresholds"])
    assert low_weight[-1] == {
        "postnatalAgeHours": ">48",
        "ancLessThanCellsPerMicroliter": 1100,
    }

    high_weight = cast(list[dict[str, object]], neutropenia_groups[1]["thresholds"])
    assert high_weight[-1] == {
        "postnatalAgeHours": ">72",
        "ancLessThanCellsPerMicroliter": 1500,
    }

    pct = by_analyte["procalcitonin"]
    assert [(_float(row["value"]), row["sourceAppendixAgeHours"]) for row in pct] == [
        (2.5, "0-72"),
        (2.0, ">72"),
    ]

    polycythemia = cast(dict[str, object], data["polycythemia"])
    definition = cast(dict[str, object], polycythemia["definitionThreshold"])
    assert definition == {
        "analyte": "venous_hematocrit",
        "operator": ">=",
        "value": 65,
        "unit": "percent",
        "context": "polycythemia_definition",
    }

    sampling = cast(dict[str, object], polycythemia["samplingBoundary"])
    trigger = cast(dict[str, object], sampling["peripheralHematocritTriggerForVenousConfirmation"])
    assert trigger["operator"] == ">"
    assert _int(trigger["value"]) == 65
    assert sampling["numericDifferenceInterpretation"] == "source-relative-wording-only"


def test_neonatal_map_kr912_preserves_ga_and_hour_grid() -> None:
    data = _load("neonatal-mean-arterial-pressure-kr912_1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["semanticClass"] == "source_reference_table_not_treatment_threshold"
    assert data["postnatalHours"] == [0, 12, 24, 36, 48, 60, 72]

    rows = cast(list[dict[str, object]], data["rows"])
    assert [row["gestationalAgeWeeks"] for row in rows] == [
        "23-26",
        "27-32",
        "33-36",
        "37-43",
    ]
    assert [cast(list[object], row["values"]) for row in rows] == [
        [24, 25, 26, 27, 28, 29, 30],
        [30, 31, 32, 33, 34, 35, 36],
        [36, 37, 38, 39, 40, 41, 42],
        [43, 44, 45, 46, 47, 48, 49],
    ]


def test_nsofa_research_definition_has_no_invented_risk_cutoffs() -> None:
    data = _load("nsofa-assessment-kr912_1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["semanticClass"] == "assessment_definition"

    application = cast(dict[str, object], data["application"])
    assert application["cadence"] == "daily"
    assert application["observationWindow"] == "worst_value_or_state_during_the_day"
    assert application["categoricalCutoffs"] is None

    score_range = cast(dict[str, object], data["scoreRange"])
    assert (_int(score_range["min"]), _int(score_range["max"])) == (0, 15)

    systems = cast(list[dict[str, object]], data["systems"])
    assert [system["id"] for system in systems] == [
        "respiratory",
        "cardiovascular",
        "hematologic",
    ]

    respiratory = systems[0]
    respiratory_rules = cast(list[dict[str, object]], respiratory["rules"])
    assert [_int(rule["score"]) for rule in respiratory_rules] == [8, 6, 4, 2, 0]
    assert respiratory["selectionPolicy"] == "choose_highest_score_whose_condition_is_met"

    hematologic = systems[2]
    hematologic_rules = cast(list[dict[str, object]], hematologic["rules"])
    assert [_int(rule["score"]) for rule in hematologic_rules] == [3, 2, 1, 0]
    assert hematologic["selectionPolicy"] == "choose_highest_score_whose_condition_is_met"


def test_neomod_variants_remain_separate_and_modified_is_non_executable() -> None:
    data = _load("neomod-assessment-variants-kr912_1-2025.json")
    assert data["status"] == "review-required"
    assert data["publicationState"] == "blocked"
    assert data["semanticClass"] == "assessment_definitions"

    variants = cast(list[dict[str, object]], data["variants"])
    assert [variant["id"] for variant in variants] == ["neomod-original", "neomod-modified"]

    original = variants[0]
    assert original["executableStatus"] == "reviewable-semantic-definition"
    original_score = cast(dict[str, object], original["scoreRange"])
    assert (_int(original_score["min"]), _int(original_score["max"])) == (0, 14)
    original_systems = cast(list[dict[str, object]], original["systems"])
    assert len(original_systems) == 7

    modified = variants[1]
    assert modified["executableStatus"] == "blocked-combination-logic-review-required"
    modified_score = cast(dict[str, object], modified["scoreRange"])
    assert (_int(modified_score["min"]), _int(modified_score["max"])) == (0, 16)
    modified_systems = cast(list[dict[str, object]], modified["systems"])
    assert len(modified_systems) == 8

    for system in modified_systems:
        cells = cast(list[dict[str, object]], system["cells"])
        assert [_int(cell["score"]) for cell in cells] == [2, 1, 0]
        assert all(cell["combinationLogic"] == "requires_pdf_visual_review" for cell in cells)

    microcirculation = next(
        system for system in modified_systems if system["id"] == "microcirculation"
    )
    assert microcirculation["sourceGap"] == (
        "flattened_source_leaves_albumin_30_to_39_without_an_explicit_cell"
    )

    assert original["categoricalCutoffs"] is None
    assert modified["categoricalCutoffs"] is None
