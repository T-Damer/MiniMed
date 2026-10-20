"""Released GRLS instruction modules: one pack per ATC level-1 group (+ unclassified).

Pure planning and staging parts of `scripts/build_grls_instruction_modules.py` (the command-line
entry point). Input is the already prepared Markdown (byte-exact source text with
`localmed:source` spans) of every instruction whose row in
`data/build/grls-instruction-text-manifest.jsonl` says `extraction == prepared`, joined by the
manifest's `workspace` column. Each instruction is assigned to the ЕСКЛП medication module that
lists one of its registration numbers (the same 15 groups as `data/build/release-esklp`); a
registration the ЕСКЛП does not list, or whose MNN has no ATC code, goes to `unclassified`.

What changes in a staged copy: only the front matter. The body (every source block, span comment
and heading) is carried over byte for byte. Added metadata (all of it from the manifest, none of it
inferred): `documentKind`, `fetchedAt`, `ocr`, `textExtractionMode`, OCR confidence, quality
signal, `textSha256`, every registration number the same PDF serves (`registrationNumbers`) and
the ATC group. A leaflet/ОХЛП title names its kind; ids, section and chunk identifiers do not
change.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml

from .builder import build_content_pack
from .grls_contents_lists import apply_overlay as apply_contents_overlay
from .grls_contents_lists import read_overlay as read_contents_overlay
from .grls_document_kind import classify_scan_document
from .sqlite_builder import repository_root

# Private data (manifest, prepared workspaces, ЕСКЛП release) lives in the main checkout only:
# a worktree build points MINIMED_DATA_ROOT at it.
REPO_ROOT = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
MODULE_TITLES = {
    "alimentary-metabolism": "Пищеварительный тракт и обмен веществ",
    "antiinfectives": "Противоинфекционные препараты системного действия",
    "antineoplastic-immunomodulating": "Противоопухолевые и иммуномодулирующие средства",
    "antiparasitic": "Противопаразитарные препараты, инсектициды и репелленты",
    "blood": "Средства, влияющие на кроветворение и кровь",
    "cardiovascular": "Сердечно-сосудистая система",
    "dermatological": "Дерматологические препараты",
    "genitourinary-hormones": "Мочеполовая система и половые гормоны",
    "musculoskeletal": "Костно-мышечная система",
    "nervous-system": "Нервная система",
    "respiratory": "Дыхательная система",
    "sensory-organs": "Органы чувств",
    "systemic-hormones": "Гормональные препараты системного действия (исключая половые гормоны)",
    "unclassified": "Без установленного кода АТХ (в т.ч. гомеопатические/комбинированные)",
    "various": "Прочие препараты",
}
_JSON_ESCAPE_MARKER = re.compile(r"\\[bfnrtu]")


def heading_json_escape_reason(md_path: Path) -> str | None:
    """A heading that would fail the SQLite build's JSON-escape guard (OCR noise), if any."""
    for line in md_path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("#"):
            continue
        title = line.lstrip("#").strip()
        if _JSON_ESCAPE_MARKER.search(json.dumps([title], ensure_ascii=False)):
            return (
                f"heading contains a raw control character or backslash (OCR artifact): {title!r}"
            )
    return None


RELEASE_ESKLP_DIR = REPO_ROOT / "data" / "build" / "release-esklp"
#: Instructions whose OCR text was re-read against the scan (`content/grls-reviewed-ocr/<id>.md`).
REVIEWED_OCR_DIR = REPO_ROOT / "content" / "grls-reviewed-ocr"
MANIFEST_PATH = REPO_ROOT / "data" / "build" / "grls-instruction-text-manifest.jsonl"
MODULE_PREFIX = "minimed.medications.instructions."
MODULE_SUFFIX = ".ru"
PACK_VERSION = "grls-2026.10.20"
BUILT_AT = "2026-10-20T00:00:00Z"
UNCLASSIFIED = "unclassified"

KIND_TITLE_SUFFIX = {
    "leaflet": "листок-вкладыш",
    "ohlp": "общая характеристика лекарственного препарата (ОХЛП)",
    "amendment": "лист изменений к инструкции",
}
OVERLAY_PATH = REPO_ROOT / "data" / "build" / "grls-ocr-quality.jsonl"
#: Documents whose leaflet table of contents was re-rendered as one list (LEAF1).
CONTENTS_OVERLAY_PATH = REPO_ROOT / "data" / "build" / "grls-contents-lists.jsonl"
#: Overlay columns (OCR1) that replace the manifest value of the same PDF.
OVERLAY_COLUMNS = (
    "workspace",
    "documentKind",
    "ocr",
    "ocrEngine",
    "ocrMeanConfidence",
    "ocrLowConfidenceRatio",
    "unknownWordRatio",
    "wordCount",
    "textSha256",
    "textSource",
)
GENERATED_TITLE_SUFFIX = ": инструкция по медицинскому применению"


