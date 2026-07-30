from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from uuid import uuid4

from .models import CamelModel

_RULE_VERSION = "instruction-card-drafts-v2-heading-exact-body-marker"
_GROUP_RULES = {
    "identity": {"общая информация", "наименование лекарственного препарата"},
    "use": {"показания к применению"},
    "warning": {"противопоказания", "особые указания", "меры предосторожности"},
    "administration": {"способ применения", "способ применения и дозы", "режим дозирования"},
    "adverse-reaction": {
        "нежелательные реакции",
        "возможные нежелательные реакции",
        "побочное действие",
    },
    "storage": {"условия хранения", "хранение"},
}
_REQUIRED_COLUMNS = {
    "documents": {"id", "title", "source_type", "current_version_id"},
    "document_versions": {"id", "document_id", "source_checksum"},
    "sections": {"id", "document_version_id", "title", "order_index", "anchor"},
    "chunks": {"id", "document_version_id", "section_id", "order_index", "original_text", "anchor"},
}
_HEADING_PREFIX = re.compile(r"^\s*\d+\s*[.)]?\s*")
_HEADING_TRAILING = re.compile(r"[.:;]+\s*$")
_WHITESPACE = re.compile(r"\s+")
_TOC_PAGE_LINE = re.compile(r"^(?:[.·…]\s*)*\d+\s*$")


class InstructionCardDraftExport(CamelModel):
    input: str
    output: str
    documents: int
    group_coverage: dict[str, int]
    missing_group_counts: dict[str, int]
    extraction_rule_version: str = _RULE_VERSION


def _normal_heading(title: str) -> str:
    value = _HEADING_PREFIX.sub("", title).casefold()
    value = _HEADING_TRAILING.sub("", value)
    return _WHITESPACE.sub(" ", value).strip()


def _validate_input(connection: sqlite3.Connection, input_path: Path) -> None:
    integrity = connection.execute("PRAGMA integrity_check").fetchone()
    if integrity is None or integrity[0] != "ok":
        raise ValueError(f"Instruction draft input failed integrity check: {input_path}")
    for table, required in _REQUIRED_COLUMNS.items():
        columns = {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}
        missing = sorted(required - columns)
        if missing:
            raise ValueError(
                f"Instruction draft input {input_path} lacks {table} columns: {missing}"
            )


def _group_for_heading(title: str) -> str | None:
    normalized = _normal_heading(title)
    return next(
        (group for group, headings in _GROUP_RULES.items() if normalized in headings),
        None,
    )


def _body_heading_markers(text: str) -> list[tuple[str, int, int, str]]:
    """Return exact physical heading lines at a chunk boundary or after a blank line."""
    markers: list[tuple[str, int, int, str]] = []
    offset = 0
    after_blank = False
    lines = text.splitlines(keepends=True)
    for index, physical_line in enumerate(lines):
        line = physical_line.rstrip("\r\n")
        is_blank = not line.strip(" \t")
        is_marker_position = offset == 0 or after_blank
        if not is_blank and is_marker_position:
            group = _group_for_heading(line.strip(" \t"))
            if group is not None and not _next_nonblank_is_toc_page(lines, index + 1):
                markers.append((group, offset, offset + len(line), line))
        after_blank = is_blank
        offset += len(physical_line)
    return markers


def _next_nonblank_is_toc_page(lines: list[str], start: int) -> bool:
    for physical_line in lines[start:]:
        line = physical_line.strip(" \t\r\n")
        if line:
            return _TOC_PAGE_LINE.fullmatch(line) is not None
    return False


