from __future__ import annotations

import copy
import gzip
import json
from pathlib import Path

import pytest

from localmed_ingest.definition_name_inventory import add_name_inventory, read_name_manifest
from localmed_ingest.definition_reference_pack import Projection, digest, encoded, obj, seq
from localmed_ingest.msd_topic_inventory import (
    FORMAT,
    component_props,
    index_sections,
    public_path,
    section_topics,
    sitemap_locations,
    title_text,
)
from localmed_ingest.msd_topic_names import compile_msd_names

SECTION = {"id": "v1_ru", "title": "Учебный раздел", "path": "/ru/professional/test"}


def page(components: object, locale: str = "ru") -> bytes:
    payload = {"props": {"pageProps": {"locale": locale, "componentProps": components}}}
    return (
        '<script id="__NEXT_DATA__" type="application/json">'
        + json.dumps(payload, ensure_ascii=False)
        + "</script>"
    ).encode()


def section_page() -> bytes:
    return page(
        {
            "component": {
                "fields": {
                    "data": {
                        "item": {
                            "SectionChildrens": {
                                "results": [
                                    {
                                        "id": "c",
                                        "ChapterName": {"value": "Учебная глава"},
                                        "ChapterUrl": {"path": "/professional/test/chapter"},
                                        "Description": {"value": "DO NOT COPY CHAPTER CONTENT"},
                                        "ChapterChildren": {
                                            "results": [
                                                {
                                                    "id": "A" * 32,
                                                    "TopicName": {
                                                        "value": "\ufeffУчебный <i>термин</i>"
                                                    },
                                                    "TopicUrl": {
                                                        "path": "/professional/test/chapter/topic"
                                                    },
                                                    "Summary": {
                                                        "value": "DO NOT COPY MEDICAL PROSE"
                                                    },
                                                    "InThisTopic": {
                                                        "value": "DO NOT COPY HEADINGS"
                                                    },
                                                }
                                            ]
                                        },
                                    }
                                ],
                            }
                        }
                    }
                }
            }
        }
    )


def catalog() -> dict[str, object]:
    raw = section_page()
    rows = section_topics(raw, SECTION)
    for row in rows:
        row["indexSha256"] = digest(raw.decode())
    return {
        "format": FORMAT,
        "scope": "ru/professional public topic navigation",
        "references": rows,
        "uniqueSourceTopics": 1,
        "receipts": [{"path": SECTION["path"], "sha256": digest(raw.decode()), "bytes": len(raw)}],
    }


def test_public_navigation_metadata_without_summary_fields() -> None:
    rows = section_topics(section_page(), SECTION)
    assert len(rows) == 1
    assert rows[0]["title"] == "Учебный термин"
    assert rows[0]["sourceTitle"] == "\ufeffУчебный <i>термин</i>"
    assert rows[0]["path"] == "/ru/professional/test/chapter/topic"
    assert rows[0]["id"] == "msd.topic." + "a" * 32
    assert "DO NOT COPY" not in encoded(rows)
    assert "definition" not in rows[0]


def test_one_specialty_index_must_be_unambiguous() -> None:
    row = {
        "uniqueid_t": "v1_ru",
        "titlecomputed_t": "Учебный раздел",
        "relativeurlcomputed_s": "/professional/test",
    }
    assert index_sections(page({"c": {"data": [row]}})) == [SECTION]
    with pytest.raises(ValueError, match="Duplicate"):
        index_sections(page({"c": {"data": [row, row]}}))
    with pytest.raises(ValueError, match="ambiguous"):
        index_sections(page({"a": {"data": [row]}, "b": {"data": [row]}}))


@pytest.mark.parametrize(
    "value",
    [
        "https://other.example/ru/professional/test",
        "http://www.msdmanuals.com/ru/test",
        "//other.example/ru/test",
        "/ru/professional/test/../secret",
        "/ru/%2e%2e/private",
        "/ru/%252e%252e/private",
        "/en/professional/test",
        "/ru/test?key=secret",
        "/ru/test#anchor",
        "/ru/test\\private",
        "/ru/test\nprivate",
    ],
)
def test_unsafe_paths_rejected(value: str) -> None:
    with pytest.raises(ValueError):
        public_path(value)


def test_safe_path_preserves_actual_unicode_url() -> None:
    assert (
        public_path("https://www.msdmanuals.com/ru/professional/%D1%82%D0%B5%D1%81%D1%82")
        == "/ru/professional/тест"
    )
    assert (
        public_path("/professional/\ufefftest/chapter/topic")
        == "/ru/professional/\ufefftest/chapter/topic"
    )


