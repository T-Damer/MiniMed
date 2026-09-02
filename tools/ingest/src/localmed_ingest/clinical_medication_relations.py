from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from .knowledge import (
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeRelation,
    KnowledgeWorkspace,
    MedicationProfile,
    RelationWeightComponents,
)
from .models import CamelModel
from .normalization import normalize_surface_text

_POSITIVE_RECOMMENDATION = re.compile(
    r"\b(?:"
    r"рекоменду(?:ется|ются|ем|ются\s+к\s+применению)|"
    r"рекомендован(?:а|о|ы)?|"
    r"препарат(?:ы|ами)?\s+выбора|"
    r"могут\s+(?:применяться|назначаться)|"
    r"возможно\s+применение|"
    r"следует\s+назначить"
    r")\b",
    re.IGNORECASE,
)
_NEGATIVE_RECOMMENDATION = re.compile(
    r"\b(?:"
    r"не\s+рекоменду(?:ется|ются|ем)|"
    r"не\s+рекомендован(?:а|о|ы)?|"
    r"нецелесообразн\w*|"
    r"противопоказан\w*|"
    r"не\s+следует"
    r")\b",
    re.IGNORECASE,
)
_MEDICATION_CONTEXT = re.compile(
    r"\b(?:препарат\w*|лекарств\w*|терап\w*|лечен\w*|назнач\w*|применен\w*|"
    r"АБП|антибактериаль\w*|доз\w*)\b",
    re.IGNORECASE,
)
_SERVICE_SECTION = re.compile(
    r"(?:список\s+литературы|ключевые\s+слова|список\s+сокращений|"
    r"критерии\s+оценки\s+качества|справочник|приложение\s+[А-ЯA-Z])",
    re.IGNORECASE,
)
_EVIDENCE_BLOCK = re.compile(r"\S(?:.*?\S)?(?=\n\s*\n|\Z)", re.DOTALL)
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[А-ЯЁ])")
_NON_TARGET_PREFIX = re.compile(
    r"(?:невозможност\w*\s+назнач\w*|нецелесообразн\w*\s+назнач\w*|содержащ\w*)\s*$",
    re.IGNORECASE,
)
_MAX_RECOMMENDATION_DISTANCE = 240


class ClinicalMedicationRelationReport(CamelModel):
    clinical_document_id: str
    medication_identities: int
    candidate_relations: int
    output: str


class ClinicalMedicationRelationBatchReport(CamelModel):
    databases: int
    candidate_relations: int
    medication_identities: int
    reused: int
    workers: int
    elapsed_seconds: float
    output_directory: str


@dataclass(frozen=True)
class _MedicationIdentity:
    canonical_name: str
    target_document_id: str


@dataclass(frozen=True)
class _Section:
    id: str
    parent_id: str | None
    title: str
    section_type: str | None
    anchor: str


@dataclass(frozen=True)
class _ClinicalDocument:
    id: str
    title: str
    version_id: str
    official_id: str | None
    age_groups: list[str]
    source_checksum: str


