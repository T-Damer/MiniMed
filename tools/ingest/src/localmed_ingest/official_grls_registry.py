from __future__ import annotations

import hashlib
import html
import http.cookiejar
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import cast
from zipfile import BadZipFile, ZipFile

import yaml

from .source_registry import load_source_registry

GRLS_PAGE = "https://grls.rosminzdrav.ru/GRLS.aspx"
_GRLS_HOST = "grls.rosminzdrav.ru"
_MAX_PAGE_BYTES = 8 * 1024 * 1024
_MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
_MAX_PDF_BYTES = 64 * 1024 * 1024
_MAX_XLSX_MEMBER_BYTES = 128 * 1024 * 1024
_XML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(str(value).replace("\xa0", " ").replace("_x000D_", " ").split())
    return cleaned or None


def _write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _validate_grls_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != _GRLS_HOST:
        raise ValueError(f"GRLS URL must use https://{_GRLS_HOST}.")


def _read_response(response: object, maximum: int) -> bytes:
    read = getattr(response, "read", None)
    if not callable(read):
        raise TypeError("HTTP response does not expose a readable body.")
    payload = cast(bytes, read(maximum + 1))
    if len(payload) > maximum:
        raise ValueError(f"GRLS response exceeds the {maximum}-byte safety limit.")
    if not payload:
        raise ValueError("GRLS returned an empty response.")
    return payload


def _request_bytes(
    url: str,
    *,
    timeout_seconds: float,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    opener: urllib.request.OpenerDirector | None = None,
    maximum: int = _MAX_PAGE_BYTES,
) -> bytes:
    _validate_grls_url(url)
    request = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": "MiniMed/0.5", **(headers or {})},
        method="POST" if data is not None else "GET",
    )
    open_request = opener.open if opener is not None else urllib.request.urlopen
    with open_request(request, timeout=timeout_seconds) as response:
        final_url = getattr(response, "geturl", lambda: url)()
        if isinstance(final_url, str):
            _validate_grls_url(final_url)
        return _read_response(response, maximum)


def _archive_url(page: str) -> str:
    matches = re.findall(r"""go\(['"](?P<url>GetGRLS\.ashx\?[^'"]+)['"]\)""", page)
    if len(matches) != 1:
        raise ValueError(f"Expected one GRLS archive link, found {len(matches)}.")
    url = urllib.parse.urljoin(GRLS_PAGE, html.unescape(matches[0]))
    _validate_grls_url(url)
    return url


def _read_zip_member(archive: ZipFile, name: str) -> bytes:
    info = archive.getinfo(name)
    if info.file_size > _MAX_XLSX_MEMBER_BYTES:
        raise ValueError(f"GRLS workbook member {name} exceeds the safety limit.")
    return archive.read(info)


