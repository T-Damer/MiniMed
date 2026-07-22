from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.clinical_query_contracts import (
    load_clinical_scenario_contracts,
    validate_clinical_scenario_contracts,
)


def _benchmark_path(name: str) -> Path:
    return Path(__file__).resolve().parents[2] / "benchmarks" / name


def _retrieval_paths() -> list[Path]:
    return [
        _benchmark_path("pilot-rf-queries.json"),
        _benchmark_path("pilot-rf-drug-queries.json"),
    ]


def _contract(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schemaVersion": 1,
        "id": "contract.example",
        "query": "Пример русского клинического запроса",
        "provenance": "synthetic_edge_case",
        "reviewStatus": "candidate",
        "riskLevel": "high-risk",
        "capabilities": ["retrieval", "clarification", "evidence-assembly"],
        "retrievalScenarioIds": ["uti.diagnostics.urine"],
        "requiredClarifications": ["patient.age"],
        "dangerousOmissions": ["urgent-assessment"],
        "requiredEvidenceClasses": ["clinical-recommendation"],
    }
    value.update(overrides)
    return value


def test_committed_russian_contract_suite_is_valid_and_reported(tmp_path: Path) -> None:
    contracts_path = _benchmark_path("russian-scenario-contracts.json")
    first_report = tmp_path / "first.json"
    second_report = tmp_path / "second.json"

    report = validate_clinical_scenario_contracts(
        contracts_path,
        _retrieval_paths(),
        report_path=first_report,
    )
    validate_clinical_scenario_contracts(
        contracts_path,
        _retrieval_paths(),
        report_path=second_report,
    )

    assert report.contract_count == 12
    assert report.retrieval_reference_count == 23
    assert report.risk_counts == {
        "critical": 4,
        "high-risk": 5,
        "routine": 2,
        "time-sensitive": 1,
    }
    assert report.review_status_counts == {"candidate": 3, "source_validated": 9}
    assert report.calculation_contracts == 3
    assert report.blocked_calculations == 3
    assert report.graph_expansion_contracts == 1
    assert report.proposed_graph_contracts == 1
    assert report.capability_counts["clarification"] == 11
    assert report.capability_counts["evidence-assembly"] == 12
    assert report.automatic_check_counts == {
        "applicability-check": 12,
        "calculation-safety": 3,
        "contradiction-check": 12,
        "graph-trust": 1,
        "medication-safety": 5,
        "red-flag-screen": 12,
        "source-coverage-check": 12,
        "uncertainty-check": 12,
    }
    assert first_report.read_bytes() == second_report.read_bytes()


def test_automatic_checks_are_derived_from_contract_requirements(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts.json"
    contracts.write_text(
        json.dumps(
            [
                _contract(
                    capabilities=[
                        "retrieval",
                        "clarification",
                        "calculation",
                        "graph-expansion",
                        "evidence-assembly",
                    ],
                    requiredEvidenceClasses=["official-registry", "regulatory-act"],
                    calculation={
                        "calculationType": "dose-volume",
                        "allowed": False,
                        "requiredInputs": ["patient.weight", "authoritative-dose-rule"],
                        "blockingReason": "No reviewed dose rule.",
                    },
                    graphExpansion={
                        "entityIds": ["medication.example", "condition.example"],
                        "relationIds": ["relation.example"],
                        "trust": "proposed",
                        "mayDriveGuidance": False,
                    },
                )
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    [contract] = load_clinical_scenario_contracts(contracts)

    assert contract.automatic_checks == (
        "red-flag-screen",
        "source-coverage-check",
        "applicability-check",
        "contradiction-check",
        "uncertainty-check",
        "medication-safety",
        "calculation-safety",
        "graph-trust",
        "temporal-validity-check",
    )


def test_contract_loader_rejects_unknown_retrieval_reference(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts.json"
    contracts.write_text(
        json.dumps(
            [_contract(retrievalScenarioIds=["missing.scenario"])],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="unknown retrieval scenario ids"):
        validate_clinical_scenario_contracts(contracts, _retrieval_paths())


def test_high_risk_contract_requires_dangerous_omissions(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts.json"
    contracts.write_text(
        json.dumps([_contract(dangerousOmissions=[])], ensure_ascii=False),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="dangerous omissions"):
        load_clinical_scenario_contracts(contracts)


def test_proposed_graph_cannot_drive_guidance(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts.json"
    contracts.write_text(
        json.dumps(
            [
                _contract(
                    riskLevel="routine",
                    capabilities=["retrieval", "graph-expansion", "evidence-assembly"],
                    graphExpansion={
                        "entityIds": ["medication.example", "condition.example"],
                        "relationIds": ["relation.example"],
                        "trust": "proposed",
                        "mayDriveGuidance": True,
                    },
                )
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="cannot drive trusted guidance"):
        load_clinical_scenario_contracts(contracts)


def test_blocked_calculation_requires_reason(tmp_path: Path) -> None:
    contracts = tmp_path / "contracts.json"
    contracts.write_text(
        json.dumps(
            [
                _contract(
                    capabilities=[
                        "retrieval",
                        "clarification",
                        "calculation",
                        "evidence-assembly",
                    ],
                    calculation={
                        "calculationType": "dose-volume",
                        "allowed": False,
                        "requiredInputs": ["patient.weight", "authoritative-dose-rule"],
                    },
                )
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="blocking reason"):
        load_clinical_scenario_contracts(contracts)