def _read_only(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise ValueError(f"SQLite database does not exist: {path}")
    uri = f"file:{quote(str(path.resolve()), safe='/')}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _json_object(value: object, *, context: str) -> dict[str, object]:
    if not isinstance(value, str):
        raise ValueError(f"{context} must be JSON text.")
    parsed: object = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{context} must be a JSON object.")
    return parsed


def _identity_key(value: str) -> str:
    return re.sub(r"\s*([+/])\s*", r"\1", normalize_surface_text(value))


def _clinical_document(connection: sqlite3.Connection) -> _ClinicalDocument:
    rows = connection.execute(
        """SELECT d.id, d.title, d.current_version_id, d.metadata_json, v.source_checksum
        FROM documents d JOIN document_versions v ON v.id = d.current_version_id
        ORDER BY d.id"""
    ).fetchall()
    if len(rows) != 1:
        raise ValueError("Clinical database must contain exactly one document.")
    row = rows[0]
    metadata = _json_object(row["metadata_json"], context="documents.metadata_json")
    raw_age_groups = metadata.get("ageGroups", [])
    age_groups = (
        [item for item in raw_age_groups if isinstance(item, str) and item.strip()]
        if isinstance(raw_age_groups, list)
        else []
    )
    official_id = metadata.get("officialId")
    return _ClinicalDocument(
        id=str(row["id"]),
        title=str(row["title"]),
        version_id=str(row["current_version_id"]),
        official_id=official_id if isinstance(official_id, str) and official_id else None,
        age_groups=age_groups,
        source_checksum=str(row["source_checksum"]),
    )


def _medication_identities(connection: sqlite3.Connection) -> list[_MedicationIdentity]:
    identities: dict[str, _MedicationIdentity] = {}
    for row in connection.execute("SELECT metadata_json FROM documents ORDER BY id"):
        metadata = _json_object(row["metadata_json"], context="documents.metadata_json")
        standardized_inn = metadata.get("standardizedInn")
        target_document_id = metadata.get("targetDocumentId")
        if (
            metadata.get("catalogFamily") != "medication"
            or metadata.get("entityType") != "medication"
            or not isinstance(standardized_inn, str)
            or not standardized_inn.strip()
            or not isinstance(target_document_id, str)
            or not target_document_id.strip()
        ):
            continue
        key = _identity_key(standardized_inn)
        identity = _MedicationIdentity(standardized_inn.strip(), target_document_id.strip())
        previous = identities.get(key)
        if previous is not None and previous.target_document_id != identity.target_document_id:
            raise ValueError(f"Ambiguous ESKLP MNN identity: {standardized_inn}")
        identities[key] = identity
    return sorted(
        identities.values(), key=lambda item: (-len(item.canonical_name), item.canonical_name)
    )


def _inn_pattern(value: str) -> str:
    parts: list[str] = []
    index = 0
    while index < len(value):
        character = value[index]
        if character.isspace():
            while index + 1 < len(value) and value[index + 1].isspace():
                index += 1
            parts.append(r"\s+")
        elif character == "+":
            parts.append(r"\s*\+\s*")
        elif character in "еёЕЁ":
            parts.append("[еёЕЁ]")
        else:
            parts.append(re.escape(character))
        index += 1
    return "".join(parts)


def _identity_matcher(
    identities: list[_MedicationIdentity],
) -> tuple[re.Pattern[str] | None, dict[str, _MedicationIdentity]]:
    by_name = {_identity_key(item.canonical_name): item for item in identities}
    alternatives = [_inn_pattern(item.canonical_name) for item in identities]
    if not alternatives:
        return None, by_name
    return (
        re.compile(
            r"(?<![\w+/\-–—])(?:" + "|".join(alternatives) + r")(?![\w+/\-–—])",
            re.IGNORECASE,
        ),
        by_name,
    )


def _identity_digest(identities: list[_MedicationIdentity]) -> str:
    payload = "\n".join(f"{item.target_document_id}\t{item.canonical_name}" for item in identities)
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def _stable_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}.{digest}"


def _under_treatment(section_id: str, sections: dict[str, _Section]) -> bool:
    seen: set[str] = set()
    current = sections.get(section_id)
    while current is not None and current.id not in seen:
        if current.section_type == "treatment":
            return True
        seen.add(current.id)
        current = sections.get(current.parent_id or "")
    return False


def _service_section(section: _Section) -> bool:
    normalized_title = normalize_surface_text(section.title)
    return section.section_type in {"references", "keywords", "abbreviations"} or bool(
        _SERVICE_SECTION.search(normalized_title)
    )


def _evidence_blocks(text: str) -> list[str]:
    return [match.group(0) for match in _EVIDENCE_BLOCK.finditer(text)] or ([text] if text else [])


