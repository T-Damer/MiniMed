from __future__ import annotations

import json
from pathlib import Path

import pytest

from localmed_ingest.official_clinical_registry import (
    OFFICIAL_REGISTRY_API,
    check_selected_clinical_sources,
    collect_official_clinical_registry,
    import_official_clinical_registry_pages,
    normalize_official_registry_row,
)


def official_row(
    code_version: str,
    *,
    title: str,
    age: str = "Дети",
    active: int = 1,
) -> dict[str, object]:
    code, version = code_version.split("_", 1)
    return {
        "Id": int(code) + 1000,
        "Name": title,
        "NPC_approved": True,
        "PublishDateStr": "2026-07-20T15:51:26",
        "Code": int(code),
        "Version": int(version),
        "CodeVersion": code_version,
        "Status": 0,
        "ApplyStatus": None,
        "AgeCategory": 2,
        "AgeCategoryStr": age,
        "CreatedStr": "2026-07-17T10:50:02",
        "ApplyStatusCalculated": active,
        "PrevCrId": None,
        "Developers": [
            {
                "ClinRecId": int(code) + 1000,
                "NkoId": 7,
                "NkoName": "Союз педиатров России",
            }
        ],
        "Mkbs": [
            {
                "ClinRecId": int(code) + 1000,
                "MkbId": 1,
                "MkbName": "Тестовое состояние",
                "MkbCode": "J18",
            }
        ],
        "Specialities": [{"Name": "Педиатрия"}],
    }


def test_normalizes_nested_official_registry_fields() -> None:
    normalized = normalize_official_registry_row(
        official_row("714_2", title="Внебольничная пневмония у детей")
    )

    assert normalized["id"] == "714_2"
    assert normalized["name"] == "Внебольничная пневмония у детей"
    assert normalized["mkb10"] == ["J18"]
    assert normalized["developer"] == "Союз педиатров России"
    assert normalized["ageCategory"] == "Дети"
    assert normalized["applicationStatus"] == "Применяется"
    assert normalized["officialUrl"] == "https://cr.minzdrav.gov.ru/preview-cr/714_2"
    assert normalized["specialities"] == ["Педиатрия"]


def test_collects_every_page_and_preserves_raw_responses(tmp_path: Path) -> None:
    rows = [
        official_row("714_2", title="Пневмония"),
        official_row("381_3", title="Бронхит"),
        official_row("360_3", title="Бронхиолит", age="Взрослые, дети"),
    ]
    requests: list[dict[str, object]] = []

    def transport(
        url: str,
        body: bytes,
        headers: dict[str, str],
        _timeout: float,
    ) -> object:
        assert url == OFFICIAL_REGISTRY_API
        assert headers["Content-Type"] == "application/json"
        assert headers["User-Agent"] == "MiniMed/0.5"
        request = json.loads(body)
        requests.append(request)
        page = int(request["currentPage"])
        page_size = int(request["pageSize"])
        start = (page - 1) * page_size
        return {
            "Data": rows[start : start + page_size],
            "CurrentPage": page,
            "PageSize": page_size,
            "TotalRecords": len(rows),
            "Erorrs": None,
        }

    output = tmp_path / "official.json"
    raw_output = tmp_path / "raw.json"
    report_output = tmp_path / "report.json"
    report = collect_official_clinical_registry(
        output,
        raw_output=raw_output,
        report_output=report_output,
        page_size=2,
        generated_at="2026-07-23T00:00:00Z",
        transport=transport,
    )

    assert [request["currentPage"] for request in requests] == [1, 2]
    for request in requests:
        filters = request["filters"]
        assert isinstance(filters, list)
        assert filters and isinstance(filters[0], dict)
        assert filters[0]["fieldName"] == "status"
    assert report["totalRecords"] == 3
    assert report["uniqueOfficialIds"] == 3
    assert report["pediatricRecords"] == 3
    catalog = json.loads(output.read_text(encoding="utf-8"))
    assert catalog["totalRecords"] == 3
    assert [record["id"] for record in catalog["records"]] == ["714_2", "381_3", "360_3"]
    raw = json.loads(raw_output.read_text(encoding="utf-8"))
    assert len(raw["pages"]) == 2
    assert report_output.is_file()


def test_rejects_duplicate_official_ids(tmp_path: Path) -> None:
    duplicate = official_row("714_2", title="Пневмония")

    def transport(
        _url: str,
        body: bytes,
        _headers: dict[str, str],
        _timeout: float,
    ) -> object:
        request = json.loads(body)
        return {
            "Data": [duplicate, duplicate],
            "CurrentPage": request["currentPage"],
            "PageSize": request["pageSize"],
            "TotalRecords": 2,
        }

    with pytest.raises(ValueError, match="duplicate recommendation 714_2"):
        collect_official_clinical_registry(
            tmp_path / "catalog.json",
            page_size=2,
            transport=transport,
        )


