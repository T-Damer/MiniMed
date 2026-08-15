from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from localmed_ingest.builder import build_content_pack
from localmed_ingest.rls_mkb import scrape_rls_mkb

INDEX_URL = "https://www.rlsnet.ru/mkb"
DETAIL_URL = "https://www.rlsnet.ru/mkb/i679"


def test_scrape_rls_mkb_builds_searchable_classification_and_relations(tmp_path: Path) -> None:
    pages = {
        INDEX_URL: """
        <div class='b-tree__collapse'>
          <a href='/mkb/a00'>A00 Холера</a>
          <a href='/mkb/i679'>I67.9 Цереброваскулярная болезнь неуточненная</a>
        </div>
        """.encode(),
        DETAIL_URL: """
        <h1>I67.9 Цереброваскулярная болезнь неуточненная, МКБ-10</h1>
        <div id='synonyms'><ul><li>ЦВБ</li><li>Хроническая ишемия мозга</li></ul></div>
        <div id='tableWithFilters-mkb'>
          <div id='tradenamesList' name='40'>
            <div id='headingOne'>
              <a name='tradename-link' href='/drugs/example-one'>Абактал®</a>
            </div>
            <div id='collapse40' data-name='mkb'></div>
          </div>
          <div id='tradenamesList' name='41'>
            <div id='headingOne'>
              <a name='tradename-link' href='/drugs/example-two'>Препарат Два</a>
            </div>
            <div id='collapse41' data-name='mkb'></div>
          </div>
        </div>
        """.encode(),
    }
    packings = {
        "40": """
        <table>
        <thead><tr>
          <th>Действующее вещество</th><th>Лекарственная форма</th>
          <th>Дозировка</th><th>Упаковка</th><th>Производитель</th>
        </tr></thead>
        <tbody>
          <tr>
            <td>Пефлоксацин</td><td>таблетки</td><td>400 мг</td>
            <td>№10</td><td>Завод Один</td>
          </tr>
          <tr>
            <td>Пефлоксацин</td><td>раствор</td><td>400 мг/100 мл</td>
            <td>№1</td><td>Завод Два</td>
          </tr>
          <tr>
            <td>Пефлоксацин</td><td>таблетки</td><td>400 мг</td>
            <td>№10</td><td>Завод Один</td>
          </tr>
        </tbody></table>
        """,
        "41": """
        <table><tbody><tr>
          <td>Аскорбиновая кислота</td><td>таблетки</td><td>100 мг</td>
          <td>№20</td><td>Завод Три</td>
        </tr></tbody></table>
        """,
    }

    def fetch(url: str, _timeout: float) -> bytes:
        return pages[url]

    def fetch_packings(_url: str, tradename_id: str, _timeout: float) -> bytes:
        return packings[tradename_id].encode()

    workspace_dir = tmp_path / "workspace"
    report = scrape_rls_mkb(
        workspace_dir,
        raw_output=tmp_path / "raw",
        classification_url=INDEX_URL,
        detail_urls=[DETAIL_URL],
        built_at="2026-08-14T00:00:00Z",
        fetcher=fetch,
        packing_fetcher=fetch_packings,
    )

    assert report.classification_nodes == 2
    assert report.detail_pages == 1
    assert report.medicines == 2
    assert report.presentations == 3
    assert report.failures == 0
    assert report.raw_files == ()
    assert not list((tmp_path / "raw").glob("*.html"))
    assert "I67.9" in (workspace_dir / "rls.mkb.node.i67-9.md").read_text(encoding="utf-8")
    assert "source_type: rls_mkb_reference" in (workspace_dir / "rls.mkb.node.i67-9.md").read_text(
        encoding="utf-8"
    )
    detail_markdown = (workspace_dir / "rls.mkb.node.i67-9.md").read_text(encoding="utf-8")
    assert "Пефлоксацин" in detail_markdown
    assert "Завод Два" in detail_markdown
    aliases = (workspace_dir / "aliases.yaml").read_text(encoding="utf-8")
    assert "alias: Абактал" in aliases
    assert "canonicalTerm: Пефлоксацин" in aliases

    database = tmp_path / "mkb.db"
    _pack, _build_report = build_content_pack(workspace_dir, database, include_embeddings=False)
    connection = sqlite3.connect(database)
    try:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert (
            connection.execute(
                "SELECT count(*) FROM chunks WHERE normalized_text LIKE '%i67%'"
            ).fetchone()[0]
            > 0
        )
        assert connection.execute(
            "SELECT count(*) FROM knowledge_entities WHERE id LIKE 'medication.brand.%'"
        ).fetchone() == (2,)
        assert connection.execute(
            "SELECT count(*) FROM knowledge_entities WHERE id LIKE 'medication.substance.%'"
        ).fetchone() == (2,)
        assert connection.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (4,)
        assert connection.execute(
            "SELECT count(*) FROM knowledge_relations WHERE review_status = 'proposed'"
        ).fetchone() == (4,)
    finally:
        connection.close()

    stale = workspace_dir / "rls.mkb.node.stale.md"
    stale.write_text("stale", encoding="utf-8")
    scrape_rls_mkb(
        workspace_dir,
        raw_output=tmp_path / "raw",
        classification_url=INDEX_URL,
        detail_urls=[DETAIL_URL],
        fetcher=fetch,
        packing_fetcher=fetch_packings,
    )
    assert not stale.exists()