def _local_sentence(text: str, start: int, end: int) -> str:
    boundaries = [match for match in _SENTENCE_BOUNDARY.finditer(text)]
    sentence_start = max(
        (match.end() for match in boundaries if match.end() <= start),
        default=0,
    )
    sentence_end = min(
        (match.start() for match in boundaries if match.start() >= end),
        default=len(text),
    )
    return text[sentence_start:sentence_end].strip()


def _nearest_recommendation_distance(text: str, start: int, end: int) -> int | None:
    distances = [
        start - marker.end()
        if marker.end() <= start
        else marker.start() - end
        if marker.start() >= end
        else 0
        for marker in _POSITIVE_RECOMMENDATION.finditer(text)
    ]
    return min(distances) if distances else None


def _extract_clinical_medication_relations(
    clinical_database: Path,
    matcher: re.Pattern[str],
    identities_by_name: dict[str, _MedicationIdentity],
    identity_digest: str,
) -> KnowledgeWorkspace:
    with closing(_read_only(clinical_database)) as clinical:
        document = _clinical_document(clinical)
        sections = {
            str(row["id"]): _Section(
                id=str(row["id"]),
                parent_id=str(row["parent_section_id"])
                if row["parent_section_id"] is not None
                else None,
                title=str(row["title"]),
                section_type=str(row["section_type"]) if row["section_type"] is not None else None,
                anchor=str(row["anchor"]),
            )
            for row in clinical.execute(
                """SELECT id, parent_section_id, title, section_type, anchor
                FROM sections WHERE document_version_id = ? ORDER BY order_index""",
                (document.version_id,),
            )
        }
        condition_id = _stable_id("clinical.condition", document.id)
        condition_external_ids = (
            {"officialClinicalId": document.official_id} if document.official_id else {}
        )
        entities: dict[str, KnowledgeEntity] = {
            condition_id: KnowledgeEntity(
                id=condition_id,
                entity_type="condition",
                canonical_name=document.title,
                external_ids=condition_external_ids,
                metadata={
                    "sourceDocumentId": document.id,
                    "candidateInput": {
                        "clinicalVersionId": document.version_id,
                        "clinicalSourceChecksum": document.source_checksum,
                        "medicationIdentityDigest": identity_digest,
                    },
                },
            )
        }
        relations: list[KnowledgeRelation] = []
        seen_relations: set[str] = set()
        rows = clinical.execute(
            """SELECT id, section_id, original_text, anchor FROM chunks
            WHERE document_version_id = ? ORDER BY order_index""",
            (document.version_id,),
        )
        for row in rows:
            section_id = str(row["section_id"])
            section = sections.get(section_id)
            if section is None or _service_section(section):
                continue
            original_text = str(row["original_text"])
            for evidence_quote in _evidence_blocks(original_text):
                if not _POSITIVE_RECOMMENDATION.search(evidence_quote):
                    continue
                for match in matcher.finditer(evidence_quote):
                    identity = identities_by_name.get(_identity_key(match.group(0)))
                    if identity is None:
                        continue
                    local_sentence = _local_sentence(evidence_quote, match.start(), match.end())
                    under_treatment = _under_treatment(section_id, sections)
                    sentence_offset = evidence_quote.find(local_sentence)
                    if sentence_offset < 0:
                        continue
                    local_start = match.start() - sentence_offset
                    local_end = match.end() - sentence_offset
                    recommendation_distance = _nearest_recommendation_distance(
                        local_sentence, local_start, local_end
                    )
                    prefix = local_sentence[max(0, local_start - 100) : local_start]
                    if (
                        not _POSITIVE_RECOMMENDATION.search(local_sentence)
                        or _NEGATIVE_RECOMMENDATION.search(local_sentence)
                        or recommendation_distance is None
                        or recommendation_distance > _MAX_RECOMMENDATION_DISTANCE
                        or _NON_TARGET_PREFIX.search(prefix)
                        or (not under_treatment and not _MEDICATION_CONTEXT.search(local_sentence))
                    ):
                        continue
                    entity_id = _stable_id("esklp.medication", identity.target_document_id)
                    entities.setdefault(
                        entity_id,
                        KnowledgeEntity(
                            id=entity_id,
                            entity_type="medication",
                            canonical_name=identity.canonical_name,
                            external_ids={"esklpMnnDocumentId": identity.target_document_id},
                            medication=MedicationProfile(
                                concept_level="substance",
                                inn=identity.canonical_name,
                            ),
                        ),
                    )
                    relation_key = (
                        f"{entity_id}|{condition_id}|{row['id']}|{local_sentence}|{match.group(0)}"
                    )
                    if relation_key in seen_relations:
                        continue
                    seen_relations.add(relation_key)
                    relations.append(
                        KnowledgeRelation(
                            id=_stable_id("clinical.relation", relation_key),
                            subject_entity_id=entity_id,
                            predicate="recommended-for",
                            object_entity_id=condition_id,
                            relation_status="guideline",
                            authority_tier="clinical-guideline",
                            review_status="proposed",
                            jurisdiction="RU",
                            weights=RelationWeightComponents(
                                authority=0.95,
                                evidence_quality=0.9,
                                applicability=0.5,
                                recency=0.5,
                                editorial_review=0.0,
                            ),
                            evidence=[
                                KnowledgeEvidence(
                                    document_id=document.id,
                                    document_version_id=document.version_id,
                                    section_id=section_id,
                                    chunk_id=str(row["id"]),
                                    quote=local_sentence,
                                    source_locator={"anchor": str(row["anchor"])},
                                )
                            ],
                            metadata={
                                "source": "clinical-recommendation",
                                "standardizedInn": identity.canonical_name,
                                "population": {"ageGroups": document.age_groups},
                                "sectionType": section.section_type,
                                "underTreatmentBranch": under_treatment,
                            },
                        )
                    )
        return KnowledgeWorkspace(entities=list(entities.values()), relations=relations)


