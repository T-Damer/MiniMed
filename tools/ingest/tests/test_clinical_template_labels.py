from __future__ import annotations

import json
import unicodedata
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack
from localmed_ingest.clinical_json_import import bold_standalone_paragraphs, extract_clinical_json
from localmed_ingest.clinical_template_labels import (
    is_template_label,
    load_template_labels,
    normalize_label,
)
from localmed_ingest.models import RegistryPack, RegistrySource, SourceRegistry
from localmed_ingest.source_registry import prepare_registry

_FILLER = [
    {
        "id": f"doc_f{index}",
        "title": f"{index}. Раздел {index}",
        "content": "<p>" + "Текст раздела клинической рекомендации. " * 40 + "</p>",
    }
    for index in range(7, 14)
]


def _document(directory: Path, name: str, sections: list[dict[str, str]]) -> Path:
    source = directory / f"{name}.json"
    source.write_text(
        json.dumps(
            {
                "id": name,
                "name": "Проверочная рекомендация",
                "obj": {"sections": [{"id": "doc_whole", "content": "dup"}, *sections, *_FILLER]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return source


def test_the_curated_list_is_normalised_and_recurs_in_many_documents() -> None:
    template = load_template_labels()

    assert template.min_documents == 6
    assert len(template.labels) == len({(item.label, item.context) for item in template.labels})
    for item in template.labels:
        assert normalize_label(item.label) == item.label
        assert normalize_label(item.example) == item.label
        assert item.documents >= template.min_documents


def test_normalising_folds_case_yo_colon_slash_and_the_decomposed_y() -> None:
    assert normalize_label("Целевая аудитория данных клинических рекомендаций:") == (
        "целевая аудитория данных клинических рекомендаций"
    )
    assert normalize_label("Порядок обновления клинических рекомендаций.") == (
        "порядок обновления клинических рекомендаций"
    )
    assert normalize_label("Методы, использованные для сбора / селекции доказательств:") == (
        "методы, использованные для сбора/селекции доказательств"
    )
    assert normalize_label("С учётом  следующих документов") == "с учетом следующих документов"
    decomposed = unicodedata.normalize("NFD", "Систематический поиск")
    assert decomposed != "Систематический поиск"
    assert normalize_label(decomposed) == "систематический поиск"


@pytest.mark.parametrize(
    ("text", "section"),
    [
        (
            "Показания для плановой госпитализации в медицинскую организацию:",
            "6. Организация оказания медицинской помощи",
        ),
        (
            "Показания для экстренной госпитализации в медицинскую организацию:",
            "6. Организация оказания медицинской помощи",
        ),
        (
            "Показания к выписке пациента из медицинской организации:",
            "6. Организация оказания медицинской помощи",
        ),
        (
            "Целевая аудитория данных клинических рекомендаций:",
            "Приложение А2. Методология разработки клинических рекомендаций",
        ),
        (
            "Порядок обновления клинических рекомендаций.",
            "Приложение А2. Методология разработки клинических рекомендаций",
        ),
        ("Конфликт интересов", "Приложение А1. Состав рабочей группы разработчиков"),
        ("Критерии установления диагноза/состояния:", "2. Диагностика"),
        (
            "Ключ (интерпретация):",
            "Приложение Г1 - Г... Шкалы оценки, вопросники и другие оценочные инструменты",
        ),
    ],
)
def test_known_template_labels_are_recognised_in_their_section(text: str, section: str) -> None:
    assert is_template_label(text, section)


@pytest.mark.parametrize(
    ("text", "section"),
    [
        # Evidence levels, comments after single recommendations and table captions.
        (
            "Уровень убедительности рекомендаций С (уровень достоверности доказательств – 5)",
            "3. Лечение",
        ),
        ("УДД 4 УУР С", "3. Лечение"),
        ("Комментарии:", "3. Лечение"),
        (
            "Таблица 1. Шкала оценки уровней достоверности доказательств (УДД) для методов диагностики",
            "Приложение А2. Методология разработки клинических рекомендаций",
        ),
        # A generic word is a label only inside the section that owns it.
        ("Содержание:", "3. Лечение"),
        ("Рабочая группа:", "Приложение А1. Состав рабочей группы разработчиков"),
        ("Конфликт интересов", "Приложение А2. Методология разработки клинических рекомендаций"),
        # Author lists, patient-information topics and wording outside the template.
        ("РУКОВОДИТЕЛИ:", "Приложение А1. Состав рабочей группы разработчиков"),
        ("Лечение", "Приложение В. Информация для пациентов"),
        (
            "Показания к выписке пациента из стационара 3-й группы:",
            "6. Организация оказания медицинской помощи",
        ),
    ],
)
def test_other_bold_lines_are_not_template_labels(text: str, section: str) -> None:
    assert not is_template_label(text, section)


def test_template_labels_become_headings_one_level_under_their_section(tmp_path: Path) -> None:
    source = _document(
        tmp_path,
        "912_1",
        [
            {
                "id": "doc_6",
                "title": "6. Организация оказания медицинской помощи",
                "content": (
                    "<p>Медицинская помощь оказывается в соответствии с порядками.</p>"
                    "<p><strong>Показания для плановой госпитализации в медицинскую организацию:</strong></p>"
                    "<ul><li>Подозрение на осложнение.</li></ul>"
                    "<p><strong>Показания для экстренной госпитализации в медицинскую организацию:</strong></p>"
                    "<p>Угрожающее жизни состояние.</p>"
                    "<p><b>Показания к выписке пациента из медицинской организации</b><b>:</b></p>"
                    "<p>Стабилизация состояния.</p>"
                    "<p><strong>Показания к </strong>выписке пациента из стационара: сразу.</p>"
                    "<p>Показания для плановой госпитализации:</p>"
                    "<table><tr><td><strong>Показания для экстренной госпитализации</strong></td></tr></table>"
                ),
            },
            {
                "id": "doc_a2",
                "title": "Приложение А2. Методология разработки клинических рекомендаций",
                "content": (
                    "<p><strong>Целевая аудитория данных клинических рекомендаций:</strong></p>"
                    "<p>1. Врачи-терапевты.</p>"
                    "<p><strong>Порядок обновления клинических рекомендаций.</strong></p>"
                    "<p>Не реже одного раза в три года.</p>"
                    "<p>Приложение А2.1 – Шкала оценки уровней достоверности</p>"
                    "<p><strong>Консультация и экспертная оценка</strong></p>"
                    "<p>Проект рецензирован независимыми экспертами.</p>"
                ),
            },
        ],
    )
    extracted = extract_clinical_json(source)
    blocks = {block.text: block for block in extracted.pages[0].blocks}

    assert extracted.extractor_revision == 6
    labels = [
        block
        for block in extracted.pages[0].blocks
        if block.metadata.get("promotedFrom") == "template-label"
    ]
    assert [(block.text, block.heading_level) for block in labels] == [
        ("Показания для плановой госпитализации в медицинскую организацию:", 2),
        ("Показания для экстренной госпитализации в медицинскую организацию:", 2),
        ("Показания к выписке пациента из медицинской организации:", 2),
        ("Целевая аудитория данных клинических рекомендаций:", 2),
        ("Порядок обновления клинических рекомендаций.", 2),
        # Under the appendix sub-title promoted just above it, so one level deeper.
        ("Консультация и экспертная оценка", 3),
    ]
    assert blocks["Приложение А2.1 – Шкала оценки уровней достоверности"].heading_level == 2
    # The wording, including the colon, and the source section stay as they were.
    assert all(block.kind == "heading" for block in labels)
    assert labels[0].metadata["sourceSectionId"] == "doc_6"
    # Partly bold, plain and table lines are body text; the stored section title is untouched.
    assert blocks["Показания к выписке пациента из стационара: сразу."].kind == "paragraph"
    assert blocks["Показания для плановой госпитализации:"].kind == "paragraph"
    assert blocks["6. Организация оказания медицинской помощи"].heading_level == 1
    assert extracted.diagnostics.promoted_headings == 7


def test_a_template_label_with_no_text_under_it_stays_a_paragraph(tmp_path: Path) -> None:
    source = _document(
        tmp_path,
        "913_1",
        [
            {
                "id": "doc_a1",
                "title": "Приложение А1. Состав рабочей группы разработчиков",
                "content": (
                    "<p>Иванов И.И.</p>"
                    "<p><strong>Блок по организации медицинской помощи:</strong></p>"
                    "<p><strong>Блок по медицинской реабилитации:</strong></p>"
                    "<p>Петров П.П.</p>"
                    "<p><strong>Конфликт интересов</strong></p>"
                ),
            }
        ],
    )
    blocks = {block.text: block for block in extract_clinical_json(source).pages[0].blocks}

    # «Блок по организации …» heads nothing before its sibling, and the last label heads nothing
    # at all: the reader would hide both, so they remain paragraphs with their wording.
    for text in ("Блок по организации медицинской помощи:", "Конфликт интересов"):
        assert blocks[text].kind == "paragraph"
        assert "promotedFrom" not in blocks[text].metadata
    assert blocks["Блок по медицинской реабилитации:"].kind == "heading"


def test_bold_standalone_paragraphs_lists_the_candidates_outside_tables(tmp_path: Path) -> None:
    source = _document(
        tmp_path,
        "914_1",
        [
            {
                "id": "doc_2",
                "title": "2. Диагностика",
                "content": (
                    "<p><strong>Критерии установления диагноза/состояния:</strong></p>"
                    "<p><strong>Жалобы:</strong> боль в груди.</p>"
                    "<table><tr><td><strong>Ячейка</strong></td></tr></table>"
                ),
            }
        ],
    )

    assert bold_standalone_paragraphs(source) == [
        ("2. Диагностика", "Критерии установления диагноза/состояния:")
    ]


def test_a_scale_passport_field_named_contents_is_not_taken_for_a_table_of_contents(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source = _document(
        source_root,
        "915_1",
        [
            {
                "id": "doc_g",
                "title": "Приложение Г1 - Г... Шкалы оценки, вопросники",
                "content": (
                    "<p>Приложение Г1. Шкала оценки боли</p>"
                    "<p><strong>Тип (подчеркнуть):</strong></p>"
                    "<p>- шкала оценки</p>"
                    "<p><strong>Содержание (шаблон):</strong></p>"
                    "<p>Оцените боль от 0 до 10.</p>"
                    "<p><strong>Ключ (интерпретация):</strong></p>"
                    "<p>0 - боли нет.</p>"
                    "<p>Приложение Г2. Шкала оценки тревоги</p>"
                    "<p>Описание второй шкалы.</p>"
                ),
            }
        ],
    )
    registry = SourceRegistry(
        pack=RegistryPack(
            id="minimed.clinical.recommendation.915_1",
            version="0.6.0-test",
            schema_version=2,
            title="Проверочная рекомендация",
            built_at="2026-10-09T00:00:00Z",
        ),
        sources=[
            RegistrySource(
                id="kr.rf.915_1",
                path=source.name,
                title="Проверочная рекомендация",
                version_label="915_1",
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
    prepare_registry(registry_path, source_root, tmp_path / "workspace")
    pack, _report = build_content_pack(tmp_path / "workspace", tmp_path / "clinical.db")

    sections = {section.title: section for section in pack.documents[0].sections}
    for title in (
        "Приложение Г1. Шкала оценки боли",
        "Тип (подчеркнуть):",
        "Содержание (шаблон):",
        "Ключ (интерпретация):",
        "Приложение Г2. Шкала оценки тревоги",
    ):
        assert title in sections
    assert sections["Содержание (шаблон):"].section_path == [
        "Приложение Г1 - Г... Шкалы оценки, вопросники",
        "Приложение Г1. Шкала оценки боли",
        "Содержание (шаблон):",
    ]
    assert [chunk.original_text for chunk in sections["Ключ (интерпретация):"].chunks] == [
        "0 - боли нет."
    ]
