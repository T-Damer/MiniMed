"""KR HTML markup that used to lose meaning on the way to a module (QA 2026-10-25, KR-PARSE)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import yaml

from localmed_ingest.builder import build_content_pack
from localmed_ingest.clinical_json_import import extract_clinical_json
from localmed_ingest.models import (
    ExtractedBlock,
    RegistryPack,
    RegistrySource,
    SourceRegistry,
)
from localmed_ingest.source_registry import prepare_registry

_ONE_PIXEL_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2sAAAAASUVORK5CYII="
)


def _write_kr(path: Path, contents: list[str]) -> None:
    sections = [
        {"id": f"doc_{index + 1}", "title": f"{index + 1}. Раздел {index + 1}", "content": html}
        for index, html in enumerate(contents)
    ]
    path.write_text(
        json.dumps(
            {
                "id": path.stem,
                "name": "Проверочная рекомендация",
                "obj": {"sections": [{"id": "doc_whole", "content": "duplicate"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _blocks(tmp_path: Path, html: str) -> list[ExtractedBlock]:
    source = tmp_path / "100_1.json"
    _write_kr(source, [html])
    return [
        block for block in extract_clinical_json(source).pages[0].blocks if block.kind != "heading"
    ]


def _texts(tmp_path: Path, html: str) -> list[str]:
    return [block.text for block in _blocks(tmp_path, html)]


def test_footnote_and_exponent_digits_do_not_glue_onto_numbers(tmp_path: Path) -> None:
    texts = _texts(
        tmp_path,
        "<p>внутрь 500<sup>1</sup>-1000<sup>2</sup> мг 3 раза в сутки</p>"
        "<p>менее 0,5х10<sup>9</sup>/л; SpO<sub>2</sub> &lt; 92 %; C<sub>max</sub></p>"
        "<p>температурой ниже 30<sup>0</sup>C и выше 38<sup>о</sup>С</p>"
        "<p>Препарат<sup>®</sup>, ссылки<sup>1,2</sup>, УУР<sup>А</sup></p>",
    )

    assert texts == [
        "внутрь 500¹-1000² мг 3 раза в сутки",
        "менее 0,5х10⁹/л; SpO₂ < 92 %; Cₘₐₓ",
        "температурой ниже 30°C и выше 38°С",
        "Препарат®, ссылки¹,², УУРА",
    ]


def test_paragraphs_and_lists_inside_a_table_cell_stay_separate_lines(tmp_path: Path) -> None:
    blocks = _blocks(
        tmp_path,
        "<table><tr>"
        "<td><p>40-80 мг/сутки</p><p>25-50 мг/сутки</p></td>"
        "<td><ul><li><p>Дети 0—2 мес &gt; 60</p></li><li>Дети 2—12 мес &gt; 50</li></ul></td>"
        "<td><ol><li>Цефтриаксон</li><li>Цефотаксим</li></ol></td>"
        "<td>1,2 - 1,9<br>(110 - 170)</td>"
        "</tr></table>",
    )
    table = next(block for block in blocks if block.kind == "table_candidate")
    render = cast(dict[str, object], table.metadata["renderBlock"])
    rows = cast(list[dict[str, object]], render["rows"])
    cells = [cell["text"] for cell in cast(list[dict[str, object]], rows[0]["cells"])]

    assert cells == [
        "40-80 мг/сутки\n25-50 мг/сутки",
        "• Дети 0—2 мес > 60\n• Дети 2—12 мес > 50",
        "1. Цефтриаксон\n2. Цефотаксим",
        "1,2 - 1,9\n(110 - 170)",
    ]
    # The plain text of the table (search, chunks) keeps one line per row.
    assert table.text.count("\n") == 0
    assert "40-80 мг/сутки 25-50 мг/сутки" in table.text


def test_text_after_an_inline_image_is_kept(tmp_path: Path) -> None:
    texts = _texts(
        tmp_path,
        f'<p>Схема<img src="data:image/png;base64,{_ONE_PIXEL_PNG}" alt="Алгоритм">'
        "1 – схема назначается при температуре тела &lt;38°C</p>"
        f'<ul><li>Пункт<img src="data:image/png;base64,{_ONE_PIXEL_PNG}" alt="Рисунок">'
        "продолжение пункта</li></ul>",
    )

    assert texts == [
        "Схема",
        "Алгоритм",
        "1 – схема назначается при температуре тела <38°C",
        "- Пункт",
        "Рисунок",
        "продолжение пункта",
    ]


def test_list_items_keep_markers_and_ordered_numbers(tmp_path: Path) -> None:
    blocks = _blocks(
        tmp_path,
        "<ol><li><p>Первый критерий</p></li><li><p>Второй критерий</p><p>Пояснение</p></li></ol>"
        '<ol start="4"><li>Четвёртый</li></ol>'
        "<ul><li><p>– пункт с собственным тире</p></li><li>1) собственный номер</li>"
        "<li>Вложенный<ul><li>подпункт</li></ul></li></ul>",
    )

    assert [(block.kind, block.text) for block in blocks] == [
        ("list", "1. Первый критерий"),
        ("list", "2. Второй критерий"),
        ("paragraph", "Пояснение"),
        ("list", "4. Четвёртый"),
        ("list", "- пункт с собственным тире"),
        ("list", "1) собственный номер"),
        ("list", "- Вложенный"),
        ("list", "- подпункт"),
    ]


def test_off_label_hash_rows_stay_text_through_the_module_build(tmp_path: Path) -> None:
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source = source_root / "1028_1.json"
    long_paragraph = " ".join(["Рекомендовано сохранять исходный текст рекомендации."] * 40)
    contents = [f"<p>{long_paragraph}</p>" for _ in range(10)]
    contents[2] = (
        f"<p>{long_paragraph}</p>"
        "<p># – применение off-label вне зарегистрированных в инструкции показаний</p>"
        "<table><tr><th>Препарат</th><th>Доза</th></tr>"
        "<tr><td># Рифампицин**</td><td>10-20 мг/кг</td></tr></table>"
    )
    _write_kr(source, contents)
    registry = SourceRegistry(
        pack=RegistryPack(
            id="minimed.clinical.recommendation.1028_1",
            version="0.6.0-test",
            schema_version=2,
            title="Проверочная рекомендация",
            built_at="2026-10-25T00:00:00Z",
        ),
        sources=[
            RegistrySource(
                id="kr.rf.1028_1",
                path=source.name,
                title="Проверочная рекомендация",
                version_label="1028_1",
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
    workspace = tmp_path / "workspace"
    prepare_registry(registry_path, source_root, workspace)
    pack, _report = build_content_pack(workspace, tmp_path / "clinical.db")

    sections = pack.documents[0].sections
    titles = [section.title for section in sections]
    texts = [chunk.original_text for section in sections for chunk in section.chunks]

    assert not any(title.startswith("–") or "Рифампицин" in title for title in titles)
    assert any(text.startswith("# – применение off-label") for text in texts)
    assert any("# Рифампицин** | 10-20 мг/кг" in text for text in texts)
    assert not any("\\#" in text for text in texts)


def test_a_template_label_written_as_a_bold_list_item_stays_a_heading(tmp_path: Path) -> None:
    source = tmp_path / "149_2.json"
    long_paragraph = " ".join(["Рекомендовано сохранять исходный текст рекомендации."] * 40)
    source.write_text(
        json.dumps(
            {
                "id": "149_2",
                "name": "Проверочная рекомендация",
                "obj": {
                    "sections": [
                        {"id": "doc_whole", "content": "duplicate"},
                        {
                            "id": "doc_1",
                            "title": "1. Раздел",
                            "content": f"<p>{long_paragraph}</p>",
                        },
                        {
                            "id": "doc_a2",
                            "title": "Приложение А2. Методология разработки рекомендаций",
                            "content": _A2_CONTENT,
                        },
                    ]
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    blocks = extract_clinical_json(source).pages[0].blocks
    headings = [block.text for block in blocks if block.kind == "heading"]

    assert "Методы, использованные для качества и силы доказательств:" in headings
    assert "Методы, использованные для анализа доказательств:" in headings
    assert any(block.kind == "list" and block.text == "- Консенсус экспертов;" for block in blocks)


_A2_CONTENT = (
    "<p><strong>Методы, использованные для анализа доказательств:</strong></p>"
    "<ul><li><p>систематические обзоры с таблицами доказательств.</p></li></ul>"
    "<ul><li><p><strong>Методы, использованные для качества и силы доказательств:"
    "</strong></p></li></ul>"
    "<ul><li><p>Консенсус экспертов;</p></li></ul>"
)
