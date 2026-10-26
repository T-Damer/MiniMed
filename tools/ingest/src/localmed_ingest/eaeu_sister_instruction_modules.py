"""Released EAEU sister-register instruction module (owner decision of 2026-10-26).

Pure planning and staging parts of `scripts/build_eaeu_sister_instruction_module.py`. Input is the
collector's `data/raw/eaeu-sister-registers/manifest.jsonl` (`eaeu_sister_registers.build_manifest`:
one row per missing Russian registration and stored document) and the raw files under
`files/<country>/<sha256>.pdf|docx`.

A drug registered under the EAEU rules has one dossier shared by every member state; the registers
of Belarus (rceth.by) and Kazakhstan (register.ndda.kz) publish its patient leaflet (ЛВ) and its
professional text (ОХЛП). The owner allowed (2026-10-26) such a text to be shown for the Russian
registration of the same dossier when the country and the register stay visible. So the module is
ONE source class (`eaeu-sister-register`), every document names its country and register, the
document kind is the register's own (the ЛВ or the ОХЛП link it was fetched from) and the ГРЛС file
still wins wherever the app has one (ranking in `instruction-source.ts`).

Selection, per (registration, document kind): the Belarus file before the Kazakh one (the Kazakh
files carry the Russian and the Kazakh text in one document), so a registration gets at most one
leaflet and one ОХЛП; the files not chosen are listed in the report. A file serves every
registration it was chosen for. Rows with `accepted: false` (the text names another drug) never
count; a row checked `no-text-layer` (a scan) is re-checked on the preparer's OCR text before the
document is staged, and a mismatch there leaves the document out.

PDFs go through the normal preparer (`medbase prepare`, macOS Vision OCR fallback), so the body
keeps its `localmed:source` spans; a DOCX has no preparer and its extracted text is prepared as
`format: text`. The text is neither summarised nor repaired; staging changes only the front matter.
"""

from __future__ import annotations

import json
import os
import shutil
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml

from .builder import build_content_pack
from .eaeu_sister_registers import check_text_names
from .grls_instruction_modules import heading_json_escape_reason, split_front_matter
from .manufacturer_instructions import docx_text
from .sqlite_builder import repository_root

# Private data lives in the main checkout only: a worktree build points MINIMED_DATA_ROOT at it.
REPO_ROOT = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
RAW_ROOT = REPO_ROOT / "data" / "raw" / "eaeu-sister-registers"
MANIFEST_PATH = RAW_ROOT / "manifest.jsonl"

MODULE_ID = "minimed.medications.instructions.eaeu-sister-register.ru"
MODULE_TITLE = "Инструкции ЕАЭС из реестров Беларуси и Казахстана"
PACK_VERSION = "eaeu-sister-2026.10.26"
BUILT_AT = "2026-10-26T00:00:00Z"
SOURCE_CLASS = "eaeu-sister-register"
DOCUMENT_ID_PREFIX = "drug.rf.eaeu."
DOCUMENT_ID_SUFFIX = ".instruction"
TEXT_DIR = "docx-text"
PREPARED_DIRS = ("prepared-pdf", "prepared-text")

#: Belarus first: its files are the Russian text alone.
COUNTRY_ORDER: tuple[str, ...] = ("BY", "KZ")
COUNTRY_NAMES: Mapping[str, str] = {"BY": "Республика Беларусь", "KZ": "Республика Казахстан"}
REGISTER_NAMES: Mapping[str, str] = {
    "BY": "Государственный реестр лекарственных средств Республики Беларусь",
    "KZ": "Государственный реестр лекарственных средств и медицинских изделий Республики Казахстан",
}
PUBLISHERS: Mapping[str, str] = {
    "BY": "РУП «Центр экспертиз и испытаний в здравоохранении»",
    "KZ": "РГП «Национальный центр экспертизы лекарственных средств и медицинских изделий»",
}
KIND_TITLE_SUFFIX: Mapping[str, str] = {
    "leaflet": "листок-вкладыш",
    "ohlp": "общая характеристика лекарственного препарата (ОХЛП)",
}


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def document_id(sha256: str) -> str:
    return f"{DOCUMENT_ID_PREFIX}{sha256.removeprefix('sha256:')[:20]}{DOCUMENT_ID_SUFFIX}"


