from __future__ import annotations

import json
from pathlib import Path

import yaml

from localmed_ingest.builder import build_content_pack
from localmed_ingest.clinical_json_import import extract_clinical_json
from localmed_ingest.models import RegistryPack, RegistrySource, SourceRegistry
from localmed_ingest.source_registry import prepare_registry


def _treatment_source(directory: Path) -> Path:
    source = directory / "908_1.json"
    sections = [
        {
            "id": "doc_3",
            "title": "3. Лечение",
            "content": (
                "<p>Вступление к лечению пациента.</p>"
                "<p>3.1 Консервативное лечение</p>"
                "<p>Назначают препарат.</p>"
                "<p>3.1.1. Подбор доз</p>"
                "<p>Дозу подбирают индивидуально.</p>"
                "<p>3.2. при фронтальном направлении удара;</p>"
                "<p>2.5 мг два раза в день</p>"
                "<p>3.3 Рекомендуется всем пациентам начинать лечение с небольших доз</p>"
            ),
        },
        *[
            {
                "id": f"doc_{index}",
                "title": f"{index}. Раздел {index}",
                "content": "<p>" + "Текст раздела клинической рекомендации. " * 40 + "</p>",
            }
            for index in range(4, 13)
        ],
    ]
    source.write_text(
        json.dumps(
            {
                "id": "908_1",
                "name": "Проверочная рекомендация",
                "obj": {"sections": [{"id": "doc_whole", "content": "dup"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return source


def _registry(tmp_path: Path, source: Path) -> Path:
    registry = SourceRegistry(
        pack=RegistryPack(
            id="minimed.clinical.recommendation.908_1",
            version="0.6.0-test",
            schema_version=2,
            title="Проверочная рекомендация",
            built_at="2026-10-07T00:00:00Z",
        ),
        sources=[
            RegistrySource(
                id="kr.rf.908_1",
                path=source.name,
                title="Проверочная рекомендация",
                version_label="908_1",
                status="active",
                format="clinical_json",
            )
        ],
    )
    registry_path = tmp_path / "registry.yaml"
    registry_path.write_text(
        yaml.safe_dump(registry.model_dump(by_alias=True, mode="json"), allow_unicode=True),
        encoding="utf-8",
    )
    return registry_path


def test_numbered_paragraphs_are_extracted_as_sub_headings(tmp_path: Path) -> None:
    extracted = extract_clinical_json(_treatment_source(tmp_path))
    blocks = extracted.pages[0].blocks
    promoted = [block for block in blocks if block.metadata.get("promotedFrom")]

    assert extracted.extractor_revision == 2
    assert extracted.diagnostics.promoted_headings == 2
    assert [(block.text, block.kind, block.heading_level) for block in promoted] == [
        ("3.1 Консервативное лечение", "heading", 2),
        ("3.1.1. Подбор доз", "heading", 3),
    ]
    # Wording is untouched, and list items, doses and recommendations stay body text.
    for text in (
        "3.2. при фронтальном направлении удара;",
        "2.5 мг два раза в день",
        "3.3 Рекомендуется всем пациентам начинать лечение с небольших доз",
    ):
        assert next(block for block in blocks if block.text == text).kind == "paragraph"
    # The block ids stay sequential, so promoting does not renumber anything after it.
    assert [block.id for block in blocks[:4]] == ["json-b1", "json-b2", "json-b3", "json-b4"]


def test_promoted_sub_headings_become_sections_of_the_pack(tmp_path: Path) -> None:
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source = _treatment_source(source_root)
    workspace = tmp_path / "workspace"
    prepare_registry(_registry(tmp_path, source), source_root, workspace)
    pack, _report = build_content_pack(workspace, tmp_path / "clinical.db")

    sections = {section.title: section for section in pack.documents[0].sections}
    assert sections["3.1 Консервативное лечение"].section_path == [
        "3. Лечение",
        "3.1 Консервативное лечение",
    ]
    assert [chunk.original_text for chunk in sections["3.1 Консервативное лечение"].chunks] == [
        "Назначают препарат."
    ]
    assert sections["3.1.1. Подбор доз"].section_path == [
        "3. Лечение",
        "3.1 Консервативное лечение",
        "3.1.1. Подбор доз",
    ]
    # The stored top-level section keeps its path-derived id and its introduction.
    assert sections["3. Лечение"].chunks[0].original_text == "Вступление к лечению пациента."


def test_reuse_re_extracts_clinical_json_written_before_the_rule(tmp_path: Path) -> None:
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source = _treatment_source(source_root)
    registry_path = _registry(tmp_path, source)
    first = tmp_path / "first"
    prepare_registry(registry_path, source_root, first)
    stored = first / ".localmed" / "extractions" / "kr.rf.908_1.json"
    payload = json.loads(stored.read_text(encoding="utf-8"))
    payload["extractorRevision"] = 1
    stored.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    second = tmp_path / "second"
    report = prepare_registry(registry_path, source_root, second, reuse_from=first)
    assert report.reused_sources == 0
    assert report.extracted_sources == 1

    third = tmp_path / "third"
    report = prepare_registry(registry_path, source_root, third, reuse_from=second)
    assert report.reused_sources == 1
