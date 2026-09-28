"""Split the prepared RLS MKB workspace into a compact code module and a packaging module.

Input is the existing scrape workspace (`details/*.json` with response checksums, the
classification document, aliases and manifest); nothing is fetched. The code module keeps every
document version, the classification document byte-for-byte, and the code/synonym/limitation
sections unchanged, so section ids and anchors cited by the discovery core stay valid. Its
medicine section becomes one line per listed medicine. The packaging tables move, deduplicated,
to one packaging document per medication brand, linked by the brand's knowledge-entity id.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import cast

import yaml

from .markdown_parser import parse_front_matter
from .publication import PublicationDecision
from .rls_mkb import (
    RLS_MKB_DETAILS_DIRNAME,
    RlsMkbDetail,
    RlsMkbMedicine,
    _detail_markdown,  # pyright: ignore[reportPrivateUsage]
    _document_id,  # pyright: ignore[reportPrivateUsage]
    _knowledge_workspace,  # pyright: ignore[reportPrivateUsage]
    _load_detail_state,  # pyright: ignore[reportPrivateUsage]
    _medication_id,  # pyright: ignore[reportPrivateUsage]
    _medicine_inns,  # pyright: ignore[reportPrivateUsage]
    _search_alias,  # pyright: ignore[reportPrivateUsage]
    _source_marker,  # pyright: ignore[reportPrivateUsage]
    _version_id,  # pyright: ignore[reportPrivateUsage]
    packaging_document_id,
)

CLASSIFICATION_FILE = "rls-mkb-classification.md"
CODE_PACK_ID = "minimed.rls.mkb"
PACKAGING_PACK_ID = "minimed.rls.packaging"
_CLASSIFICATION_HEADING = re.compile(r"^## (?P<code>\S+) (?P<title>.+)$")
# Cyrillic look-alikes that occur in RLS range codes (a Cyrillic "V" in "A00-B99").
_LATIN = str.maketrans("АВЕКМНОРСТХУ", "ABEKMHOPCTXY")
_CODE_POINT = re.compile(r"([A-Z])(\d{2})")


@dataclass(frozen=True)
class RlsMkbSplitReport:
    code_documents: int
    classification_nodes: int
    listed_medicines: int
    packaging_documents: int
    packaging_tables: int
    packaging_rows: int
    tradenames_with_conflicting_packings: int
    code_output: str
    packaging_output: str


def _latin(code: str) -> str:
    return code.upper().translate(_LATIN)


def _ordinal(point: str) -> int | None:
    match = _CODE_POINT.fullmatch(point)
    if match is None:
        return None
    return (ord(match.group(1)) - ord("A")) * 100 + int(match.group(2))


def _code_bounds(code: str) -> tuple[int, int] | None:
    """Inclusive ordinal bounds of a range, category or subcategory code."""
    parts = _latin(code).split("-")
    if len(parts) == 2:
        start = _ordinal(parts[0])
        end_point = parts[1] if parts[1][:1].isalpha() else parts[0][0] + parts[1]
        end = _ordinal(end_point)
        return (start, end) if start is not None and end is not None else None
    ordinal = _ordinal(_latin(code).split(".", 1)[0])
    return (ordinal, ordinal) if ordinal is not None else None


def classification_nodes(markdown: str) -> list[tuple[str, str]]:
    nodes: list[tuple[str, str]] = []
    for line in markdown.splitlines():
        match = _CLASSIFICATION_HEADING.match(line)
        if match:
            nodes.append((match.group("code"), match.group("title").strip()))
    return nodes


def classification_path(
    code: str, nodes: list[tuple[str, str]], documents: set[str]
) -> list[dict[str, str]]:
    """Ancestors from the narrowest (category) to the widest (chapter), from the index only."""
    bounds = _code_bounds(code)
    if bounds is None:
        return []
    ancestors: list[tuple[int, int, str, str]] = []
    own = _latin(code)
    parent = own.rsplit(".", 1)[0] if "." in own else None
    for node_code, title in nodes:
        latin = _latin(node_code)
        if latin == own:
            continue
        node_bounds = _code_bounds(node_code)
        if node_bounds is None:
            continue
        contains = node_bounds[0] <= bounds[0] and bounds[1] <= node_bounds[1]
        # A block/chapter range is an ancestor unless it is the same range as this node.
        if "-" in latin and contains and (node_bounds != bounds or "-" not in own):
            ancestors.append((node_bounds[1] - node_bounds[0], 1, node_code, title))
        elif parent is not None and latin == parent:
            ancestors.append((-1, 0, node_code, title))
    ancestors.sort(key=lambda item: (item[0], item[1], item[2]))
    path: list[dict[str, str]] = []
    for _, _, node_code, title in ancestors:
        entry = {"code": node_code, "title": title}
        document_id = _document_id(node_code)
        if document_id in documents:
            entry["documentId"] = document_id
        path.append(entry)
    return path


def with_front_matter_metadata(markdown: str, extra: dict[str, object]) -> str:
    """Add source metadata keys while keeping the document body byte-for-byte."""
    if not markdown.startswith("---\n"):
        raise ValueError("Expected YAML front matter")
    end = markdown.index("\n---\n", 4)
    front = cast(dict[str, object], yaml.safe_load(markdown[4:end]))
    metadata = cast(dict[str, object], front.setdefault("metadata", {}))
    metadata.update(extra)
    dumped = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip()
    return f"---\n{dumped}" + markdown[end:]


def _publication_metadata(publication: PublicationDecision) -> dict[str, object]:
    return {
        "publicationState": publication.state,
        "publicationDecision": publication.metadata(),
    }


@dataclass
class _PackagingTable:
    tradename_id: str
    name: str
    url: str
    packing_checksum: str
    listed_on: str
    rows: list[tuple[str, str, str, str, str]]


@dataclass
class _PackagingBrand:
    brand_id: str
    name: str
    inns: list[str]
    tables: dict[tuple[str, str], _PackagingTable]
    codes: dict[str, tuple[str, str]]


def _packaging_markdown(brand: _PackagingBrand, publication: PublicationDecision) -> str:
    tables = [brand.tables[key] for key in sorted(brand.tables)]
    identity = [
        {"tradenameId": table.tradename_id, "packingChecksum": table.packing_checksum}
        for table in tables
    ]
    checksum = hashlib.sha256(
        json.dumps(
            [
                {**item, "rows": [list(row) for row in table.rows]}
                for item, table in zip(identity, tables, strict=True)
            ],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    urls = list(dict.fromkeys(table.url for table in tables))
    inns = "; ".join(brand.inns) if brand.inns else "не указано"
    body = [
        "# Препарат",
        "",
        _source_marker(urls[0], sourceKind="medicine"),
        f"Торговое наименование: {brand.name}. МНН: {inns}.",
        *(f"- Страница РЛС: {url}" for url in urls),
        "",
        "# Формы, дозировки, упаковки и производители",
        "",
    ]
    for table in tables:
        body.extend(
            [
                _source_marker(
                    table.listed_on,
                    sourceKind="medicine-packings",
                    tradenameId=table.tradename_id,
                    packingChecksum=table.packing_checksum,
                ),
                f"{table.name} — {table.url}",
                "",
                "| МНН | Лекарственная форма | Дозировка | Упаковка | Производитель |",
                "| --- | --- | --- | --- | --- |",
                *(f"| {' | '.join(row)} |" for row in table.rows),
                "",
            ]
        )
    body.extend(
        [
            "# Коды МКБ-10 на страницах РЛС",
            "",
            _source_marker(urls[0], sourceKind="listed-on-mkb-pages"),
            *(
                f"- {code} {title} — {url}"
                for code, (title, url) in sorted(brand.codes.items(), key=lambda item: item[0])
            ),
            "",
            "# Источник и ограничения",
            "",
            _source_marker(urls[0], sourceKind="limitations"),
            "Формы, дозировки, упаковки и производители перенесены из таблиц РЛС без изменений "
            "и объединены по торговому наименованию. Это не инструкция по применению и не "
            "назначение; дозировка формы не является схемой дозирования.",
        ]
    )
    metadata = {
        "id": packaging_document_id(brand.brand_id),
        "title": f"{brand.name} — формы, дозировки и упаковки (РЛС)",
        "short_title": brand.name,
        "version_label": f"rls-{checksum[:12]}",
        "source_type": "rls_packaging_reference",
        "status": "active",
        "specialties": ["medical-reference"],
        "source_file": urls[0],
        "source_checksum": f"sha256:{checksum}",
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Регистр лекарственных средств России",
            "officialSourceUrl": urls[0],
            "sourceKind": "rls-packings",
            "medicationEntityId": brand.brand_id,
            "inn": brand.inns,
            "tradenames": identity,
            "mkbCodes": sorted(brand.codes),
            "requiresReview": True,
            "rightsStatus": "unknown",
            "rights": {
                "licenseId": "rlsnet-site-terms",
                "allowsOfflineStorage": False,
                "allowsDerivativeProcessing": False,
                "allowsRedistribution": False,
            },
            **_publication_metadata(publication),
        },
    }
    front_matter = yaml.safe_dump(
        metadata, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip()
    return f"---\n{front_matter}\n---\n\n" + "\n".join(body) + "\n"


def _add_packaging(
    brands: dict[str, _PackagingBrand], detail: RlsMkbDetail, medicine: RlsMkbMedicine
) -> None:
    if not medicine.presentations:
        return
    brand_id = _medication_id("medication.brand", _search_alias(medicine.name))
    brand = brands.setdefault(brand_id, _PackagingBrand(brand_id, medicine.name, [], {}, {}))
    for inn in _medicine_inns(medicine):
        if inn not in brand.inns:
            brand.inns.append(inn)
    brand.codes[detail.code] = (detail.title, detail.url)
    key = (medicine.tradename_id, medicine.packing_checksum or "")
    if key not in brand.tables:
        brand.tables[key] = _PackagingTable(
            tradename_id=medicine.tradename_id,
            name=medicine.name,
            url=medicine.url,
            packing_checksum=medicine.packing_checksum or "",
            listed_on=detail.url,
            rows=[
                (item.inn, item.dosage_form, item.dosage, item.packaging, item.manufacturer)
                for item in medicine.presentations
            ],
        )


def _write_workspace(output: Path, files: dict[str, str | bytes]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary) / "workspace"
        workspace.mkdir()
        for name, content in files.items():
            path = workspace / name
            if isinstance(content, bytes):
                path.write_bytes(content)
            else:
                path.write_text(content, encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)


def split_rls_mkb_workspace(
    source: Path,
    code_output: Path,
    packaging_output: Path,
    publication: PublicationDecision,
) -> RlsMkbSplitReport:
    manifest = cast(dict[str, object], yaml.safe_load((source / "manifest.yaml").read_text()))
    built_at = str(manifest["builtAt"])
    details = sorted(
        _load_detail_state(source / RLS_MKB_DETAILS_DIRNAME).values(),
        key=lambda item: (item.code, item.url),
    )
    if not details:
        raise ValueError(f"No RLS MKB detail state under {source}")
    classification = (source / CLASSIFICATION_FILE).read_text(encoding="utf-8")
    nodes = classification_nodes(classification)
    documents = {_document_id(detail.code) for detail in details}
    extra = _publication_metadata(publication)
    code_files: dict[str, str | bytes] = {
        CLASSIFICATION_FILE: with_front_matter_metadata(classification, extra),
        "aliases.yaml": (source / "aliases.yaml").read_bytes(),
    }
    brands: dict[str, _PackagingBrand] = {}
    for detail in details:
        name = f"{_document_id(detail.code)}.md"
        original = (source / name).read_text(encoding="utf-8")
        original_metadata, _ = parse_front_matter(original)
        compact = _detail_markdown(
            detail,
            compact_medicines=True,
            extra_metadata=extra,
            classification_path=classification_path(detail.code, nodes, documents),
        )
        compact_metadata, _ = parse_front_matter(compact)
        if (original_metadata.version_label, original_metadata.source_checksum) != (
            compact_metadata.version_label,
            compact_metadata.source_checksum,
        ):
            raise ValueError(f"{name}: detail state no longer matches the prepared document")
        code_files[name] = compact
        for medicine in detail.medicines:
            _add_packaging(brands, detail, medicine)

    identity = _version_id(
        json.dumps(
            [str(manifest["version"]), *sorted(documents), "compact-medicines-v1"],
            ensure_ascii=False,
        )
    )
    code_files["manifest.yaml"] = yaml.safe_dump(
        {
            "id": CODE_PACK_ID,
            "version": f"0.2.0-{identity}",
            "schemaVersion": 2,
            "title": "МКБ-10 и привязки РЛС",
            "builtAt": built_at,
        },
        allow_unicode=True,
        sort_keys=False,
    )
    _write_workspace(code_output, code_files)
    knowledge = _knowledge_workspace(
        details, code_output, built_at=built_at, compact_medicines=True
    )
    (code_output / "knowledge.json").write_text(
        json.dumps(knowledge.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )

    packaging_files: dict[str, str | bytes] = {"aliases.yaml": "aliases: []\n"}
    conflicts = 0
    for brand_id in sorted(brands):
        brand = brands[brand_id]
        tradenames = [key[0] for key in brand.tables]
        conflicts += len(tradenames) - len(set(tradenames))
        packaging_files[f"{packaging_document_id(brand_id)}.md"] = _packaging_markdown(
            brand, publication
        )
    packaging_files["manifest.yaml"] = yaml.safe_dump(
        {
            "id": PACKAGING_PACK_ID,
            "version": f"0.1.0-{identity}",
            "schemaVersion": 2,
            "title": "Формы, дозировки и упаковки РЛС",
            "builtAt": built_at,
        },
        allow_unicode=True,
        sort_keys=False,
    )
    _write_workspace(packaging_output, packaging_files)
    report = RlsMkbSplitReport(
        code_documents=len(details),
        classification_nodes=len(nodes),
        listed_medicines=sum(len(detail.medicines) for detail in details),
        packaging_documents=len(brands),
        packaging_tables=sum(len(brand.tables) for brand in brands.values()),
        packaging_rows=sum(
            len(table.rows) for brand in brands.values() for table in brand.tables.values()
        ),
        tradenames_with_conflicting_packings=conflicts,
        code_output=str(code_output),
        packaging_output=str(packaging_output),
    )
    (code_output / "split-report.json").write_text(
        json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