def module_id(group: str) -> str:
    return f"{MODULE_PREFIX}{group}{MODULE_SUFFIX}"


def group_title(group: str) -> str:
    return MODULE_TITLES.get(group, group)


@dataclass(frozen=True)
class PlannedInstruction:
    """One prepared instruction document and where it goes."""

    document_id: str
    path: Path
    group: str
    group_basis: str
    registration_numbers: tuple[str, ...]
    #: The manifest row of the newest PDF carrying this document id.
    newest: Mapping[str, Any]

    @property
    def kind(self) -> str:
        return str(self.newest.get("documentKind") or "unknown")


def _mapping_list(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [cast(Mapping[str, Any], item) for item in items if isinstance(item, dict)]


def load_registration_groups(release_dir: Path = RELEASE_ESKLP_DIR) -> dict[str, set[str]]:
    """Registration number -> ЕСКЛП module groups listing it (trade names and КЛП positions)."""
    groups: dict[str, set[str]] = defaultdict(set)
    for db_path in sorted(release_dir.glob("*.db")):
        group = db_path.stem.removeprefix("minimed.medications.").removesuffix(".ru")
        connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            for (raw,) in connection.execute("SELECT metadata_json FROM documents"):
                metadata = cast(Mapping[str, Any], json.loads(raw))
                for node in _mapping_list(metadata.get("smnnNodes")):
                    for key in ("tradeNames", "klpPositions"):
                        for item in _mapping_list(node.get(key)):
                            registration = item.get("registrationNumber")
                            if isinstance(registration, str) and registration:
                                groups[registration].add(group)
        finally:
            connection.close()
    return groups


def assign_group(
    primary: str,
    registrations: Sequence[str],
    registration_groups: Mapping[str, set[str]],
) -> tuple[str, str]:
    """(group, basis). The primary registration decides; otherwise the most common group."""
    direct = registration_groups.get(primary, set())
    if len(direct) == 1:
        return next(iter(direct)), "esklp-registration"
    counts: Counter[str] = Counter()
    for registration in registrations:
        for group in registration_groups.get(registration, set()):
            counts[group] += 1
    if not counts:
        return UNCLASSIFIED, "no-esklp-registration"
    best = max(counts.values())
    winners = sorted(group for group, count in counts.items() if count == best)
    return winners[0], "esklp-registration" if len(winners) == 1 else "esklp-registration-tie"


def plain_body(markdown: str) -> str:
    """The body of a prepared Markdown file without its front matter."""
    return split_front_matter(markdown)[1]


def read_manifest_rows(
    path: Path = MANIFEST_PATH,
    overlay: Path | None = OVERLAY_PATH,
    contents_overlay: Path | None = CONTENTS_OVERLAY_PATH,
) -> list[dict[str, Any]]:
    """Manifest rows with the OCR1 overlay (re-prepared text, kind, quality) joined by PDF.

    The LEAF1 overlay comes last and only replaces the text workspace and digest of a document
    whose leaflet contents list was re-rendered (`grls_contents_lists.py`).
    """
    rows = [
        cast(dict[str, Any], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    if overlay is not None and overlay.is_file():
        rows = apply_overlay(rows, read_overlay(overlay))
    if contents_overlay is not None:
        rows = apply_contents_overlay(rows, read_contents_overlay(contents_overlay))
    return rows


def read_overlay(path: Path) -> dict[str, dict[str, Any]]:
    return {
        str(row["pdfSha256"]): row
        for row in (
            cast(dict[str, Any], json.loads(line))
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        )
    }


def apply_overlay(
    rows: Sequence[Mapping[str, Any]], overlay: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """A row whose PDF has an overlay row takes its text workspace, kind and OCR quality from it.

    Rows without an overlay row are returned unchanged. Every extra overlay column (quality grade
    reasons, uncertain numbers, tool) travels in `ocrOverlay` for `augmented_markdown`.
    """
    merged: list[dict[str, Any]] = []
    for row in rows:
        entry = dict(row)
        extra = overlay.get(str(row.get("pdfSha256")))
        if extra is not None and row.get("extraction") == "prepared":
            for column in OVERLAY_COLUMNS:
                if column in extra:
                    entry[column] = extra[column]
            entry["ocrOverlay"] = dict(extra)
        merged.append(entry)
    return merged


def _row_registrations(row: Mapping[str, Any]) -> list[str]:
    numbers = [str(row["registrationNumber"])]
    requested = row.get("requestedRegistrationNumbers")
    if isinstance(requested, list):
        numbers.extend(str(item) for item in cast(list[object], requested))
    return numbers


def plan_instructions(
    rows: Sequence[Mapping[str, Any]],
    registration_groups: Mapping[str, set[str]],
    repo_root: Path = REPO_ROOT,
) -> tuple[list[PlannedInstruction], list[dict[str, str]]]:
    """One entry per prepared instruction document id, with every PDF row that carries it."""
    by_source: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    skipped: list[dict[str, str]] = []
    for row in rows:
        source_id = row.get("sourceId")
        if row.get("extraction") != "prepared" or not isinstance(source_id, str):
            skipped.append(
                {
                    "registrationNumber": str(row.get("registrationNumber")),
                    "reason": f"extraction={row.get('extraction')}",
                }
            )
            continue
        by_source[source_id].append(row)
    plan: list[PlannedInstruction] = []
    for source_id in sorted(by_source):
        group_rows = sorted(by_source[source_id], key=lambda r: str(r.get("fetchedAt") or ""))
        # The workspace file is the single prepared copy; every row of the id names the same one.
        workspaces = {str(r["workspace"]) for r in group_rows}
        if len(workspaces) != 1:
            raise ValueError(f"{source_id} is prepared in several workspaces: {sorted(workspaces)}")
        workspace = (repo_root / "tools" / "ingest" / next(iter(workspaces))).resolve()
        path = workspace / f"{source_id}.md"
        if not path.is_file():
            skipped.append({"documentId": source_id, "reason": f"missing {path}"})
            continue
        registrations = sorted({number for r in group_rows for number in _row_registrations(r)})
        newest = group_rows[-1]
        if not newest.get("documentKind") or newest.get("documentKind") == "unknown":
            # A text layer whose title page the collector did not read: use the content.
            evidence = classify_scan_document(plain_body(path.read_text(encoding="utf-8")))
            if evidence.kind != "unknown":
                newest = {
                    **newest,
                    "documentKind": evidence.kind,
                    "documentKindReason": evidence.reason,
                }
        group, basis = assign_group(
            str(newest["registrationNumber"]), registrations, registration_groups
        )
        plan.append(
            PlannedInstruction(
                document_id=source_id,
                path=path,
                group=group,
                group_basis=basis,
                registration_numbers=tuple(registrations),
                newest=newest,
            )
        )
    return plan, skipped


def split_front_matter(text: str) -> tuple[dict[str, Any], str]:
    """Front matter mapping and the untouched body (everything after the closing marker)."""
    if not text.startswith("---\n"):
        raise ValueError("Instruction Markdown has no front matter.")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Instruction Markdown has an unterminated front matter.")
    payload: object = yaml.safe_load(text[4:end])
    if not isinstance(payload, dict):
        raise ValueError("Front matter is not a mapping.")
    return cast(dict[str, Any], payload), text[end + len("\n---\n") :]


def reviewed_override(
    document_id: str, source_text: str, directory: Path = REVIEWED_OCR_DIR
) -> str | None:
    """The reviewed Markdown of ``document_id`` when it was made from the same PDF, else None.

    The reviewed file replaces the whole prepared text (front matter and body); it is used only
    while its ``source_checksum`` equals the prepared text's, so a newer edition of the PDF falls
    back to the fresh OCR instead of silently keeping text of an older edition.
    """
    path = directory / f"{document_id}.md"
    if not path.is_file():
        return None
    reviewed = path.read_text(encoding="utf-8")
    prepared_front, _ = split_front_matter(source_text)
    reviewed_front, _ = split_front_matter(reviewed)
    if reviewed_front.get("id") != document_id:
        raise ValueError(f"{path}: front matter id is not {document_id}")
    checksum = prepared_front.get("source_checksum")
    if checksum is None or reviewed_front.get("source_checksum") != checksum:
        return None
    return reviewed


def augmented_markdown(text: str, entry: PlannedInstruction) -> str:
    front, body = split_front_matter(text)
    existing = front.get("metadata")
    metadata: dict[str, Any] = cast(dict[str, Any], existing) if isinstance(existing, dict) else {}
    newest = entry.newest
    added: dict[str, Any] = {
        "documentKind": entry.kind,
        "fetchedAt": newest.get("fetchedAt"),
        "ocr": bool(newest.get("ocr")),
        "textExtractionMode": newest.get("textExtractionMode"),
        "ocrEngine": newest.get("ocrEngine"),
        "ocrMeanConfidence": newest.get("ocrMeanConfidence"),
        "ocrLowConfidenceRatio": newest.get("ocrLowConfidenceRatio"),
        "unknownWordRatio": newest.get("unknownWordRatio"),
        "qualityScore": newest.get("qualityScore"),
        "textSha256": newest.get("textSha256"),
        "pdfPageCount": newest.get("pageCount"),
        "registrationNumbers": list(entry.registration_numbers),
        "atcGroup": entry.group,
        "atcGroupBasis": entry.group_basis,
    }
    overlay = cast("Mapping[str, Any] | None", newest.get("ocrOverlay"))
    if isinstance(overlay, Mapping):
        added.update(
            {
                "ocrQuality": overlay.get("ocrQuality"),
                "ocrQualityReasons": overlay.get("ocrQualityReasons") or None,
                "ocrTool": overlay.get("ocrTool"),
                "ocrUncertainNumbers": overlay.get("uncertainNumbers"),
                "ocrWordEdits": overlay.get("wordEdits"),
                "textSource": overlay.get("textSource"),
                "textSourcePdfSha256": overlay.get("textSourcePdfSha256"),
                "documentKindReason": overlay.get("documentKindReason"),
            }
        )
    contents = cast("Mapping[str, Any] | None", newest.get("contentsOverlay"))
    if isinstance(contents, Mapping):
        added["contentsLists"] = contents.get("contentsLists")
    for key, value in added.items():
        if value is not None:
            metadata[key] = value
    front["metadata"] = metadata
    title = front.get("title")
    suffix = KIND_TITLE_SUFFIX.get(entry.kind)
    if suffix and isinstance(title, str) and title.endswith(GENERATED_TITLE_SUFFIX):
        front["title"] = f"{title[: -len(GENERATED_TITLE_SUFFIX)]}: {suffix}"
    rendered = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, width=1_000_000, default_flow_style=False
    )
    return f"---\n{rendered}---\n{body}"


def stage_module(stage: Path, group: str, entries: Sequence[PlannedInstruction]) -> None:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    (stage / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": module_id(group),
                "version": PACK_VERSION,
                "schemaVersion": 2,
                "title": f"Инструкции ГРЛС — {group_title(group)}",
                "builtAt": BUILT_AT,
                "publicationState": "local-dev",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (stage / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    for entry in entries:
        source = entry.path.read_text(encoding="utf-8")
        source = reviewed_override(entry.document_id, source) or source
        (stage / f"{entry.document_id}.md").write_text(
            augmented_markdown(source, entry), encoding="utf-8"
        )


def build_group(out: Path, group: str, entries: Sequence[PlannedInstruction]) -> dict[str, Any]:
    stage = out / f".stage-{group}"
    raw_dir = out / "raw"
    report_dir = out / "reports"
    raw_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    database = raw_dir / f"{module_id(group)}.db"
    if database.exists():
        database.unlink()
    excluded: list[dict[str, str]] = []
    kept: list[PlannedInstruction] = []
    for entry in entries:
        reason = heading_json_escape_reason(entry.path)
        if reason is None:
            kept.append(entry)
        else:
            excluded.append({"documentId": entry.document_id, "reason": reason})
    build_report = None
    try:
        for _attempt in range(6):
            stage_module(stage, group, kept)
            try:
                _pack, build_report = build_content_pack(
                    stage,
                    database,
                    report_path=report_dir / f"{module_id(group)}.build.json",
                    include_embeddings=False,
                )
                break
            except ValueError as error:
                message = str(error)
                offenders: list[tuple[str, str]] = []
                if message.startswith("Content lint failed:"):
                    for line in message.splitlines()[1:]:
                        document_id, _, reason = line.partition(": ")
                        if any(e.document_id == document_id for e in kept):
                            offenders.append((document_id, reason or line))
                if not offenders:
                    raise
                bad = {document_id for document_id, _ in offenders}
                excluded.extend({"documentId": i, "reason": r} for i, r in offenders)
                kept = [e for e in kept if e.document_id not in bad]
                if database.exists():
                    database.unlink()
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    if build_report is None:
        raise RuntimeError(f"{group}: every attempt failed lint")
    result: dict[str, Any] = {
        "moduleId": module_id(group),
        "group": group,
        "documents": build_report.documents,
        "sections": build_report.sections,
        "chunks": build_report.chunks,
        "sqliteIntegrity": build_report.sqlite_integrity,
        "outputChecksum": build_report.output_checksum,
        "sizeBytes": database.stat().st_size,
        "excluded": excluded,
        "documentIds": sorted(e.document_id for e in kept),
    }
    (report_dir / f"{module_id(group)}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def summarize(plan: Sequence[PlannedInstruction]) -> dict[str, Any]:
    kinds: dict[str, Counter[str]] = defaultdict(Counter)
    ocr: Counter[str] = Counter()
    registrations: dict[str, set[str]] = defaultdict(set)
    documents: Counter[str] = Counter()
    for entry in plan:
        documents[entry.group] += 1
        kinds[entry.group][entry.kind] += 1
        ocr[entry.group] += 1 if entry.newest.get("ocr") else 0
        registrations[entry.group].update(entry.registration_numbers)
    return {
        group: {
            "documents": documents[group],
            "kinds": dict(kinds[group]),
            "ocr": ocr[group],
            "registrations": len(registrations[group]),
        }
        for group in sorted(documents)
    }