def test_scrape_rls_mkb_retries_failures_and_preserves_successful_details(tmp_path: Path) -> None:
    other_url = "https://www.rlsnet.ru/mkb/a00"
    pages = {
        INDEX_URL: """
        <div class='b-tree__collapse'>
          <a href='/mkb/a00'>A00 Холера</a>
          <a href='/mkb/i679'>I67.9 Цереброваскулярная болезнь неуточненная</a>
        </div>
        """.encode(),
        other_url: "<h1>A00 Холера, МКБ-10</h1>".encode(),
        DETAIL_URL: """
        <h1>I67.9 Цереброваскулярная болезнь неуточненная, МКБ-10</h1>
        <div id='tableWithFilters-mkb'>
          <div id='tradenamesList' name='40'>
            <a name='tradename-link' href='/drugs/example-one'>Абактал</a>
          </div>
        </div>
        """.encode(),
    }
    attempts = 0
    calls: list[str] = []

    def fetch(url: str, _timeout: float) -> bytes:
        nonlocal attempts
        calls.append(url)
        if url == DETAIL_URL:
            attempts += 1
            if attempts <= 3:
                raise RuntimeError("temporary failure")
        return pages[url]

    def fetch_packings(_url: str, _tradename_id: str, _timeout: float) -> bytes:
        return (
            "<table><tr><td>Пефлоксацин</td><td>таблетки</td><td>400 мг</td>"
            "<td>№10</td><td>Завод</td></tr></table>"
        ).encode()

    workspace_dir = tmp_path / "workspace"
    raw_dir = tmp_path / "raw"
    first = scrape_rls_mkb(
        workspace_dir,
        raw_output=raw_dir,
        classification_url=INDEX_URL,
        detail_urls=[DETAIL_URL, other_url],
        fetcher=fetch,
        packing_fetcher=fetch_packings,
    )
    assert first.failures == 1
    failure_log = json.loads((raw_dir / "rls-mkb-failures.json").read_text(encoding="utf-8"))
    assert [item["url"] for item in failure_log["failures"]] == [DETAIL_URL]
    calls.clear()

    second = scrape_rls_mkb(
        workspace_dir,
        raw_output=raw_dir,
        classification_url=INDEX_URL,
        retry_failures=True,
        fetcher=fetch,
        packing_fetcher=fetch_packings,
    )

    assert second.failures == 0
    assert other_url not in calls
    assert second.detail_pages == 2
    failure_log = json.loads((raw_dir / "rls-mkb-failures.json").read_text(encoding="utf-8"))
    assert failure_log["failures"] == []
