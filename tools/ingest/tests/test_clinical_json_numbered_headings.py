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

    assert extracted.extractor_revision == 4
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


def _classification_source(directory: Path) -> Path:
    source = directory / "909_1.json"
    sections = [
        {
            "id": "doc_1",
            "title": "1. Краткая информация",
            "content": (
                "<p>1.1 Причины заболевания</p>"
                "<p>Причины перечислены ниже.</p>"
                "<p>2.3 Патология развития</p>"
                "<p>2.3.1 Краснуха</p>"
                "<p>2.3.2 Другие</p>"
                "<p>2.4 Лечение патологии</p>"
                "<p>2.4.1 Подбор терапии</p>"
                "<p>Терапию подбирают индивидуально.</p>"
                "<p>2.5 Профилактика</p>"
            ),
        },
        *[
            {
                "id": f"doc_{index}",
                "title": f"{index}. Раздел {index}",
                "content": "<p>" + "Текст раздела клинической рекомендации. " * 40 + "</p>",
            }
            for index in range(2, 12)
        ],
    ]
    source.write_text(
        json.dumps(
            {
                "id": "909_1",
                "name": "Проверочная классификация",
                "obj": {"sections": [{"id": "doc_whole", "content": "dup"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return source


def test_a_numbered_paragraph_that_heads_no_text_stays_a_paragraph(tmp_path: Path) -> None:
    extracted = extract_clinical_json(_classification_source(tmp_path))
    blocks = {block.text: block for block in extracted.pages[0].blocks}

    # «2.4» heads «2.4.1», which has text below it; «2.4.1» heads its own text.
    assert blocks["2.4 Лечение патологии"].kind == "heading"
    assert blocks["2.4.1 Подбор терапии"].kind == "heading"
    # A heading directly followed by body text stays one (the cause list intro).
    assert blocks["1.1 Причины заболевания"].kind == "heading"
    # A classification list and a last numbered line with nothing below it would be hidden by the
    # reader as text-less sections, so they remain body paragraphs with their wording.
    for text in ("2.3 Патология развития", "2.3.1 Краснуха", "2.3.2 Другие", "2.5 Профилактика"):
        assert blocks[text].kind == "paragraph"
        assert blocks[text].heading_level is None
        assert "promotedFrom" not in blocks[text].metadata
    assert extracted.diagnostics.promoted_headings == 3


def test_a_numbered_paragraph_that_would_take_over_a_stored_headings_text_stays_a_paragraph(
    tmp_path: Path,
) -> None:
    source = tmp_path / "910_1.json"
    sections = [
        {
            "id": "doc_3",
            "title": "3. Лечение",
            "content": (
                "<h3>3.3 Иное лечение</h3>"
                "<p>3.3.1 Дистанционная лучевая терапия</p>"
                "<p>Рекомендована при болевом синдроме.</p>"
                "<p>3.3.2 Контрацепция</p>"
                "<p>Подбирается индивидуально.</p>"
                "<h3>3.4 Наблюдение</h3>"
                "<p>3.4.1 Контрольные визиты</p>"
                "<p>Раз в три месяца.</p>"
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
                "id": "910_1",
                "name": "Проверочная рекомендация",
                "obj": {"sections": [{"id": "doc_whole", "content": "dup"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    blocks = {block.text: block for block in extract_clinical_json(source).pages[0].blocks}

    # «3.3» is a stored level-3 heading; its «3.3.x» lines would be level-3 siblings that leave it
    # without text of its own, so the reader would hide it. They stay as its body paragraphs.
    assert blocks["3.3 Иное лечение"].kind == "heading"
    for text in (
        "3.3.1 Дистанционная лучевая терапия",
        "3.3.2 Контрацепция",
        "3.4.1 Контрольные визиты",
    ):
        assert blocks[text].kind == "paragraph"


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


def test_appendix_sub_titles_are_extracted_as_sub_headings(tmp_path: Path) -> None:
    source = tmp_path / "911_1.json"
    sections = [
        {
            "id": "doc_1",
            "title": "Приложение Б. Алгоритмы действий врача",
            "content": (
                "<p>Приложение Б1. Алгоритм диагностики</p>"
                "<p>Обследование начинают с осмотра.</p>"
                "<p>Приложение Б2. Алгоритм лечения</p>"
                "<p>Лечение подбирают индивидуально.</p>"
                "<p>Приложение Г1</p>"
                "<p>Приложение № 2 к классификациям и критериям</p>"
            ),
        },
        *[
            {
                "id": f"doc_{index}",
                "title": f"{index}. Раздел {index}",
                "content": "<p>" + "Текст раздела клинической рекомендации. " * 40 + "</p>",
            }
            for index in range(2, 12)
        ],
    ]
    source.write_text(
        json.dumps(
            {
                "id": "911_1",
                "name": "Проверочная рекомендация",
                "obj": {"sections": [{"id": "doc_whole", "content": "dup"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    extracted = extract_clinical_json(source)
    blocks = {block.text: block for block in extracted.pages[0].blocks}

    for text in ("Приложение Б1. Алгоритм диагностики", "Приложение Б2. Алгоритм лечения"):
        assert blocks[text].kind == "heading"
        assert blocks[text].heading_level == 2
        assert blocks[text].metadata["promotedFrom"] == "appendix-paragraph"
        # The block keeps pointing at the source section it was read from.
        assert blocks[text].metadata["sourceSectionId"] == "doc_1"
    # A bare label and a reference to an order stay body text.
    for text in ("Приложение Г1", "Приложение № 2 к классификациям и критериям"):
        assert blocks[text].kind == "paragraph"
    assert extracted.diagnostics.promoted_headings == 2
