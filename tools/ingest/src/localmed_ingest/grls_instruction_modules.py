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
from .sqlite_builder import repository_root

REPO_ROOT = repository_root()
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
MANIFEST_PATH = REPO_ROOT / "data" / "build" / "grls-instruction-text-manifest.jsonl"
MODULE_PREFIX = "minimed.medications.instructions."
MODULE_SUFFIX = ".ru"
PACK_VERSION = "grls-2026.10.05"
BUILT_AT = "2026-10-05T00:00:00Z"
UNCLASSIFIED = "unclassified"

KIND_TITLE_SUFFIX = {
    "leaflet": "листок-вкладыш",
    "ohlp": "общая характеристика лекарственного препарата (ОХЛП)",
}
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


def read_manifest_rows(path: Path = MANIFEST_PATH) -> list[dict[str, Any]]:
    return [
        cast(dict[str, Any], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


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