def extract_clinical_medication_relations(
    clinical_database: Path,
    medication_identity_database: Path,
) -> KnowledgeWorkspace:
    """Extract conservative source-exact proposed MNN relations from one clinical module."""
    with closing(_read_only(medication_identity_database)) as medication:
        identities = _medication_identities(medication)
        matcher, identities_by_name = _identity_matcher(identities)
    if matcher is None:
        return KnowledgeWorkspace()
    return _extract_clinical_medication_relations(
        clinical_database,
        matcher,
        identities_by_name,
        _identity_digest(identities),
    )


def _write_candidate_workspace(
    workspace: KnowledgeWorkspace,
    output: Path,
) -> ClinicalMedicationRelationReport:
    condition = next(
        (entity for entity in workspace.entities if entity.entity_type == "condition"), None
    )
    if condition is None:
        raise ValueError("Clinical relation workspace has no condition entity.")
    source_document_id = condition.metadata.get("sourceDocumentId")
    if not isinstance(source_document_id, str):
        raise ValueError("Clinical condition has no source document id.")
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(workspace.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n"
    )
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=output.parent, prefix=f".{output.name}.", delete=False
    ) as temporary:
        temporary.write(payload)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, output)
    return ClinicalMedicationRelationReport(
        clinical_document_id=source_document_id,
        medication_identities=sum(
            entity.entity_type == "medication" for entity in workspace.entities
        ),
        candidate_relations=len(workspace.relations),
        output=str(output),
    )


def write_clinical_medication_relation_candidates(
    clinical_database: Path,
    medication_identity_database: Path,
    output: Path,
) -> ClinicalMedicationRelationReport:
    """Atomically write proposed relation candidates without modifying either source database."""
    resolved_output = output.resolve()
    if resolved_output in {clinical_database.resolve(), medication_identity_database.resolve()}:
        raise ValueError("Candidate output must not overwrite an input database.")
    workspace = extract_clinical_medication_relations(
        clinical_database,
        medication_identity_database,
    )
    return _write_candidate_workspace(workspace, output)


