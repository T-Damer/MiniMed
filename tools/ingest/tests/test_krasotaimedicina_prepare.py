from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from localmed_ingest.builder import build_content_pack
from localmed_ingest.krasotaimedicina_prepare import prepare_krasotaimedicina


def test_prepare_krasotaimedicina_builds_a_linked_syndrome_document(tmp_path: Path) -> None:
    html = """
    <h1>Gilbert placeholder</h1>
    <div class="previewTextDis"><div itemprop="description"><p>Краткое описание.</p></div></div>
    <div class="detailTextDis">
      <div class="relatedMaterialBody"><ul><li>Навигация</li></ul></div>
      <h2>Общие сведения</h2>
      <p>Синдром Жильбера связан с <a href="/diseases/a/b">гипербилирубинемией</a>.</p>
      <div class="imageBlock"><a href="/upload/gilbert.jpg"><img alt="Синдром Жильбера"></a></div>
      <h2>Диагностика</h2><ul><li>Билирубин</li></ul>
    </div>
    <div class="diseaseMkbItem">E80.4</div>
    """.encode()
    raw = tmp_path / "raw"
    (raw / "records").mkdir(parents=True)
    (raw / "pages").mkdir()
    checksum = hashlib.sha256(html).hexdigest()
    (raw / "pages" / "page.html").write_bytes(html)
    (raw / "records" / "record.json").write_text(
        json.dumps(
            {
                "entityType": "disease",
                "fetchedAt": "2026-09-03T10:00:00Z",
                "rawPath": "pages/page.html",
                "rawSha256": checksum,
                "title": "Синдром Жильбера",
                "url": "https://www.krasotaimedicina.ru/diseases/a/gilbert",
                "images": [],
                "rightsStatus": "unresolved",
                "publicationState": "blocked",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    workspace = tmp_path / "workspace"
    report = prepare_krasotaimedicina(raw, workspace)

    assert report.documents_prepared == 1
    assert report.syndromes_prepared == 1
    markdown = next(workspace.glob("*.md")).read_text(encoding="utf-8")
    assert "entityType: syndrome" in markdown
    assert "- E80.4" in markdown
    assert "[гипербилирубинемией](https://www.krasotaimedicina.ru/diseases/a/b)" in markdown
    assert "[Источник изображения](https://www.krasotaimedicina.ru/upload/gilbert.jpg)" in markdown
    assert checksum in markdown

    database = tmp_path / "diseases.db"
    build_content_pack(workspace, database, include_embeddings=False)
    connection = sqlite3.connect(database)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        metadata = json.loads(
            connection.execute("SELECT metadata_json FROM documents").fetchone()[0]
        )
        assert metadata["entityType"] == "syndrome"
        assert metadata["icd10Codes"] == ["E80.4"]
    finally:
        connection.close()
