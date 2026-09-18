"""Promote explicitly reviewed extraction candidates into a MiniMed knowledge module.

This module never turns a text hit into a definition, scoring rule or clinical assertion.
An accepted candidate creates only a canonical entity plus a reviewed document link to the exact
source chunk.
The resulting JSON is intended to be rebuilt with the source documents through the normal knowledge
pipeline.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from .edition_manifest import sha256_file
from .embedding import normalize_text
from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeName,
    KnowledgeWorkspace,
)
from .knowledge_candidates import Candidate, scan_candidates
from .models import CamelModel

_ALLOWED_TYPES = frozenset(
    {"scale", "questionnaire", "criterion_set", "classification", "severity_grade"}
)


class CandidateReviewDecision(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    candidate_id: str = Field(min_length=1)
    decision: Literal["accept", "reject"]
    entity_id: str | None = Field(default=None, pattern=r"^[a-z0-9][a-z0-9._:-]{2,127}$")
    canonical_name: str | None = None
    entity_type: str | None = None
    interactive_assessment_id: str | None = None
    interactive_calculator_id: str | None = None
    interactive_route: str | None = None
    aliases: list[str] = Field(default_factory=list)
    specialties: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    note: str | None = None

    @model_validator(mode="after")
    def validate_acceptance(self) -> CandidateReviewDecision:
        if self.decision == "accept":
            if self.entity_id is None:
                raise ValueError("Accepted candidate requires entityId.")
            if self.canonical_name is None or not self.canonical_name.strip():
                raise ValueError("Accepted candidate requires canonicalName.")
            if self.entity_type is not None and self.entity_type not in _ALLOWED_TYPES:
                raise ValueError(f"Unsupported reviewed entityType: {self.entity_type}.")
            assessment = (
                self.interactive_assessment_id.strip()
                if self.interactive_assessment_id and self.interactive_assessment_id.strip()
                else None
            )
            calculator = (
                self.interactive_calculator_id.strip()
                if self.interactive_calculator_id and self.interactive_calculator_id.strip()
                else None
            )
            route = (
                self.interactive_route.strip()
                if self.interactive_route and self.interactive_route.strip()
                else None
            )
            if assessment and calculator:
                raise ValueError("Reviewed candidate cannot link to two interactive tool kinds.")
            if route and not (assessment or calculator):
                raise ValueError("interactiveRoute requires an explicit interactive tool id.")
            if (assessment or calculator) and not route:
                raise ValueError("Interactive tool link requires interactiveRoute.")
            expected_prefix = (
                "#/assessments/" if assessment else "#/calculators/" if calculator else None
            )
            if route and expected_prefix and not route.startswith(expected_prefix):
                label = "Assessment" if assessment else "Calculator"
                raise ValueError(
                    f"{label} interactiveRoute must start with {expected_prefix}."
                )
            if route:
                if any(character.isspace() for character in route):
                    raise ValueError("interactiveRoute must not contain whitespace.")
                if "?" in route or "#" in route[1:]:
                    raise ValueError(
                        "interactiveRoute must not contain query or nested hash parts."
                    )
                if expected_prefix:
                    remainder = route[len(expected_prefix) :]
                    if not remainder or any(not part for part in remainder.split("/")):
                        raise ValueError("interactiveRoute contains an empty path segment.")
        return self


def _read_json_object(path: Path) -> dict[str, object]:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return {str(key): value for key, value in payload.items()}


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        value: object = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number} must contain a JSON object.")
        rows.append({str(key): item for key, item in value.items()})
    return rows


def _validated_candidates(
    workspace: Path,
    source: Path,
    inventory_sources: tuple[Path, ...] = (),
) -> dict[str, Candidate]:
    manifest_path = workspace / "manifest.json"
    candidates_path = workspace / "candidates.jsonl"
    if not manifest_path.is_file() or not candidates_path.is_file():
        raise ValueError("Candidate workspace must contain manifest.json and candidates.jsonl.")
    manifest = _read_json_object(manifest_path)
    expected_source_sha = manifest.get("sourceSha256")
    actual_source_sha = sha256_file(source.resolve(strict=True))
    if expected_source_sha != actual_source_sha:
        raise ValueError("Candidate workspace source checksum does not match the reviewed SQLite.")
    raw_candidates = candidates_path.read_bytes()
    actual_candidate_sha = "sha256:" + hashlib.sha256(raw_candidates).hexdigest()
    if manifest.get("candidateSha256") != actual_candidate_sha:
        raise ValueError("Candidate workspace payload checksum does not match its manifest.")
    source_types_value = manifest.get("sourceTypes")
    if not isinstance(source_types_value, list) or not source_types_value:
        raise ValueError("Candidate workspace has no sourceTypes.")
    source_types = tuple(
        item for item in source_types_value if isinstance(item, str) and item.strip()
    )
    if len(source_types) != len(source_types_value):
        raise ValueError("Candidate workspace sourceTypes must contain only non-empty strings.")

    inventory_value = manifest.get("inventorySources", [])
    if not isinstance(inventory_value, list):
        raise ValueError("Candidate workspace inventorySources must be a list.")
    expected_inventory: list[tuple[str, str]] = []
    for item in inventory_value:
        if not isinstance(item, dict):
            raise ValueError("Candidate workspace inventory source must be an object.")
        path_value = item.get("path")
        checksum = item.get("sha256")
        if not isinstance(path_value, str) or not isinstance(checksum, str):
            raise ValueError("Candidate workspace inventory source is incomplete.")
        expected_inventory.append((path_value, checksum))

    resolved_inventory = inventory_sources
    if not resolved_inventory and expected_inventory:
        resolved_inventory = tuple(Path(path_value) for path_value, _ in expected_inventory)
    if len(resolved_inventory) != len(expected_inventory):
        raise ValueError("Candidate workspace inventory source count does not match review inputs.")
    for path, (_, expected_checksum) in zip(
        resolved_inventory,
        expected_inventory,
        strict=True,
    ):
        if sha256_file(path.resolve(strict=True)) != expected_checksum:
            raise ValueError("Candidate workspace inventory checksum does not match review inputs.")

    stored_rows = _read_jsonl(candidates_path)
    stored_by_id: dict[str, dict[str, object]] = {}
    for row in stored_rows:
        candidate_id = row.get("candidateId")
        if not isinstance(candidate_id, str) or not candidate_id:
            raise ValueError("Candidate workspace contains a row without candidateId.")
        if candidate_id in stored_by_id:
            raise ValueError(f"Duplicate candidateId in workspace: {candidate_id}.")
        stored_by_id[candidate_id] = row
    if manifest.get("candidateCount") != len(stored_by_id):
        raise ValueError("Candidate workspace count does not match its manifest.")

    fresh = scan_candidates(
        source,
        source_types=source_types,
        inventory_sources=resolved_inventory,
    )
    fresh_by_id = {candidate.candidate_id: candidate for candidate in fresh}
    if set(fresh_by_id) != set(stored_by_id):
        raise ValueError("Candidate workspace no longer matches deterministic source extraction.")
    for candidate_id, candidate in fresh_by_id.items():
        if candidate.payload() != stored_by_id[candidate_id]:
            raise ValueError(f"Candidate {candidate_id} differs from deterministic extraction.")
    return fresh_by_id


def _stable_id(prefix: str, value: str) -> str:
    return f"{prefix}." + hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = " ".join(raw.split())
        normalized = normalize_text(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(value)
    return result


def _parse_reviewed_at(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("reviewedAt must not be blank.")
    parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("reviewedAt must include a timezone.")
    return cleaned


def promote_candidate_reviews(
    candidate_workspace: Path,
    source: Path,
    decisions_file: Path,
    output: Path,
    *,
    reviewer: str,
    reviewed_at: str,
    inventory_sources: tuple[Path, ...] = (),
) -> tuple[int, int]:
    if output.exists():
        raise ValueError("Output is immutable; choose a new knowledge module path.")
    reviewer_name = reviewer.strip()
    if not reviewer_name:
        raise ValueError("Reviewer must not be blank.")
    reviewed_timestamp = _parse_reviewed_at(reviewed_at)
    candidates = _validated_candidates(
        candidate_workspace,
        source,
        inventory_sources,
    )

    decisions: list[CandidateReviewDecision] = []
    seen_decisions: set[str] = set()
    for row in _read_jsonl(decisions_file):
        decision = CandidateReviewDecision.model_validate(row)
        if decision.candidate_id in seen_decisions:
            raise ValueError(f"Duplicate review decision for {decision.candidate_id}.")
        if decision.candidate_id not in candidates:
            raise ValueError(f"Review references unknown candidate {decision.candidate_id}.")
        seen_decisions.add(decision.candidate_id)
        decisions.append(decision)

    entities: dict[str, KnowledgeEntity] = {}
    links: list[KnowledgeDocumentLink] = []
    rejected = 0
    for decision in decisions:
        candidate = candidates[decision.candidate_id]
        if decision.decision == "reject":
            rejected += 1
            continue

        entity_id = decision.entity_id
        canonical_name = " ".join((decision.canonical_name or "").split())
        if entity_id is None or not canonical_name:
            raise ValueError(f"Accepted candidate {candidate.candidate_id} lacks identity.")
        entity_type = decision.entity_type or candidate.candidate_type
        if entity_type not in _ALLOWED_TYPES:
            raise ValueError(f"Unsupported reviewed entity type: {entity_type}.")

        aliases = _dedupe([candidate.label, *decision.aliases])
        canonical_normalized = normalize_text(canonical_name)
        names = [
            KnowledgeName(
                name=alias,
                name_type=(
                    "source-label"
                    if normalize_text(alias) == normalize_text(candidate.label)
                    else "alias"
                ),
                weight=(
                    1.4
                    if normalize_text(alias) == normalize_text(candidate.label)
                    else 1.0
                ),
            )
            for alias in aliases
            if normalize_text(alias) != canonical_normalized
        ]
        metadata: dict[str, object] = {
            "tags": _dedupe(decision.tags),
            "specialties": _dedupe(decision.specialties),
        }
        if decision.interactive_assessment_id and decision.interactive_assessment_id.strip():
            metadata["interactiveAssessmentId"] = decision.interactive_assessment_id.strip()
        if decision.interactive_calculator_id and decision.interactive_calculator_id.strip():
            metadata["interactiveCalculatorId"] = decision.interactive_calculator_id.strip()
        if decision.interactive_route and decision.interactive_route.strip():
            metadata["interactiveRoute"] = decision.interactive_route.strip()
        existing = entities.get(entity_id)
        if existing is None:
            entities[entity_id] = KnowledgeEntity(
                id=entity_id,
                entity_type=entity_type,
                canonical_name=canonical_name,
                names=names,
                metadata=metadata,
            )
        else:
            if (
                existing.entity_type != entity_type
                or normalize_text(existing.canonical_name) != canonical_normalized
            ):
                raise ValueError(f"Conflicting reviewed identity for {entity_id}.")
            by_name = {normalize_text(item.name): item for item in existing.names}
            for name in names:
                previous = by_name.get(normalize_text(name.name))
                if previous is None:
                    existing.names.append(name)
                    by_name[normalize_text(name.name)] = name
                elif name.weight > previous.weight:
                    previous.weight = name.weight
                    previous.name_type = name.name_type
            for scalar_key in (
                "interactiveAssessmentId",
                "interactiveCalculatorId",
                "interactiveRoute",
            ):
                current_scalar = existing.metadata.get(scalar_key)
                incoming_scalar = metadata.get(scalar_key)
                if current_scalar is None and incoming_scalar is not None:
                    existing.metadata[scalar_key] = incoming_scalar
                elif (
                    current_scalar is not None
                    and incoming_scalar is not None
                    and current_scalar != incoming_scalar
                ):
                    raise ValueError(
                        f"Conflicting {scalar_key} for reviewed entity {entity_id}."
                    )
            for key in ("tags", "specialties"):
                current = existing.metadata.get(key)
                current_values = current if isinstance(current, list) else []
                incoming = metadata[key]
                incoming_values = incoming if isinstance(incoming, list) else []
                existing.metadata[key] = _dedupe(
                    [str(item) for item in [*current_values, *incoming_values]]
                )

        links.append(
            KnowledgeDocumentLink(
                id=_stable_id(
                    "link.reviewed-candidate",
                    f"{entity_id}|{candidate.candidate_id}",
                ),
                entity_id=entity_id,
                document_id=candidate.document_id,
                document_version_id=candidate.document_version_id,
                section_id=candidate.section_id,
                chunk_id=candidate.chunk_id,
                link_type="described-by",
                weight=1.0,
                review_status="reviewed",
                metadata={
                    "candidateId": candidate.candidate_id,
                    "candidateType": candidate.candidate_type,
                    "extractionKind": candidate.extraction_kind,
                    "candidateConfidence": candidate.confidence,
                    "sourceAnchor": candidate.anchor,
                    "pageStart": candidate.page_start,
                    "reviewer": reviewer_name,
                    "reviewedAt": reviewed_timestamp,
                    **(
                        {"reviewNote": decision.note.strip()}
                        if decision.note and decision.note.strip()
                        else {}
                    ),
                },
            )
        )

    workspace = KnowledgeWorkspace(
        entities=[entities[key] for key in sorted(entities)],
        document_links=sorted(links, key=lambda item: item.id),
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            workspace.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return len(links), rejected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--reviewed-at", required=True)
    parser.add_argument(
        "--inventory-db",
        action="append",
        dest="inventory_sources",
        type=Path,
        help="Repeat with the same reviewed inventory DBs used during candidate extraction.",
    )
    args = parser.parse_args()
    accepted, rejected = promote_candidate_reviews(
        args.candidates,
        args.source,
        args.decisions,
        args.output,
        reviewer=args.reviewer,
        reviewed_at=args.reviewed_at,
        inventory_sources=tuple(args.inventory_sources or ()),
    )
    print(
        f"Prepared reviewed knowledge module: {accepted} accepted source links, "
        f"{rejected} rejected candidates."
    )


if __name__ == "__main__":
    main()
