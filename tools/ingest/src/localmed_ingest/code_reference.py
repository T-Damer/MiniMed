"""Номенклатура медицинских услуг (НСИ Минздрава России) as a prepared Markdown workspace.

Input is the dictionary fetched by ``scripts/fetch-nsi-dictionary.mjs`` under
``data/raw/nsi/medical-services/<version>/`` (``rows.json``, ``passport.json``, ``MANIFEST.json``):
the OID 1.2.643.5.1.13.13.11.1070 rows ``ID``, ``S_CODE``, ``NAME``, ``REL``, ``DATEOUT``.

The preparer never rewrites a service name. It lays the rows out as GFM tables, one document per
class and section of the code (``A16.20``, ``B01.003`` is filed under ``B01.003``), the active
services first and, apart, the services the dictionary marks as abolished with the date. Four
repairs of the codes are made and counted in the report: a row without a code is dropped, the
Cyrillic look-alikes of A and B in some codes become Latin, a space inside a code is
removed, and an abolished row that repeats an active row (same code after those repairs, same
name) is not shown twice. A code the dictionary reuses for a different name keeps both rows.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

import yaml

PACK_ID = "minimed.reference.medical-services"
DOCUMENT_PREFIX = "reference.medical-services."
SOURCE_TYPE = "code_reference"
RIGHTS_STATUS = "official-act-not-copyrighted"
RIGHTS_BASIS = (
    "Номенклатура медицинских услуг утверждена приказом Минздрава России и публикуется в НСИ "
    "Минздрава России; официальные документы не являются объектом авторского права "
    "(ст. 1259 ГК РФ)"
)
NSI_OID = "1.2.643.5.1.13.13.11.1070"
NSI_PUBLIC_PAGE = f"https://nsi.rosminzdrav.ru/dictionaries/{NSI_OID}"
ORDER_TITLE = (
    "приказ Минздрава России от 13.10.2017 № 804н «Об утверждении номенклатуры медицинских услуг»"
)
TABLE_PIECE_LIMIT = 2800
"""Largest table paragraph (characters); the chunker only splits paragraphs above 3200."""
TITLE_NAMES = 2
TITLE_LIMIT = 110
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)
_CODE = re.compile(r"[AB]\d{2}(?:\.\d{2,3}){1,4}")
_CYRILLIC_TO_LATIN = str.maketrans({"А": "A", "В": "B"})
_SPACES = re.compile(r"\s+")


class MedicalServicesError(ValueError):
    """The dictionary does not look like the one this preparer was written for."""


@dataclass(frozen=True)
class ServiceRow:
    row_id: str
    printed_code: str
    code: str
    name: str
    active: bool
    date_out: str | None

    @property
    def group(self) -> str:
        """Class and section: ``A16.20`` for ``A16.20.005.001``, ``B01.003`` for ``B01.003.004``."""
        return ".".join(self.code.split(".")[:2])


@dataclass
class PrepareReport:
    version: str
    publish_date: str
    rows: int = 0
    documents: int = 0
    active_services: int = 0
    abolished_services: int = 0
    rows_without_code: list[str] = field(default_factory=lambda: list[str]())
    cyrillic_codes_repaired: int = 0
    codes_with_spaces_repaired: int = 0
    abolished_twins_not_repeated: int = 0
    codes_reused_for_other_name: list[str] = field(default_factory=lambda: list[str]())
    names_normalized: int = 0
    rows_sha256: str = ""
    output: str = ""


def clean_code(printed: str) -> str:
    return _SPACES.sub("", printed).translate(_CYRILLIC_TO_LATIN)


def clean_name(name: str) -> str:
    return _SPACES.sub(" ", name).strip()


def sort_key(code: str) -> tuple[str, tuple[int, ...]]:
    head, *rest = code.split(".")
    return head[:1], (int(head[1:]), *(int(part) for part in rest))


def read_rows(raw_root: Path) -> tuple[list[ServiceRow], dict[str, object], PrepareReport]:
    """The dictionary's rows, repaired as described in the module docstring."""
    manifest = json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    if manifest.get("oid") != NSI_OID:
        raise MedicalServicesError(f"{raw_root} is not dictionary {NSI_OID}")
    payload = (raw_root / str(manifest["rowsFile"])).read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != manifest["rowsSha256"]:
        raise MedicalServicesError("rows.json differs from the SHA-256 in MANIFEST.json")
    raw_rows = json.loads(payload)
    if len(raw_rows) != manifest["rowsCount"]:
        raise MedicalServicesError("rows.json holds a different number of rows than MANIFEST.json")
    report = PrepareReport(
        version=str(manifest["version"]),
        publish_date=str(manifest["publishDate"]),
        rows=len(raw_rows),
        rows_sha256=digest,
    )
    parsed: list[ServiceRow] = []
    for raw in raw_rows:
        cells = {str(cell["column"]): cell["value"] for cell in raw}
        printed = cells.get("S_CODE")
        name = clean_name(str(cells.get("NAME") or ""))
        if not printed or not str(printed).strip():
            report.rows_without_code.append(f"{cells.get('ID')}: {name}")
            continue
        code = clean_code(str(printed))
        spaceless = _SPACES.sub("", str(printed))
        report.codes_with_spaces_repaired += spaceless != str(printed)
        report.cyrillic_codes_repaired += code != spaceless
        if not _CODE.fullmatch(code):
            raise MedicalServicesError(f"row {cells.get('ID')}: unexpected code «{printed}»")
        if name != str(cells.get("NAME") or ""):
            report.names_normalized += 1
        rel = str(cells.get("REL"))
        if rel not in {"0", "1"}:
            raise MedicalServicesError(f"row {cells.get('ID')}: unexpected REL «{rel}»")
        date_out = cells.get("DATEOUT")
        parsed.append(
            ServiceRow(
                row_id=str(cells["ID"]),
                printed_code=str(printed),
                code=code,
                name=name,
                active=rel == "1",
                date_out=str(date_out) if date_out else None,
            )
        )
    active_names: dict[str, set[str]] = defaultdict(set)
    for row in parsed:
        if row.active:
            active_names[row.code].add(row.name.casefold())
    kept: list[ServiceRow] = []
    reused: set[str] = set()
    for row in parsed:
        if not row.active and row.name.casefold() in active_names.get(row.code, set()):
            report.abolished_twins_not_repeated += 1
            continue
        if not row.active and row.code in active_names:
            reused.add(row.code)
        kept.append(row)
    report.codes_reused_for_other_name = sorted(reused, key=sort_key)
    if any(not row.active and not row.date_out for row in kept):
        raise MedicalServicesError("an abolished row has no abolition date")
    report.active_services = sum(row.active for row in kept)
    report.abolished_services = len(kept) - report.active_services
    kept.sort(key=lambda row: (sort_key(row.code), not row.active, row.row_id))
    return kept, manifest, report


