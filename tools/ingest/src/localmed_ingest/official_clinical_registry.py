from __future__ import annotations

import hashlib
import json
import math
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

OFFICIAL_REGISTRY_PAGE = "https://cr.minzdrav.gov.ru/clin-rec/"
OFFICIAL_REGISTRY_API = "https://apicr.minzdrav.gov.ru/api.ashx?op=GetJsonClinrecsFilterV2"
_ALLOWED_API_HOST = "apicr.minzdrav.gov.ru"
_MAX_RESPONSE_BYTES = 64 * 1024 * 1024

JsonTransport = Callable[[str, bytes, dict[str, str], float], object]


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def _request_payload(*, page_size: int, current_page: int) -> dict[str, object]:
    return {
        "filters": [
            {
                "fieldName": "status",
                "filterType": 1,
                "filterValueType": 2,
                "value1": 0,
                "value2": "",
                "values": [],
            }
        ],
        "sortOption": {"fieldName": "publishdate", "sortType": 2},
        "pageSize": page_size,
        "currentPage": current_page,
        "useANDoperator": True,
        "columns": [],
    }


def _default_transport(
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout_seconds: float,
) -> object:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != _ALLOWED_API_HOST:
        raise ValueError(f"Official registry URL must use https://{_ALLOWED_API_HOST}.")
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(payload) > _MAX_RESPONSE_BYTES:
        raise ValueError("Official registry response exceeds the 64 MiB safety limit.")
    return json.loads(payload.decode("utf-8-sig"))


def _int_field(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"Official registry field {key} must be an integer.")
    return value


def _response_page(
    payload: object,
    *,
    expected_page: int,
) -> tuple[list[dict[str, object]], int, int]:
    if not isinstance(payload, dict):
        raise ValueError("Official registry response must be an object.")
    response = {str(key): cast(object, value) for key, value in payload.items()}
    current_page = _int_field(response, "CurrentPage")
    page_size = _int_field(response, "PageSize")
    total_records = _int_field(response, "TotalRecords")
    if current_page != expected_page:
        raise ValueError(
            f"Official registry returned page {current_page} "
            f"while page {expected_page} was requested."
        )
    if page_size < 1 or total_records < 0:
        raise ValueError("Official registry returned an invalid page size or total record count.")
    raw_rows = response.get("Data")
    if not isinstance(raw_rows, list):
        raise ValueError("Official registry response does not contain a Data array.")
    rows: list[dict[str, object]] = []
    for index, row in enumerate(raw_rows):
        if not isinstance(row, dict):
            raise ValueError(f"Official registry row {index + 1} is not an object.")
        rows.append({str(key): cast(object, value) for key, value in row.items()})
    return rows, page_size, total_records


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(str(value).replace("\xa0", " ").split())
    return cleaned or None


def _object_list(value: object | None) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, object]] = []
    for item in value:
        if isinstance(item, dict):
            result.append({str(key): cast(object, child) for key, child in item.items()})
    return result


def _unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _clean(value)
        if cleaned is None:
            continue
        key = cleaned.casefold().replace("ё", "е")
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def _application_status(row: dict[str, object]) -> str:
    calculated = row.get("ApplyStatusCalculated")
    if calculated == 1:
        return "Применяется"
    if row.get("PrevCrId") not in (None, ""):
        return "Заменена новой редакцией"
    apply_status = _clean(row.get("ApplyStatus"))
    if apply_status:
        return apply_status
    return "Статус применения не указан"


def normalize_official_registry_row(row: dict[str, object]) -> dict[str, object]:
    official_id = _clean(row.get("CodeVersion"))
    title = _clean(row.get("Name"))
    if official_id is None or title is None:
        raise ValueError("Official registry row requires CodeVersion and Name.")
    developers = _unique_strings(
        [
            name
            for item in _object_list(row.get("Developers"))
            if (name := _clean(item.get("NkoName"))) is not None
        ]
    )
    icd10_codes = _unique_strings(
        [
            code
            for item in _object_list(row.get("Mkbs"))
            if (code := _clean(item.get("MkbCode"))) is not None
        ]
    )
    specialities = _unique_strings(
        [
            name
            for item in _object_list(row.get("Specialities"))
            if (
                name := _clean(item.get("Name"))
                or _clean(item.get("SpecialityName"))
                or _clean(item.get("SpecialtyName"))
            )
            is not None
        ]
    )
    return {
        "id": official_id,
        "name": title,
        "version": official_id,
        "mkb10": icd10_codes,
        "ageCategory": _clean(row.get("AgeCategoryStr")) or "Не указано",
        "developer": ", ".join(developers) if developers else None,
        "publishedAt": _clean(row.get("PublishDateStr")),
        "applicationStatus": _application_status(row),
        "officialUrl": f"https://cr.minzdrav.gov.ru/preview-cr/{official_id}",
        "officialRegistryId": row.get("Id"),
        "code": row.get("Code"),
        "versionNumber": row.get("Version"),
        "npcApproved": row.get("NPC_approved"),
        "previousRecommendationId": row.get("PrevCrId"),
        "specialities": specialities,
        "officialMetadata": row,
    }