def _shared_strings(workbook: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ET.fromstring(_read_zip_member(workbook, "xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(_XML_NS + "t")) for item in root]


def _cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    if cell.attrib.get("t") == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(_XML_NS + "t"))
    value = cell.find(_XML_NS + "v")
    text = "" if value is None else value.text or ""
    if cell.attrib.get("t") == "s" and text:
        return shared_strings[int(text)]
    return text


def _worksheet_rows(payload: bytes) -> list[dict[str, str]]:
    with ZipFile(BytesIO(payload)) as workbook:
        shared_strings = _shared_strings(workbook)
        root = ET.fromstring(_read_zip_member(workbook, "xl/worksheets/sheet1.xml"))
        rows: list[dict[str, str]] = []
        for row in root.iter(_XML_NS + "row"):
            row_number = int(row.attrib.get("r", len(rows) + 1))
            if row_number <= len(rows):
                raise ValueError("GRLS worksheet row numbers must be strictly increasing.")
            while len(rows) < row_number - 1:
                rows.append({})
            values: dict[str, str] = {}
            for cell in row.findall(_XML_NS + "c"):
                reference = cell.attrib.get("r", "")
                column = "".join(character for character in reference if character.isalpha())
                if column:
                    values[column] = _cell_text(cell, shared_strings)
            rows.append(values)
        return rows


def _status_from_rows(rows: list[dict[str, str]], filename: str) -> str:
    if len(rows) >= 6 and (status := _clean(rows[5].get("C"))):
        return status
    stem = Path(filename).stem
    return stem.rsplit("-", 1)[-1]


def _registry_date(rows: list[dict[str, str]]) -> str | None:
    for row in rows[:6]:
        for value in row.values():
            match = re.search(r"по состоянию на\s+(\d{2}\.\d{2}\.\d{4})", value)
            if match:
                return match.group(1)
    return None


def _dosage_forms(value: str | None) -> str | None:
    if not value:
        return None
    forms: list[str] = []
    for item in value.split(";"):
        form = _clean(item.split(",", 1)[0])
        if form and form.casefold() not in {existing.casefold() for existing in forms}:
            forms.append(form)
    return "; ".join(forms) or None


def _prescription_status(value: str | None) -> str | None:
    normalized = (value or "").casefold()
    prescription = "по рецепту" in normalized
    otc = "без рецепта" in normalized
    if prescription and otc:
        return "Смешанные условия отпуска"
    if prescription:
        return "По рецепту"
    if otc:
        return "Без рецепта"
    return None


def _status_rank(status: str) -> int:
    normalized = status.casefold().replace("ё", "е")
    if "действ" in normalized or "выдано по правилам" in normalized:
        return 5
    if "приостанов" in normalized:
        return 4
    if "исключ" in normalized:
        return 3
    if "истек" in normalized:
        return 2
    if "измен" in normalized:
        return 1
    return 0


def _normalize_row(
    row: dict[str, str],
    *,
    status: str,
    source_edition: str | None,
    filename: str,
) -> dict[str, object] | None:
    registration_number = _clean(row.get("C"))
    trade_name = _clean(row.get("I"))
    if registration_number is None or trade_name is None:
        return None
    release_forms = _clean(row.get("K"))
    return {
        "registrationNumber": registration_number,
        "tradeName": trade_name,
        "inn": _clean(row.get("J")),
        "dosageForm": _dosage_forms(release_forms),
        "manufacturer": _clean(row.get("L")),
        "holder": _clean(row.get("G")),
        "status": status,
        "prescriptionStatus": _prescription_status(release_forms),
        "sourceEdition": source_edition,
        "officialUrl": GRLS_PAGE,
        "registrationDate": _clean(row.get("D")),
        "expirationDate": _clean(row.get("E")),
        "cancellationDate": _clean(row.get("F")),
        "holderCountry": _clean(row.get("H")),
        "releaseForms": release_forms,
        "regulatoryDocumentation": _clean(row.get("M")),
        "pharmacotherapeuticGroup": _clean(row.get("N")),
        "essentialDrug": _clean(row.get("O")),
        "controlledSubstances": _clean(row.get("P")),
        "orphan": _clean(row.get("Q")),
        "sourceWorkbook": filename,
    }


def parse_grls_archive(
    payload: bytes,
) -> tuple[list[dict[str, object]], dict[str, int], str | None]:
    try:
        archive = ZipFile(BytesIO(payload))
    except BadZipFile as error:
        raise ValueError("GRLS export is not a valid ZIP archive.") from error
    selected: dict[str, tuple[int, dict[str, object]]] = {}
    source_counts: Counter[str] = Counter()
    registry_dates: set[str] = set()
    with archive:
        names = sorted(name for name in archive.namelist() if name.lower().endswith(".xlsx"))
        if not names:
            raise ValueError("GRLS archive contains no XLSX workbooks.")
        for name in names:
            rows = _worksheet_rows(_read_zip_member(archive, name))
            status = _status_from_rows(rows, name)
            source_counts[status] += 0
            edition = _registry_date(rows)
            if edition:
                registry_dates.add(edition)
            for row in rows[6:]:
                record = _normalize_row(
                    row,
                    status=status,
                    source_edition=edition,
                    filename=name,
                )
                if record is None:
                    continue
                source_counts[status] += 1
                registration_number = cast(str, record["registrationNumber"])
                rank = _status_rank(status)
                previous = selected.get(registration_number)
                if previous is None or rank > previous[0]:
                    selected[registration_number] = (rank, record)
    if len(registry_dates) > 1:
        raise ValueError("GRLS workbooks report different registry dates.")
    records = [item[1] for item in selected.values()]
    records.sort(key=lambda item: cast(str, item["registrationNumber"]))
    return records, dict(sorted(source_counts.items())), next(iter(registry_dates), None)


def collect_official_grls_registry(
    output: Path,
    *,
    archive_output: Path | None = None,
    report_output: Path | None = None,
    timeout_seconds: float = 180.0,
    generated_at: str | None = None,
) -> dict[str, object]:
    page = _request_bytes(GRLS_PAGE, timeout_seconds=timeout_seconds).decode("utf-8-sig")
    archive_url = _archive_url(page)
    archive = _request_bytes(
        archive_url,
        timeout_seconds=timeout_seconds,
        maximum=_MAX_ARCHIVE_BYTES,
    )
    records, source_counts, source_edition = parse_grls_archive(archive)
    collected_at = generated_at or _utc_now()
    catalog = {
        "schemaVersion": 1,
        "generatedAt": collected_at,
        "source": GRLS_PAGE,
        "archiveUrl": archive_url,
        "archiveSha256": _sha256(archive),
        "sourceEdition": source_edition,
        "totalRecords": len(records),
        "records": records,
    }
    encoded = (json.dumps(catalog, ensure_ascii=False, indent=2) + "\n").encode()
    _write(output, encoded)
    if archive_output is not None:
        _write(archive_output, archive)
    report = {
        "output": str(output),
        "archiveOutput": str(archive_output) if archive_output else None,
        "records": len(records),
        "sourceRows": sum(source_counts.values()),
        "sourceStatusCounts": source_counts,
        "sourceEdition": source_edition,
        "archiveSha256": _sha256(archive),
        "catalogSha256": _sha256(encoded),
        "generatedAt": collected_at,
    }
    if report_output is not None:
        _write(
            report_output,
            (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode(),
        )
    return report


def _hidden_fields(page: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for tag in re.findall(r"<input\b[^>]*>", page, re.IGNORECASE):
        attributes = {
            key.casefold(): html.unescape(value)
            for key, _quote, value in re.findall(
                r"""([\w:$-]+)\s*=\s*(["'])(.*?)\2""",
                tag,
                re.DOTALL,
            )
        }
        if attributes.get("type", "").casefold() == "hidden" and (name := attributes.get("name")):
            fields[name] = attributes.get("value", "")
    return fields


def _routing_guid(page: str, registration_number: str) -> str:
    for match in re.finditer(
        r"""<tr\b[^>]*onclick=["']det\((?:&#39;|')([^'&]+)(?:&#39;|'),\s*0\);["'][^>]*>(.*?)</tr>""",
        page,
        re.IGNORECASE | re.DOTALL,
    ):
        text = html.unescape(re.sub(r"<[^>]+>", " ", match.group(2)))
        if registration_number in " ".join(text.split()):
            return match.group(1)
    raise ValueError(f"GRLS search did not return registration {registration_number}.")


def _instruction_url(payload: bytes) -> tuple[str, str]:
    outer: object = json.loads(payload.decode("utf-8-sig"))
    if not isinstance(outer, dict) or not isinstance(outer.get("d"), str):
        raise ValueError("GRLS instruction response does not contain a d field.")
    inner: object = json.loads(outer["d"])
    if not isinstance(inner, dict) or not isinstance(inner.get("Sources"), list):
        raise ValueError("GRLS instruction response does not contain Sources.")
    images: list[tuple[str, str]] = []
    for source in inner["Sources"]:
        if not isinstance(source, dict) or not isinstance(source.get("Instructions"), list):
            continue
        for instruction in source["Instructions"]:
            if not isinstance(instruction, dict) or not isinstance(instruction.get("Images"), list):
                continue
            for image in instruction["Images"]:
                if isinstance(image, dict) and isinstance(image.get("Url"), str):
                    images.append((image["Url"], str(image.get("Label") or "")))
    if not images:
        raise ValueError("GRLS returned no instruction PDF.")
    path, label = max(images, key=lambda item: item[0])
    url = urllib.parse.urljoin(GRLS_PAGE, path.replace("\\", "/"))
    _validate_grls_url(url)
    return url, label


def _safe_target(root: Path, relative_path: str) -> Path:
    resolved_root = root.resolve()
    target = (resolved_root / relative_path).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"Instruction target escapes output root: {relative_path}") from error
    return target


def sync_selected_grls_instructions(
    registry_path: Path,
    output_root: Path,
    report_output: Path,
    *,
    resolved_registry_output: Path | None = None,
    timeout_seconds: float = 180.0,
) -> dict[str, object]:
    registry = load_source_registry(registry_path)
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    results: list[dict[str, object]] = []
    for source in registry.sources:
        registration_number = source.metadata.get("registrationNumber")
        if not isinstance(registration_number, str) or not registration_number:
            raise ValueError(f"{source.id}: metadata.registrationNumber is required.")
        form_page = _request_bytes(
            GRLS_PAGE,
            timeout_seconds=timeout_seconds,
            opener=opener,
        ).decode("utf-8-sig")
        fields = _hidden_fields(form_page)
        fields.update(
            {
                "ctl00$plate$isFS": "0",
                "ctl00$plate$txtRegNm": registration_number,
                "ctl00$plate$txtRecordOnPageCount": "10",
                "ctl00$plate$bSeek": "Найти",
            }
        )
        result_page = _request_bytes(
            GRLS_PAGE,
            timeout_seconds=timeout_seconds,
            opener=opener,
            data=urllib.parse.urlencode(fields).encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": GRLS_PAGE,
            },
        ).decode("utf-8-sig")
        routing_guid = _routing_guid(result_page, registration_number)
        detail_url = urllib.parse.urljoin(
            GRLS_PAGE,
            f"Grls_View_v2.aspx?routingGuid={urllib.parse.quote(routing_guid)}",
        )
        detail_page = _request_bytes(
            detail_url,
            timeout_seconds=timeout_seconds,
            opener=opener,
        ).decode("utf-8-sig")
        id_match = re.search(
            r'id=["\']ctl00_plate_hfIdReg["\'][^>]*value=["\'](\d+)["\']', detail_page
        )
        if id_match is None:
            raise ValueError(f"GRLS detail page has no idReg for {registration_number}.")
        endpoint = urllib.parse.urljoin(GRLS_PAGE, "GRLS_View_V2.aspx/AddInstrImg")
        instruction_response = _request_bytes(
            endpoint,
            timeout_seconds=timeout_seconds,
            opener=opener,
            data=json.dumps(
                {"regNumber": registration_number, "idReg": id_match.group(1)},
                ensure_ascii=False,
            ).encode(),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Referer": detail_url,
            },
        )
        instruction_url, label = _instruction_url(instruction_response)
        pdf = _request_bytes(
            instruction_url,
            timeout_seconds=timeout_seconds,
            opener=opener,
            maximum=_MAX_PDF_BYTES,
        )
        if not pdf.startswith(b"%PDF-"):
            raise ValueError(f"GRLS instruction for {registration_number} is not a PDF.")
        target = _safe_target(output_root, source.path)
        _write(target, pdf)
        results.append(
            {
                "sourceId": source.id,
                "registrationNumber": registration_number,
                "target": str(target),
                "instructionUrl": instruction_url,
                "instructionLabel": label,
                "sha256": _sha256(pdf),
                "bytes": len(pdf),
            }
        )
    report = {
        "schemaVersion": 1,
        "generatedAt": _utc_now(),
        "registry": str(registry_path),
        "sources": len(results),
        "results": results,
    }
    if resolved_registry_output is not None:
        resolved_registry = registry.model_dump(by_alias=True, mode="json")
        result_by_id = {cast(str, item["sourceId"]): item for item in results}
        for source in cast(list[dict[str, object]], resolved_registry["sources"]):
            result = result_by_id[cast(str, source["id"])]
            metadata = cast(dict[str, object], source["metadata"])
            metadata["instructionUrl"] = result["instructionUrl"]
            metadata["instructionLabel"] = result["instructionLabel"]
            metadata["sourceChecksum"] = result["sha256"]
        _write(
            resolved_registry_output,
            yaml.safe_dump(
                resolved_registry,
                allow_unicode=True,
                sort_keys=False,
            ).encode(),
        )
    _write(
        report_output,
        (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode(),
    )
    return report
