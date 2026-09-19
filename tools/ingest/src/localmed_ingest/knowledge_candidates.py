"""Extract review-only clinical knowledge candidates from source-preserving SQLite documents.

The scanner never creates knowledge entities or claims clinical equivalence. It combines
conservative structural heuristics with exact names from already reviewed MiniMed tools/knowledge
and records exact source locators for later human review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .edition_manifest import sha256_file
from .embedding import normalize_text

DEFAULT_SOURCE_TYPES = ("clinical_recommendation",)
MAX_SOURCE_TEXT = 1200
MAX_CANDIDATES = 100_000

_ALLOWED_TYPES = frozenset(
    {
        "scale",
        "questionnaire",
        "assessment_method",
        "criterion_set",
        "classification",
        "severity_grade",
    }
)
_EXCLUSIONS = re.compile(
    r"(?:критери[ия]\s+качества|оценк[аи]\s+качества\s+медицин|"
    r"уров(?:ень|ни)\s+убедительности\s+рекомендац|"
    r"уров(?:ень|ни)\s+достоверности\s+доказательств|"
    r"шкал[аы]\s+оценки\s+уровней\s+(?:достоверности|убедительности))",
    re.IGNORECASE,
)
_QUALITY_CONTEXT = re.compile(
    r"(?:критери[ия]\s+оценки\s+качества|критери[ия]\s+качества\s+медицин)",
    re.IGNORECASE,
)
_METHODOLOGY_CONTEXT = re.compile(
    r"(?:методологи[яи]\s+разработки\s+клинических\s+рекомендац|"
    r"достоверност[ьи]\s+доказательств|убедительности\s+рекомендац)",
    re.IGNORECASE,
)
_TOC_PATTERN = re.compile(r"(?:\.{3,}|…+)\s*\d+\s*$", re.IGNORECASE)
_TOC_SECTION_PATTERN = re.compile(r"^\s*\d+(?:\.\d+)+\s+", re.IGNORECASE)
_REFERENCE_START_PATTERN = re.compile(r"^\s*\d+\.\s+", re.IGNORECASE)
_REFERENCE_MARKER_PATTERN = re.compile(
    r"(?:\b(?:19|20)\d{2}\b|и\s+др\.|et\s+al\.?|//|\bdoi\b|\b№\s*\d|\bМ\.:)",
    re.IGNORECASE,
)
_GENERIC_CLASSIFICATION_PATTERN = re.compile(
    r"(?:классификац(?:ия|ии)\s+заболевания\s+или\s+состояния|"
    r"международн\w*\s+статистическ\w*\s+классификац\w*\s+болезн|"
    r"классификац\w*\s+болезней\s+и\s+проблем)",
    re.IGNORECASE,
)
_NEGATED_CLASSIFICATION_PATTERN = re.compile(
    r"классификац\w*[^.!?\n]{0,80}\bне\s+существует\b",
    re.IGNORECASE,
)
_SEVERITY_MEANING_PATTERN = re.compile(
    r"(?:тяжест|заболеван|процесс|недостаточност|дыхательн\w*\s+недостаточност)",
    re.IGNORECASE,
)
_GENERIC_ASSESSMENT_METHOD_PATTERN = re.compile(
    r"^(?:приложение\s+[а-яa-z0-9.\-]+\.?\s*)?"
    r"(?:(?:диагностические|психологические|когнитивные|нейропсихологические)\s+)?"
    r"(?:тесты?|методики?|батареи?)$",
    re.IGNORECASE,
)
_SCALE_PROSE_TAIL_PATTERN = re.compile(
    r"\s+(?:использ\w*|примен\w*|позвол\w*|предназнач\w*|служ\w*|"
    r"оценива\w*|рассчитыва\w*|определя\w*)\b",
    re.IGNORECASE,
)

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("questionnaire", re.compile(r"\b(?:опросник|анкета|questionnaire)\b", re.IGNORECASE)),
    ("criterion_set", re.compile(r"\bкритери(?:й|и|ев|ями|ям)\b", re.IGNORECASE)),
    ("classification", re.compile(r"\bклассификац(?:ия|ии|ию|ией)\b", re.IGNORECASE)),
    (
        "severity_grade",
        re.compile(
            r"\b(?:степен(?:ь|и|ей)|стади(?:я|и|й))\b[^\n]{0,80}"
            r"\b(?:тяжест|заболеван|процесс|недостаточност)",
            re.IGNORECASE,
        ),
    ),
    (
        "assessment_method",
        re.compile(
            r"\b(?:тест(?:а|ы|ов|ом|е)?|батаре(?:я|и|ю|ей)|"
            r"методик(?:а|и|у|ой)|test|battery)\b",
            re.IGNORECASE,
        ),
    ),
    ("scale", re.compile(r"\b(?:шкал(?:а|ы|е|ой|у)|score|индекс)\b", re.IGNORECASE)),
)

_NAME_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "scale": (
        re.compile(
            r"(?P<name>(?:по\s+)?шкал[аеы]?\s+[A-ZА-ЯЁ0-9][^,.;:\n()]{1,90})",
            re.IGNORECASE,
        ),
        re.compile(r"(?P<name>индекс\s+[^,.;:\n()]{2,80})", re.IGNORECASE),
    ),
    "questionnaire": (
        re.compile(r"(?P<name>опросник\s+[^,.;:\n()]{2,90})", re.IGNORECASE),
        re.compile(r"(?P<name>анкета\s+[^,.;:\n()]{2,90})", re.IGNORECASE),
    ),
    "assessment_method": (
        re.compile(
            r"(?P<name>(?:тест|батарея|методика)\s+[^,.;:\n()]{2,90})",
            re.IGNORECASE,
        ),
        re.compile(r"(?P<name>[^,.;:\n()]{2,80}\s+(?:test|battery))", re.IGNORECASE),
    ),
    "criterion_set": (
        re.compile(
            r"(?P<name>(?:диагностические\s+)?критерии\s+[^,.;:\n()]{2,90})",
            re.IGNORECASE,
        ),
    ),
    "classification": (
        re.compile(r"(?P<name>классификац(?:ия|ии)\s+[^,.;:\n()]{2,90})", re.IGNORECASE),
    ),
    "severity_grade": (
        re.compile(
            r"(?P<name>(?:степен(?:ь|и)|стади(?:я|и))\s+[^,.;:\n()]{2,90})",
            re.IGNORECASE,
        ),
    ),
}


@dataclass(frozen=True)
class KnownName:
    canonical_name: str
    normalized_name: str
    candidate_type: str
    source_kind: str
    source_id: str


@dataclass(frozen=True)
class Candidate:
    candidate_id: str
    candidate_type: str
    label: str
    confidence: float
    extraction_kind: str
    document_id: str
    document_version_id: str
    document_title: str
    section_id: str
    section_title: str
    chunk_id: str
    anchor: str
    page_start: int | None
    source_text: str
    context_kind: str = "content"
    signals: tuple[str, ...] = ()
    known_source_kind: str | None = None
    known_source_id: str | None = None

    def payload(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "candidateId": self.candidate_id,
            "candidateType": self.candidate_type,
            "label": self.label,
            "confidence": self.confidence,
            "reviewStatus": "proposed",
            "extractionKind": self.extraction_kind,
            "contextKind": self.context_kind,
            "signals": list(self.signals),
            **(
                {
                    "knownMatch": {
                        "kind": self.known_source_kind,
                        "id": self.known_source_id,
                    }
                }
                if self.known_source_kind and self.known_source_id
                else {}
            ),
            "source": {
                "documentId": self.document_id,
                "documentVersionId": self.document_version_id,
                "documentTitle": self.document_title,
                "sectionId": self.section_id,
                "sectionTitle": self.section_title,
                "chunkId": self.chunk_id,
                "anchor": self.anchor,
                "pageStart": self.page_start,
                "text": self.source_text,
            },
        }


def _table_exists(connection: sqlite3.Connection, name: str) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
            (name,),
        ).fetchone()
        is not None
    )


def _candidate_types(text: str) -> tuple[str, ...]:
    if _EXCLUSIONS.search(text):
        return ()
    return tuple(candidate_type for candidate_type, pattern in _PATTERNS if pattern.search(text))


def _heading_candidate_types(text: str) -> tuple[str, ...]:
    if _EXCLUSIONS.search(text):
        return ()
    result: list[str] = []
    for candidate_type, pattern in _PATTERNS:
        match = pattern.search(text)
        if match and match.start() <= 42:
            result.append(candidate_type)
    # A heading such as "Классификация по степени тяжести" names the
    # classification itself; "степени тяжести" is not a second entity.
    if "classification" in result and "severity_grade" in result:
        result.remove("severity_grade")
    return tuple(result)


def _meaningful_label(candidate_type: str, label: str, source_text: str) -> bool:
    normalized = normalize_text(label)
    if len(normalized) < 4:
        return False
    if candidate_type == "classification":
        if _GENERIC_CLASSIFICATION_PATTERN.search(label):
            return False
        if _NEGATED_CLASSIFICATION_PATTERN.search(source_text):
            return False
    if candidate_type == "severity_grade" and not _SEVERITY_MEANING_PATTERN.search(label):
        return False
    if candidate_type == "assessment_method" and _GENERIC_ASSESSMENT_METHOD_PATTERN.fullmatch(
        label.strip()
    ):
        return False
    return not (candidate_type == "scale" and normalized in {"шкала", "шкала оценки", "индекс"})


def _clean_candidate_label(candidate_type: str, label: str) -> str:
    clean = " ".join(label.split())
    if candidate_type != "scale":
        return clean[:180]

    # Body prose often uses an inflected lead-in ("по шкале CURB-65
    # используется..."). Keep only the instrument name so it deduplicates
    # against the section-title candidate instead of becoming a false entity.
    clean = re.sub(r"^(?:по\s+)?шкал[аеы]\s+", "Шкала ", clean, flags=re.IGNORECASE)
    clean = _SCALE_PROSE_TAIL_PATTERN.split(clean, maxsplit=1)[0]
    return clean[:180]


def _candidate_label(candidate_type: str, text: str) -> str | None:
    for pattern in _NAME_PATTERNS.get(candidate_type, ()):
        match = pattern.search(text)
        if match:
            label = _clean_candidate_label(candidate_type, match.group("name"))
            return label if _meaningful_label(candidate_type, label, text) else None
    return None


def _context_kind(section_title: str, text: str) -> str:
    combined = f"{section_title}\n{text[:600]}"
    if _QUALITY_CONTEXT.search(combined):
        return "quality"
    if _METHODOLOGY_CONTEXT.search(combined):
        return "methodology"
    if _TOC_PATTERN.search(section_title):
        return "toc"
    if (
        _TOC_SECTION_PATTERN.search(section_title)
        and _TOC_SECTION_PATTERN.search(text.lstrip())
        and _TOC_PATTERN.search(text[:500])
    ):
        return "toc"
    if _REFERENCE_START_PATTERN.search(section_title) and _REFERENCE_MARKER_PATTERN.search(
        combined
    ):
        return "bibliography"
    return "content"


def _source_excerpt(text: str, label: str) -> str:
    clean = " ".join(text.split())
    if len(clean) <= MAX_SOURCE_TEXT:
        return clean
    normalized = normalize_text(clean)
    label_normalized = normalize_text(label)
    offset = normalized.find(label_normalized) if label_normalized else -1
    if offset < 0:
        return clean[: MAX_SOURCE_TEXT - 1] + "…"
    start = max(0, offset - MAX_SOURCE_TEXT // 3)
    end = min(len(clean), start + MAX_SOURCE_TEXT)
    return ("…" if start else "") + clean[start:end] + ("…" if end < len(clean) else "")


def _candidate_id(
    document_version_id: str,
    section_id: str,
    chunk_id: str,
    candidate_type: str,
    label: str,
) -> str:
    key = "\0".join(
        [document_version_id, section_id, chunk_id, candidate_type, normalize_text(label)]
    )
    return "candidate.knowledge." + hashlib.sha256(key.encode()).hexdigest()[:24]


def _known_type_for_tool(kind: str, names: list[str]) -> str:
    joined = " ".join(names)
    if kind == "assessment" and re.search(r"\b(?:опросник|анкета|questionnaire)\b", joined, re.I):
        return "questionnaire"
    if kind == "assessment" and re.search(
        r"\b(?:тест|test|battery|батаре\w*|методик\w*|матриц\w*)\b",
        joined,
        re.I,
    ):
        return "assessment_method"
    return "scale"


def _load_known_names(paths: tuple[Path, ...]) -> tuple[KnownName, ...]:
    known: dict[tuple[str, str, str], KnownName] = {}
    for path in paths:
        resolved = path.resolve(strict=True)
        connection = sqlite3.connect(f"{resolved.as_uri()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            if _table_exists(connection, "tool_definitions"):
                rows = connection.execute(
                    """SELECT id, kind, title, short_title, aliases_json
                    FROM tool_definitions ORDER BY id"""
                )
                for row in rows:
                    aliases_raw: object = json.loads(str(row["aliases_json"]))
                    aliases = (
                        [item for item in aliases_raw if isinstance(item, str)]
                        if isinstance(aliases_raw, list)
                        else []
                    )
                    names = [str(row["title"]), str(row["short_title"]), *aliases]
                    candidate_type = _known_type_for_tool(str(row["kind"]), names)
                    for name in names:
                        normalized = normalize_text(name)
                        if len(normalized) < 3:
                            continue
                        item = KnownName(
                            canonical_name=str(row["title"]),
                            normalized_name=normalized,
                            candidate_type=candidate_type,
                            source_kind="tool",
                            source_id=str(row["id"]),
                        )
                        known[(item.source_kind, item.source_id, normalized)] = item

            if _table_exists(connection, "knowledge_entities"):
                entity_rows = connection.execute(
                    """SELECT id, entity_type, canonical_name
                    FROM knowledge_entities ORDER BY id"""
                ).fetchall()
                for entity_row in entity_rows:
                    entity_type = str(entity_row["entity_type"])
                    if entity_type not in _ALLOWED_TYPES:
                        continue
                    entity_id = str(entity_row["id"])
                    names = [str(entity_row["canonical_name"])]
                    if _table_exists(connection, "knowledge_names"):
                        names.extend(
                            str(row[0])
                            for row in connection.execute(
                                "SELECT name FROM knowledge_names WHERE entity_id = ? ORDER BY id",
                                (entity_id,),
                            )
                        )
                    for name in names:
                        normalized = normalize_text(name)
                        if len(normalized) < 3:
                            continue
                        item = KnownName(
                            canonical_name=str(entity_row["canonical_name"]),
                            normalized_name=normalized,
                            candidate_type=entity_type,
                            source_kind="concept",
                            source_id=entity_id,
                        )
                        known[(item.source_kind, item.source_id, normalized)] = item
        finally:
            connection.close()
    return tuple(known[key] for key in sorted(known))


def _known_index(items: tuple[KnownName, ...]) -> dict[str, tuple[KnownName, ...]]:
    grouped: dict[str, list[KnownName]] = {}
    for item in items:
        first = item.normalized_name.split(" ", 1)[0]
        if not first:
            continue
        grouped.setdefault(first, []).append(item)
    return {key: tuple(value) for key, value in grouped.items()}


def _known_matches(text: str, index: dict[str, tuple[KnownName, ...]]) -> tuple[KnownName, ...]:
    normalized = normalize_text(text)
    if not normalized:
        return ()
    padded = f" {normalized} "
    first_tokens = set(normalized.split())
    matches: dict[tuple[str, str], KnownName] = {}
    for token in first_tokens:
        for item in index.get(token, ()):
            if f" {item.normalized_name} " in padded:
                matches[(item.source_kind, item.source_id)] = item
    return tuple(matches[key] for key in sorted(matches))


def _build_candidate(
    row: sqlite3.Row,
    *,
    candidate_type: str,
    label: str,
    confidence: float,
    extraction_kind: str,
    context_kind: str,
    signals: tuple[str, ...],
    known: KnownName | None = None,
) -> Candidate:
    return Candidate(
        candidate_id=_candidate_id(
            str(row["document_version_id"]),
            str(row["section_id"]),
            str(row["chunk_id"]),
            candidate_type,
            label,
        ),
        candidate_type=candidate_type,
        label=label,
        confidence=confidence,
        extraction_kind=extraction_kind,
        document_id=str(row["document_id"]),
        document_version_id=str(row["document_version_id"]),
        document_title=str(row["document_title"]),
        section_id=str(row["section_id"]),
        section_title=str(row["section_title"]),
        chunk_id=str(row["chunk_id"]),
        anchor=str(row["anchor"]),
        page_start=int(row["page_start"]) if row["page_start"] is not None else None,
        source_text=_source_excerpt(str(row["original_text"]), label),
        context_kind=context_kind,
        signals=signals,
        known_source_kind=known.source_kind if known else None,
        known_source_id=known.source_id if known else None,
    )


def scan_candidates(
    source: Path,
    *,
    source_types: tuple[str, ...] = DEFAULT_SOURCE_TYPES,
    inventory_sources: tuple[Path, ...] = (),
) -> tuple[Candidate, ...]:
    path = source.resolve(strict=True)
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    known = _known_index(_load_known_names(inventory_sources))
    try:
        if [str(row[0]) for row in connection.execute("PRAGMA integrity_check")] != ["ok"]:
            raise ValueError("Source SQLite failed integrity check.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Source SQLite failed foreign-key check.")
        placeholders = ",".join("?" for _ in source_types)
        rows = connection.execute(
            f"""SELECT d.id AS document_id, d.title AS document_title,
                       v.id AS document_version_id, s.id AS section_id,
                       s.title AS section_title, c.id AS chunk_id, c.anchor,
                       COALESCE(c.page_start, s.page_start) AS page_start,
                       c.original_text
                FROM documents d
                JOIN document_versions v ON v.id = d.current_version_id
                JOIN sections s ON s.document_version_id = v.id
                JOIN chunks c ON c.section_id = s.id
                WHERE d.source_type IN ({placeholders})
                ORDER BY d.id, s.order_index, c.order_index, c.id""",
            source_types,
        )
        candidates: dict[tuple[str, str, str], Candidate] = {}
        for row in rows:
            section_title = str(row["section_title"])
            text = str(row["original_text"])
            context = _context_kind(section_title, text)
            suppressed_heuristic = context in {"quality", "methodology", "toc", "bibliography"}

            if not suppressed_heuristic:
                heading_types = _heading_candidate_types(section_title)
                for candidate_type in heading_types:
                    label = " ".join(section_title.split())[:180]
                    if candidate_type == "assessment_method":
                        label = _candidate_label(candidate_type, section_title) or label
                    if not _meaningful_label(candidate_type, label, text):
                        continue
                    candidate = _build_candidate(
                        row,
                        candidate_type=candidate_type,
                        label=label,
                        confidence=0.88,
                        extraction_kind="section-title",
                        context_kind=context,
                        signals=("heuristic-heading",),
                    )
                    key = (
                        candidate.document_version_id,
                        candidate.candidate_type,
                        normalize_text(candidate.label),
                    )
                    previous = candidates.get(key)
                    if previous is None or candidate.confidence > previous.confidence:
                        candidates[key] = candidate

                for candidate_type in _candidate_types(text):
                    # Generic "test/method" prose is far too noisy. Discover named assessment
                    # methods structurally from headings or through the reviewed-name inventory.
                    if candidate_type == "assessment_method":
                        continue
                    label = _candidate_label(candidate_type, text)
                    if not label:
                        continue
                    candidate = _build_candidate(
                        row,
                        candidate_type=candidate_type,
                        label=label,
                        confidence=0.68,
                        extraction_kind="body-mention",
                        context_kind=context,
                        signals=("heuristic-body",),
                    )
                    key = (
                        candidate.document_version_id,
                        candidate.candidate_type,
                        normalize_text(candidate.label),
                    )
                    previous = candidates.get(key)
                    if previous is None or candidate.confidence > previous.confidence:
                        candidates[key] = candidate

            if context not in {"quality", "methodology", "toc"}:
                for known_match in _known_matches(f"{section_title}\n{text}", known):
                    confidence = 0.97 if context == "content" else 0.72
                    candidate = _build_candidate(
                        row,
                        candidate_type=known_match.candidate_type,
                        label=known_match.canonical_name,
                        confidence=confidence,
                        extraction_kind=f"known-{known_match.source_kind}",
                        context_kind=context,
                        signals=(f"known-{known_match.source_kind}",),
                        known=known_match,
                    )
                    key = (
                        candidate.document_version_id,
                        candidate.candidate_type,
                        normalize_text(candidate.label),
                    )
                    previous = candidates.get(key)
                    if previous is None or candidate.confidence > previous.confidence:
                        candidates[key] = candidate

            if len(candidates) > MAX_CANDIDATES:
                raise ValueError("Candidate scan exceeded the safety limit.")
        ordered = sorted(
            candidates.values(),
            key=lambda item: (
                item.document_id,
                item.section_id,
                item.chunk_id,
                item.candidate_type,
                normalize_text(item.label),
            ),
        )
        known_by_chunk_type: dict[tuple[str, str], list[Candidate]] = {}
        for candidate in ordered:
            if candidate.known_source_id:
                known_by_chunk_type.setdefault(
                    (candidate.chunk_id, candidate.candidate_type),
                    [],
                ).append(candidate)

        def label_terms(value: str) -> set[str]:
            return {
                term
                for term in normalize_text(value).split()
                if term not in {"по", "для", "им", "имени", "тест", "шкала", "индекс"}
            }

        def duplicates_known(candidate: Candidate) -> bool:
            if candidate.known_source_id:
                return False
            source_terms = label_terms(candidate.label)
            if len(source_terms) < 2:
                return False
            for known_candidate in known_by_chunk_type.get(
                (candidate.chunk_id, candidate.candidate_type),
                [],
            ):
                known_terms = label_terms(known_candidate.label)
                if not known_terms:
                    continue
                overlap = len(source_terms & known_terms)
                if overlap >= 2 and overlap / min(len(source_terms), len(known_terms)) >= 0.6:
                    return True
            return False

        return tuple(candidate for candidate in ordered if not duplicates_known(candidate))
    finally:
        connection.close()


def write_candidate_workspace(
    source: Path,
    output: Path,
    *,
    source_types: tuple[str, ...] = DEFAULT_SOURCE_TYPES,
    inventory_sources: tuple[Path, ...] = (),
) -> int:
    if output.exists():
        raise ValueError("Output is immutable; choose a new candidate workspace.")
    candidates = scan_candidates(
        source,
        source_types=source_types,
        inventory_sources=inventory_sources,
    )
    output.mkdir(parents=True, exist_ok=False)
    payload = "".join(
        json.dumps(candidate.payload(), ensure_ascii=False, sort_keys=True) + "\n"
        for candidate in candidates
    )
    (output / "candidates.jsonl").write_text(payload, encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "source": str(source.resolve()),
        "sourceSha256": sha256_file(source.resolve(strict=True)),
        "sourceTypes": list(source_types),
        "inventorySources": [
            {
                "path": str(path.resolve()),
                "sha256": sha256_file(path.resolve(strict=True)),
            }
            for path in inventory_sources
        ],
        "candidateCount": len(candidates),
        "candidateSha256": "sha256:" + hashlib.sha256(payload.encode()).hexdigest(),
        "reviewStatus": "proposed",
        "note": (
            "Candidates are source locators, not reviewed medical concepts or executable tools."
        ),
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(candidates)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--source-type",
        action="append",
        dest="source_types",
        help="Repeat to scan additional source types; defaults to full clinical recommendations.",
    )
    parser.add_argument(
        "--inventory-db",
        action="append",
        dest="inventory_sources",
        type=Path,
        help=(
            "Optional reviewed MiniMed SQLite DB. Exact tool/concept names are used as an "
            "additional candidate channel; repeat for multiple inventories."
        ),
    )
    args = parser.parse_args()
    count = write_candidate_workspace(
        args.input,
        args.output,
        source_types=tuple(args.source_types) if args.source_types else DEFAULT_SOURCE_TYPES,
        inventory_sources=tuple(args.inventory_sources or ()),
    )
    print(f"Prepared {count} review-only knowledge candidates: {args.output}")


if __name__ == "__main__":
    main()