def md_cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|").strip()


def gfm_tables(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    """GFM table paragraphs; a long table is split into pieces that repeat the header."""
    head = [
        "| " + " | ".join(md_cell(cell) for cell in header) + " |",
        "|" + " --- |" * len(header),
    ]
    head_size = sum(len(line) + 1 for line in head)
    pieces: list[list[str]] = [[]]
    size = head_size
    for row in rows:
        if len(row) != len(header):
            raise MedicalServicesError(f"table row has {len(row)} cells, expected {len(header)}")
        line = "| " + " | ".join(md_cell(cell) for cell in row) + " |"
        if pieces[-1] and size + len(line) + 1 > TABLE_PIECE_LIMIT:
            pieces.append([])
            size = head_size
        pieces[-1].append(line)
        size += len(line) + 1
    return ["\n".join([*head, *piece]) for piece in pieces if piece]


def group_id(group: str) -> str:
    return DOCUMENT_PREFIX + group.lower().replace(".", "-")


def document_title(group: str, rows: Sequence[ServiceRow]) -> str:
    """«Услуги A16.20: Удаление кисты яичника; Оофорэктомия лапаротомическая…»."""
    active = [row for row in rows if row.active] or list(rows)
    if len(active) == 1:
        return f"Услуга {active[0].code}: {active[0].name}"
    # The first services of the section, not their endoscopic or other variants, which repeat the
    # name before them.
    shallowest = min(len(row.code.split(".")) for row in active)
    leading = [row for row in active if len(row.code.split(".")) == shallowest]
    title = f"Услуги {group}: " + "; ".join(row.name for row in leading[:TITLE_NAMES])
    if len(title) > TITLE_LIMIT:
        title = title[:TITLE_LIMIT].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    elif len(leading) > TITLE_NAMES:
        title += "…"
    return title


def _source_marker(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def _common_metadata(version: str) -> dict[str, object]:
    return {
        "authorityTier": "official-reference",
        "jurisdiction": "RU",
        "publisher": "Минздрав России (НСИ)",
        "documentKind": "номенклатура медицинских услуг",
        "officialSourceUrl": NSI_PUBLIC_PAGE,
        "codingSystem": "medical-services-nomenclature",
        "nsiOid": NSI_OID,
        "nsiVersion": version,
        "contentMode": "verbatim",
        "rightsStatus": RIGHTS_STATUS,
        "rightsBasis": RIGHTS_BASIS,
        "publicationState": "preview",
        "calculationRequired": False,
        "clinicalContextRequired": False,
    }


def _front_matter(metadata: dict[str, object]) -> str:
    front = yaml.dump(
        metadata,
        Dumper=_YAML_DUMPER,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1_000_000,
    ).rstrip()
    return f"---\n{front}\n---\n\n"


def render_document(
    group: str, rows: Sequence[ServiceRow], manifest: dict[str, object], rows_sha256: str
) -> tuple[str, str, str]:
    """``(document id, title, Markdown)`` of one class and section."""
    active = [row for row in rows if row.active]
    abolished = [row for row in rows if not row.active]
    version = str(manifest["version"])
    basis = json.dumps(
        [[row.row_id, row.code, row.name, row.active, row.date_out] for row in rows],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    checksum = "sha256:" + hashlib.sha256(f"{rows_sha256}\n{basis}".encode()).hexdigest()
    title = document_title(group, rows)
    marker = _source_marker(
        {
            "officialUrl": NSI_PUBLIC_PAGE,
            "dictionary": NSI_OID,
            "dictionaryVersion": version,
            "section": group,
            "rows": len(rows),
            "contentMode": "verbatim",
        }
    )
    blocks: list[str] = []
    if active:
        blocks.append(f"# Услуги {group}")
        blocks.append(marker)
        blocks.extend(
            gfm_tables(("Код", "Наименование услуги"), [(r.code, r.name) for r in active])
        )
    if abolished:
        blocks.append("# Упразднённые услуги")
        blocks.append(marker)
        blocks.extend(
            gfm_tables(
                ("Код", "Наименование услуги", "Упразднена"),
                [(r.code, r.name, r.date_out or "") for r in abolished],
            )
        )
    blocks.append("# Реквизиты")
    blocks.append(
        "\n".join(
            f"- {line}"
            for line in (
                "Номенклатура медицинских услуг — справочник НСИ Минздрава России "
                f"(OID {NSI_OID}), версия {version} от {manifest['publishDate']}",
                f"Основание: {ORDER_TITLE}",
                f"Страница справочника: {NSI_PUBLIC_PAGE}",
            )
        )
    )
    metadata: dict[str, object] = {
        "id": group_id(group),
        "title": title,
        "short_title": f"Услуги {group} (номенклатура)",
        "version_label": f"nsi-{version}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["medical-reference"],
        "age_groups": [],
        "source_file": f"nsi/medical-services/v{version}",
        "source_checksum": checksum,
        "synthetic_fixture": False,
        "metadata": {
            **_common_metadata(version),
            "serviceSection": group,
            "serviceCount": len(active),
            "abolishedServiceCount": len(abolished),
        },
    }
    return group_id(group), title, _front_matter(metadata) + "\n\n".join(blocks) + "\n"


OVERVIEW_ID = DOCUMENT_PREFIX + "overview"
OVERVIEW_TITLE = "Номенклатура медицинских услуг (приказ 804н): разделы кодов"


def render_overview(
    grouped: dict[str, list[ServiceRow]], manifest: dict[str, object], rows_sha256: str
) -> tuple[str, str]:
    """The entry point: every section with its service count and its first services."""
    version = str(manifest["version"])
    table_rows: list[tuple[str, str, str]] = []
    for group in sorted(grouped, key=sort_key):
        rows = grouped[group]
        active = [row for row in rows if row.active]
        leading = document_title(group, rows).split(": ", 1)[1]
        table_rows.append((group, str(len(active)), leading))
    checksum = (
        "sha256:"
        + hashlib.sha256(
            (rows_sha256 + json.dumps(table_rows, ensure_ascii=False)).encode()
        ).hexdigest()
    )
    marker = _source_marker(
        {
            "officialUrl": NSI_PUBLIC_PAGE,
            "dictionary": NSI_OID,
            "dictionaryVersion": version,
            "contentMode": "derived-index",
        }
    )
    blocks = [
        "# Разделы кодов",
        marker,
        "Код услуги записывается как A16.20.005 или B01.003.004: первые две части — класс и "
        "раздел. Раздел открывается отдельным документом с таблицей кодов и наименований "
        "действующих услуг; упразднённые услуги указаны в нём отдельно, с датой упразднения.",
        *gfm_tables(("Раздел", "Услуг", "Первые услуги раздела"), table_rows),
        "# Реквизиты",
        "\n".join(
            f"- {line}"
            for line in (
                "Справочник НСИ Минздрава России «Номенклатура медицинских услуг» "
                f"(OID {NSI_OID}), версия {version} от {manifest['publishDate']}",
                f"Основание: {ORDER_TITLE}",
                f"Страница справочника: {NSI_PUBLIC_PAGE}",
            )
        ),
    ]
    metadata: dict[str, object] = {
        "id": OVERVIEW_ID,
        "title": OVERVIEW_TITLE,
        "short_title": "Номенклатура медицинских услуг",
        "version_label": f"nsi-{version}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["medical-reference"],
        "age_groups": [],
        "source_file": f"nsi/medical-services/v{version}",
        "source_checksum": checksum,
        "synthetic_fixture": False,
        "metadata": {
            **_common_metadata(version),
            "serviceSection": "overview",
            "serviceCount": 0,
            "abolishedServiceCount": 0,
            "sectionCount": len(table_rows),
        },
    }
    return OVERVIEW_ID, _front_matter(metadata) + "\n\n".join(blocks) + "\n"


def prepare_medical_services(raw_root: Path, output: Path) -> PrepareReport:
    rows, manifest, report = read_rows(raw_root)
    grouped: dict[str, list[ServiceRow]] = defaultdict(list)
    for row in rows:
        grouped[row.group].append(row)
    rendered: dict[str, str] = {}
    for group in sorted(grouped, key=sort_key):
        document_id, _title, markdown = render_document(
            group, grouped[group], manifest, report.rows_sha256
        )
        rendered[f"{document_id}.md"] = markdown
    overview_id, overview = render_overview(grouped, manifest, report.rows_sha256)
    rendered[f"{overview_id}.md"] = overview
    report.documents = len(rendered)
    report.output = str(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        manifest_path = output / "manifest.yaml"
        if not manifest_path.is_file() or PACK_ID not in manifest_path.read_text(encoding="utf-8"):
            raise MedicalServicesError(f"{output} exists and is not a {PACK_ID} workspace")
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for name, markdown in rendered.items():
            (workspace / name).write_text(markdown, encoding="utf-8")
        pack_manifest = {
            "id": PACK_ID,
            "version": f"0.1.0-{report.rows_sha256[:8]}",
            "schemaVersion": 2,
            "title": "Номенклатура медицинских услуг (НСИ Минздрава России)",
            "builtAt": str(manifest["fetchedAt"]),
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(pack_manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        (workspace / "prepare-report.json").write_text(
            report_json(replace(report, output="")) + "\n", encoding="utf-8"
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)
    return report


def report_json(report: PrepareReport) -> str:
    return json.dumps(asdict(report), ensure_ascii=False, indent=2)