def _extract_and_write_with_index(
    clinical_database: Path,
    output: Path,
    matcher: re.Pattern[str],
    identities_by_name: dict[str, _MedicationIdentity],
    identity_digest: str,
) -> ClinicalMedicationRelationReport:
    return _write_candidate_workspace(
        _extract_clinical_medication_relations(
            clinical_database,
            matcher,
            identities_by_name,
            identity_digest,
        ),
        output,
    )


def _existing_candidate_report(
    path: Path,
    clinical_database: Path,
    identity_digest: str,
) -> ClinicalMedicationRelationReport | None:
    workspace = KnowledgeWorkspace.model_validate_json(path.read_text(encoding="utf-8"))
    condition = next(
        (entity for entity in workspace.entities if entity.entity_type == "condition"), None
    )
    if condition is None:
        raise ValueError(f"Existing candidate file is invalid: {path}")
    source_document_id = condition.metadata.get("sourceDocumentId")
    if not isinstance(source_document_id, str):
        raise ValueError(f"Existing candidate file is invalid: {path}")
    candidate_input = condition.metadata.get("candidateInput")
    if not isinstance(candidate_input, dict):
        return None
    with closing(_read_only(clinical_database)) as clinical:
        document = _clinical_document(clinical)
    expected_input = {
        "clinicalVersionId": document.version_id,
        "clinicalSourceChecksum": document.source_checksum,
        "medicationIdentityDigest": identity_digest,
    }
    if candidate_input != expected_input:
        return None
    return ClinicalMedicationRelationReport(
        clinical_document_id=source_document_id,
        medication_identities=sum(
            entity.entity_type == "medication" for entity in workspace.entities
        ),
        candidate_relations=len(workspace.relations),
        output=str(path),
    )


def write_clinical_medication_relation_batch(
    clinical_databases_directory: Path,
    medication_identity_database: Path,
    output_directory: Path,
    *,
    workers: int = 4,
    resume: bool = False,
) -> ClinicalMedicationRelationBatchReport:
    """Extract independent clinical modules concurrently into resumable JSON candidates."""
    if not 1 <= workers <= 8:
        raise ValueError("Clinical relation workers must be between 1 and 8.")
    if not clinical_databases_directory.is_dir():
        raise ValueError("Clinical databases directory must exist.")
    databases = sorted(clinical_databases_directory.glob("*.db"), key=lambda path: path.name)
    if not databases:
        raise ValueError("Clinical databases directory contains no .db files.")
    output_directory.mkdir(parents=True, exist_ok=True)
    with closing(_read_only(medication_identity_database)) as medication:
        identities = _medication_identities(medication)
        matcher, identities_by_name = _identity_matcher(identities)
    if matcher is None:
        raise ValueError("Medication identity database contains no ESKLP MNN pointers.")
    identity_digest = _identity_digest(identities)
    started = time.perf_counter()
    reports: list[ClinicalMedicationRelationReport] = []
    pending: list[tuple[Path, Path]] = []
    reused = 0
    for database in databases:
        output = output_directory / f"{database.stem}.json"
        if resume and output.is_file():
            existing = _existing_candidate_report(output, database, identity_digest)
            if existing is not None:
                reports.append(existing)
                reused += 1
            else:
                pending.append((database, output))
        else:
            pending.append((database, output))
    with ThreadPoolExecutor(
        max_workers=workers, thread_name_prefix="clinical-medication-relations"
    ) as executor:
        futures = {
            executor.submit(
                _extract_and_write_with_index,
                database,
                output,
                matcher,
                identities_by_name,
                identity_digest,
            ): database
            for database, output in pending
        }
        for future in as_completed(futures):
            reports.append(future.result())
    return ClinicalMedicationRelationBatchReport(
        databases=len(reports),
        candidate_relations=sum(report.candidate_relations for report in reports),
        medication_identities=sum(report.medication_identities for report in reports),
        reused=reused,
        workers=workers,
        elapsed_seconds=round(time.perf_counter() - started, 3),
        output_directory=str(output_directory),
    )
