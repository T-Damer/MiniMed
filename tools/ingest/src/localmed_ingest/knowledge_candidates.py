"""Extract review-only clinical knowledge candidates from source-preserving SQLite documents.

The scanner never creates knowledge entities or claims clinical equivalence. It records exact source
locators for headings/text that appear to describe scales, questionnaires, criteria, classifications
or severity/stage systems so a later review step can promote selected records.
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

_EXCLUSIONS = re.compile(
    r"(?:критери[ия]\s+качества|оценк[аи]\s+качества\s+медицин|"
    r"уров(?:ень|ни)\s+убедительности\s+рекомендац|"
    r"уров(?:ень|ни)\s+достоверности\s+доказательств)",
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
        "scale",
        re.compile(r"\b(?:шкал(?:а|ы|е|ой|у)|score|индекс)\b", re.IGNORECASE),
    ),
)
_NAME_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"(?P<name>(?:по\s+)?шкал[аеы]?\s+[A-ZА-ЯЁ][^,.;:\n()]{1,90})",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?P<name>(?:диагностические\s+)?критерии\s+[^,.;:\n()]{2,90})",
        re.IGNORECASE,
    ),
    re.compile(r"(?P<name>индекс\s+[^,.;:\n()]{2,80})", re.IGNORECASE),
    re.compile(r"(?P<name>опросник\s+[^,.;:\n()]{2,90})", re.IGNORECASE),
)


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

    def payload(self) -> dict[str, object]:
        return {
            "schemaVersion": 1,
            "candidateId": self.candidate_id,
            "candidateType": self.candidate_type,
            "label": self.label,
            "confidence": self.confidence,
            "reviewStatus": "proposed",
            "extractionKind": self.extraction_kind,
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


def _candidate_type(text: str) -> str | None:
    if _EXCLUSIONS.search(text):
        return None
    for candidate_type, pattern in _PATTERNS:
        if pattern.search(text):
            return candidate_type
    return None


def _candidate_label(section_title: str, text: str, *, heading_match: bool) -> str:
    if heading_match:
        return " ".join(section_title.split())[:180]
    for pattern in _NAME_PATTERNS:
        match = pattern.search(text)
        if match:
            return " ".join(match.group("name").split())[:180]
    line = next((line.strip() for line in text.splitlines() if line.strip()), text.strip())
    return " ".join(line.split())[:180]


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


def scan_candidates(
    source: Path,
    *,
    source_types: tuple[str, ...] = DEFAULT_SOURCE_TYPES,
) -> tuple[Candidate, ...]:
    path = source.resolve(strict=True)
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
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
        candidates: list[Candidate] = []
        seen: set[tuple[str, str, str]] = set()
        for row in rows:
            section_title = str(row["section_title"])
            text = str(row["original_text"])
            heading_type = _candidate_type(section_title)
            body_type = _candidate_type(text)
            candidate_type = heading_type or body_type
            if candidate_type is None:
                continue
            heading_match = heading_type is not None
            label = _candidate_label(section_title, text, heading_match=heading_match)
            key = (str(row["document_version_id"]), candidate_type, normalize_text(label))
            if key in seen:
                continue
            seen.add(key)
            candidate = Candidate(
                candidate_id=_candidate_id(
                    str(row["document_version_id"]),
                    str(row["section_id"]),
                    str(row["chunk_id"]),
                    candidate_type,
                    label,
                ),
                candidate_type=candidate_type,
                label=label,
                confidence=0.88 if heading_match else 0.62,
                extraction_kind="section-title" if heading_match else "body-mention",
                document_id=str(row["document_id"]),
                document_version_id=str(row["document_version_id"]),
                document_title=str(row["document_title"]),
                section_id=str(row["section_id"]),
                section_title=section_title,
                chunk_id=str(row["chunk_id"]),
                anchor=str(row["anchor"]),
                page_start=int(row["page_start"]) if row["page_start"] is not None else None,
                source_text=_source_excerpt(text, label),
            )
            candidates.append(candidate)
            if len(candidates) > MAX_CANDIDATES:
                raise ValueError("Candidate scan exceeded the safety limit.")
        return tuple(candidates)
    finally:
        connection.close()


def write_candidate_workspace(
    source: Path,
    output: Path,
    *,
    source_types: tuple[str, ...] = DEFAULT_SOURCE_TYPES,
) -> int:
    if output.exists():
        raise ValueError("Output is immutable; choose a new candidate workspace.")
    candidates = scan_candidates(source, source_types=source_types)
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
    args = parser.parse_args()
    count = write_candidate_workspace(
        args.input,
        args.output,
        source_types=tuple(args.source_types) if args.source_types else DEFAULT_SOURCE_TYPES,
    )
    print(f"Prepared {count} review-only knowledge candidates: {args.output}")


if __name__ == "__main__":
    main()
