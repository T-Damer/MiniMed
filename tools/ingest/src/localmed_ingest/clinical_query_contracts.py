from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from .clinical_queries import ProvenanceClass, ReviewStatus

RiskLevel = Literal["routine", "time-sensitive", "high-risk", "critical"]
Capability = Literal[
    "retrieval",
    "clarification",
    "calculation",
    "graph-expansion",
    "evidence-assembly",
]
EvidenceClass = Literal[
    "clinical-recommendation",
    "official-drug-instruction",
    "official-registry",
    "regulatory-act",
]
GraphTrust = Literal["proposed", "reviewed"]


class CalculationExpectation(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    calculation_type: str = Field(min_length=1, alias="calculationType")
    allowed: bool
    required_inputs: list[str] = Field(min_length=1, alias="requiredInputs")
    blocking_reason: str | None = Field(default=None, alias="blockingReason")

    @model_validator(mode="after")
    def validate_boundary(self) -> CalculationExpectation:
        if not self.allowed and not self.blocking_reason:
            raise ValueError("Blocked calculations require a blocking reason.")
        return self


class GraphExpansionExpectation(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    entity_ids: list[str] = Field(min_length=1, alias="entityIds")
    relation_ids: list[str] = Field(default_factory=list, alias="relationIds")
    trust: GraphTrust
    may_drive_guidance: bool = Field(alias="mayDriveGuidance")

    @model_validator(mode="after")
    def validate_trust_boundary(self) -> GraphExpansionExpectation:
        if self.trust == "proposed" and self.may_drive_guidance:
            raise ValueError("Proposed graph knowledge cannot drive trusted guidance.")
        return self


class ClinicalScenarioContract(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_version: int = Field(default=1, alias="schemaVersion")
    id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    language: Literal["ru"] = "ru"
    jurisdiction: Literal["RU"] = "RU"
    provenance: ProvenanceClass
    review_status: ReviewStatus = Field(alias="reviewStatus")
    risk_level: RiskLevel = Field(alias="riskLevel")
    capabilities: list[Capability] = Field(min_length=1)
    retrieval_scenario_ids: list[str] = Field(min_length=1, alias="retrievalScenarioIds")
    required_clarifications: list[str] = Field(
        default_factory=list, alias="requiredClarifications"
    )
    dangerous_omissions: list[str] = Field(default_factory=list, alias="dangerousOmissions")
    required_evidence_classes: list[EvidenceClass] = Field(
        min_length=1, alias="requiredEvidenceClasses"
    )
    calculation: CalculationExpectation | None = None
    graph_expansion: GraphExpansionExpectation | None = Field(
        default=None, alias="graphExpansion"
    )
    reviewed_by: str | None = Field(default=None, alias="reviewedBy")

    @model_validator(mode="after")
    def validate_contract(self) -> ClinicalScenarioContract:
        if self.risk_level in {"high-risk", "critical"} and not self.dangerous_omissions:
            raise ValueError("High-risk and critical contracts require dangerous omissions.")
        if self.risk_level == "critical" and not self.required_clarifications:
            raise ValueError("Critical contracts require clarification expectations.")
        if self.calculation is not None and "calculation" not in self.capabilities:
            raise ValueError("Calculation expectations require the calculation capability.")
        if self.graph_expansion is not None and "graph-expansion" not in self.capabilities:
            raise ValueError("Graph expectations require the graph-expansion capability.")
        if self.review_status == "clinician_reviewed" and not self.reviewed_by:
            raise ValueError("Clinician-reviewed contracts require a reviewer identifier.")
        if self.review_status != "clinician_reviewed" and self.reviewed_by:
            raise ValueError("Reviewer identifiers are reserved for clinician-reviewed contracts.")
        return self


class ClinicalScenarioContractReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    contract_count: int = Field(ge=1)
    source_sha256: str
    risk_counts: dict[str, int]
    capability_counts: dict[str, int]
    review_status_counts: dict[str, int]
    evidence_class_counts: dict[str, int]
    retrieval_reference_count: int = Field(ge=1)
    calculation_contracts: int = Field(ge=0)
    blocked_calculations: int = Field(ge=0)
    graph_expansion_contracts: int = Field(ge=0)
    proposed_graph_contracts: int = Field(ge=0)


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _load_json_array(path: Path) -> list[dict[str, Any]]:
    payload: Any = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"Expected a non-empty JSON array: {path}")
    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError(f"Expected object rows in {path}.")
        rows.append({str(key): value for key, value in item.items()})
    return rows


def load_retrieval_scenario_ids(paths: list[Path]) -> set[str]:
    identifiers: set[str] = set()
    for path in paths:
        for row in _load_json_array(path):
            identifier = row.get("id")
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValueError(f"Retrieval scenario without a valid id: {path}")
            if identifier in identifiers:
                raise ValueError(f"Duplicate retrieval scenario id: {identifier}")
            identifiers.add(identifier)
    if not identifiers:
        raise ValueError("At least one retrieval scenario file is required.")
    return identifiers


def load_clinical_scenario_contracts(path: Path) -> list[ClinicalScenarioContract]:
    contracts = TypeAdapter(list[ClinicalScenarioContract]).validate_python(_load_json_array(path))
    identifiers: set[str] = set()
    for contract in contracts:
        if contract.id in identifiers:
            raise ValueError(f"Duplicate clinical scenario contract id: {contract.id}")
        identifiers.add(contract.id)
    return contracts


def validate_clinical_scenario_contracts(
    contracts_path: Path,
    retrieval_paths: list[Path],
    *,
    report_path: Path | None = None,
) -> ClinicalScenarioContractReport:
    source_payload = contracts_path.read_bytes()
    contracts = load_clinical_scenario_contracts(contracts_path)
    retrieval_ids = load_retrieval_scenario_ids(retrieval_paths)

    referenced_ids: set[str] = set()
    for contract in contracts:
        missing = sorted(set(contract.retrieval_scenario_ids) - retrieval_ids)
        if missing:
            raise ValueError(f"{contract.id}: unknown retrieval scenario ids: {', '.join(missing)}")
        referenced_ids.update(contract.retrieval_scenario_ids)

    risk_counts = Counter(contract.risk_level for contract in contracts)
    capability_counts = Counter(
        capability for contract in contracts for capability in contract.capabilities
    )
    review_counts = Counter(contract.review_status for contract in contracts)
    evidence_counts = Counter(
        evidence
        for contract in contracts
        for evidence in contract.required_evidence_classes
    )
    calculations = [contract.calculation for contract in contracts if contract.calculation]
    graph_expansions = [
        contract.graph_expansion for contract in contracts if contract.graph_expansion
    ]
    report = ClinicalScenarioContractReport(
        contract_count=len(contracts),
        source_sha256=_sha256(source_payload),
        risk_counts=dict(sorted(risk_counts.items())),
        capability_counts=dict(sorted(capability_counts.items())),
        review_status_counts=dict(sorted(review_counts.items())),
        evidence_class_counts=dict(sorted(evidence_counts.items())),
        retrieval_reference_count=len(referenced_ids),
        calculation_contracts=len(calculations),
        blocked_calculations=sum(not calculation.allowed for calculation in calculations),
        graph_expansion_contracts=len(graph_expansions),
        proposed_graph_contracts=sum(
            expansion.trust == "proposed" for expansion in graph_expansions
        ),
    )
    if report_path is not None:
        _write_atomic(
            report_path,
            (
                json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2)
                + "\n"
            ).encode("utf-8"),
        )
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate Russian clinical scenario contracts.")
    parser.add_argument("--contracts", type=Path, required=True)
    parser.add_argument("--retrieval", type=Path, action="append", required=True)
    parser.add_argument("--report", type=Path)
    return parser


def main() -> None:
    arguments = _parser().parse_args()
    report = validate_clinical_scenario_contracts(
        arguments.contracts,
        arguments.retrieval,
        report_path=arguments.report,
    )
    print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