def collect_official_clinical_registry(
    output: Path,
    *,
    raw_output: Path | None = None,
    report_output: Path | None = None,
    page_size: int = 200,
    max_pages: int = 100,
    timeout_seconds: float = 180.0,
    generated_at: str | None = None,
    transport: JsonTransport = _default_transport,
) -> dict[str, object]:
    if page_size < 1 or page_size > 1000:
        raise ValueError("Official registry page size must be between 1 and 1000.")
    if max_pages < 1:
        raise ValueError("Official registry max_pages must be positive.")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Referer": "https://cr.minzdrav.gov.ru/",
        "User-Agent": "MiniMed-Medbase/1.0 (+https://github.com/T-Damer/MiniMed)",
    }
    raw_pages: list[dict[str, object]] = []
    normalized_records: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    total_records: int | None = None
    actual_page_size: int | None = None
    total_pages: int | None = None

    page = 1
    while total_pages is None or page <= total_pages:
        if page > max_pages:
            raise ValueError(
                f"Official registry requires more than the configured {max_pages} pages."
            )
        request_payload = _request_payload(page_size=page_size, current_page=page)
        request_body = json.dumps(
            request_payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        response_payload = transport(
            OFFICIAL_REGISTRY_API,
            request_body,
            headers,
            timeout_seconds,
        )
        rows, returned_page_size, returned_total = _response_page(
            response_payload,
            expected_page=page,
        )
        if total_records is None:
            total_records = returned_total
            actual_page_size = returned_page_size
            total_pages = max(1, math.ceil(total_records / actual_page_size))
        elif returned_total != total_records or returned_page_size != actual_page_size:
            raise ValueError("Official registry pagination metadata changed during collection.")
        raw_pages.append(
            {
                "page": page,
                "request": request_payload,
                "requestSha256": _sha256_bytes(request_body),
                "response": response_payload,
            }
        )
        for row in rows:
            normalized = normalize_official_registry_row(row)
            official_id = cast(str, normalized["id"])
            if official_id in seen_ids:
                raise ValueError(
                    f"Official registry returned duplicate recommendation {official_id}."
                )
            seen_ids.add(official_id)
            normalized_records.append(normalized)
        page += 1

    assert total_records is not None
    assert actual_page_size is not None
    assert total_pages is not None
    if len(normalized_records) != total_records:
        raise ValueError(
            "Official registry record-count mismatch: "
            f"expected {total_records}, collected {len(normalized_records)}."
        )
    collected_at = generated_at or _utc_now()
    catalog = {
        "schemaVersion": 1,
        "generatedAt": collected_at,
        "source": OFFICIAL_REGISTRY_PAGE,
        "apiUrl": OFFICIAL_REGISTRY_API,
        "totalRecords": total_records,
        "pageSize": actual_page_size,
        "pages": total_pages,
        "records": normalized_records,
    }
    encoded_catalog = (json.dumps(catalog, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded_catalog)

    raw_payload = {
        "schemaVersion": 1,
        "generatedAt": collected_at,
        "source": OFFICIAL_REGISTRY_PAGE,
        "apiUrl": OFFICIAL_REGISTRY_API,
        "pages": raw_pages,
    }
    if raw_output is not None:
        raw_output.parent.mkdir(parents=True, exist_ok=True)
        raw_output.write_text(
            json.dumps(raw_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    report: dict[str, object] = {
        "schemaVersion": 1,
        "generatedAt": collected_at,
        "source": OFFICIAL_REGISTRY_PAGE,
        "apiUrl": OFFICIAL_REGISTRY_API,
        "catalogSha256": _sha256_bytes(encoded_catalog),
        "totalRecords": total_records,
        "uniqueOfficialIds": len(seen_ids),
        "pageSize": actual_page_size,
        "pages": total_pages,
        "activeRecords": sum(
            record.get("applicationStatus") == "Применяется" for record in normalized_records
        ),
        "pediatricRecords": sum(
            "дет" in str(record.get("ageCategory", "")).casefold() for record in normalized_records
        ),
    }
    if report_output is not None:
        report_output.parent.mkdir(parents=True, exist_ok=True)
        report_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return report


def import_official_clinical_registry_pages(
    source: Path,
    output: Path,
    *,
    raw_output: Path | None = None,
    report_output: Path | None = None,
    generated_at: str | None = None,
) -> dict[str, object]:
    payload: object = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Official registry browser capture must be an object.")
    pages_value = payload.get("pages")
    if not isinstance(pages_value, list) or not pages_value:
        raise ValueError("Official registry browser capture must contain response pages.")

    responses: list[object] = []
    for expected_page, page_value in enumerate(pages_value, start=1):
        if not isinstance(page_value, dict) or page_value.get("page") != expected_page:
            raise ValueError("Official registry browser capture pages must be ordered.")
        if "response" not in page_value:
            raise ValueError(
                f"Official registry browser capture page {expected_page} has no response."
            )
        responses.append(page_value["response"])

    first_response = responses[0]
    if not isinstance(first_response, dict):
        raise ValueError("Official registry browser capture response must be an object.")
    normalized_first = {str(key): cast(object, value) for key, value in first_response.items()}
    page_size = _int_field(normalized_first, "PageSize")

    def captured_transport(
        _url: str,
        body: bytes,
        _headers: dict[str, str],
        _timeout_seconds: float,
    ) -> object:
        request: object = json.loads(body)
        if not isinstance(request, dict):
            raise ValueError("Official registry request must be an object.")
        normalized_request = {str(key): cast(object, value) for key, value in request.items()}
        current_page = _int_field(normalized_request, "currentPage")
        if current_page < 1 or current_page > len(responses):
            raise ValueError(f"Official registry browser capture has no page {current_page}.")
        return responses[current_page - 1]

    return collect_official_clinical_registry(
        output,
        raw_output=raw_output,
        report_output=report_output,
        page_size=page_size,
        max_pages=len(responses),
        generated_at=generated_at,
        transport=captured_transport,
    )