def test_rejects_record_count_drift(tmp_path: Path) -> None:
    row = official_row("714_2", title="Пневмония")

    def transport(
        _url: str,
        body: bytes,
        _headers: dict[str, str],
        _timeout: float,
    ) -> object:
        request = json.loads(body)
        return {
            "Data": [row] if request["currentPage"] == 1 else [],
            "CurrentPage": request["currentPage"],
            "PageSize": request["pageSize"],
            "TotalRecords": 2,
        }

    with pytest.raises(ValueError, match="record-count mismatch"):
        collect_official_clinical_registry(
            tmp_path / "catalog.json",
            page_size=1,
            transport=transport,
        )


def test_imports_browser_captured_pages(tmp_path: Path) -> None:
    rows = [
        official_row("714_2", title="Пневмония"),
        official_row("381_3", title="Бронхит"),
    ]
    capture = tmp_path / "api-pages.json"
    capture.write_text(
        json.dumps(
            {
                "pages": [
                    {
                        "page": index,
                        "response": {
                            "Data": [row],
                            "CurrentPage": index,
                            "PageSize": 1,
                            "TotalRecords": len(rows),
                        },
                    }
                    for index, row in enumerate(rows, start=1)
                ]
            }
        ),
        encoding="utf-8",
    )

    report = import_official_clinical_registry_pages(
        capture,
        tmp_path / "catalog.json",
        generated_at="2026-07-24T00:00:00Z",
    )

    assert report["totalRecords"] == 2
    assert report["uniqueOfficialIds"] == 2


def test_reports_replacement_for_selected_inactive_edition(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        json.dumps({"records": [{"id": "714_3", "code": 714}]}),
        encoding="utf-8",
    )
    registry = tmp_path / "sources.yaml"
    registry.write_text(
        """pack:
  id: test
  version: "1"
  schemaVersion: 2
  title: Test
  builtAt: "2026-07-24T00:00:00Z"
sources:
  - id: kr.test.pneumonia
    path: pneumonia.pdf
    title: Pneumonia
    versionLabel: "714_2"
    metadata:
      officialId: "714_2"
""",
        encoding="utf-8",
    )

    report = check_selected_clinical_sources(catalog, registry)

    assert report["updates"] == 1
    assert report["sources"] == [
        {
            "sourceId": "kr.test.pneumonia",
            "officialId": "714_2",
            "status": "update-available",
            "replacementId": "714_3",
        }
    ]


def test_all_status_listing_sends_no_status_filter_and_keeps_archive_rows(tmp_path: Path) -> None:
    replaced = {**official_row("507_3", title="Туберкулез у детей"), "Status": 4}
    current = official_row("507_4", title="Туберкулез у детей")
    archived_twice = [
        {**official_row("687_1", title="Архивная"), "Status": 2},
        {**official_row("687_1", title="Архивная"), "Status": 1},
    ]
    untitled = {**official_row("9_1", title="x"), "CodeVersion": None, "Name": None, "Status": 2}
    rows = [replaced, current, *archived_twice, untitled]
    requests: list[dict[str, object]] = []

    def transport(
        _url: str,
        body: bytes,
        _headers: dict[str, str],
        _timeout: float,
    ) -> object:
        request = json.loads(body)
        requests.append(request)
        return {
            "Data": rows,
            "CurrentPage": request["currentPage"],
            "PageSize": request["pageSize"],
            "TotalRecords": len(rows),
        }

    report = collect_official_clinical_registry(
        tmp_path / "catalog.json",
        page_size=10,
        status=None,
        transport=transport,
    )

    assert requests[0]["filters"] == []
    assert report["totalRecords"] == 5
    assert report["skippedRowsWithoutIdOrTitle"] == 1
    catalog = json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8"))
    assert [record["id"] for record in catalog["records"]] == ["507_3", "507_4", "687_1", "687_1"]
    assert [record["officialMetadata"]["Status"] for record in catalog["records"]] == [4, 0, 2, 1]


def test_delta_keeps_only_records_without_a_module(tmp_path: Path) -> None:
    from localmed_ingest.official_clinical_registry import write_clinical_catalog_delta

    records = [
        normalize_official_registry_row(official_row("507_4", title="Туберкулез у детей")),
        normalize_official_registry_row(official_row("53_2", title="Аневризмы")),
    ]
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"records": records, "totalRecords": 2}), encoding="utf-8")
    modules = tmp_path / "modules.json"
    modules.write_text(
        json.dumps(
            {
                "modules": [
                    {"id": "minimed.core.ru"},
                    {"id": "minimed.clinical.recommendation.53_2"},
                    {"id": "minimed.clinical.recommendation.507_3"},
                ]
            }
        ),
        encoding="utf-8",
    )

    summary = write_clinical_catalog_delta(catalog, modules, tmp_path / "delta.json")

    assert summary["newRecords"] == ["507_4"]
    assert summary["listedButNotActive"] == ["507_3"]
    delta = json.loads((tmp_path / "delta.json").read_text(encoding="utf-8"))
    assert [record["id"] for record in delta["records"]] == ["507_4"]
    assert delta["totalRecords"] == 1
