from __future__ import annotations

from pathlib import Path
from typing import cast

from localmed_ingest.html_import import extract_html
from localmed_ingest.models import RegistrySource
from localmed_ingest.source_registry import render_prepared_markdown


def fixture_html() -> str:
    paragraphs = " ".join(
        [
            "Рекомендовано проводить клиническую оценку пациента, учитывать возраст, тяжесть состояния, "
            "результаты обследования и сведения из действующей редакции клинических рекомендаций."
        ]
        * 35
    )
    return f"""
    <!doctype html>
    <html lang="ru">
      <head><title>Клинические рекомендации</title><style>.hidden {{ display:none }}</style></head>
      <body>
        <nav><a>Новости</a><a>Документы</a></nav>
        <h1>Пневмония (внебольничная)</h1>
        <p>Код 714. Редакция 2.</p>
        <main>
          <h3>1.1 Определение заболевания или состояния</h3>
          <p>{paragraphs}</p>
          <h3>2. Диагностика</h3>
          <p>Диагностика включает анамнез, осмотр, пульсоксиметрию и исследования по показаниям.</p>
          <table>
            <tr><th>Возраст</th><th>Показатель</th></tr>
            <tr><td>До 5 лет</td><td>Тахипноэ</td></tr>
          </table>
          <h3>3. Лечение</h3>
          <ul><li>Оценить тяжесть.</li><li>Выбрать лечение по показаниям.</li></ul>
        </main>
        <footer><p>Поделиться</p></footer>
      </body>
    </html>
    """


def registry_source() -> RegistrySource:
    return RegistrySource.model_validate(
        {
            "id": "kr.rf.714_2.pneumonia.full",
            "path": "pneumonia.html",
            "title": "Внебольничная пневмония у детей",
            "shortTitle": "Пневмония у детей",
            "versionLabel": "714_2-2025-full",
            "sourceType": "clinical_recommendation",
            "status": "active",
            "specialties": ["pediatrics", "pulmonology"],
            "ageGroups": ["children"],
            "format": "html",
            "metadata": {
                "officialId": "714_2",
                "contentMode": "full-source-text",
            },
        }
    )


def test_html_extraction_keeps_clinical_sections_and_tables(tmp_path: Path) -> None:
    source = tmp_path / "pneumonia.html"
    source.write_text(fixture_html(), encoding="utf-8")

    extracted = extract_html(source)
    blocks = [block for page in extracted.pages for block in page.blocks]

    assert extracted.source_format == "html"
    assert extracted.diagnostics.character_count > 5_000
    assert extracted.diagnostics.heading_candidates == 3
    assert extracted.diagnostics.table_candidates == 1
    assert extracted.diagnostics.requires_review is False
    assert blocks[0].text == "1.1 Определение заболевания или состояния"
    assert all("Новости" not in block.text for block in blocks)
    assert any(block.kind == "table_candidate" and "Возраст | Показатель" in block.text for block in blocks)


def test_html_preparation_renders_source_markers_and_raw_checksum(tmp_path: Path) -> None:
    source_path = tmp_path / "pneumonia.html"
    source_path.write_text(fixture_html(), encoding="utf-8")
    extracted = extract_html(source_path)

    markdown = render_prepared_markdown(registry_source(), extracted)

    assert "source_checksum: sha256:" in markdown
    assert "source_file: pneumonia.html" in markdown
    assert "<!-- localmed:source" in markdown
    assert "<!-- localmed:review table-candidate -->" in markdown
    assert "# 1.1 Определение заболевания или состояния" in markdown
    assert cast(dict[str, object], registry_source().metadata)["contentMode"] == "full-source-text"