def export_instruction_card_drafts(input_path: Path, output: Path) -> InstructionCardDraftExport:
    """Export exact instruction excerpts as external review-only card drafts."""
    if not input_path.is_file():
        raise ValueError(f"Instruction draft input is not a file: {input_path}")
    if input_path.resolve() == output.resolve():
        raise ValueError("Instruction draft output must not overwrite the input SQLite database.")
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA schema_version").fetchone()
    except sqlite3.DatabaseError as error:
        raise ValueError(
            f"Instruction draft input is not a valid SQLite database: {input_path}"
        ) from error

    try:
        _validate_input(connection, input_path)
        temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
        output.parent.mkdir(parents=True, exist_ok=True)
        coverage = {group: 0 for group in _GROUP_RULES}
        missing = {group: 0 for group in _GROUP_RULES}
        documents = 0
        try:
            with temporary.open("w", encoding="utf-8") as destination:
                document_rows = connection.execute(
                    """SELECT d.id, d.title, dv.id AS version_id, dv.source_checksum
                    FROM documents d
                    JOIN document_versions dv ON dv.id = d.current_version_id
                    WHERE d.source_type = 'official_drug_instruction'
                    ORDER BY d.id"""
                )
                for document in document_rows:
                    document_id = str(document["id"])
                    version_id = str(document["version_id"])
                    groups: dict[str, list[dict[str, object]]] = {}
                    rows = connection.execute(
                        """SELECT s.id AS section_id, s.title AS section_title,
                                  s.anchor AS section_anchor, c.id AS chunk_id,
                                  c.anchor AS chunk_anchor, c.original_text
                        FROM sections s
                        JOIN chunks c ON c.section_id = s.id
                        WHERE s.document_version_id = ? AND c.document_version_id = ?
                        ORDER BY s.order_index, c.order_index, c.id""",
                        (version_id, version_id),
                    )
                    chunk_rows = rows.fetchall()
                    for row in chunk_rows:
                        group = _group_for_heading(str(row["section_title"]))
                        if group is None:
                            continue
                        groups.setdefault(group, []).append(
                            {
                                "documentId": document_id,
                                "documentVersionId": version_id,
                                "sectionId": str(row["section_id"]),
                                "chunkId": str(row["chunk_id"]),
                                "anchor": str(row["chunk_anchor"]),
                                "quote": str(row["original_text"]),
                                "sectionAnchor": str(row["section_anchor"]),
                            }
                        )
                    if len(groups) < len(_GROUP_RULES):
                        for row in chunk_rows:
                            for group, start, end, quote in _body_heading_markers(
                                str(row["original_text"])
                            ):
                                if group in groups:
                                    continue
                                groups[group] = [
                                    {
                                        "documentId": document_id,
                                        "documentVersionId": version_id,
                                        "sectionId": str(row["section_id"]),
                                        "chunkId": str(row["chunk_id"]),
                                        "anchor": str(row["chunk_anchor"]),
                                        "quote": quote,
                                        "sectionAnchor": str(row["section_anchor"]),
                                        "matchKind": "body-heading-marker",
                                        "startOffset": start,
                                        "endOffset": end,
                                    }
                                ]
                    missing_groups = [group for group in _GROUP_RULES if group not in groups]
                    for group in groups:
                        coverage[group] += 1
                    for group in missing_groups:
                        missing[group] += 1
                    candidate = {
                        "artifactType": "instruction-card-draft",
                        "reviewStatus": "needs-review",
                        "extractionRule": {
                            "version": _RULE_VERSION,
                            "method": (
                                "exact normalized section-heading match with "
                                "body-heading-marker fallback"
                            ),
                        },
                        "document": {
                            "id": document_id,
                            "title": str(document["title"]),
                            "versionId": version_id,
                            "sourceChecksum": str(document["source_checksum"]),
                        },
                        "groups": groups,
                        "missingGroups": missing_groups,
                    }
                    destination.write(
                        json.dumps(candidate, ensure_ascii=False, separators=(",", ":")) + "\n"
                    )
                    documents += 1
            temporary.replace(output)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    finally:
        connection.close()
    return InstructionCardDraftExport(
        input=str(input_path),
        output=str(output),
        documents=documents,
        group_coverage=coverage,
        missing_group_counts=missing,
    )