def read_manifest_rows(path: Path = MANIFEST_PATH) -> list[dict[str, Any]]:
    return [
        cast(dict[str, Any], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


@dataclass(frozen=True)
class PlannedDocument:
    """One chosen file and every registration it is chosen for (rows sorted by registration)."""

    document_id: str
    sha256: str
    country: str
    kind: str
    file_format: str
    rows: tuple[Mapping[str, Any], ...]

    @property
    def primary(self) -> Mapping[str, Any]:
        return self.rows[0]

    @property
    def registration_numbers(self) -> tuple[str, ...]:
        numbers: set[str] = set()
        for row in self.rows:
            numbers.add(str(row["registrationNumber"]))
            numbers.update(str(n) for n in row.get("coveredRegistrationNumbers") or [])
        return tuple(sorted(numbers))

    @property
    def source_path(self) -> str:
        """Path under the raw root (`data/raw/eaeu-sister-registers`)."""
        return f"files/{self.country}/{self.sha256}.{self.file_format}"

    @property
    def text_source_path(self) -> str:
        return f"{TEXT_DIR}/{self.sha256}.txt"

    @property
    def prepared_as_text(self) -> bool:
        return self.file_format != "pdf"

    @property
    def needs_text_recheck(self) -> bool:
        return any(row.get("textCheck") == "no-text-layer" for row in self.rows)


@dataclass(frozen=True)
class EaeuPlan:
    documents: tuple[PlannedDocument, ...]
    #: Accepted rows not chosen because the other country's file of the same kind was.
    not_chosen: tuple[dict[str, Any], ...]
    rejected_rows: int
    rows: int


def plan_documents(rows: Sequence[Mapping[str, Any]], raw_root: Path = RAW_ROOT) -> EaeuPlan:
    accepted = [row for row in rows if row.get("accepted") is True]
    by_slot: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for row in accepted:
        by_slot[(str(row["registrationNumber"]), str(row["documentKind"]))].append(row)
    chosen: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    not_chosen: list[dict[str, Any]] = []
    for slot in sorted(by_slot):
        candidates = sorted(
            by_slot[slot],
            key=lambda r: (COUNTRY_ORDER.index(str(r["country"])), str(r["sha256"])),
        )
        winner = candidates[0]
        chosen[str(winner["sha256"])].append(winner)
        not_chosen.extend(
            {
                "registrationNumber": slot[0],
                "documentKind": slot[1],
                "country": str(row["country"]),
                "sha256": str(row["sha256"]),
                "reason": f"the {winner['country']} file of the same kind was chosen",
            }
            for row in candidates[1:]
        )
    documents: list[PlannedDocument] = []
    for sha in sorted(chosen):
        file_rows = sorted(chosen[sha], key=lambda r: str(r["registrationNumber"]))
        for field in ("country", "documentKind", "url"):
            if len({str(r[field]) for r in file_rows}) != 1:
                raise ValueError(f"{sha} has rows with different {field} values.")
        first = file_rows[0]
        file_format = _resolve_format(first, raw_root)
        documents.append(
            PlannedDocument(
                document_id=document_id(sha),
                sha256=sha,
                country=str(first["country"]),
                kind=str(first["documentKind"]),
                file_format=file_format,
                rows=tuple(file_rows),
            )
        )
    ids = [document.document_id for document in documents]
    if len(ids) != len(set(ids)):
        raise ValueError("Two sister-register files share the first 20 hex digits of their sha256.")
    return EaeuPlan(
        documents=tuple(documents),
        not_chosen=tuple(not_chosen),
        rejected_rows=len(rows) - len(accepted),
        rows=len(rows),
    )


def _resolve_format(row: Mapping[str, Any], raw_root: Path) -> str:
    """The stored file's type: the manifest does not record it, the file name does."""
    for suffix in ("pdf", "docx"):
        if (raw_root / "files" / str(row["country"]) / f"{row['sha256']}.{suffix}").is_file():
            return suffix
    raise FileNotFoundError(raw_root / "files" / str(row["country"]) / str(row["sha256"]))


def registry_source(document: PlannedDocument) -> dict[str, Any]:
    """One `medbase prepare` registry entry: everything here is read from the manifest."""
    primary = document.primary
    trade_name = str(primary.get("tradeName") or primary.get("sisterTradeName") or "")
    country = document.country
    url = _text(primary.get("url"))
    fetched_at = str(primary.get("fetchedAt") or "")
    metadata: dict[str, Any] = {
        "sourceClass": SOURCE_CLASS,
        "country": country,
        "countryName": COUNTRY_NAMES[country],
        "register": REGISTER_NAMES[country],
        "publisher": PUBLISHERS[country],
        "documentKind": document.kind,
        "tradeName": trade_name,
        "inn": _text(primary.get("inn")),
        "registrationNumber": str(primary["registrationNumber"]),
        "registrationNumbers": list(document.registration_numbers),
        "dossier": str(primary["dossier"]),
        "sisterCertificate": _text(primary.get("sisterCertificate")),
        "sisterTradeName": _text(primary.get("sisterTradeName")),
        "matchMethod": "shared-dossier-number",
        "textCheck": sorted({str(row.get("textCheck")) for row in document.rows}),
        "essentialDrug": any(row.get("essentialDrug") is True for row in document.rows),
        "officialSourceUrl": url if url and url.startswith("https://") else None,
        "fetchedAt": fetched_at or None,
        "httpLastModified": _text(primary.get("httpLastModified")),
        "pdfSha256": f"sha256:{document.sha256}",
        "fileFormat": document.file_format,
        "rawPath": f"data/raw/eaeu-sister-registers/{document.source_path}",
    }
    suffix = KIND_TITLE_SUFFIX[document.kind]
    return {
        "id": document.document_id,
        "path": document.text_source_path if document.prepared_as_text else document.source_path,
        "title": f"{trade_name}: {suffix}",
        "shortTitle": trade_name,
        "versionLabel": f"{SOURCE_CLASS}-{country.lower()}-{fetched_at[:10]}",
        "sourceType": "official_drug_instruction",
        "status": "active",
        "format": "text" if document.prepared_as_text else "pdf",
        "metadata": {key: value for key, value in metadata.items() if value is not None},
    }


def registry_payload(documents: Sequence[PlannedDocument]) -> dict[str, Any]:
    return {
        "pack": {
            "id": MODULE_ID,
            "version": PACK_VERSION,
            "schemaVersion": 2,
            "title": MODULE_TITLE,
            "builtAt": BUILT_AT,
        },
        "sources": [registry_source(document) for document in documents],
    }


def write_registries(plan: EaeuPlan, workspace: Path, raw_root: Path = RAW_ROOT) -> dict[str, Any]:
    """`registry-pdf.yaml` (source root: the raw root) and `registry-text.yaml` + `docx-text/`
    (source root: the workspace) for `medbase prepare`."""
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / TEXT_DIR).mkdir(exist_ok=True)
    pdfs = [document for document in plan.documents if not document.prepared_as_text]
    texts = [document for document in plan.documents if document.prepared_as_text]
    for document in plan.documents:
        if not (raw_root / document.source_path).is_file():
            raise FileNotFoundError(raw_root / document.source_path)
    for document in texts:
        body = docx_text((raw_root / document.source_path).read_bytes())
        if not body.strip():
            raise ValueError(f"{document.source_path} has no extractable text.")
        (workspace / document.text_source_path).write_text(body, encoding="utf-8")
    for name, group in (("registry-pdf.yaml", pdfs), ("registry-text.yaml", texts)):
        if group:
            (workspace / name).write_text(
                yaml.safe_dump(
                    registry_payload(group), allow_unicode=True, sort_keys=False, width=1_000_000
                ),
                encoding="utf-8",
            )
    return {"pdf": len(pdfs), "text": len(texts), "workspace": str(workspace)}


def augmented_markdown(text: str, document: PlannedDocument) -> str:
    """Front matter of a prepared document, completed; the body is carried over byte for byte."""
    front, body = split_front_matter(text)
    existing = front.get("metadata")
    metadata: dict[str, Any] = cast(dict[str, Any], existing) if isinstance(existing, dict) else {}
    extraction = cast(Mapping[str, Any], metadata.get("extraction") or {})
    mode = extraction.get("textExtractionMode")
    added: dict[str, Any] = {
        "ocr": mode == "ocr" if isinstance(mode, str) else None,
        "textExtractionMode": mode,
        "ocrEngine": extraction.get("ocrEngine"),
        "ocrMeanConfidence": extraction.get("ocrMeanConfidence"),
        "ocrLowConfidenceRatio": extraction.get("ocrLowConfidenceRatio"),
        "qualityScore": extraction.get("qualityScore"),
        "pdfPageCount": extraction.get("pageCount") if document.file_format == "pdf" else None,
    }
    for key, value in added.items():
        if value is not None:
            metadata[key] = value
    front["metadata"] = metadata
    rendered = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, width=1_000_000, default_flow_style=False
    )
    return f"---\n{rendered}---\n{body}"


