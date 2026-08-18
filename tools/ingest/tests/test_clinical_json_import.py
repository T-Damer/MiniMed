from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import cast

import yaml

from localmed_ingest.builder import build_content_pack
from localmed_ingest.clinical_json_import import extract_clinical_json
from localmed_ingest.models import RegistryPack, RegistrySource, SourceRegistry
from localmed_ingest.source_registry import prepare_registry

_ONE_PIXEL_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl2sAAAAASUVORK5CYII="
)


def test_official_json_attaches_adjacent_figure_captions(tmp_path: Path) -> None:
    source = tmp_path / "281_3.json"
    caption = "Рис. 1. Активность ПМП против штаммов S. pneumoniae в РФ (n=540)"
    source.write_text(
        json.dumps(
            {
                "id": "281_3",
                "name": "Инфекция мочевых путей",
                "obj": {
                    "sections": [
                        {"id": "doc_whole", "content": "duplicate"},
                        {
                            "id": "s1",
                            "title": "1. Диагностика",
                            "content": (
                                f'<img src="data:image/png;base64,{_ONE_PIXEL_PNG}" '
                                f'alt="image.png"><p>{caption}</p>'
                            ),
                        },
                    ]
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    extracted = extract_clinical_json(source)
    blocks = extracted.pages[0].blocks
    images = [block for block in blocks if block.kind == "image"]
    render = cast(dict[str, object], images[0].metadata["renderBlock"])

    assert images[0].text == caption
    assert render["alt"] == caption
    assert render["title"] == caption
    assert not any(block.text == "image.png" for block in blocks)
    assert not any(block.kind == "paragraph" and block.text == caption for block in blocks)


def test_official_json_preserves_tables_and_embedded_images(tmp_path: Path) -> None:
    source_root = tmp_path / "sources"
    source_root.mkdir()
    source = source_root / "714_2.json"
    long_paragraph = " ".join(
        [
            "Рекомендовано сохранять исходный текст клинической рекомендации и проверять "
            "применимость сведений к пациенту."
        ]
        * 20
    )
    sections = []
    for index in range(10):
        rich_content = ""
        if index == 0:
            rich_content = f"""
            <table>
              <caption>Проверочная таблица</caption>
              <tr><th rowspan="2">Возраст</th><th colspan="2">Показатель</th></tr>
              <tr><th>Минимум</th><th>Максимум</th></tr>
              <tr>
                <td>3 года</td>
                <td>10</td>
                <td>20<img src="data:image/png;base64,{_ONE_PIXEL_PNG}" alt="Схема в ячейке"></td>
              </tr>
            </table>
            <img src="data:image/png;base64,{_ONE_PIXEL_PNG}" alt="Проверочная схема">
            """
        sections.append(
            {
                "id": f"doc_{index + 1}",
                "title": f"{index + 1}. Раздел {index + 1}",
                "content": f"<p>{long_paragraph}</p>{rich_content}",
            }
        )
    source.write_text(
        json.dumps(
            {
                "id": "714_2",
                "name": "Внебольничная пневмония у детей",
                "obj": {"sections": [{"id": "doc_whole", "content": "duplicate"}, *sections]},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    registry = SourceRegistry(
        pack=RegistryPack(
            id="minimed.clinical.recommendation.714_2",
            version="0.6.0-test",
            schema_version=2,
            title="Внебольничная пневмония у детей",
            built_at="2026-07-27T00:00:00Z",
        ),
        sources=[
            RegistrySource(
                id="kr.rf.714_2",
                path=source.name,
                title="Внебольничная пневмония у детей",
                version_label="714_2",
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
    database = tmp_path / "clinical.db"
    pack, report = build_content_pack(workspace, database)

    document = pack.documents[0]
    rich_blocks: list[dict[str, object]] = [
        cast(dict[str, object], chunk.metadata["renderBlock"])
        for section in document.sections
        for chunk in section.chunks
        if "renderBlock" in chunk.metadata
    ]
    table = next(block for block in rich_blocks if block["kind"] == "table")
    image = next(block for block in rich_blocks if block["kind"] == "image")
    rows = cast(list[dict[str, object]], table["rows"])
    cells = cast(list[dict[str, object]], rows[0]["cells"])
    image_cells = cast(list[dict[str, object]], rows[2]["cells"])

    assert cells[0]["rowSpan"] == 2
    assert cells[1]["colSpan"] == 2
    assert len(cast(list[object], image_cells[2]["images"])) == 1
    assert cast(str, image["dataUrl"]).startswith("data:image/png;base64,")
    assert report.sqlite_integrity == "ok"

    connection = sqlite3.connect(database)
    try:
        metadata = [
            json.loads(row[0])
            for row in connection.execute(
                "SELECT metadata_json FROM chunks WHERE metadata_json LIKE '%renderBlock%'"
            )
        ]
        assert {item["renderBlock"]["kind"] for item in metadata} == {"table", "image"}
        assert connection.execute(
            "SELECT count(*) FROM chunks_fts WHERE normalized_text LIKE '%base64%'"
        ).fetchone() == (0,)
    finally:
        connection.close()