@pytest.mark.parametrize("value", ["<script>bad</script>", "<a href='/'>bad</a>", " "])
def test_titles_are_not_a_hidden_prose_or_link_channel(value: str) -> None:
    with pytest.raises(ValueError):
        title_text(value)


def test_language_and_metadata_presence_checked() -> None:
    with pytest.raises(ValueError, match="language"):
        component_props(page({}, "en"))
    with pytest.raises(ValueError, match="metadata"):
        component_props(b"<html>no metadata</html>")
    with pytest.raises(ValueError, match="ambiguous"):
        component_props(page({}) + page({}))


def test_pagination_is_not_reported_as_complete() -> None:
    data = component_props(section_page())
    item = obj(obj(obj(obj(data["component"])["fields"])["data"])["item"])
    obj(item["SectionChildrens"])["pageInfo"] = {"hasNextPage": True}
    with pytest.raises(ValueError, match="paginated"):
        section_topics(page(data), SECTION)


def test_sitemap_reads_only_locations_not_alternate_language_urls() -> None:
    raw = (
        b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url>'
        b"<loc>https://www.msdmanuals.com/ru/professional/test/chapter/topic</loc>"
        b'<lastmod>2026-01-01</lastmod><link href="https://other.example/" /></url></urlset>'
    )
    expected = ["/ru/professional/test/chapter/topic"]
    assert sitemap_locations(raw, "urlset") == expected
    assert sitemap_locations(gzip.compress(raw), "urlset") == expected
    with pytest.raises(ValueError, match="Unexpected"):
        sitemap_locations(raw, "sitemapindex")
    with pytest.raises(ValueError, match="Unsafe"):
        sitemap_locations(b"<!DOCTYPE x><urlset/>", "urlset")


def test_compile_uses_existing_name_inventory_and_does_not_promote_prose() -> None:
    payload = catalog()
    original = copy.deepcopy(payload)
    inventory, report = compile_msd_names(payload, [])
    assert payload == original
    assert report["newSearchableNames"] == 1
    assert report["medicalDefinitionsImported"] == 0
    projection = Projection()
    assert add_name_inventory(projection, inventory, digest(encoded(inventory))) == 1
    entry = next(iter(projection.entries.values()))
    assert entry.coverage == "needs-definition"
    assert [role for role, _ in entry.links] == ["annotation"]
    assert "DO NOT COPY" not in encoded(inventory)


def test_existing_titles_remain_in_source_inventory_without_inferred_equivalence() -> None:
    payload = catalog()
    inventory, report = compile_msd_names(payload, ["УЧЕБНЫЙ ТЕРМИН"])
    assert inventory["names"] == []
    assert len(seq(payload["references"], 100)) == 1
    assert (
        obj(seq(report["deferred"], 100)[0])["reason"]
        == "already-searchable-name-needs-sense-review"
    )


def test_overviews_are_not_counted_as_medical_definitions_or_terms() -> None:
    payload = catalog()
    obj(seq(payload["references"], 100)[0])["title"] = "Обзор учебного раздела"
    inventory, report = compile_msd_names(payload, [])
    assert inventory["names"] == []
    assert obj(seq(report["deferred"], 100)[0])["reason"] == "overview-or-navigation-title"


def test_missing_receipt_or_unexpected_text_rejects_intake() -> None:
    for field, value in [("Summary", "unrequested medical prose"), ("indexSha256", "a" * 64)]:
        payload = catalog()
        obj(seq(payload["references"], 100)[0])[field] = value
        with pytest.raises(ValueError):
            compile_msd_names(payload, [])


def test_multiple_manifest_inputs_are_all_checked(tmp_path: Path) -> None:
    directory = tmp_path / "content/definition-drafts"
    directory.mkdir(parents=True)
    inventory, _ = compile_msd_names(catalog(), [])
    raw = encoded(inventory).encode()
    rows = []
    for name in ("first.json", "second.json"):
        (directory / name).write_bytes(raw)
        rows.append(
            {
                "format": inventory["format"],
                "path": "content/definition-drafts/" + name,
                "bytes": len(raw),
                "sha256": digest(raw.decode()),
            }
        )
    (directory / "name-inputs.json").write_text(
        encoded({"format": "minimed-name-inputs-v2", "inputs": rows})
    )
    # Duplicate bytes are not accepted as two knowledge inputs.
    with pytest.raises(ValueError, match="Duplicate"):
        read_name_manifest(tmp_path)
    rows.pop()
    (directory / "name-inputs.json").write_text(
        encoded({"format": "minimed-name-inputs-v2", "inputs": rows})
    )
    assert read_name_manifest(tmp_path) == (directory / "first.json",)
    (directory / "first.json").write_bytes(raw + b" ")
    with pytest.raises(ValueError, match="receipt"):
        read_name_manifest(tmp_path)