def recheck_reason(document: PlannedDocument, body: str) -> str | None:
    """A scan accepted on its dossier number alone must name its drug in the OCR text too."""
    if not document.needs_text_recheck:
        return None
    for row in document.rows:
        check = check_text_names(body, str(row.get("tradeName") or ""), str(row.get("inn") or ""))
        sister = check_text_names(body, str(row.get("sisterTradeName") or ""), "")
        if check in ("trade-name", "inn") or sister == "trade-name":
            continue
        return f"the OCR text does not name {row['registrationNumber']} ({check})"
    return None


def prepared_markdown_path(prepared_dirs: Sequence[Path], document: PlannedDocument) -> Path | None:
    for directory in prepared_dirs:
        candidate = directory / f"{document.document_id}.md"
        if candidate.is_file():
            return candidate
    return None


def stage_module(
    stage: Path, documents: Sequence[PlannedDocument], paths: Mapping[str, Path]
) -> None:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    (stage / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": MODULE_ID,
                "version": PACK_VERSION,
                "schemaVersion": 2,
                "title": MODULE_TITLE,
                "builtAt": BUILT_AT,
                "publicationState": "local-dev",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (stage / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    for document in documents:
        source = paths[document.document_id].read_text(encoding="utf-8")
        (stage / f"{document.document_id}.md").write_text(
            augmented_markdown(source, document), encoding="utf-8"
        )


def select_prepared(
    plan: EaeuPlan, prepared_dirs: Sequence[Path]
) -> tuple[list[PlannedDocument], dict[str, Path], list[dict[str, str]]]:
    """The documents that can be staged, their prepared Markdown, and why the others cannot."""
    excluded: list[dict[str, str]] = []
    paths: dict[str, Path] = {}
    kept: list[PlannedDocument] = []
    for document in plan.documents:
        path = prepared_markdown_path(prepared_dirs, document)
        if path is None:
            excluded.append(
                {
                    "documentId": document.document_id,
                    "reason": "the preparer produced no Markdown (no searchable text)",
                }
            )
            continue
        reason = heading_json_escape_reason(path) or recheck_reason(
            document, split_front_matter(path.read_text(encoding="utf-8"))[1]
        )
        if reason is not None:
            excluded.append({"documentId": document.document_id, "reason": reason})
            continue
        paths[document.document_id] = path
        kept.append(document)
    return kept, paths, excluded


def build_module(out: Path, plan: EaeuPlan, prepared_dirs: Sequence[Path]) -> dict[str, Any]:
    """Stage the prepared documents, build the lexical-only pack and write the report."""
    stage = out / ".stage"
    raw_dir = out / "raw"
    report_dir = out / "reports"
    raw_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    database = raw_dir / f"{MODULE_ID}.db"
    if database.exists():
        database.unlink()
    kept, paths, excluded = select_prepared(plan, prepared_dirs)
    build_report = None
    try:
        for _attempt in range(6):
            stage_module(stage, kept, paths)
            try:
                _pack, build_report = build_content_pack(
                    stage,
                    database,
                    report_path=report_dir / f"{MODULE_ID}.build.json",
                    include_embeddings=False,
                )
                break
            except ValueError as error:
                message = str(error)
                offenders: list[tuple[str, str]] = []
                if message.startswith("Content lint failed:"):
                    for line in message.splitlines()[1:]:
                        identifier, _, reason = line.partition(": ")
                        if any(item.document_id == identifier for item in kept):
                            offenders.append((identifier, reason or line))
                if not offenders:
                    raise
                bad = {identifier for identifier, _ in offenders}
                excluded.extend({"documentId": i, "reason": r} for i, r in offenders)
                kept = [item for item in kept if item.document_id not in bad]
                if database.exists():
                    database.unlink()
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    if build_report is None:
        raise RuntimeError("every attempt failed lint")
    result = module_report(plan, kept, excluded)
    result.update(
        {
            "documents": build_report.documents,
            "sections": build_report.sections,
            "chunks": build_report.chunks,
            "sqliteIntegrity": build_report.sqlite_integrity,
            "outputChecksum": build_report.output_checksum,
            "sizeBytes": database.stat().st_size,
        }
    )
    (report_dir / f"{MODULE_ID}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def _registrations(documents: Sequence[PlannedDocument]) -> set[str]:
    return {str(row["registrationNumber"]) for document in documents for row in document.rows}


def module_report(
    plan: EaeuPlan, kept: Sequence[PlannedDocument], excluded: Sequence[Mapping[str, str]]
) -> dict[str, Any]:
    essential = {
        str(row["registrationNumber"])
        for document in kept
        for row in document.rows
        if row.get("essentialDrug") is True
    }
    return {
        "moduleId": MODULE_ID,
        "version": PACK_VERSION,
        "sourceClass": SOURCE_CLASS,
        "manifestRows": plan.rows,
        "rejectedRows": plan.rejected_rows,
        "excluded": list(excluded),
        "notChosen": list(plan.not_chosen),
        "registrations": len(_registrations(kept)),
        "essentialRegistrations": len(essential),
        "documentsByCountry": dict(sorted(Counter(d.country for d in kept).items())),
        "documentsByKind": dict(sorted(Counter(d.kind for d in kept).items())),
        "documentsByFormat": dict(sorted(Counter(d.file_format for d in kept).items())),
        "documentIds": sorted(d.document_id for d in kept),
    }


def summarize(plan: EaeuPlan) -> dict[str, Any]:
    documents = plan.documents
    return {
        "manifestRows": plan.rows,
        "rejectedRows": plan.rejected_rows,
        "documents": len(documents),
        "registrations": len(_registrations(documents)),
        "documentsByCountry": dict(sorted(Counter(d.country for d in documents).items())),
        "documentsByKind": dict(sorted(Counter(d.kind for d in documents).items())),
        "documentsByFormat": dict(sorted(Counter(d.file_format for d in documents).items())),
        "scansToRecheck": sum(1 for d in documents if d.needs_text_recheck),
        "notChosen": len(plan.not_chosen),
    }
